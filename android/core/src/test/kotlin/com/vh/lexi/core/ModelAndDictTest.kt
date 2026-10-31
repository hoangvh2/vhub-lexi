package com.vh.lexi.core

import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ModelTest {
    private val utc = ZoneOffset.UTC
    @Test
    fun `optimized FSRS parameters are read only as 21 finite numbers and drive the scheduler`() {
        // Firestore hands whole numbers back as Long.
        val stored: List<Any> = listOf<Any>(0L) + Fsrs.DEFAULT_W.drop(1).toList()
        assertEquals(Fsrs.DEFAULT_W.drop(1), fsrsWeightsOrNull(stored)!!.drop(1))
        assertEquals(0.0, fsrsWeightsOrNull(stored)!![0])
        assertNull(fsrsWeightsOrNull(stored.drop(1)))
        assertNull(fsrsWeightsOrNull(stored.drop(1) + "0.1"))
        assertNull(fsrsWeightsOrNull(stored.drop(1) + Double.NaN))
        assertNull(fsrsWeightsOrNull(null))
        // A learner whose fitted first-"Easy" stability is 1.5 days gets a much shorter first interval than the default 8.
        val fast = Fsrs.DEFAULT_W.copyOf().also { it[3] = 1.5 }.toList()
        val card = Card(id = "n.recognize", noteId = "n", deckId = "d", template = "recognize", due = 0, createdAt = 0, updatedAt = 0)
        val default = Prefs().fsrs().next(card, 0, 4).scheduledDays
        val fitted = Prefs(fsrsWeights = fast).fsrs().next(card, 0, 4).scheduledDays
        assertTrue(fitted < default / 3, "fitted $fitted, default $default")
    }

    @Test
    fun `study day rolls over at the configured hour`() {
        val t = { y: Int, mo: Int, d: Int, h: Int -> java.time.LocalDateTime.of(y, mo, d, h, 0).toInstant(utc).toEpochMilli() }
        assertEquals("2026-01-14", dayId(t(2026, 1, 15, 2), 4, utc))
        assertEquals("2026-01-15", dayId(t(2026, 1, 15, 5), 4, utc))
        assertEquals(t(2026, 1, 16, 4), nextDayStart(t(2026, 1, 15, 10), 4, utc))
        assertEquals(t(2026, 1, 15, 4), nextDayStart(t(2026, 1, 15, 2), 4, utc))
    }

    @Test
    fun `daily counters add and subtract without going negative`() {
        val d = DailyDelta("2026-01-15", newCards = 1, reviews = 0, rating = 3, ms = 4000)
        val up = Daily("2026-01-15").apply(d, 1, 5)
        assertEquals(Daily("2026-01-15", newCards = 1, good = 1, ms = 4000, updatedAt = 5), up)
        assertEquals(Daily("2026-01-15", updatedAt = 9), up.apply(d, -1, 9))
        assertEquals(0L, Daily("x").apply(d, -1, 1).newCards)
    }
}

class DictTest {
    private val se = """{"v":1,"e":[
      ["serendipity","ˌsɛrənˈdɪpɪti",0,[["n",[["good luck in making unexpected and fortunate discoveries"]]]]],
      ["serene","sɝˈin",3,[["a",[["completely calm",["a serene smile"]]]]],[["a","thanh bình; trầm lặng"]]]
    ]}""".trimIndent()
    private val pr = """{"v":1,"e":[
      ["procrastinate","proʊˈkræstɪneɪt",0,[["v",[["postpone doing what one should be doing",["do not procrastinate"]]]]]]
    ]}"""
    private val dict = Dictionary { key -> when (key) { "se" -> se; "pr" -> pr; else -> null } }

    @Test
    fun `exact lookup decodes ipa parts of speech and examples`() {
        val r = assertNotNull(dict.lookup(" Serendipity "))
        assertEquals("serendipity", r.entry.word)
        assertEquals("ˌsɛrənˈdɪpɪti", r.entry.ipa)
        assertEquals("n", r.entry.pos[0].pos)
        assertTrue(dict.lookup("serene")!!.entry.pos[0].senses[0].def.isNotEmpty())
        assertEquals(emptyList(), r.entry.vi)
    }

    @Test
    fun `vietnamese meaning follows the part of speech`() {
        val serene = dict.lookup("serene")!!.entry
        assertEquals("thanh bình; trầm lặng", serene.viFor("adjective"))
        assertEquals("", serene.viFor("noun"))
        val pronoun = DictEntry("it", "", 0, emptyList(), listOf(DictVi("n", "công nghệ thông tin"), DictVi("pron", "nó")))
        assertEquals("công nghệ thông tin", pronoun.viFor("noun"))
        assertEquals("nó", pronoun.viFor("verb"))
    }

    @Test
    fun `inflected forms resolve to the base word`() {
        val r = assertNotNull(dict.lookup("procrastinating"))
        assertEquals("procrastinate", r.entry.word)
        assertEquals("procrastinating", r.inflectedFrom)
        assertEquals(listOf("do not procrastinate"), r.entry.pos[0].senses[0].examples)
    }

    @Test
    fun `suggest ranks common words first and needs two letters`() {
        assertEquals(listOf("serene", "serendipity"), dict.suggest("ser").map { it.word })
        assertEquals(emptyList(), dict.suggest("s"))
        assertNull(dict.lookup("qzxwv"))
        assertNull(Dictionary { null }.lookup("hello"))
    }
}

class StatsTest {
    private val utc = ZoneOffset.UTC
    private val t0 = java.time.LocalDateTime.of(2026, 1, 15, 10, 0).toInstant(utc).toEpochMilli()
    private val day = 86_400_000L
    private fun card(id: String, over: (Card) -> Card = { it }) =
        over(Card(id = id, noteId = id, deckId = "d", template = "recognize", due = t0, createdAt = t0, updatedAt = t0))

    @Test
    fun `counts forecast streak retention and heatmap`() {
        val cards = listOf(
            card("a"),
            card("b") { it.copy(state = CardState.REVIEW, scheduledDays = 30.0, due = t0 + 2 * day) },
            card("c") { it.copy(state = CardState.REVIEW, scheduledDays = 5.0, due = t0 - day) },
        )
        assertEquals(CardCounts(3, 1, 0, 1, 1, 0), cardCounts(cards))
        val fc = forecast(cards, t0, 4, 5, utc)
        assertEquals(1, fc[0])
        assertEquals(2, fc.sum())
        val ids = listOf(0L, 1L, 2L, 4L).map { dayId(t0 - it * day, 4, utc) }
        val dailies = ids.map { Daily(it, newCards = 10, again = 1, good = 9) }
        assertEquals(3, streak(dailies, t0, 4, utc))
        assertEquals(0, streak(emptyList(), t0, 4, utc))
        assertEquals(0.9, retention(dailies, t0, 4, 30, utc)!!, 1e-9)
        assertNull(retention(emptyList(), t0, 4, 30, utc))
        val heat = heatmap(dailies, t0, 4, 4, utc)
        assertEquals(10L, heat.first { it.id == ids[0] }.count)
        assertEquals(0, heatLevel(0, 10))
        assertEquals(4, heatLevel(10, 10))
    }
}
