package com.vh.lexi.core

import java.time.ZoneId

/** Statistics over cards and per-day counters (port of web/src/lib/stats.ts). */
data class CardCounts(val total: Int, val new: Int, val learning: Int, val young: Int, val mature: Int, val suspended: Int)

/** Mature = interval of 21+ days, same convention as Anki. */
fun cardCounts(cards: List<Card>): CardCounts {
    var n = 0; var l = 0; var y = 0; var m = 0; var s = 0
    for (c in cards) when {
        c.suspended -> s++
        c.state == CardState.NEW -> n++
        c.state == CardState.LEARNING || c.state == CardState.RELEARNING -> l++
        c.scheduledDays >= 21 -> m++
        else -> y++
    }
    return CardCounts(cards.size, n, l, y, m, s)
}

/** Cards due per study day for the next [days] days (day 0 includes everything overdue). */
fun forecast(cards: List<Card>, now: Long, dayStartHour: Int, days: Int = 14, zone: ZoneId = ZoneId.systemDefault()): IntArray {
    val out = IntArray(days)
    val bounds = ArrayList<Long>()
    var t = now
    repeat(days) {
        t = nextDayStart(t, dayStartHour, zone)
        bounds += t
    }
    for (c in cards) {
        if (c.suspended || c.state == CardState.NEW) continue
        val i = bounds.indexOfFirst { c.due < it }
        if (i >= 0) out[i]++
    }
    return out
}

fun streak(daily: List<Daily>, now: Long, dayStartHour: Int, zone: ZoneId = ZoneId.systemDefault()): Int {
    val active = daily.filter { it.newCards + it.reviews > 0 }.map { it.id }.toSet()
    var n = 0
    var t = now
    if (dayId(t, dayStartHour, zone) !in active) t -= 86_400_000L
    while (dayId(t, dayStartHour, zone) in active) {
        n++
        t -= 86_400_000L
    }
    return n
}

/** Share of review answers that were not "Again" over the last [days] days; null when there is no data. */
fun retention(daily: List<Daily>, now: Long, dayStartHour: Int, days: Int = 30, zone: ZoneId = ZoneId.systemDefault()): Double? {
    val since = dayId(now - days * 86_400_000L, dayStartHour, zone)
    var ok = 0L
    var all = 0L
    for (d in daily) {
        if (d.id < since) continue
        all += d.again + d.hard + d.good + d.easy
        ok += d.hard + d.good + d.easy
    }
    return if (all > 0) ok.toDouble() / all else null
}

data class HeatCell(val id: String, val count: Long, val week: Int, val dow: Int)

/** [weeks] columns ending with the current week (Monday first). */
fun heatmap(daily: List<Daily>, now: Long, dayStartHour: Int, weeks: Int = 26, zone: ZoneId = ZoneId.systemDefault()): List<HeatCell> {
    val byId = daily.associate { it.id to it.newCards + it.reviews }
    val today = java.time.Instant.ofEpochMilli(now - dayStartHour * 3_600_000L).atZone(zone).toLocalDate()
    val dow = today.dayOfWeek.value - 1 // Monday = 0
    val cells = ArrayList<HeatCell>()
    for (w in weeks - 1 downTo 0) {
        for (d in 0..6) {
            val offset = w * 7 + (dow - d)
            if (offset < 0) continue
            val id = dayId(now - offset * 86_400_000L, dayStartHour, zone)
            cells += HeatCell(id, byId[id] ?: 0, weeks - 1 - w, d)
        }
    }
    return cells
}

/** 0 (none) .. 4 (busiest). */
fun heatLevel(count: Long, max: Long): Int {
    if (count <= 0 || max <= 0) return 0
    val r = count.toDouble() / max
    return if (r > 0.75) 4 else if (r > 0.5) 3 else if (r > 0.25) 2 else 1
}
