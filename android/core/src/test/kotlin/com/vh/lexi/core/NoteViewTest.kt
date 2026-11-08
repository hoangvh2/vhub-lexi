package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The library's read view ("Xem") must lay a note out exactly like the web app: shared/vectors/views.json. */
class NoteViewTest {
    private fun blocks(a: JSONArray) = JSONArray(a.objects().map { it.canon() }).toString()
    private fun mine(b: List<Block>) = JSONArray(b.map { it.toJson().canon() }).toString()

    @Test
    fun `note views match the web app, open and covered`() {
        val cases = JSONArray(vectors("views.json")).objects()
        assertTrue(cases.size >= 8)
        for (c in cases) {
            val note = noteFromJson(c.getJSONObject("note"))
            assertEquals(blocks(c.getJSONArray("open")), mine(noteView(note)), "${note.id} open")
            assertEquals(blocks(c.getJSONArray("covered")), mine(noteView(note, covered = true)), "${note.id} covered")
        }
    }

    @Test
    fun `covering a word hides every Vietnamese meaning but keeps the word and its sentences`() {
        val note = noteFromJson(JSONArray(vectors("views.json")).objects().first().getJSONObject("note"))
        val covered = noteView(note, covered = true)
        val text = covered.joinToString("\n") { it.toJson().toString() }
        assertTrue("kiên cường" !in text, text)
        assertTrue(covered.any { it is Block.Title && it.text == "resilient" })
        assertTrue(covered.filterIsInstance<Block.Example>().all { it.vi == null })
        assertEquals(JSONObject().put("k", "label").put("text", "Ví dụ").toString(), Block.Label("Ví dụ").toJson().toString())
    }
}
