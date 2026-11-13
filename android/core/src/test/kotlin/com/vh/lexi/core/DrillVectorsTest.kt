package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Replays shared/vectors/drill.json (made by web/test/drill-vectors.ts): "Từ hay quên" marks and practice rounds. */
class DrillVectorsTest {
    private val v = JSONObject(vectors("drill.json"))
    private val notes = v.getJSONArray("notes").objects().map { o ->
        noteFromJson(o).copy(
            forgot = o.optJSONArray("forgot")?.strings() ?: emptyList(),
            forgotAt = o.optLongOrNull("forgotAt"),
        )
    }
    private fun note(id: String) = notes.first { it.id == id }
    private fun ids(items: List<DrillItem>) = items.map { "${it.noteId}/${it.mode.key}" + (it.options?.let { o -> ":" + o.joinToString(",") } ?: "") }
    private fun strs(a: Any?): List<String>? = if (a is JSONArray) a.strings() else null

    @Test
    fun marksAndMeanings() {
        assertEquals(v.getJSONArray("forgotOf").let { a -> List(a.length()) { a.getJSONArray(it).strings() } }, notes.map { n -> forgotOf(n).map { it.key } })
        assertEquals(v.getJSONArray("shortMeaning").strings(), notes.map(::shortMeaning))
        assertEquals(v.getJSONArray("forgotNotes").strings(), forgotNotes(notes).map { it.id })
    }

    @Test
    fun toggling() {
        for (c in v.getJSONArray("withForgot").objects()) {
            val kind = ForgotKind.entries.first { it.key == c.getString("kind") }
            val n = withForgot(note(c.getString("id")), kind, c.getBoolean("on"), 2000)
            val what = "${c.getString("id")} ${kind.key} ${c.getBoolean("on")}"
            assertEquals(strs(c.get("forgot")) ?: emptyList(), n.forgot, what)
            assertEquals(c.optLongOrNull("forgotAt"), n.forgotAt, what)
            assertEquals(c.getLong("updatedAt"), n.updatedAt, what)
        }
    }

    @Test
    fun optionsAndRounds() {
        for (c in v.getJSONArray("meaningOptions").objects()) {
            assertEquals(strs(c.get("out")), meaningOptions(note(c.getString("id")), notes, c.getString("seed")), "${c.getString("id")} ${c.getString("seed")}")
        }
        val small = listOf(
            Note("s1", "vocab", "d1", mapOf("word" to FieldValue.Text("alpha"), "vi" to FieldValue.Text("một"), "pos" to FieldValue.Text("")), createdAt = 1, updatedAt = 1, forgot = listOf("meaning"), forgotAt = 1),
            Note("s2", "vocab", "d1", mapOf("word" to FieldValue.Text("beta"), "vi" to FieldValue.Text("hai"), "pos" to FieldValue.Text("")), createdAt = 1, updatedAt = 1),
        )
        assertNull(strs(v.get("meaningOptionsSmall")))
        assertNull(meaningOptions(small[0], small, "s"))
        val marked = forgotNotes(notes)
        for (c in v.getJSONArray("drillRound").objects()) assertEquals(c.getJSONArray("out").strings(), ids(drillRound(marked, notes, c.getString("seed"))), c.getString("seed"))
        assertEquals(v.getJSONArray("drillRoundSmall").strings(), ids(drillRound(forgotNotes(small), small, "s")))
    }

    @Test
    fun retries() {
        val queue = listOf("a", "b", "c", "d", "e").map { DrillItem(it, DrillMode.RECALL) }
        val cases = v.getJSONArray("afterAnswer").objects()
        val inputs = listOf(queue, queue, queue.take(2), queue.take(1))
        cases.forEachIndexed { i, c -> assertEquals(c.getJSONArray("out").strings(), afterAnswer(inputs[i], c.getBoolean("right")).map { it.noteId }, "case $i") }
    }
}
