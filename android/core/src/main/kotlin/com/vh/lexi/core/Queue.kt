package com.vh.lexi.core

import java.time.ZoneId

/**
 * Study queue (port of web/src/lib/queue.ts, pinned by shared/vectors/queue.json).
 *   learning  cards in (re)learning whose short step is due (or due within the learn-ahead window)
 *   review    review cards due before the next study-day boundary, most overdue first
 *   new       never-seen cards, capped by the daily limit and shared out between decks by weight ([shareOut])
 * Siblings (cards of one note) are buried for the rest of the session once one is answered.
 * Review cards of a note answered today are also held until the next study day ([answeredToday], from lastReview),
 * so leaving and reopening the study screen does not bring the word straight back (queue.ts).
 * Near-synonyms interfere when learned together, so a new word waits while another word sharing a
 * Vietnamese meaning phrase is new in this queue or reviewed but not yet on a SETTLE_DAYS interval.
 * Custom study: [QueueInput.noteIds] limits the session to some notes (a lesson tag), [QueueInput.reviewAheadDays]
 * also takes review cards due in the next N days.
 */
const val LEARN_AHEAD_MS = 20 * 60_000L
const val LEECH_LAPSES = 8
/** A card on an interval this long (days) is settled enough for a near-synonym to start. */
const val SETTLE_DAYS = 3

/** Order in which a new note's cards are introduced: see the word first, type it later (queue.ts INTRO_ORDER). */
val INTRO_ORDER = listOf("recognize", "recall", "cloze", "listen")
private fun introRank(template: String) = INTRO_ORDER.indexOf(template).let { if (it < 0) INTRO_ORDER.size else it }

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
    /** Share of the daily new words per deck ([Deck.newWeight], see [deckWeights]); a deck missing from the map counts as 1. */
    val deckWeights: Map<Id, Int>? = null,
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

/** Weights of decks for the queue: [Deck.newWeight], or 1 when the learner never set one (equal shares). */
fun deckWeights(decks: List<Deck>): Map<Id, Int> = decks.associate { it.id to (it.newWeight ?: 1) }

data class NewShare(val id: Id, /** Relative share (whole number >= 0; 0 = paused). */ val weight: Int, /** Most this deck can take. */ val cap: Int)

/**
 * Splits [total] new words between decks in proportion to their weights, in whole words (largest remainder; ties go to
 * the heavier deck, then the smaller id). A deck that cannot take its share ([NewShare.cap]) gives the rest back to the
 * others. Port of queue.ts shareOut: integer arithmetic only, so both sides agree.
 */
fun shareOut(total: Int, items: List<NewShare>): Map<Id, Int> {
    val out = LinkedHashMap<Id, Int>()
    for (x in items) out[x.id] = 0
    var remaining = maxOf(0, total)
    var active = items.filter { it.weight > 0 && it.cap > 0 }
    while (remaining > 0 && active.isNotEmpty()) {
        val sum = active.sumOf { it.weight.toLong() }
        val capped = active.filter { remaining.toLong() * it.weight > it.cap.toLong() * sum }
        if (capped.isNotEmpty()) {
            for (x in capped) { out[x.id] = x.cap; remaining -= x.cap }
            active = active.filter { a -> capped.none { it.id == a.id } }
            continue
        }
        class Part(val x: NewShare, val q: Int, val r: Long)
        val parts = active.map { Part(it, (remaining.toLong() * it.weight / sum).toInt(), remaining.toLong() * it.weight % sum) }
        var left = remaining - parts.sumOf { it.q }
        for (a in parts) out[a.x.id] = a.q
        for (a in parts.sortedWith(compareByDescending<Part> { it.r }.thenByDescending { it.x.weight }.thenBy { it.x.id })) {
            if (left <= 0) break
            out[a.x.id] = (out[a.x.id] ?: 0) + 1
            left--
        }
        break
    }
    return out
}

/** [shareOut] for a whole day, plus: every deck above 0% that has words gets at least one, as long as there are enough words for that. */
fun dailyShares(total: Int, items: List<NewShare>): Map<Id, Int> {
    val out = LinkedHashMap(shareOut(total, items))
    val eligible = items.filter { it.weight > 0 && it.cap > 0 }.sortedWith(compareByDescending<NewShare> { it.weight }.thenBy { it.id })
    if (total < eligible.size) return out
    for (x in eligible) {
        if ((out[x.id] ?: 0) > 0) continue
        val donor = eligible.filter { (out[it.id] ?: 0) >= 2 }
            .sortedWith(compareByDescending<NewShare> { out[it.id] ?: 0 }.thenByDescending { it.weight }.thenBy { it.id }).firstOrNull() ?: break
        out[donor.id] = (out[donor.id] ?: 0) - 1
        out[x.id] = 1
    }
    return out
}

/** Notes (not cards) with a new card in this list. */
private fun distinctNotes(cards: List<Card>?): Int = cards?.mapTo(HashSet()) { it.noteId }?.size ?: 0

/** Notes with a card answered in the current study day (queue.ts answeredToday). */
fun answeredToday(cards: List<Card>, now: Long, dayStartHour: Int, zone: ZoneId = ZoneId.systemDefault()): Set<Id> {
    val dayStart = nextDayStart(now, dayStartHour, zone) - Fsrs.DAY_MS
    return cards.filter { it.state != CardState.NEW && (it.lastReview ?: Long.MIN_VALUE) >= dayStart }.mapTo(HashSet()) { it.noteId }
}

/** The template that introduces a word; the note's typing cards wait until it reaches Review (queue.ts INTRO_TEMPLATE). */
const val INTRO_TEMPLATE = "recognize"

