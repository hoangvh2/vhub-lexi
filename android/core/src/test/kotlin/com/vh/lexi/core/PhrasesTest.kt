package com.vh.lexi.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame

/** Same cases as web/test/phrases.test.ts (the vectors in templates.json pin the rest). */
class PhrasesTest {
    private fun t(s: String) = FieldValue.Text(s)
    private fun items(vararg s: String) = FieldValue.Items(s.toList())
    private val layout = CardLayout(true, true, true, true, true, true)
    private fun note(fields: Map<String, FieldValue>) = Note("n1", "vocab", "d", fields, createdAt = 0, updatedAt = 0)
    private val acc = note(mapOf(
        "word" to t("accommodate"), "pos" to t("verb"),
        "vi" to t("(chứa) chứa được; (dịch vụ) đáp ứng; (công việc) tạo điều kiện"),
        "phrases" to items("accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu", "She accommodates new staff | tạo điều kiện cho nhân viên mới"),
        "examples" to items("The hotel can accommodate a large group of tourists."),
        "examplesVi" to items("Khách sạn có thể chứa một đoàn du khách lớn."),
    ))
    private val cloze = template("vocab", "cloze")!!

    @Test
    fun `parses phrase | meaning and keeps only phrases with the word`() {
        assertEquals(Phrase("accommodate 200 guests", "chứa được 200 khách"), parsePhrase("  accommodate   200 guests | chứa được   200 khách "))
        assertEquals(Phrase("accommodate a request", ""), parsePhrase("accommodate a request"))
        assertNull(parsePhrase("   |  chỉ có nghĩa"))
        val n = note(mapOf("word" to t("accommodate"), "phrases" to items("welcome 200 guests | chào đón", "accommodates 200 guests | chứa", "", "accommodate")))
        assertEquals(listOf("accommodates 200 guests", "accommodate"), phrasesOf(n).map { it.text })
    }

    @Test
    fun `turns the phrases one review after another and wraps around`() {
        fun quote(reps: Int) = cloze.front(studyNote(acc, "cloze", reps), layout).filterIsInstance<Block.Quote>().single().text
        assertEquals("_____ 200 guests", quote(0))
        assertEquals("_____ a request", quote(1))
        assertEquals("She _____ new staff", quote(2))
        assertEquals(quote(0), quote(3))
        assertEquals(listOf("accommodate", "accommodates"), cloze.expected(studyNote(acc, "cloze", 2)))
    }

    @Test
    fun `other templates and notes without phrases are shown as they are`() {
        assertSame(acc, studyNote(acc, "listen", 1))
        assertSame(acc, studyNote(acc, "recall", 1))
        val plain = note(mapOf("word" to t("accommodate"), "examples" to items("We accommodate guests.")))
        assertSame(plain, studyNote(plain, "cloze", 4))
    }

    @Test
    fun `a phrase without a meaning never lets old translations slide onto it`() {
        val n = note(mapOf("word" to t("accommodate"), "phrases" to items("accommodate 200 guests"), "vi" to t("chứa được"), "examples" to items("Rooms accommodate guests."), "examplesVi" to items("Phòng chứa khách.")))
        val v = studyNote(n, "cloze", 0)
        assertEquals(emptyList(), v.fields["examplesVi"].items())
        assertEquals(true, cloze.front(v, layout).contains(Block.Text("chứa được", "muted")))
    }

    @Test
    fun `answer sides list the phrases before the full examples, rotation leaves them alone`() {
        for (id in listOf("recognize", "recall")) {
            val kinds = template("vocab", id)!!.back(acc, layout).filterIsInstance<Block.Example>().map { it.phrase }
            assertEquals(listOf(true, true, true, false), kinds, id)
        }
        val blocks = phraseBlocks(acc) + listOf(Block.Example("S1"), Block.Example("S2"), Block.Memo("m"))
        val out = rotateExamples(blocks, 1).map { if (it is Block.Example) it.text else "m" }
        assertEquals(listOf("accommodate 200 guests", "accommodate a request", "She accommodates new staff", "S2", "S1", "m"), out)
    }
}
