package com.vh.lexi.core

import kotlin.test.Test
import kotlin.test.assertEquals

/** Mirrors web/test/deckshare.test.ts: the same cases, so both apps share the daily new words the same way. */
class DeckShareTest {
    private fun share(id: String, weight: Int, cap: Int = 99) = NewShare(id, weight, cap)

    @Test
    fun `ten words 50-25-15-10 split into 5-3-1-1`() {
        assertEquals(mapOf("A" to 5, "B" to 3, "C" to 1, "D" to 1), shareOut(10, listOf(share("A", 50), share("B", 25), share("C", 15), share("D", 10))))
    }

    @Test
    fun `a deck with too few words gives the rest back, paused decks get nothing`() {
        assertEquals(mapOf("A" to 8, "B" to 2), shareOut(10, listOf(share("A", 50), share("B", 50, 2))))
        assertEquals(mapOf("A" to 10, "B" to 0), shareOut(10, listOf(share("A", 1), share("B", 0))))
        assertEquals(mapOf("A" to 3, "B" to 2), shareOut(10, listOf(share("A", 1, 3), share("B", 1, 2))))
    }

    @Test
    fun `every deck above zero gets one word when there are enough`() {
        val items = listOf(share("A", 70), share("B", 20), share("C", 6), share("D", 4))
        assertEquals(mapOf("A" to 1, "B" to 1, "C" to 1, "D" to 1), dailyShares(4, items))
        assertEquals(mapOf("A" to 3, "B" to 1, "C" to 0, "D" to 0), shareOut(4, items))
        assertEquals(mapOf("A" to 2, "B" to 0, "C" to 0), dailyShares(2, listOf(share("A", 70), share("B", 20), share("C", 10))))
    }

    @Test
    fun `random inputs add up, respect caps and ignore paused decks`() {
        var seed = 7L
        fun rnd(n: Int): Int { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed % n).toInt() }
        repeat(500) {
            val items = List(1 + rnd(5)) { k -> share("d$k", if (rnd(4) == 0) 0 else 1 + rnd(100), if (rnd(6) == 0) 0 else rnd(15)) }
            val total = rnd(30)
            val out = shareOut(total, items)
            val usable = items.filter { it.weight > 0 }.sumOf { it.cap }
            assertEquals(minOf(total, usable), out.values.sum())
            for (x in items) {
                assert((out[x.id] ?: 0) <= x.cap)
                if (x.weight == 0) assertEquals(0, out[x.id])
            }
        }
    }

    @Test
    fun `percent helpers match the web app`() {
        assertEquals(listOf(50, 25, 15, 10), percents(listOf(50, 25, 15, 10)))
        assertEquals(listOf(34, 33, 33), percents(listOf(1, 1, 1)))
        assertEquals(listOf(0, 0), percents(listOf(0, 0)))
        assertEquals(listOf(48, 24, 16, 12), rankWeights(4))
        assertEquals(listOf(70, 15, 9, 6), setPercent(listOf(50, 25, 15, 10), 0, 70))
        assertEquals(listOf(55, 28, 17, 0), setPercent(listOf(50, 25, 15, 10), 3, 0))
        assertEquals(listOf(40, 30, 30), setPercent(listOf(100, 0, 0), 0, 40))
        assertEquals(ShareMode.EQUAL, shareMode(listOf(1, 1, 1)))
        assertEquals(ShareMode.RANK, shareMode(listOf(48, 12, 24, 16)))
        assertEquals(ShareMode.CUSTOM, shareMode(listOf(50, 25, 15, 10)))
    }

    @Test
    fun `new cards per deck are counted and undone per deck`() {
        val d = DailyDelta("2026-01-15", 1, 0, 3, 10, "A")
        var day = Daily("2026-01-15").apply(d, 1, 1)
        day = day.apply(d.copy(deckId = "B"), 1, 2).apply(d, 1, 3)
        assertEquals(mapOf("A" to 2L, "B" to 1L), day.newByDeck)
        assertEquals(mapOf("A" to 1L, "B" to 1L), day.apply(d, -1, 4).newByDeck)
        assertEquals(emptyMap(), Daily("x").apply(DailyDelta("x", 0, 1, 3, 10), 1, 1).newByDeck)
    }

    @Test
    fun `today's mix lists decks with new words, biggest first, and hides with one deck`() {
        val decks = listOf(Deck("A", "TOEIC", createdAt = 1, updatedAt = 1), Deck("B", "Part 5", createdAt = 2, updatedAt = 2))
        val card = { id: String, deck: String -> Card(id = id, noteId = id, deckId = deck, template = "recognize", state = CardState.NEW, due = 0, stability = 0.0, difficulty = 0.0, createdAt = 0, updatedAt = 0) }
        assertEquals("TOEIC 4 · Part 5 1", newMixLabel(decks, mapOf("A" to 3L), listOf(card("a", "A"), card("b", "B"))))
        assertEquals(null, newMixLabel(decks, emptyMap(), listOf(card("a", "A"))))
    }
}
