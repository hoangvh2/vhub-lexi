package com.vh.lexi.core

import java.time.ZoneId
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Roadmap statistics (port of web/src/lib/roadmap.ts, pinned by shared/vectors/roadmap.json): how far along the library is,
 * counted in WORDS, and a forecast of when every word has been started and 80% are known. The forecast replays the real
 * FSRS scheduler over the learner's own cards with their rating mix and their real pace of new words; it assumes the
 * learner keeps that pace.
 */
const val MATURE_DAYS = 21
const val MATURE_SHARE = 0.8
private const val DAY = 86_400_000L
private const val HOUR = 3_600_000L
private const val INTRO = INTRO_TEMPLATE
private fun introRank(t: String) = INTRO_ORDER.indexOf(t).let { if (it < 0) INTRO_ORDER.size else it }
private fun isLearning(c: Card) = c.state == CardState.LEARNING || c.state == CardState.RELEARNING

data class WordStatus(val total: Int, val unseen: Int, val learning: Int, val young: Int, val mature: Int)

private fun groupByNote(cards: List<Card>): LinkedHashMap<String, MutableList<Card>> {
    val m = LinkedHashMap<String, MutableList<Card>>()
    for (c in cards) if (!c.suspended) m.getOrPut(c.noteId) { ArrayList() }.add(c)
    return m
}

private enum class Word { UNSEEN, LEARNING, YOUNG, MATURE }

private fun wordOf(cs: List<Card>): Word = when {
    cs.all { it.state == CardState.NEW } -> Word.UNSEEN
    cs.any { isLearning(it) } -> Word.LEARNING
    cs.all { it.state != CardState.NEW && it.scheduledDays >= MATURE_DAYS } -> Word.MATURE
    else -> Word.YOUNG
}

/** Words by progress. Pass only the cards of notes that count as vocabulary. Suspended cards are ignored. */
fun wordStatus(cards: List<Card>): WordStatus {
    var total = 0; var un = 0; var le = 0; var yo = 0; var ma = 0
    for (cs in groupByNote(cards).values) {
        total++
        when (wordOf(cs)) { Word.UNSEEN -> un++; Word.LEARNING -> le++; Word.YOUNG -> yo++; Word.MATURE -> ma++ }
    }
    return WordStatus(total, un, le, yo, ma)
}

/** FSRS-6 forgetting curve, same formula and rounding as [Fsrs]. */
fun recallProbability(c: Card, now: Long, w: DoubleArray = Fsrs.DEFAULT_W): Double {
    val decay = -w[20]
    val factor = Fsrs.roundTo(exp((1.0 / decay) * ln(0.9)) - 1, 8)
    val last = c.lastReview?.toDouble() ?: (c.due.toDouble() - c.scheduledDays * DAY)
    val t = max(0.0, (now - last) / DAY)
    if (!(c.stability > 0)) return 1.0
    return Fsrs.roundTo((1 + (factor * t) / c.stability).pow(decay), 8)
}

data class RecallEstimate(val started: Int, val recalled: Double)

/** A word's recall = the mean over its answered cards. */
fun recallNow(cards: List<Card>, now: Long, w: DoubleArray = Fsrs.DEFAULT_W): RecallEstimate {
    var started = 0
    var recalled = 0.0
    for (cs in groupByNote(cards).values) {
        val seen = cs.filter { it.state != CardState.NEW }
        if (seen.isEmpty()) continue
        started++
        var sum = 0.0
        for (c in seen) sum += recallProbability(c, now, w)
        recalled += sum / seen.size
    }
    return RecallEstimate(started, recalled)
}

data class Pace(val perDay: Double, val observedDays: Int, val activeDays: Int)

/** New words per day over the [days] full study days before today; the window shrinks to the history that exists. */
fun paceOf(daily: List<Daily>, now: Long, dayStartHour: Int, days: Int = 14, zone: ZoneId = ZoneId.systemDefault()): Pace {
    val byId = daily.associateBy { it.id }
    var first = ""
    for (d in daily) if (d.newCards + d.reviews > 0 && (first == "" || d.id < first)) first = d.id
    var sum = 0L
    var observed = 0
    var active = 0
    if (first != "") {
        for (k in 1..days) {
            val id = dayId(now - k * DAY, dayStartHour, zone)
            if (id < first) break
            observed++
            val d = byId[id]
            sum += d?.newCards ?: 0
            if (d != null && d.newCards + d.reviews > 0) active++
        }
    }
    return Pace(if (observed > 0) sum.toDouble() / observed else 0.0, observed, active)
}

private val PRIOR_MIX = doubleArrayOf(0.12, 0.08, 0.7, 0.1)
private const val PRIOR_WEIGHT = 30

