package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Replays shared/vectors/roadmap.json, produced by web/test/roadmap-vectors.ts from the TypeScript reference. */
class RoadmapTest {
    private val utc = ZoneOffset.UTC
    private val root = JSONObject(vectors("roadmap.json"))
    private val library = root.getJSONArray("library").objects().map { cardFromJson(it) }

    private fun dailyFrom(a: JSONArray) = a.objects().map {
        Daily(
            id = it.getString("id"), newCards = it.getLong("newCards"), reviews = it.getLong("reviews"), again = it.getLong("again"),
            hard = it.getLong("hard"), good = it.getLong("good"), easy = it.getLong("easy"), ms = it.getLong("ms"), updatedAt = it.getLong("updatedAt"),
        )
    }

    private fun doubles(a: JSONArray) = DoubleArray(a.length()) { a.getDouble(it) }
    private fun ints(a: JSONArray) = List(a.length()) { a.getInt(it) }

    @Test
    fun `simulation matches the web app`() {
        val cases = root.getJSONArray("simulate").objects()
        assertTrue(cases.size >= 4)
        for (c in cases) {
            val i = c.getJSONObject("input")
            val done = i.getJSONObject("doneToday")
            val input = SimInput(
                cards = library, now = i.getLong("now"), todayEnd = i.getLong("todayEnd"), pace = i.getDouble("pace"),
                maxReviewsPerDay = i.getInt("maxReviewsPerDay"), desiredRetention = i.getDouble("desiredRetention"),
                w = if (i.has("w")) doubles(i.getJSONArray("w")) else null, mix = doubles(i.getJSONArray("mix")),
                doneNewWords = done.getInt("newWords"), doneReviews = done.getInt("reviews"), runs = i.getInt("runs"), horizonDays = i.getInt("horizonDays"),
            )
            val out = simulate(input)!!
            val want = c.getJSONObject("out")
            val name = c.getString("name")
            assertEquals(want.getInt("words"), out.words, "$name words")
            assertEquals(if (want.isNull("introDay")) null else want.getInt("introDay"), out.introDay, "$name introDay")
            assertEquals(if (want.isNull("matureDay")) null else want.getInt("matureDay"), out.matureDay, "$name matureDay")
            assertEquals(want.getInt("matureTarget"), out.matureTarget, "$name matureTarget")
            assertEquals(ints(want.getJSONArray("unseen")), out.unseen, "$name unseen")
            assertEquals(ints(want.getJSONArray("mature")), out.mature, "$name mature")
            assertEquals(ints(want.getJSONArray("load")), out.load, "$name load")
            assertEquals(want.getInt("peakLoad"), out.peakLoad, "$name peakLoad")
            assertEquals(want.getInt("peakDay"), out.peakDay, "$name peakDay")
        }
        assertNull(simulate(SimInput(emptyList(), 0, 86_400_000L, 5.0, 200, 0.9, null, doubleArrayOf(0.1, 0.1, 0.7, 0.1))))
    }

    @Test
    fun `word status recall pace and rating mix match`() {
        val s = root.getJSONObject("status")
        assertEquals(WordStatus(s.getInt("total"), s.getInt("unseen"), s.getInt("learning"), s.getInt("young"), s.getInt("mature")), wordStatus(library))
        for (c in root.getJSONArray("recall").objects()) {
            val w = if (c.has("w")) doubles(c.getJSONArray("w")) else Fsrs.DEFAULT_W
            val r = recallNow(library, c.getLong("now"), w)
            assertEquals(c.getJSONObject("out").getInt("started"), r.started)
            assertEquals(c.getJSONObject("out").getDouble("recalled"), r.recalled, 1e-6)
        }
        val pace = root.getJSONObject("pace")
        val daily = dailyFrom(pace.getJSONArray("daily"))
        for (c in pace.getJSONArray("cases").objects()) {
            val p = paceOf(daily, c.getLong("now"), c.getInt("dayStartHour"), c.getInt("days"), utc)
            val o = c.getJSONObject("out")
            assertEquals(o.getInt("observedDays"), p.observedDays)
            assertEquals(o.getInt("activeDays"), p.activeDays)
            assertEquals(o.getDouble("perDay"), p.perDay, 1e-9)
        }
        val mix = root.getJSONObject("mix")
        val m = ratingMix(dailyFrom(mix.getJSONArray("daily")), root.getJSONArray("week").getJSONObject(0).getLong("now"), 4, 30, utc)
        for (k in 0..3) assertEquals(mix.getJSONArray("out").getDouble(k), m[k], 1e-12)
        val e = ratingMix(emptyList(), 0, 4, 30, utc)
        for (k in 0..3) assertEquals(mix.getJSONArray("empty").getDouble(k), e[k], 1e-12)
    }

    @Test
    fun `overdue heat levels and week comparison match`() {
        val o = root.getJSONObject("overdue")
        assertEquals(o.getInt("out"), overdueCount(o.getJSONArray("cards").objects().map { cardFromJson(it) }, o.getLong("now"), 4, utc))
        for (p in root.getJSONArray("heat")) {
            val pair = p as JSONArray
            assertEquals(pair.getInt(1), heatLevelFixed(pair.getLong(0)), "heat ${pair.getLong(0)}")
        }
        val daily = dailyFrom(root.getJSONObject("pace").getJSONArray("daily"))
        for (c in root.getJSONArray("week").objects()) {
            val w = weekCompare(daily, c.getLong("now"), c.getInt("dayStartHour"), utc)
            val o2 = c.getJSONObject("out")
            assertEquals(o2.getInt("days"), w.days)
            assertEquals(o2.getJSONArray("now").let { a -> List(a.length()) { if (a.isNull(it)) null else a.getLong(it) } }, w.now)
            assertEquals(o2.getJSONArray("prev").let { a -> List(a.length()) { a.getLong(it) } }, w.prev)
            for ((key, side) in listOf("thisWeek" to w.thisWeek, "lastWeek" to w.lastWeek)) {
                val s = o2.getJSONObject(key)
                assertEquals(s.getLong("answers"), side.answers, "$key answers")
                assertEquals(s.getLong("ms"), side.ms, "$key ms")
                assertEquals(s.getInt("activeDays"), side.activeDays, "$key activeDays")
                if (s.isNull("retention")) assertNull(side.retention) else assertEquals(s.getDouble("retention"), side.retention!!, 1e-12)
            }
        }
    }
}
