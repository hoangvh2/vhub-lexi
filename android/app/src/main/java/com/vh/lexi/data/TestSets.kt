package com.vh.lexi.data

import android.util.Log
import com.vh.lexi.cloud.SetsCloud
import com.vh.lexi.core.CloudMeta
import com.vh.lexi.core.SET_FILE
import com.vh.lexi.core.SyncAction
import com.vh.lexi.core.SyncSide
import com.vh.lexi.core.TestSet
import com.vh.lexi.core.contentOf
import com.vh.lexi.core.mediaKey
import com.vh.lexi.core.mediaPath
import com.vh.lexi.core.metaOf
import com.vh.lexi.core.planSync
import com.vh.lexi.core.testSetFromJson
import com.vh.lexi.core.toJson
import com.vh.lexi.core.withProgress
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** What the Bộ đề sync is doing ("" when idle), its last problem, and whether the account is in use at all. */
data class SetsSyncStatus(val busy: String = "", val error: String = "", val on: Boolean = false)

/**
 * Bộ đề (web: data/testsets.ts): one JSON file per set in the app's private files and its media (audio, page pictures)
 * in a folder of its own, so a test opens and plays offline; when signed in, also in the learner's own account so
 * every device has it (core/TestSetSync.kt, cloud/SetsCloud.kt). Never in the JSON export; the app opts out of Android
 * backup (AndroidManifest allowBackup=false).
 */
