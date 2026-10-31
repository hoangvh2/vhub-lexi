package com.vh.lexi.core

import java.time.ZoneId

/**
 * Study queue (port of web/src/lib/queue.ts, pinned by shared/vectors/queue.json).
 *   learning  cards in (re)learning whose short step is due (or due within the learn-ahead window)
 *   review    review cards due before the next study-day boundary, most overdue first
 *   new       never-seen cards, oldest first, capped by the daily limit
 * Siblings (cards of one note) are buried for the rest of the session once one is answered.
 * Near-synonyms interfere when learned together, so a new word waits while another word sharing a
 * Vietnamese meaning phrase is new in this queue or reviewed but not yet on a SETTLE_DAYS interval.
 * Custom study: [QueueInput.noteIds] limits the session to some notes (a lesson tag), [QueueInput.reviewAheadDays]
 * also takes review cards due in the next N days.
 */
const val LEARN_AHEAD_MS = 20 * 60_000L
const val LEECH_LAPSES = 8
/** A card on an interval this long (days) is settled enough for a near-synonym to start. */
const val SETTLE_DAYS = 3

data class QueueInput(
    val cards: List<Card>,
    /** False for cards whose note is gone or whose template no longer applies. */
    val eligible: (Card) -> Boolean,
    val today: Daily?,
    val prefs: Prefs,
    val now: Long,
    val deckId: Id? = null,
    val buried: Set<Id> = emptySet(),
    val learnAheadMs: Long = 0,
    val zone: ZoneId = ZoneId.systemDefault(),
    /** Vietnamese meaning phrases per note ([meaningsByNote]); when given, near-synonyms are introduced apart. */
    val meanings: Map<Id, List<String>>? = null,
    /** Only these notes (e.g. the notes of one lesson tag). */
    val noteIds: Set<Id>? = null,
    /** Also review cards due within this many days after today (review ahead). */
    val reviewAheadDays: Int = 0,
)

data class Counts(val new: Int, val learning: Int, val review: Int)

data class Queue(val learning: List<Card>, val review: List<Card>, val newCards: List<Card>, val counts: Counts) {
    val all: List<Card> get() = learning + review + newCards
}

fun buildQueue(i: QueueInput): Queue {
    val cutoff = nextDayStart(i.now, i.prefs.dayStartHour, i.zone) + i.reviewAheadDays * Fsrs.DAY_MS
    val learning = ArrayList<Card>()
    val review = ArrayList<Card>()
    val fresh = ArrayList<Card>()
    for (c in i.cards) {
        if (c.suspended || !i.eligible(c)) continue
        if (i.deckId != null && c.deckId != i.deckId) continue
        if (i.noteIds != null && c.noteId !in i.noteIds) continue
        when (c.state) {
            CardState.LEARNING, CardState.RELEARNING -> if (c.due <= i.now + i.learnAheadMs) learning += c
            CardState.REVIEW -> if (c.due < cutoff && c.noteId !in i.buried) review += c
            else -> if (c.noteId !in i.buried) fresh += c
        }
    }
    learning.sortBy { it.due }
    review.sortBy { it.due }
    fresh.sortWith(compareBy<Card> { it.createdAt }.thenBy { it.id })

    val newLimit = maxOf(0, i.prefs.newPerDay - (i.today?.newCards ?: 0L).toInt())
    val reviewLimit = maxOf(0, i.prefs.maxReviewsPerDay - (i.today?.reviews ?: 0L).toInt())

    // Meaning phrase -> notes still settling with it (any deck: interference does not care about decks).
    val settling = HashMap<String, MutableSet<Id>>()
    fun hold(noteId: Id) {
        for (p in i.meanings?.get(noteId).orEmpty()) settling.getOrPut(p) { HashSet() } += noteId
    }
    fun blocked(noteId: Id) = i.meanings?.get(noteId).orEmpty().any { p ->
        val owners = settling[p]
        owners != null && (owners.size > 1 || noteId !in owners)
    }
    if (i.meanings != null) {
        for (c in i.cards) if (!c.suspended && c.state != CardState.NEW && c.scheduledDays < SETTLE_DAYS) hold(c.noteId)
    }

    val seen = HashSet<Id>()
    val newCards = ArrayList<Card>()
    for (c in fresh) {
        if (newCards.size >= newLimit) break
        if (c.noteId in seen || blocked(c.noteId)) continue
        seen += c.noteId
        hold(c.noteId)
        newCards += c
    }
    val reviewCapped = review.take(reviewLimit)
    return Queue(learning, reviewCapped, newCards, Counts(newCards.size, learning.size, reviewCapped.size))
}

data class SessionState(val shown: Int = 0, val shownNew: Int = 0)

/** Next card to show, or null when the session is done. Due learning cards come first. */
fun pickNext(q: Queue, s: SessionState, now: Long): Card? {
    q.learning.firstOrNull { it.due <= now }?.let { return it }
    val rest = q.review.size + q.newCards.size
    if (rest == 0) return q.learning.firstOrNull()
    if (q.newCards.isEmpty()) return q.review.first()
    if (q.review.isEmpty()) return q.newCards.first()
    val share = q.newCards.size.toDouble() / rest
    return if (s.shownNew < Fsrs.jsRound((s.shown + 1) * share)) q.newCards.first() else q.review.first()
}

/** Review cards outside today's queue that `reviewAheadDays = days` would add (for the "review ahead" button). */
fun dueWithin(cards: List<Card>, eligible: (Card) -> Boolean, now: Long, dayStartHour: Int, days: Int, deckId: Id? = null, noteIds: Set<Id>? = null, zone: ZoneId = ZoneId.systemDefault()): Int {
    val today = nextDayStart(now, dayStartHour, zone)
    val until = today + days * Fsrs.DAY_MS
    return cards.count { c ->
        c.state == CardState.REVIEW && !c.suspended && c.due >= today && c.due < until && eligible(c) &&
            (deckId == null || c.deckId == deckId) && (noteIds == null || c.noteId in noteIds)
    }
}

/** Lesson / topic tags in use with their note counts, in natural order ("lesson-2" before "lesson-10"). */
fun tagCounts(tagsPerNote: List<List<String>>): List<Pair<String, Int>> {
    val m = HashMap<String, Int>()
    for (tags in tagsPerNote) for (t in tags) m[t] = (m[t] ?: 0) + 1
    return m.entries.map { it.key to it.value }.sortedWith { a, b -> naturalCompare(a.first, b.first) }
}

private fun naturalCompare(a: String, b: String): Int {
    val re = Regex("\\d+|\\D+")
    val pa = re.findAll(a).map { it.value }.toList()
    val pb = re.findAll(b).map { it.value }.toList()
    for (k in 0 until minOf(pa.size, pb.size)) {
        val x = pa[k]
        val y = pb[k]
        val c = if (x[0].isDigit() && y[0].isDigit()) x.toBigInteger().compareTo(y.toBigInteger()) else x.compareTo(y, ignoreCase = true)
        if (c != 0) return c
    }
    return pa.size - pb.size
}

fun isLeech(c: Card) = c.lapses >= LEECH_LAPSES
