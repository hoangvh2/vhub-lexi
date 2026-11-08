package com.vh.lexi.core

/** The writes that move words to another deck (web: planMove / writeGroups in web/src/data). */
data class MovePlan(val notes: List<Note>, val cards: List<Card>) {
    val size get() = notes.size + cards.size
}

/** Firestore accepts at most 500 writes in one batch. */
const val BATCH_WRITES = 500

/**
 * Each chosen note not already in [deckId], and all its cards, get the new deck; nothing else changes (FSRS state,
 * due date, suspension and the review history stay as they are).
 */
fun planMove(notes: List<Note>, cards: List<Card>, noteIds: Set<Id>, deckId: Id, now: Long): MovePlan {
    val moved = notes.filter { it.id in noteIds && it.deckId != deckId }.map { it.copy(deckId = deckId, updatedAt = now) }
    val ids = moved.map { it.id }.toSet()
    return MovePlan(moved, cards.filter { it.noteId in ids }.map { it.copy(deckId = deckId, updatedAt = now) })
}

/**
 * Splits a plan into batches of at most [max] writes, keeping each note with its cards so a failed batch never
 * leaves a word half in one deck and half in another. Cards whose note is not in the plan go last.
 */
fun MovePlan.batches(max: Int = BATCH_WRITES): List<MovePlan> {
    val byNote = cards.groupBy { it.noteId }.toMutableMap()
    val out = mutableListOf<MovePlan>()
    var ns = mutableListOf<Note>()
    var cs = mutableListOf<Card>()
    fun flush() {
        if (ns.size + cs.size > 0) out += MovePlan(ns, cs)
        ns = mutableListOf(); cs = mutableListOf()
    }
    for (n in notes) {
        val own = byNote.remove(n.id).orEmpty()
        if (ns.size + cs.size + 1 + own.size > max) flush()
        ns += n; cs += own
    }
    for (c in byNote.values.flatten()) {
        if (ns.size + cs.size + 1 > max) flush()
        cs += c
    }
    flush()
    return out
}