/** Notes whose live (eligible, not suspended) recognize card is not in Review yet (queue.ts awaitingRecognize). */
fun awaitingRecognize(cards: List<Card>, eligible: (Card) -> Boolean): Set<Id> =
    cards.filter { it.template == INTRO_TEMPLATE && !it.suspended && it.state != CardState.REVIEW && eligible(it) }.mapTo(HashSet()) { it.noteId }

/** A new card that may be introduced now (queue.ts introducible). */
fun introducible(c: Card, waiting: Set<Id>): Boolean = c.template == INTRO_TEMPLATE || c.noteId !in waiting

fun buildQueue(i: QueueInput): Queue {
    val cutoff = nextDayStart(i.now, i.prefs.dayStartHour, i.zone) + i.reviewAheadDays * Fsrs.DAY_MS
    val doneToday = answeredToday(i.cards, i.now, i.prefs.dayStartHour, i.zone)
    val waiting = awaitingRecognize(i.cards, i.eligible)
    val learning = ArrayList<Card>()
    val review = ArrayList<Card>()
    val fresh = ArrayList<Card>()
    for (c in i.cards) {
        if (c.suspended || !i.eligible(c)) continue
        if (i.deckId != null && c.deckId != i.deckId) continue
        if (i.noteIds != null && c.noteId !in i.noteIds) continue
        when (c.state) {
            CardState.LEARNING, CardState.RELEARNING -> if (c.due <= i.now + i.learnAheadMs) learning += c
            CardState.REVIEW -> if (c.due < cutoff && c.noteId !in i.buried && c.noteId !in doneToday) review += c
            else -> if (c.noteId !in i.buried && c.noteId !in doneToday && introducible(c, waiting)) fresh += c
        }
    }
    learning.sortBy { it.due }
    review.sortBy { it.due }
    fresh.sortWith(compareBy<Card> { it.createdAt }.thenBy { introRank(it.template) }.thenBy { it.id })

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

    // New words: today's total is shared out between decks by weight (a deck that cannot fill its share gives it back),
    // each deck keeps its own order, and the picks are dealt out deck by deck so the session mixes them.
    val doneBy = i.today?.newByDeck.orEmpty()
    val groups = LinkedHashMap<Id, MutableList<Card>>()
    for (c in fresh) groups.getOrPut(c.deckId) { ArrayList() } += c
    fun weightOf(id: Id) = i.deckWeights?.get(id) ?: 1
    val ids = ((i.deckWeights?.keys ?: emptySet<Id>()) + groups.keys).distinct()
    val items = ids.map { id -> NewShare(id, weightOf(id), ((doneBy[id] ?: 0L).toInt()) + distinctNotes(groups[id])) }
    val targets = dailyShares(i.prefs.newPerDay, items)
    val take = HashMap<Id, Int>()
    for (x in items) take[x.id] = maxOf(0, (targets[x.id] ?: 0) - (doneBy[x.id] ?: 0L).toInt())
    var want: Map<Id, Int> = take
    if (take.values.sum() > newLimit) {
        // Some deck is already past its share today (weights changed): trim to what is left, still by weight.
        want = shareOut(newLimit, items.filter { (take[it.id] ?: 0) > 0 }.map { NewShare(it.id, it.weight, take[it.id] ?: 0) })
    }
    val order = items.filter { it.weight > 0 }.sortedWith(compareByDescending<NewShare> { it.weight }.thenBy { it.id }).map { it.id }
    val seen = HashSet<Id>() // one new card per note per session (siblings wait for the next session)
    val picked = HashMap<Id, MutableList<Card>>()
    for (d in order) picked[d] = ArrayList()
    val cursor = HashMap<Id, Int>()
    fun grab(d: Id, n: Int): Int {
        val list = groups[d].orEmpty()
        var k = cursor[d] ?: 0
        var got = 0
        while (got < n && k < list.size) {
            val c = list[k++]
            if (c.noteId in seen || blocked(c.noteId)) continue
            seen += c.noteId
            hold(c.noteId)
            picked[d]?.add(c)
            got++
        }
        cursor[d] = k
        return got
    }
    var taken = 0
    for (d in order) taken += grab(d, minOf(want[d] ?: 0, newLimit - taken))
    // A near-synonym held a word back: fill the gap from the other decks, one word each in turn.
    var moved = true
    while (moved && taken < newLimit) {
        moved = false
        for (d in order) {
            if (taken >= newLimit) break
            if (grab(d, 1) > 0) { taken++; moved = true }
        }
    }
    val newCards = ArrayList<Card>()
    var round = 0
    var more = true
    while (more) {
        more = false
        for (d in order) picked[d]?.getOrNull(round)?.let { newCards += it; more = true }
        round++
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
/** [skip]: notes the queue holds back today ([answeredToday]), so the button never offers cards it would not add. */
fun dueWithin(cards: List<Card>, eligible: (Card) -> Boolean, now: Long, dayStartHour: Int, days: Int, deckId: Id? = null, noteIds: Set<Id>? = null, zone: ZoneId = ZoneId.systemDefault(), skip: Set<Id> = emptySet()): Int {
    val today = nextDayStart(now, dayStartHour, zone)
    val until = today + days * Fsrs.DAY_MS
    return cards.count { c ->
        c.state == CardState.REVIEW && !c.suspended && c.due >= today && c.due < until && eligible(c) &&
            (deckId == null || c.deckId == deckId) && (noteIds == null || c.noteId in noteIds) && c.noteId !in skip
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
