package com.vh.lexi.core

import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RoadmapViewTest {
    private val utc = ZoneOffset.UTC
    private val day = 86_400_000L
    private val t0 = java.time.LocalDateTime.of(2026, 1, 15, 8, 30).toInstant(utc).toEpochMilli()

    @Test
    fun `labels study days with date and weekday`() {
        val start = java.time.LocalDateTime.of(2026, 1, 15, 4, 0).toInstant(utc).toEpochMilli()
        assertEquals("15/01", dm(start, 0, utc))
        assertEquals("01/02", dm(start, 17, utc))
        assertEquals("T5", weekdayOf(start, 0, utc))
        assertEquals("CN", weekdayOf(start, 3, utc))
    }

    @Test
    fun `says spans in days weeks and months`() {
        assertEquals(listOf("3 ngày", "13 ngày", "2 tuần", "8 tuần", "2 tháng", "8 tháng"), listOf(3, 13, 14, 56, 61, 240).map { span(it) })
    }

    @Test
    fun `derives seconds per card and a usual day`() {
        fun d(k: Int, answers: Long, ms: Long) = Daily(id = dayId(t0 - k * day, 4, utc), reviews = answers, good = answers, ms = ms)
        val e = effortOf(listOf(d(1, 40, 320_000), d(2, 60, 480_000), d(3, 100, 800_000), d(45, 500, 1)), t0, 4, 30, utc)
        assertEquals(8.0, e.secPerCard!!, 1e-9)
        assertEquals(60L, e.usual)
        assertEquals(Effort(null, null), effortOf(emptyList(), t0, 4, 30, utc))
        assertEquals(4, minutes(30.0, 8.0))
        assertNull(minutes(30.0, null))
    }
}