class TestSetStore(root: File, private val scope: CoroutineScope) {
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
            dir.listFiles { f -> f.isFile && f.name.endsWith(".json") && f.name != PENDING }.orEmpty().mapNotNull { f ->
                runCatching { testSetFromJson(JSONObject(f.readText())) }.getOrNull()
            }
        }.sortedByDescending { it.createdAt }
        loaded = true
        _sets.value = all
        all
    }

    /** Dated now (never older than what is stored: the next sync compares it with the account's). */
    private fun dated(set: TestSet) = set.copy(updatedAt = maxOf(System.currentTimeMillis(), set.updatedAt + 1))

    suspend fun save(set: TestSet) {
        val next = dated(set)
        write(next)
        syncSoon(next.id)
    }

    /**
     * Shows [set] at once and writes it in [scope]: an answer chosen or the clock paused as the screen closes is already
     * there if the test is opened again before the file is written.
     */
    fun saveSoon(scope: CoroutineScope, set: TestSet) {
        if (set.id in deleted) return
        val next = dated(set)
        _sets.update { list -> (listOf(next) + list.filter { it.id != set.id }).sortedByDescending { it.createdAt } }
        scope.launch {
            write(next)
            syncSoon(next.id)
        }
    }

    /** Stored as given (no new date). */
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

    private suspend fun deleteLocal(id: String) = lock.withLock {
        deleted += id
        withContext(Dispatchers.IO) {
            fileOf(id).delete()
            File(mediaRoot, safe(id)).deleteRecursively()
        }
        _sets.value = _sets.value.filter { it.id != id }
    }

    /** The set and every file stored for it (audio, pictures); once it was uploaded, from the account too (every device). */
    suspend fun delete(id: String) {
        val set = _sets.value.firstOrNull { it.id == id }
        val stub = _remote.value.firstOrNull { it.id == id }
        deleteLocal(id)
        _remote.update { l -> l.filter { it.id != id } }
        val c = cloud ?: return
        if (set?.syncedAt == null && stub == null) return
        addPending(id, stub?.files ?: set?.let { metaOf(it, 0).files } ?: listOf(SET_FILE))
        runCatching { cloudLock.withLock { flushDeletes(c) } }.onFailure { Log.w(TAG, "delete in the account", it) }
    }

    /** Where a media item of a set is kept; keys are `${setId}:a0` (audio) or `${setId}:p3` (a page picture). */
    fun mediaFile(key: String): File {
        val setId = key.substringBefore(':')
        return File(File(mediaRoot, safe(setId)).apply { mkdirs() }, safe(key.substringAfter(':')))
    }

    // ---------------------------------------------------------------- in the account (every device)

    @Volatile private var cloud: SetsCloud? = null
    private val _remote = MutableStateFlow<List<CloudMeta>>(emptyList())
    /** Sets in the account that are not on this phone yet: listed, downloaded when opened. */
    val remote: StateFlow<List<CloudMeta>> = _remote
    private val _status = MutableStateFlow(SetsSyncStatus())
    val status: StateFlow<SetsSyncStatus> = _status
    private val bytesById = java.util.concurrent.ConcurrentHashMap<String, Long>()
    /** One cloud job at a time: an upload, a download and a sync never interleave. */
    private val cloudLock = Mutex()

    /** Signed in: sets go to the account. Null (signed out, phone-only build): this phone only. */
    fun useCloud(c: SetsCloud?) {
        cloud = c
        _remote.value = emptyList()
        bytesById.clear()
        _status.value = SetsSyncStatus(on = c != null)
    }

    private fun busy(text: String) = _status.update { it.copy(busy = text) }
    private fun failed(text: String) = _status.update { it.copy(busy = "", error = text) }
    private fun idle() = _status.update { it.copy(busy = "", error = "") }
    private fun pct(sent: Long, total: Long) = "${minOf(100L, Math.round(sent * 100.0 / maxOf(1L, total)))}%"

    // Deletions not yet done in the account (offline): retried by every sync, so a deleted set does not come back.
    private val pendingFile = File(dir, PENDING)
    private fun pending(): Map<String, List<String>> = runCatching {
        val o = JSONObject(pendingFile.readText())
        o.keys().asSequence().associateWith { k -> o.getJSONArray(k).let { a -> List(a.length()) { a.getString(it) } } }
    }.getOrDefault(emptyMap())
    private fun writePending(m: Map<String, List<String>>) {
        runCatching { pendingFile.writeText(JSONObject().apply { m.forEach { (k, v) -> put(k, JSONArray(v)) } }.toString()) }
    }
    @Synchronized private fun addPending(id: String, files: List<String>) = writePending(pending() + (id to files))
    @Synchronized private fun donePending(id: String) = writePending(pending() - id)

    private suspend fun flushDeletes(c: SetsCloud) {
        for ((id, files) in pending()) {
            c.remove(id, files)
            donePending(id)
        }
    }

    private fun typeOf(path: String, set: TestSet): String {
        if (path == SET_FILE) return "application/json"
        if (path.startsWith("media/p")) return "image/jpeg"
        val track = set.tracks.firstOrNull { mediaPath(it.key) == path }?.name?.lowercase().orEmpty()
        return when {
            track.endsWith(".mp3") -> "audio/mpeg"
            track.endsWith(".m4a") || track.endsWith(".mp4") || track.endsWith(".aac") -> "audio/mp4"
            track.endsWith(".wav") -> "audio/wav"
            track.endsWith(".ogg") || track.endsWith(".opus") -> "audio/ogg"
            else -> "application/octet-stream"
        }
    }

    private suspend fun upload(c: SetsCloud, set: TestSet) {
        val json = File(dir, "${safe(set.id)}.upload").apply { writeText(contentOf(set).toJson().toString()) }
        try {
            val media = (set.tracks.map { it.key } + set.pictures.map { it.key }).map { mediaPath(it) to mediaFile(it) }.filter { it.second.exists() }
            val total = json.length() + media.sumOf { it.second.length() }
            val label = "Đang đưa “${set.name}” lên tài khoản"
            busy("$label…")
            c.putFile(set.id, SET_FILE, json, "application/json")
            var done = json.length()
            for ((path, f) in media) {
                c.putFile(set.id, path, f, typeOf(path, set)) { sent -> busy("$label… ${pct(done + sent, total)}") }
                done += f.length()
            }
            // The document last: another device lists the set only once every file it names is there.
            val meta = metaOf(set, total).copy(files = listOf(SET_FILE) + media.map { it.first })
            c.putMeta(meta)
            bytesById[set.id] = total
            markSynced(set.id, meta.updatedAt)
        } finally {
            json.delete()
        }
    }

    /** Records that version [updatedAt] of the set is in the account, unless it changed again meanwhile. */
    private suspend fun markSynced(id: String, updatedAt: Long) {
        val now = _sets.value.firstOrNull { it.id == id } ?: return
        if (now.updatedAt == updatedAt) write(now.copy(syncedAt = System.currentTimeMillis()))
    }

    private suspend fun push(c: SetsCloud, set: TestSet) {
        c.putMeta(metaOf(set, bytesById[set.id] ?: 0))
        markSynced(set.id, set.updatedAt)
    }

    /** Lists the account and brings both sides together (planSync). Runs when the Bộ đề screen opens. */
    suspend fun sync() {
        val c = cloud ?: return
        cloudLock.withLock {
            try {
                load()
                flushDeletes(c)
                busy("Đang đồng bộ…")
                val remote = c.list()
                val byId = remote.associateBy { it.id }
                remote.forEach { bytesById[it.id] = it.bytes }
                val stubs = mutableListOf<CloudMeta>()
                val plan = planSync(_sets.value.map { SyncSide(it.id, it.updatedAt, it.syncedAt) }, remote.map { SyncSide(it.id, it.updatedAt) })
                for (a in plan) {
                    val set = _sets.value.firstOrNull { it.id == a.id }
                    val m = byId[a.id]
                    when (a.kind) {
                        SyncAction.UPLOAD -> if (set != null) upload(c, set)
                        SyncAction.PUSH -> if (set != null) push(c, set)
                        SyncAction.PULL -> if (set != null && m != null && set.updatedAt <= m.updatedAt) {
                            write(withProgress(set, m.state).copy(name = m.name, updatedAt = m.updatedAt, syncedAt = System.currentTimeMillis()))
                        }
                        SyncAction.DROP -> deleteLocal(a.id)
                        SyncAction.REMOTE -> if (m != null) stubs += m
                    }
                }
                _remote.value = stubs.sortedByDescending { it.createdAt }
                idle()
            } catch (e: Exception) {
                Log.w(TAG, "sync", e)
                failed("Chưa đồng bộ được (mất mạng?). Đề trên máy này vẫn dùng bình thường.")
            }
        }
    }

    private var soonJob: Job? = null
    private val soonIds = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    /** After a change: a new set is uploaded, a changed one's progress written, a moment later (answers come in bursts). */
    private fun syncSoon(id: String) {
        if (cloud == null) return
        soonIds += id
        synchronized(this) {
            soonJob?.cancel()
            soonJob = scope.launch {
                delay(SOON_MS)
                flushSoon()
            }
        }
    }

    private suspend fun flushSoon() {
        val ids = synchronized(soonIds) { soonIds.toList().also { soonIds.clear() } }
        val c = cloud ?: return
        cloudLock.withLock {
            for (id in ids) {
                val set = _sets.value.firstOrNull { it.id == id } ?: continue
                try {
                    if (set.syncedAt != null) push(c, set) else upload(c, set)
                    idle()
                } catch (e: Exception) {
                    Log.w(TAG, "save", e)
                    failed("Chưa đồng bộ được (mất mạng?). Lexi sẽ thử lại lần sau mở Bộ đề.")
                }
            }
        }
    }

    /** Brings a set that is only in the account onto this phone (its questions, audio and pictures). */
    suspend fun download(id: String): TestSet {
        val c = cloud ?: error("not signed in")
        return cloudLock.withLock {
            val m = _remote.value.firstOrNull { it.id == id } ?: error("not in the account")
            val label = "Đang tải “${m.name}” về máy"
            try {
                busy("$label…")
                val tmp = File(dir, "${safe(id)}.download")
                c.getFile(id, SET_FILE, tmp)
                val content = withContext(Dispatchers.IO) { testSetFromJson(JSONObject(tmp.readText())).also { tmp.delete() } }
                check(content.id == id) { "set.json does not match" }
                var got = 0L
                for (f in m.files) {
                    val key = mediaKey(id, f) ?: continue
                    val out = mediaFile(key)
                    c.getFile(id, f, out)
                    got += out.length()
                    busy("$label… ${pct(got, m.bytes)}")
                }
                deleted -= id
                val set = withProgress(contentOf(content), m.state).copy(name = m.name, updatedAt = m.updatedAt, syncedAt = System.currentTimeMillis())
                write(set)
                _remote.update { l -> l.filter { it.id != id } }
                idle()
                set
            } catch (e: Exception) {
                // Whatever arrived of its media goes again: a half-downloaded set is not left behind.
                withContext(Dispatchers.IO) { File(mediaRoot, safe(id)).deleteRecursively() }
                failed("Không tải được bộ đề (mất mạng?). Thử lại khi có mạng.")
                throw e
            }
        }
    }

    /** Tests: run the queued upload or progress write now. */
    suspend fun flushSync() {
        synchronized(this) { soonJob?.cancel(); soonJob = null }
        flushSoon()
    }

    companion object {
        private const val TAG = "Lexi"
        private const val PENDING = "pending-deletes.json"
        const val SOON_MS = 1500L
    }
}
