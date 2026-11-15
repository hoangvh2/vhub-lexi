package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays shared/vectors/partmarks.json (made by web/test/partmarks-vectors.ts): Listening Part marks, times, and who needs marks. */
class PartMarksVectorsTest {
    private val v = JSONObject(vectors("partmarks.json"))
    private fun objs(a: JSONArray) = List(a.length()) { a.getJSONObject(it) }
    private fun ints(a: JSONArray) = List(a.length()) { a.getInt(it) }

    private fun cutsOf(o: JSONObject): PartCuts = o.keys().asSequence().associate { k -> k.toInt() to cutFromJson(o.getJSONObject(k))!! }

    private fun windowJson(w: PartWindow): JSONObject = when (w) {
        is PartWindow.Ok -> JSONObject().put("ok", true).put("track", w.track).put("from", w.from).put("to", w.to ?: JSONObject.NULL)
        is PartWindow.Missing -> JSONObject().put("ok", false).put("missing", if (w.field == MarkField.START) "start" else "end")
    }

    @Test
    fun scriptsGiveTheSameMarksAndWindows() {
        for ((n, c) in objs(v.getJSONArray("scripts")).withIndex()) {
            val order = ints(c.getJSONArray("order"))
            var cuts: PartCuts = emptyMap()
            val outs = objs(c.getJSONArray("out"))
            for ((k, s) in objs(c.getJSONArray("steps")).withIndex()) {
                var error: String? = null
                val field = if (s.getString("field") == "start") MarkField.START else MarkField.END
                if (s.getString("op") == "set") {
                    val ms = s.getDouble("ms")
                    // A time that is not whole is refused as the web does (its numbers are doubles).
                    val r = if (ms != Math.floor(ms)) MarkResult(cuts, MarkError.NEGATIVE)
                    else setMark(cuts, order, s.getInt("part"), field, ms.toLong(), if (s.has("track")) s.getInt("track") else 0, if (s.has("link")) s.getBoolean("link") else true)
                    cuts = r.cuts
                    error = r.error?.let { if (it == MarkError.NEGATIVE) "negative" else "order" }
                } else cuts = clearMark(cuts, s.getInt("part"), field)
                val want = outs[k]
                val got = JSONObject().put("cuts", cuts.toJson()).put("error", error ?: JSONObject.NULL).put("windows", JSONArray(order.map { windowJson(partWindow(cuts, order, it)) }))
                assertTrue(want.similar(got), "script $n step $k\nexpected: $want\nactual:   $got")
            }
        }
    }

    @Test
    fun timesParseAndFormat() {
        for (c in objs(v.getJSONArray("parse"))) assertEquals(if (c.isNull("ms")) null else c.getLong("ms"), parseClock(c.getString("text")), "parse ${c.getString("text")}")
        for (c in objs(v.getJSONArray("format"))) assertEquals(c.getString("text"), formatClock(c.getLong("ms")), "format ${c.getLong("ms")}")
    }

    @Test
    fun whoNeedsMarks() {
        for (c in objs(v.getJSONArray("needs"))) {
            val parts = ints(c.getJSONArray("parts"))
            val perQ = c.getBoolean("perQuestionTrack")
            val qs = parts.mapIndexed { i, p ->
                SetQuestion(i = i, number = null, part = p, kind = "listen", stem = "", options = emptyMap(), correct = null, passage = null, topic = "", rule = "", translation = "", flags = emptyList(), track = if (perQ) i else null)
            }
            assertEquals(c.getBoolean("needs"), needsPartMarks(c.getInt("tracks"), qs), "needs $c")
            assertEquals(ints(c.getJSONArray("order")), markParts(qs), "order $c")
        }
    }
}
