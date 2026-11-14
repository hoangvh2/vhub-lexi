package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays shared/vectors/testsync.json (made by web/test/testsync-vectors.ts): what the Bộ đề document carries, and planSync. */
class TestSetSyncVectorsTest {
    private val v = JSONObject(vectors("testsync.json"))
    private val set = testSetFromJson(v.getJSONObject("set"))

    private fun same(expected: Any?, actual: Any?, what: String) {
        val ok = when (expected) {
            is JSONObject -> actual is JSONObject && expected.similar(actual)
            is JSONArray -> actual is JSONArray && expected.similar(actual)
            JSONObject.NULL, null -> actual == null || actual == JSONObject.NULL
            else -> expected == actual
        }
        assertTrue(ok, "$what\nexpected: $expected\nactual:   $actual")
    }
    private fun attemptJson(a: Attempt?): Any = a?.let {
        JSONObject().put("startedAt", it.startedAt).put("elapsedMs", it.elapsedMs)
            .put("answers", JSONObject().apply { it.answers.forEach { (k, l) -> put(k.toString(), l) } })
            .apply { it.finishedAt?.let { f -> put("finishedAt", f) }; it.resultNoteId?.let { r -> put("resultNoteId", r) } }
    } ?: JSONObject.NULL
    private fun clipJson(c: Clip?): Any = c?.let { JSONObject().put("track", it.track).put("from", it.from).put("to", it.to) } ?: JSONObject.NULL
    private fun objs(a: JSONArray) = List(a.length()) { a.getJSONObject(it) }
    private fun sides(a: JSONArray) = objs(a).map { SyncSide(it.getString("id"), it.getLong("updatedAt"), if (it.has("syncedAt")) it.getLong("syncedAt") else null) }

    @Test
    fun progressIsTheSameJson() {
        for (c in objs(v.getJSONArray("progress"))) {
            val s = testSetFromJson(c.getJSONObject("set"))
            same(c.getJSONObject("out"), JSONObject(progressOf(s)), "progressOf")
        }
    }

    @Test
    fun progressFromAnotherDevice() {
        for (c in objs(v.getJSONArray("withProgress"))) {
            val state = c.getString("state")
            val out = withProgress(set, state)
            same(c.get("attempt"), attemptJson(out.attempt).let { if (it == JSONObject.NULL) null else it }, "attempt for $state")
            val parts = if (out.parts.isEmpty()) null else JSONObject().apply { out.parts.toSortedMap().forEach { (k, a) -> put(k.toString(), attemptJson(a)) } }
            same(c.get("parts"), parts, "parts for $state")
            same(c.getJSONArray("clips"), JSONArray(out.questions.map { clipJson(it.clip) }), "clips for $state")
        }
    }

    @Test
    fun filesPathsAndDocument() {
        same(v.getJSONArray("files"), JSONArray(filesOf(set)), "filesOf")
        for (c in objs(v.getJSONArray("paths"))) assertEquals(c.getString("path"), mediaPath(c.getString("key")))
        for (c in objs(v.getJSONArray("keys"))) assertEquals(if (c.isNull("key")) null else c.getString("key"), mediaKey("s1", c.getString("path")))
        val m = v.getJSONObject("meta")
        val k = metaOf(set, 1234)
        assertEquals(m.getString("id"), k.id)
        assertEquals(m.getString("name"), k.name)
        assertEquals(m.getString("section"), k.section)
        assertEquals(m.getLong("createdAt"), k.createdAt)
        assertEquals(m.getLong("updatedAt"), k.updatedAt)
        same(m.getJSONArray("files"), JSONArray(k.files), "meta files")
        assertEquals(m.getLong("bytes"), k.bytes)
        assertEquals(m.getInt("questions"), k.questions)
        same(JSONObject(m.getString("state")), JSONObject(k.state), "meta state")
        // The content leaves out the attempt and the sync mark, and reads back as the same set.
        val content = contentOf(set.copy(syncedAt = 9))
        assertEquals(null, content.attempt)
        assertEquals(null, content.syncedAt)
        assertEquals(emptyMap(), contentOf(set.copy(parts = mapOf(5 to Attempt(1, 2, emptyMap())))).parts)
        assertEquals(set.questions, testSetFromJson(content.toJson()).questions)
    }

    @Test
    fun plans() {
        for (c in objs(v.getJSONArray("plans"))) {
            val out = planSync(sides(c.getJSONArray("local")), sides(c.getJSONArray("remote")))
            same(c.getJSONArray("out"), JSONArray(out.map { JSONObject().put("kind", it.kind).put("id", it.id) }), "plan $c")
        }
    }
}
