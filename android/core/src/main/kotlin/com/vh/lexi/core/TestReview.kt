package com.vh.lexi.core

import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/**
 * "Ôn câu sai" (web: lib/testreview.ts, the reference; vectors in shared/vectors/testreview.json).
 *
 * The questions of a Bộ đề to do again, kept in the set's own `state`, outside FSRS. A question gets a mark when the
 * learner flags it (⚑) or when it is wrong (or blank) at submit. A queued mark comes back after 1, 3, 7, 14 days; two
 * right answers in a row from box 2 on make it learnt, a wrong answer starts the boxes again.
 */
val MARK_CAUSES = listOf("v", "g", "p", "t")
val GAPS = listOf(1, 3, 7, 14)
const val LEARNT_STREAK = 2

data class Mark(
    val flag: Boolean = false,
    val cause: String? = null,
    /** The day (dayNumber) it is next due; null while only flagged, or once learnt. */
    val due: Int? = null,
    val box: Int = 0,
    val streak: Int = 0,
    val done: Boolean = false,
)
typealias Marks = Map<Int, Mark>

/** Whole local days since 1970-01-01 (web: dayNumber). */
fun dayNumber(ms: Long, zone: ZoneId = ZoneId.systemDefault()): Int =
    java.time.Instant.ofEpochMilli(ms).atZone(zone).toLocalDate().let { LocalDate.of(it.year, it.month, it.dayOfMonth).toEpochDay().toInt() }

private fun Mark.isEmpty() = !flag && cause == null && due == null && !done

private fun Marks.put(i: Int, m: Mark): Marks = if (m.isEmpty()) this - i else this + (i to m)

fun Marks.toggleFlag(i: Int): Marks {
    val m = this[i] ?: Mark()
    return put(i, m.copy(flag = !m.flag))
}

fun Marks.setCause(i: Int, cause: String?): Marks = put(i, (this[i] ?: Mark()).copy(cause = cause))

/** A question the learner got wrong: answered, or left blank, against a known key. */
fun isWrong(correct: String?, pick: String?): Boolean = correct != null && pick != correct

/** At submit: every flagged or wrong question of the Part joins the queue, due tomorrow (web: enqueue). */
fun Marks.enqueue(questions: List<SetQuestion>, answers: Map<Int, String>, today: Int): Marks {
    var out = this
    for (q in questions) {
        val m = out[q.i]
        if (!isWrong(q.correct, answers[q.i]) && m?.flag != true) continue
        if (m != null && m.due != null && !m.done) continue
        out = out.put(q.i, (m ?: Mark()).copy(box = 0, streak = 0, due = today + GAPS[0], done = false))
    }
    return out
}

/** An answer in "Ôn câu sai". */
fun Marks.review(i: Int, correct: Boolean, today: Int): Marks {
    val m = this[i] ?: return this
    if (m.due == null) return this
    if (!correct) return put(i, m.copy(box = 0, streak = 0, due = today + GAPS[0]))
    val streak = m.streak + 1
    val box = minOf(m.box + 1, GAPS.size - 1)
    return if (streak >= LEARNT_STREAK && box >= 2) put(i, m.copy(streak = streak, box = box, due = null, done = true))
    else put(i, m.copy(streak = streak, box = box, due = today + GAPS[box]))
}

/** "Bỏ khỏi ôn": learnt by the learner's say. The flag goes too. */
fun Marks.release(i: Int): Marks {
    val m = this[i] ?: return this
    return put(i, m.copy(done = true, due = null, flag = false))
}

/** Question positions due on or before [today], oldest first. */
fun Marks.dueOf(today: Int): List<Int> =
    entries.filter { it.value.due != null && !it.value.done && it.value.due!! <= today }
        .sortedWith(compareBy({ it.value.due }, { it.key })).map { it.key }

fun Marks.queuedCount(): Int = values.count { it.due != null && !it.done }

fun Mark.toJson(): JSONObject = JSONObject().apply {
    if (flag) put("flag", true)
    cause?.let { put("cause", it) }
    due?.let { put("due", it) }
    put("box", box)
    put("streak", streak)
    if (done) put("done", true)
}

/** One mark as `state` has it; null when it is not one (web: readMark). */
fun markFromJson(x: JSONObject): Mark? {
    fun int(k: String): Int? = (x.opt(k) as? Number)?.toDouble()?.takeIf { it.isFinite() && it == Math.floor(it) }?.toInt()
    val box = int("box") ?: return null
    val streak = int("streak") ?: return null
    if (box < 0 || box > 3 || streak < 0) return null
    return Mark(
        flag = x.opt("flag") == true,
        cause = (x.opt("cause") as? String)?.takeIf { it in MARK_CAUSES },
        due = int("due"), box = box, streak = streak, done = x.opt("done") == true,
    )
}

fun Marks.toJson(): JSONObject = JSONObject().apply { toSortedMap().forEach { (k, m) -> put(k.toString(), m.toJson()) } }
