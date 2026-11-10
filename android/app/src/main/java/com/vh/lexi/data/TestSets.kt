package com.vh.lexi.data

import com.vh.lexi.core.TestSet
import com.vh.lexi.core.testSetFromJson
import com.vh.lexi.core.toJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Bộ đề on this device only (web: data/testsets.ts, IndexedDB `lexi-private`): one JSON file per set in the app's
 * private files, and its media (audio, page pictures) in a folder of its own. Never synced, never in the JSON export,
 * and the app opts out of Android backup (AndroidManifest allowBackup=false), so the test content stays on the phone.
 */
class TestSetStore(root: File) {
    private val dir = File(root, "testsets").apply { mkdirs() }
    private val mediaRoot = File(dir, "media")
    private val lock = Mutex()
    private var loaded = false
    private val _sets = MutableStateFlow<List<TestSet>>(emptyList())
    val sets: StateFlow<List<TestSet>> = _sets

    private fun fileOf(id: String) = File(dir, "${safe(id)}.json")
    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_-]"), "_")

    /** Newest first, as on the web. A file that does not parse (a write cut short) is skipped, not fatal. */
    suspend fun load(force: Boolean = false): List<TestSet> = lock.withLock {
        if (loaded && !force) return _sets.value
        val all = withContext(Dispatchers.IO) {
            dir.listFiles { f -> f.isFile && f.name.endsWith(".json") }.orEmpty().mapNotNull { f ->
                runCatching { testSetFromJson(JSONObject(f.readText())) }.getOrNull()
            }
        }.sortedByDescending { it.createdAt }
        loaded = true
        _sets.value = all
        all
    }

    suspend fun save(set: TestSet) = lock.withLock {
        val next = set.copy(updatedAt = System.currentTimeMillis())
        withContext(Dispatchers.IO) {
            dir.mkdirs()
            val tmp = File(dir, "${safe(set.id)}.tmp")
            tmp.writeText(next.toJson().toString())
            if (!tmp.renameTo(fileOf(set.id))) {
                fileOf(set.id).delete()
                check(tmp.renameTo(fileOf(set.id))) { "could not store the test set" }
            }
        }
        _sets.value = (listOf(next) + _sets.value.filter { it.id != set.id }).sortedByDescending { it.createdAt }
    }

    /** The set and every file stored for it (audio, pictures). */
    suspend fun delete(id: String) = lock.withLock {
        withContext(Dispatchers.IO) {
            fileOf(id).delete()
            File(mediaRoot, safe(id)).deleteRecursively()
        }
        _sets.value = _sets.value.filter { it.id != id }
    }

    /** Where a media item of a set is kept; keys are `${setId}:a0` (audio) or `${setId}:p3` (a page picture). */
    fun mediaFile(key: String): File {
        val setId = key.substringBefore(':')
        return File(File(mediaRoot, safe(setId)).apply { mkdirs() }, safe(key.substringAfter(':')))
    }
}
