package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays shared/vectors/import.json and readcheck.json, produced by the TypeScript implementation. */
class ImportVectorsTest {
    private fun JSONObject.toPlain(): Map<String, Any?> = keySet().associateWith { k -> plain(get(k)) }
    private fun plain(v: Any?): Any? = when (v) {
        is JSONObject -> v.toPlain()
        is JSONArray -> List(v.length()) { plain(v.get(it)) }
        JSONObject.NULL -> null
        else -> v
    }

    @Test
    fun `review rows, checks and grammar fields match the web app`() {
        val cases = JSONArray(vectors("import.json")).objects()
        assertTrue(cases.size >= 12)
        for (c in cases) {
            val name = c.getString("name")
            val existing = c.getJSONArray("existing").strings().toSet()
            val raw = mapOf("questions" to List(c.getJSONArray("questions").length()) { plain(c.getJSONArray("questions").get(it)) })
            val (drafts, skipped) = draftsFrom(extractedFrom(raw), existing)
            assertEquals(c.getInt("skipped"), skipped, "$name skipped")
            val want = c.getJSONArray("drafts").objects()
            assertEquals(want.size, drafts.size, "$name rows")
            for ((i, w) in want.withIndex()) {
                val d = drafts[i]
                val where = "$name row $i"
                assertEquals(w.optIntOrNull("number"), d.number, "$where number")
                assertEquals(w.getBoolean("include"), d.include, "$where include")
                assertEquals(if (w.isNull("correct")) null else w.getString("correct"), d.correct, "$where correct")
                val f = w.getJSONObject("fields")
                assertEquals(f.keySet().associateWith { f.getString(it) }, d.grammarFields(), "$where fields")
                val p = d.problems(existing)
                assertEquals(w.getJSONObject("problems").getJSONArray("block").strings(), p.block, "$where block")
                assertEquals(w.getJSONObject("problems").getJSONArray("warn").strings(), p.warn, "$where warn")
                assertEquals(w.getJSONArray("aiFields").strings(), d.aiFields(), "$where aiFields")
            }
        }
    }

    private fun JSONObject.optIntOrNull(k: String): Int? = if (has(k) && !isNull(k)) getInt(k) else null

    @Test
    fun `unknown-word analysis and sentence windows match the web app`() {
        val root = JSONObject(vectors("readcheck.json"))
        val index = root.getJSONObject("index").let { o -> o.keySet().associateWith { o.getString(it) } }
        val analyses = root.getJSONArray("analyses").objects()
        assertTrue(analyses.size >= 6)
        for (a in analyses) {
            val name = a.getString("name")
            val r = analyze(a.getString("text"), index, a.getJSONArray("ignored").strings().toSet())
            assertEquals(a.getInt("counted"), r.counted, "$name counted")
            assertEquals(a.getInt("covered"), r.covered, "$name covered")
            assertEquals(a.getInt("pending"), r.pending, "$name pending")
            if (a.isNull("coverage")) assertEquals(null, r.coverage, "$name coverage") else assertEquals(a.getDouble("coverage"), r.coverage!!, 1e-9, "$name coverage")
            val unknown = a.getJSONArray("unknown")
            assertEquals(unknown.length(), r.unknown.size, "$name unknown count")
            for (i in 0 until unknown.length()) {
                val u = unknown.getJSONArray(i)
                assertEquals(listOf(u.getString(0), u.getInt(1), u.getInt(2)), listOf(r.unknown[i].key, r.unknown[i].count, r.unknown[i].first.start), "$name unknown $i")
            }
            val tokens = a.getJSONArray("tokens")
            assertEquals(tokens.length(), r.tokens.size, "$name tokens")
            for (i in 0 until tokens.length()) {
                val t = tokens.getJSONArray(i)
                assertEquals(listOf(t.getInt(0), t.getString(1), t.getString(2)), listOf(r.tokens[i].start, r.tokens[i].key, r.tokens[i].kind.name.lowercase()), "$name token $i")
            }
        }
        for (x in root.getJSONArray("around").objects()) {
            assertEquals(x.getString("expect"), sentenceAround(x.getString("text"), x.getInt("at"), x.getInt("max")), "sentenceAround at ${x.getInt("at")}")
        }
    }

    @Test
    fun `an odd answer from the function never crashes the reader`() {
        val e = extractedFrom(mapOf("questions" to listOf("x", 5, mapOf("kind" to "fill", "stem" to "Please _____ us.", "options" to "none"), mapOf("stem" to null)), "passages" to "no"))
        assertEquals(2, e.questions.size)
        val (drafts, _) = draftsFrom(e, emptySet())
        assertEquals(listOf("no-answer"), drafts[0].problems(emptySet()).block)
    }

    @Test
    fun `test tags match the web app and the latest test is picked by date`() {
        val pairs = JSONArray(vectors("testtag.json"))
        for (i in 0 until pairs.length()) {
            val p = pairs.getJSONArray(i)
            assertEquals(p.getString(1), testTag(p.getString(0)), "tag of ${p.getString(0)}")
        }
        fun test(id: String, name: String, date: String, at: Long) = Note(id, "test", "d", mapOf("name" to FieldValue.Text(name), "date" to FieldValue.Text(date)), createdAt = at, updatedAt = at)
        val notes = listOf(test("a", "Test 2", "2026-11-10", 5), test("b", "Test 1", "2026-10-31", 9), Note("c", "vocab", "d", mapOf("word" to FieldValue.Text("x")), createdAt = 99, updatedAt = 99))
        assertEquals("Test 2", latestTestName(notes))
        assertEquals(null, latestTestName(notes.drop(2)))
    }
}
