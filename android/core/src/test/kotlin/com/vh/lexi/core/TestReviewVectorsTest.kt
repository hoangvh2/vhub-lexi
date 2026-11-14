package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays shared/vectors/testreview.json (made by web/test/testreview-vectors.ts): the "Ôn câu sai" queue. */
class TestReviewVectorsTest {
    private val v = JSONObject(vectors("testreview.json"))
    private fun objs(a: JSONArray) = List(a.length()) { a.getJSONObject(it) }

    private val questions = objs(v.getJSONArray("questions")).map { o ->
        SetQuestion(
            i = o.getInt("i"), number = null, part = 5, kind = "fill", stem = "", options = emptyMap(),
            correct = if (o.isNull("correct")) null else o.getString("correct"), passage = null, topic = "", rule = "", translation = "", flags = emptyList(),
        )
    }

    private fun marksOf(o: JSONObject): Marks = o.keys().asSequence().associate { k -> k.toInt() to markFromJson(o.getJSONObject(k))!! }

    @Test
    fun scriptsGiveTheSameMarks() {
        for ((n, c) in objs(v.getJSONArray("scripts")).withIndex()) {
            var m: Marks = emptyMap()
            val steps = objs(c.getJSONArray("steps"))
            val outs = objs(c.getJSONArray("out"))
            for ((k, s) in steps.withIndex()) {
                m = when (s.getString("op")) {
                    "flag" -> m.toggleFlag(s.getInt("i"))
                    "cause" -> m.setCause(s.getInt("i"), if (s.isNull("cause")) null else s.getString("cause"))
                    "enqueue" -> {
                        val a = s.getJSONObject("answers")
                        m.enqueue(questions, a.keys().asSequence().associate { it.toInt() to a.getString(it) }, s.getInt("today"))
                    }
                    "review" -> m.review(s.getInt("i"), s.getBoolean("correct"), s.getInt("today"))
                    else -> m.release(s.getInt("i"))
                }
                val want = outs[k]
                assertTrue(want.similar(JSONObject(m.toJson().toString())), "script $n step $k\nexpected: $want\nactual:   ${m.toJson()}")
            }
        }
    }

    @Test
    fun dueList() {
        for (c in objs(v.getJSONArray("due"))) {
            val m = marksOf(c.getJSONObject("marks"))
            val ids = c.getJSONArray("ids")
            assertEquals(List(ids.length()) { ids.getInt(it) }, m.dueOf(c.getInt("today")), "due on ${c.getInt("today")}")
            assertEquals(c.getInt("queued"), m.queuedCount())
        }
    }

    @Test
    fun countsLocalDays() {
        val z = ZoneId.of("Asia/Ho_Chi_Minh")
        val d = { y: Int, mo: Int, day: Int, h: Int, mi: Int -> java.time.ZonedDateTime.of(y, mo, day, h, mi, 0, 0, z).toInstant().toEpochMilli() }
        assertEquals(dayNumber(d(2026, 11, 14, 23, 55), z), dayNumber(d(2026, 11, 14, 0, 5), z))
        assertEquals(dayNumber(d(2026, 11, 14, 23, 55), z) + 1, dayNumber(d(2026, 11, 15, 0, 5), z))
    }
}
