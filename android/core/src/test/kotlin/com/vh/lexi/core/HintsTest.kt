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
        for (l in 0..3) assertEquals(caps.getInt(l), maxRating(l))
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

    @Test
    fun `recall ladder`() {
        val l = v.getJSONObject("ladder")
        val hints = l.getJSONArray("rungHint")
        for (r in 0..4) assertEquals(hints.getInt(r), rungHint(r))
        for (n in l.getJSONArray("next").objects()) {
            val want = if (n.isNull("expect")) null else n.getInt("expect")
            assertEquals(want, nextRung(n.getInt("rung"), n.getBoolean("has")), n.toString())
        }
        for (x in l.getJSONArray("letters").objects()) assertEquals(x.getInt("expect"), lettersShown(x.getLong("ms"), x.getInt("n")), x.toString())
        fun withPhrases(word: String, key: String) = Note(
            id = "n", type = "vocab", deckId = "d", createdAt = 0, updatedAt = 0,
            fields = mapOf("word" to FieldValue.Text(word), "phrases" to FieldValue.Items(l.getJSONArray(key).strings())),
        )
        val acc = withPhrases(l.getString("otherWord"), "otherPhrases")
        for (o in l.getJSONArray("other").objects()) {
            val got = otherPhrase(acc, o.getInt("reps"))!!
            val want = o.getJSONObject("expect")
            assertEquals(want.getString("vi"), got.vi)
            val segs = want.getJSONArray("segs").objects().map { Seg(it.getString("text"), it.getBoolean("masked")) }
            assertEquals(segs, got.segs, o.toString())
        }
        assertTrue(l.isNull("otherNone"))
        assertEquals(null, otherPhrase(withPhrases(l.getString("singleWord"), "singlePhrases"), 0))
        for (f in l.getJSONArray("flash").objects()) {
            val want = if (f.isNull("expect")) null else f.getJSONArray("expect").strings()
            assertEquals(want, flashWords(f.getString("word"), f.getJSONArray("pool").strings(), f.getString("seed")), f.toString())
        }
    }
}
