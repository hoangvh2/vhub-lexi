package com.vh.lexi.data

import com.vh.lexi.core.TestSet
import com.vh.lexi.core.testSetFromJson
import com.vh.lexi.core.toJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.update
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
    private val deleted: MutableSet<String> = java.util.Collections.synchronizedSet(mutableSetOf())
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

    suspend fun save(set: TestSet) = write(set.copy(updatedAt = System.currentTimeMillis()))

    /**
     * Shows [set] at once and writes it in [scope]: an answer chosen or the clock paused as the screen closes is already
     * there if the test is opened again before the file is written.
     */
    fun saveSoon(scope: CoroutineScope, set: TestSet) {
        if (set.id in deleted) return
        val next = set.copy(updatedAt = System.currentTimeMillis())
        _sets.update { list -> (listOf(next) + list.filter { it.id != set.id }).sortedByDescending { it.createdAt } }
        scope.launch { write(next) }
    }

    private suspend fun write(next: TestSet): Unit = lock.withLock {
        val set = next
        // A write still queued when its set was deleted must not bring the file back.
        if (set.id in deleted) return@withLock
        withContext(Dispatchers.IO) {
            dir.mkdirs()
            val tmp = File(dir, "${safe(set.id)}.tmp")
            tmp.writeText(next.toJson().toString())
            if (!tmp.renameTo(fileOf(set.id))) {
                fileOf(set.id).delete()
                check(tmp.renameTo(fileOf(set.id))) { "could not store the test set" }
            }
        }
        // Writes finish in order, but a newer version may already be shown (saveSoon): never put an older one back.
        _sets.update { list ->
            if (list.any { it.id == set.id && it.updatedAt > next.updatedAt }) list
            else (listOf(next) + list.filter { it.id != set.id }).sortedByDescending { it.createdAt }
        }
    }

    /** The set and every file stored for it (audio, pictures). */
    suspend fun delete(id: String) = lock.withLock {
        deleted += id
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
