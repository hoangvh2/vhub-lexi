package com.vh.lexi.core

import java.time.Instant
import java.time.ZoneId

/** Text and small numbers for the Thống kê roadmap (port of web/src/lib/roadmapView.ts). */
private const val DAY = 86_400_000L
val WEEKDAYS = listOf("T2", "T3", "T4", "T5", "T6", "T7", "CN")

/** "17/12" for study day [d] counted from the day that starts at [todayStart]. */
fun dm(todayStart: Long, d: Int, zone: ZoneId = ZoneId.systemDefault()): String {
    val t = Instant.ofEpochMilli(todayStart + d * DAY + 12 * 3_600_000L).atZone(zone).toLocalDate()
    return "%02d/%02d".format(t.dayOfMonth, t.monthValue)
}

/** Weekday label (Monday first) of study day [d]. */
fun weekdayOf(todayStart: Long, d: Int, zone: ZoneId = ZoneId.systemDefault()): String =
    WEEKDAYS[Instant.ofEpochMilli(todayStart + d * DAY + 12 * 3_600_000L).atZone(zone).toLocalDate().dayOfWeek.value - 1]

/** "5 tuần" / "3 tháng" for a day count, for the sentences under the dates. */
fun span(days: Int): String = when {
    days < 14 -> "$days ngày"
    days < 60 -> "${Fsrs.jsRound(days / 7.0).toInt()} tuần"
    else -> "${Fsrs.jsRound(days / 30.4375).toInt()} tháng"
}

data class Effort(
    /** Seconds per answered card over the last days; null without data. */
    val secPerCard: Double?,
    /** Median answers on the days the learner studied; null without data. */
    val usual: Long?,
)

/** How long a card takes and how much a normal day holds, from the learner's own days. */
fun effortOf(daily: List<Daily>, now: Long, dayStartHour: Int, days: Int = 30, zone: ZoneId = ZoneId.systemDefault()): Effort {
    val since = dayId(now - days * DAY, dayStartHour, zone)
    var ms = 0L
    var n = 0L
    val per = ArrayList<Long>()
    for (d in daily) {
        val a = d.newCards + d.reviews
        if (d.id < since || a <= 0) continue
        ms += d.ms
        n += a
        per += a
    }
    if (n == 0L) return Effort(null, null)
    per.sort()
    val sec = ms.toDouble() / n / 1000
    return Effort(if (sec > 0) minOf(60.0, maxOf(3.0, sec)) else null, per[(per.size - 1) / 2])
}

/** Answers a new word takes (recognize with its two learning steps), used for the minutes estimate. */
const val NEW_WORD_ANSWERS = 3

fun minutes(answers: Double, secPerCard: Double?): Int? =
    if (secPerCard == null) null else maxOf(0.0, Fsrs.jsRound(answers * secPerCard / 60)).toInt()
