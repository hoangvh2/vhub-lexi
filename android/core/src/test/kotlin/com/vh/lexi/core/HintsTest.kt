package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays shared/vectors/hints.json, produced by shared/hints.ts. */
class HintsTest {
    private val v = JSONObject(vectors("hints.json"))

    private fun note(fields: JSONObject) = Note(
        id = "n", type = "vocab", deckId = "d",
        fields = fields.keys().asSequence().associateWith { FieldValue.Text(fields.getString(it)) },
        createdAt = 0, updatedAt = 0,
    )

    @Test
    fun `gate and rating cap`() {
        for (g in v.getJSONArray("gate").objects()) {
            assertEquals(g.getLong("expect"), hintGateMs(g.getInt("state"), g.getDouble("stability")), g.toString())
        }
        val caps = v.getJSONArray("maxRating")
        for (l in 0..2) assertEquals(caps.getInt(l), maxRating(l))
    }

    @Test
    fun `meaning terms`() {
        for (t in v.getJSONArray("terms").objects()) assertEquals(t.getJSONArray("expect").strings(), meaningTerms(t.getString("vi")), t.getString("vi"))
    }

    @Test
    fun `masking the answer`() {
        val masks = v.getJSONArray("masks").objects()
        assertTrue(masks.size >= 8)
        for (m in masks) {
            val want = m.getJSONArray("expect").objects().map { Seg(it.getString("text"), it.getBoolean("masked")) }
            assertEquals(want, maskHint(m.getString("text"), note(m.getJSONObject("fields")), m.getString("template")), m.getString("text"))
        }
    }

    @Test
    fun `cue`() {
        for (c in v.getJSONArray("cues").let { a -> List(a.length()) { a.getJSONArray(it) } }) assertEquals(c.getString(1), hintCue(c.getString(0)), c.getString(0))
    }

    @Test
    fun `leaning on hints`() {
        for (d in v.getJSONArray("dependent").objects()) {
            val logs = d.getJSONArray("logs").objects().map { HintLog(it.getLong("reviewedAt"), it.getInt("rating"), it.optInt("hint", 0)) }
            assertEquals(d.getBoolean("expect"), hintDependent(logs), d.toString())
        }
    }

    @Test
    fun `rotating examples`() {
        val texts = v.getJSONArray("rotateBlocks").strings()
        val kinds = v.getJSONArray("rotateKinds").strings()
        val blocks: List<Block> = texts.zip(kinds).map { (t, k) -> when (k) { "example" -> Block.Example(t); "phrase" -> Block.Example(t, phrase = true); "memo" -> Block.Memo(t); else -> Block.Text(t) } }
        fun text(b: Block) = when (b) { is Block.Example -> b.text; is Block.Memo -> b.text; is Block.Text -> b.text; else -> "" }
        for (r in v.getJSONArray("rotate").objects()) {
            assertEquals(r.getJSONArray("expect").strings(), rotateExamples(blocks, r.getInt("reps")).map(::text), "reps ${r.getInt("reps")}")
        }
    }
}