/** Share of answers by rating over the last [days] days, blended with a small prior: [again, hard, good, easy]. */
fun ratingMix(daily: List<Daily>, now: Long, dayStartHour: Int, days: Int = 30, zone: ZoneId = ZoneId.systemDefault()): DoubleArray {
    val since = dayId(now - days * DAY, dayStartHour, zone)
    val n = DoubleArray(4)
    for (d in daily) {
        if (d.id < since) continue
        n[0] += d.again.toDouble(); n[1] += d.hard.toDouble(); n[2] += d.good.toDouble(); n[3] += d.easy.toDouble()
    }
    val tot = n[0] + n[1] + n[2] + n[3] + PRIOR_WEIGHT
    return DoubleArray(4) { (n[it] + PRIOR_MIX[it] * PRIOR_WEIGHT) / tot }
}

/** mulberry32: 32-bit integer arithmetic only, so it draws the same numbers as the TypeScript version. */
class Rng(seed: Int) {
    private var a = seed
    fun next(): Double {
        a += 0x6d2b79f5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
        return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL) / 4294967296.0
    }
}

class SimInput(
    val cards: List<Card>,
    val now: Long,
    /** Epoch ms of the next study-day boundary after [now]. */
    val todayEnd: Long,
    /** New words per day the learner is assumed to start (may be fractional). */
    val pace: Double,
    val maxReviewsPerDay: Int,
    val desiredRetention: Double,
    val w: DoubleArray? = null,
    /** [again, hard, good, easy] probabilities (see [ratingMix]). */
    val mix: DoubleArray,
    /** New words already started today and review answers already given today. */
    val doneNewWords: Int = 0,
    val doneReviews: Int = 0,
    val runs: Int = 12,
    val horizonDays: Int = 240,
)

data class Roadmap(
    val words: Int,
    /** Day index (0 = today) at whose end no word is unseen any more; null when not within the horizon. */
    val introDay: Int?,
    /** Day index when [MATURE_SHARE] of the words are mature; null when not within the horizon. */
    val matureDay: Int?,
    val matureTarget: Int,
    /** Median unseen / mature words at the start of day 0, 7, ... 91. */
    val unseen: List<Int>,
    val mature: List<Int>,
    /** Median review answers per day for days 0..97. */
    val load: List<Int>,
    val peakLoad: Int,
    val peakDay: Int,
)

const val SIM_SEED = 20_260_101
const val SIM_POINTS = 14
private const val SIM_LOAD_DAYS = SIM_POINTS * 7

private class SimNote(val created: Long, val cards: Array<Card>, val intro: Int)

private fun medianOf(xs: List<Double>): Double = xs.sorted()[(xs.size - 1) / 2]

/**
 * Plays the next days [SimInput.runs] times and takes medians. One day, in the order the study queue serves it: due
 * learning cards; due review cards (one per word, up to the daily limit); a typing card of every recognised word; new
 * words, oldest first. Every answer is drawn from the rating mix and moves the card as [Fsrs] does.
 */
