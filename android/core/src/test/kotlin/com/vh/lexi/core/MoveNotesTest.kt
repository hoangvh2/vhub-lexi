package com.vh.lexi.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Mirrors the "moving words between decks" cases of web/test/data.test.ts. */
class MoveNotesTest {
    private fun note(id: String, deck: String = "d1") = Note(id, "vocab", deck, mapOf("word" to FieldValue.Text(id)), createdAt = 1, updatedAt = 1)
    private fun card(noteId: String, t: String, deck: String = "d1") = Card("$noteId.$t", noteId, deck, t, due = 1, createdAt = 1, updatedAt = 1)

    @Test
    fun `only the chosen notes not yet in the target move, with all their cards, and nothing else changes`() {
        val reviewed = card("a", "recognize").copy(state = CardState.REVIEW, due = 99, stability = 4.2, difficulty = 5.1, scheduledDays = 4.0, reps = 3, lapses = 1, lastReview = 50, suspended = true)
        val ns = listOf(note("a"), note("b"), note("c", "d2"))
        val cs = listOf(reviewed, card("a", "cloze"), card("b", "recognize"), card("c", "recognize", "d2"))
        val p = planMove(ns, cs, setOf("a", "c"), "d2", 5)
        assertEquals(listOf(Triple("a", "d2", 5L)), p.notes.map { Triple(it.id, it.deckId, it.updatedAt) })
        assertEquals(listOf("a.recognize", "a.cloze"), p.cards.map { it.id })
        assertTrue(p.cards.all { it.deckId == "d2" && it.updatedAt == 5L })
        assertEquals(reviewed.copy(deckId = "d2", updatedAt = 5), p.cards[0])
    }

    @Test
    fun `batches keep every note with its cards and stay within 500 writes`() {
        val ns = List(400) { note("n$it") }
        val cs = ns.flatMap { listOf(card(it.id, "recognize"), card(it.id, "cloze")) }
        val groups = MovePlan(ns, cs).batches()
        assertEquals(3, groups.size)
        for (g in groups) {
            assertTrue(g.size <= 500)
            val ids = g.notes.map { it.id }.toSet()
            assertTrue(g.cards.all { it.noteId in ids })
        }
        assertEquals(400, groups.sumOf { it.notes.size })
        assertEquals(800, groups.sumOf { it.cards.size })
        assertEquals(emptyList(), MovePlan(emptyList(), emptyList()).batches())
        assertEquals(listOf(1, 1), MovePlan(listOf(note("x")), listOf(card("x", "recognize"), card("orphan", "cloze"))).batches(2).map { it.cards.size })
    }
}
