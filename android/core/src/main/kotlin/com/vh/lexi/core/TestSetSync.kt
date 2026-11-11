package com.vh.lexi.core

import org.json.JSONObject

/**
 * Bộ đề across devices (web: lib/testsync.ts, the reference; vectors in shared/vectors/testsync.json).
 *
 *  - Cloud Storage `users/{uid}/testsets/{id}/set.json`: the set as imported, written once; `.../media/a0`, `.../media/p3`:
 *    the audio files and page pictures (device keys `${id}:a0`…).
 *  - Firestore `users/{uid}/testsets/{id}`: a small document to list the set and continue it anywhere; `state` holds the
 *    attempt and the replay positions as JSON text.
 */
const val SET_FILE = "set.json"
const val MAX_SETS = 200

data class CloudMeta(
    val id: String,
    val name: String,
    val section: String,
    val createdAt: Long,
    val updatedAt: Long,
    val files: List<String>,
    val bytes: Long,
    val questions: Int,
    val state: String,
)

/** Device media key → path in the set's folder: "abc:a0" → "media/a0". */
fun mediaPath(key: String): String = "media/" + key.substring(key.indexOf(':') + 1)

/** Path in the set's folder → device media key; null for set.json. */
fun mediaKey(id: String, path: String): String? = if (path.startsWith("media/")) "$id:${path.substring(6)}" else null

fun filesOf(set: TestSet): List<String> = listOf(SET_FILE) + set.tracks.map { mediaPath(it.key) } + set.pictures.map { mediaPath(it.key) }

/** What changes while the learner works, as stored in `state`. Clips by question position. */
fun progressOf(set: TestSet): String {
    val clips = JSONObject()
    for (q in set.questions) q.clip?.let { clips.put(q.i.toString(), JSONObject().put("track", it.track).put("from", it.from).put("to", it.to)) }
    val p = JSONObject().put("clips", clips)
    set.attempt?.let { a ->
        val answers = JSONObject()
        for (k in a.answers.keys.sorted()) answers.put(k.toString(), a.answers[k])
        p.put("attempt", JSONObject().put("startedAt", a.startedAt).put("elapsedMs", a.elapsedMs).put("answers", answers).apply {
            a.finishedAt?.let { put("finishedAt", it) }
            a.resultNoteId?.let { put("resultNoteId", it) }
        })
    }
    return p.toString()
}

private val DIGITS = Regex("^\\d+$")
private val LETTER = Regex("^[A-D]$")

/** A JSON number that is a whole number (as JS Number.isInteger), else null. */
private fun JSONObject.int(k: String): Long? {
    val v = opt(k)
    if (v !is Number) return null
    val d = v.toDouble()
    return if (d.isFinite() && d == Math.floor(d)) d.toLong() else null
}

/**
 * The set with the progress in [state] in place of its own: the attempt replaced (or gone), every question's clip as
 * [state] has it. Text that does not parse, or has the wrong shape, changes nothing.
 */
fun withProgress(set: TestSet, state: String): TestSet {
    val p = try {
        val t = state.trim()
        if (!t.startsWith("{")) return set
        JSONObject(t)
    } catch (_: Exception) {
        return set
    }
    val clips = p.opt("clips") as? JSONObject ?: return set
    val attempt: Attempt? = when (val x = p.opt("attempt")) {
        null -> null
        is JSONObject -> {
            val startedAt = x.int("startedAt") ?: return set
            val elapsedMs = x.int("elapsedMs") ?: return set
            val ans = x.opt("answers") as? JSONObject
            val answers = sortedMapOf<Int, String>()
            ans?.keys()?.forEach { k ->
                val v = ans.opt(k)
                if (DIGITS.matches(k) && v is String && LETTER.matches(v)) answers[k.toInt()] = v
            }
            val rid = x.opt("resultNoteId")
            Attempt(startedAt, elapsedMs, answers, x.int("finishedAt"), (rid as? String)?.ifEmpty { null })
        }
        else -> return set
    }
    val questions = set.questions.map { q ->
        val v = clips.opt(q.i.toString()) as? JSONObject
        val t = v?.int("track"); val f = v?.int("from"); val e = v?.int("to")
        q.copy(clip = if (t != null && f != null && e != null) Clip(t.toInt(), f, e) else null)
    }
    return set.copy(questions = questions, attempt = attempt)
}

/** The set as uploaded in set.json: without the attempt (in `state`) and this device's sync mark. */
fun contentOf(set: TestSet): TestSet = set.copy(attempt = null, syncedAt = null)

fun metaOf(set: TestSet, bytes: Long): CloudMeta = CloudMeta(
    id = set.id, name = set.name.take(200).ifEmpty { "Bộ đề" }, section = set.section.ifEmpty { "rc" }, createdAt = set.createdAt,
    updatedAt = set.updatedAt, files = filesOf(set), bytes = bytes, questions = set.questions.size, state = progressOf(set),
)

/** See lib/testsync.ts SyncAction. */
data class SyncAction(val kind: String, val id: String) {
    companion object {
        const val UPLOAD = "upload"
        const val PUSH = "push"
        const val PULL = "pull"
        const val DROP = "drop"
        const val REMOTE = "remote"
    }
}

data class SyncSide(val id: String, val updatedAt: Long, val syncedAt: Long? = null)

/** What to do with every set (web: planSync). Only call it with a list from the server: a missing document means "deleted". */
fun planSync(local: List<SyncSide>, remote: List<SyncSide>): List<SyncAction> {
    val r = remote.associateBy { it.id }
    val out = mutableListOf<SyncAction>()
    for (l in local) {
        val m = r[l.id]
        when {
            m == null -> out += SyncAction(if (l.syncedAt != null && l.syncedAt != 0L) SyncAction.DROP else SyncAction.UPLOAD, l.id)
            l.updatedAt > m.updatedAt -> out += SyncAction(SyncAction.PUSH, l.id)
            m.updatedAt > l.updatedAt || l.syncedAt == null || l.syncedAt == 0L -> out += SyncAction(SyncAction.PULL, l.id)
        }
    }
    val here = local.map { it.id }.toSet()
    for (m in remote) if (m.id !in here) out += SyncAction(SyncAction.REMOTE, m.id)
    return out
}