fun simulate(inp: SimInput): Roadmap? {
    val fsrs = Fsrs(inp.desiredRetention, inp.w ?: Fsrs.DEFAULT_W)
    val todayStart = inp.todayEnd - DAY
    val base = groupByNote(inp.cards).values.map { cs ->
        val cards = cs.sortedWith(compareBy<Card> { introRank(it.template) }.thenBy { it.id })
        val r = cards.indexOfFirst { it.template == INTRO }
        SimNote(cards.minOf { it.createdAt }, cards.toTypedArray(), if (r >= 0) r else 0)
    }.sortedWith(compareBy<SimNote> { it.created }.thenBy { it.cards[0].id })
    val words = base.size
    if (words == 0) return null
    val target = Math.ceil(words * MATURE_SHARE).toInt()
    val c1 = inp.mix[0]
    val c2 = c1 + inp.mix[1]
    val c3 = c2 + inp.mix[2]

    val never = Double.POSITIVE_INFINITY
    val introDays = ArrayList<Double>()
    val matureDays = ArrayList<Double>()
    val unseenPts = ArrayList<IntArray>()
    val maturePts = ArrayList<IntArray>()
    val loads = ArrayList<IntArray>()

    for (runIndex in 0 until inp.runs) {
        val rng = Rng(SIM_SEED + runIndex * 0x9e3779b9.toInt())
        val notes = base.map { SimNote(it.created, it.cards.copyOf(), it.intro) }
        fun rate(): Int {
            val u = rng.next()
            return if (u < c1) 1 else if (u < c2) 2 else if (u < c3) 3 else 4
        }
        fun status(): IntArray {
            var un = 0; var ma = 0
            for (n in notes) when (wordOf(n.cards.asList())) { Word.UNSEEN -> un++; Word.MATURE -> ma++; else -> {} }
            return intArrayOf(un, ma)
        }
        /** Answers a card, then keeps answering it while it sits in a learning step due before [dayEnd]. */
        fun play(n: SimNote, ci: Int, at: Long, dayEnd: Long) {
            n.cards[ci] = fsrs.next(n.cards[ci], at, rate())
            var guard = 0
            while (guard < 12 && isLearning(n.cards[ci]) && n.cards[ci].due < dayEnd) {
                n.cards[ci] = fsrs.next(n.cards[ci], max(n.cards[ci].due, at), rate())
                guard++
            }
        }
        val up = ArrayList<Int>()
        val mp = ArrayList<Int>()
        val load = ArrayList<Int>()
        var introDay = never
        var matureDay = never
        var acc = 0.0
        run {
            val s0 = status()
            if (s0[0] == 0) introDay = 0.0
            if (s0[1] >= target) matureDay = 0.0
        }
        for (d in 0 until inp.horizonDays) {
            val dayStart = todayStart + d * DAY
            val dayEnd = dayStart + DAY
            val at = if (d == 0) inp.now else dayStart + 12 * HOUR
            if (d % 7 == 0 && d / 7 < SIM_POINTS) {
                val s = status()
                up += s[0]; mp += s[1]
            }
            val done = HashSet<Int>()
            if (d == 0) {
                notes.forEachIndexed { i, n ->
                    if (n.cards.any { it.state != CardState.NEW && it.lastReview != null && it.lastReview >= dayStart }) done += i
                }
            }
            // 1. learning cards that are due.
            val learn = ArrayList<IntArray>()
            notes.forEachIndexed { i, n -> n.cards.forEachIndexed { ci, c -> if (isLearning(c) && c.due < dayEnd) learn += intArrayOf(i, ci) } }
            learn.sortWith(compareBy<IntArray> { notes[it[0]].cards[it[1]].due }.thenBy { notes[it[0]].cards[it[1]].id })
            for ((i, ci) in learn.map { it[0] to it[1] }) {
                play(notes[i], ci, max(at, notes[i].cards[ci].due), dayEnd)
                done += i
            }
            // 2. review cards that are due, 3. typing cards of recognised words.
            var budget = if (d == 0) max(0, inp.maxReviewsPerDay - inp.doneReviews) else inp.maxReviewsPerDay
            var answered = 0
            val due = ArrayList<IntArray>()
            notes.forEachIndexed { i, n -> n.cards.forEachIndexed { ci, c -> if (c.state == CardState.REVIEW && c.due < dayEnd) due += intArrayOf(i, ci) } }
            due.sortWith(compareBy<IntArray> { notes[it[0]].cards[it[1]].due }.thenBy { notes[it[0]].cards[it[1]].id })
            for ((i, ci) in due.map { it[0] to it[1] }) {
                if (budget <= 0) break
                if (i in done) continue
                play(notes[i], ci, at, dayEnd)
                done += i
                budget--
                answered++
            }
            val free = ArrayList<IntArray>()
            notes.forEachIndexed { i, n ->
                if (i in done || n.cards[n.intro].state != CardState.REVIEW) return@forEachIndexed
                val ci = n.cards.indexOfFirst { it.state == CardState.NEW }
                if (ci >= 0) free += intArrayOf(i, ci)
            }
            for ((i, ci) in free.map { it[0] to it[1] }) {
                if (budget <= 0) break
                play(notes[i], ci, at, dayEnd)
                done += i
                budget--
                answered++
            }
            // 4. new words.
            var quota: Int
            if (d == 0) quota = max(0, Fsrs.jsRound(inp.pace).toInt() - inp.doneNewWords)
            else {
                acc += inp.pace
                quota = Math.floor(acc).toInt()
                acc -= quota
            }
            var i = 0
            while (i < notes.size && quota > 0) {
                val n = notes[i]
                if (i !in done && n.cards[n.intro].state == CardState.NEW) {
                    play(n, n.intro, at, dayEnd)
                    done += i
                    quota--
                }
                i++
            }
            if (d < SIM_LOAD_DAYS) load += answered
            val s = status()
            if (introDay == never && s[0] == 0) introDay = d.toDouble()
            if (matureDay == never && s[1] >= target) matureDay = d.toDouble()
            if (introDay != never && matureDay != never && d >= SIM_POINTS * 7) break
        }
        while (up.size < SIM_POINTS) {
            val s = status()
            up += s[0]; mp += s[1]
        }
        while (load.size < SIM_LOAD_DAYS) load += 0
        introDays += introDay
        matureDays += matureDay
        unseenPts += up.toIntArray()
        maturePts += mp.toIntArray()
        loads += load.toIntArray()
    }

    fun dayOrNull(xs: List<Double>): Int? = medianOf(xs).let { if (it.isFinite()) it.toInt() else null }
    fun col(rows: List<IntArray>, j: Int): Int = medianOf(rows.map { it[j].toDouble() }).toInt()
    val load = List(SIM_LOAD_DAYS) { col(loads, it) }
    var peak = 0.0
    var peakDay = 0
    for (i in 0..load.size - 7) {
        var sum = 0
        for (k in i until i + 7) sum += load[k]
        val avg = sum / 7.0
        if (avg > peak) { peak = avg; peakDay = i }
    }
    return Roadmap(
        words = words,
        introDay = dayOrNull(introDays),
        matureDay = dayOrNull(matureDays),
        matureTarget = target,
        unseen = List(SIM_POINTS) { col(unseenPts, it) },
        mature = List(SIM_POINTS) { col(maturePts, it) },
        load = load,
        peakLoad = Fsrs.jsRound(peak).toInt(),
        peakDay = peakDay,
    )
}
