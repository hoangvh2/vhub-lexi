package com.vh.lexi.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/** Same cases as web/test/enrich.test.ts (mergeEnrich). */
class EnrichTest {
    private val ai = Enriched(
        vi = "(công việc) trình diễn; (chung) chứng minh",
        en = "to show how something works",
        examples = listOf("The rep demonstrated the printer.", "Results demonstrate the point."),
        examplesVi = listOf("Nhân viên trình diễn máy in.", "Kết quả chứng minh luận điểm."),
        existingVi = listOf("Cô ấy trình diễn ứng dụng."),
        mnemonic = "Anh sales demonstrate cái máy in mới.",
    )
    private fun t(s: String) = FieldValue.Text(s)

    @Test
    fun `fills an empty note and keeps translations aligned with examples`() {
        val m = mergeEnrich(mapOf("word" to t("demonstrate"), "examples" to FieldValue.Items(listOf("She demonstrated the app."))), emptySet(), ai)
        assertEquals(ai.vi, m.fields["vi"].str())
        assertEquals(listOf("She demonstrated the app.") + ai.examples, m.fields["examples"].items())
        assertEquals(listOf("Cô ấy trình diễn ứng dụng.") + ai.examplesVi, m.fields["examplesVi"].items())
        assertEquals(setOf("vi", "en", "examples", "examplesVi", "mnemonic"), m.aiFields)
    }

    @Test
    fun `keeps what the learner wrote unless asked to overwrite the meaning`() {
        val mine = mapOf("word" to t("demonstrate"), "vi" to t("biểu diễn"), "en" to t("show"), "mnemonic" to t("của tôi"))
        val m = mergeEnrich(mine, emptySet(), ai)
        assertEquals("biểu diễn", m.fields["vi"].str())
        assertEquals("show", m.fields["en"].str())
        assertEquals("của tôi", m.fields["mnemonic"].str())
        assertFalse("vi" in m.aiFields)
        assertEquals(ai.vi, mergeEnrich(mine, emptySet(), ai, overwriteVi = true).fields["vi"].str())
        assertEquals(ai.vi, mergeEnrich(mine + ("vi" to t("cũ")), setOf("vi"), ai).fields["vi"].str())
    }

    @Test
    fun `never lets a translation slide onto the wrong sentence`() {
        val m = mergeEnrich(mapOf("word" to t("x"), "examples" to FieldValue.Items(listOf("A x.", "B x."))), emptySet(), ai.copy(existingVi = listOf("A dịch", "")))
        assertEquals(listOf("A x.") + ai.examples + "B x.", m.fields["examples"].items())
        assertEquals(listOf("A dịch") + ai.examplesVi, m.fields["examplesVi"].items())
        val same = mergeEnrich(mapOf("examples" to FieldValue.Items(listOf("B x.", "A x."))), emptySet(), Enriched(vi = ""))
        assertEquals(listOf("B x.", "A x."), same.fields["examples"].items())
    }

    @Test
    fun `skips duplicate sentences and stops at 8 examples`() {
        val eight = (0 until 8).map { "Sentence $it demonstrate." }
        assertEquals(eight, mergeEnrich(mapOf("examples" to FieldValue.Items(eight)), emptySet(), ai).fields["examples"].items())
        val dup = mergeEnrich(mapOf("examples" to FieldValue.Items(listOf(ai.examples[0].uppercase()))), emptySet(), ai.copy(existingVi = emptyList()))
        assertEquals(listOf(ai.examples[1], ai.examples[0].uppercase()), dup.fields["examples"].items())
        assertEquals(listOf(ai.examplesVi[1]), dup.fields["examplesVi"].items())
    }

    private val phrases = listOf("accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu", "accommodate new staff | tạo điều kiện cho nhân viên mới", "accommodate the boss | chiều ý sếp")

    @Test
    fun `phrases fill an empty field with at most 3 lines and mark it AI, touching nothing else`() {
        val m = mergeEnrich(mapOf("word" to t("accommodate"), "vi" to t("tạo điều kiện")), emptySet(), Enriched(vi = "", phrases = phrases))
        assertEquals(phrases.take(3), m.fields["phrases"].items())
        assertEquals(true, "phrases" in m.aiFields)
        assertEquals("tạo điều kiện", m.fields["vi"].str())
        assertEquals(false, m.fields.containsKey("examples"))
    }

    @Test
    fun `phrases the learner wrote are never replaced, AI-written ones are refreshed`() {
        val mine = mergeEnrich(mapOf("word" to t("accommodate"), "phrases" to FieldValue.Items(listOf("accommodate my boss | chiều sếp"))), emptySet(), Enriched(vi = "", phrases = phrases))
        assertEquals(listOf("accommodate my boss | chiều sếp"), mine.fields["phrases"].items())
        assertEquals(false, "phrases" in mine.aiFields)
        val ai = mergeEnrich(mapOf("word" to t("accommodate"), "phrases" to FieldValue.Items(listOf("old one | cũ"))), setOf("phrases"), Enriched(vi = "", phrases = phrases))
        assertEquals(phrases.take(3), ai.fields["phrases"].items())
    }

    @Test
    fun `an answer without phrases changes nothing, and hasPhrases ignores blank lines`() {
        val m = mergeEnrich(mapOf("word" to t("x"), "phrases" to FieldValue.Items(listOf("a b c | d"))), emptySet(), Enriched(vi = "nghĩa"))
        assertEquals(listOf("a b c | d"), m.fields["phrases"].items())
        assertEquals(true, hasPhrases(m.fields))
        assertEquals(false, hasPhrases(mapOf("phrases" to FieldValue.Items(listOf("", "  ")))))
    }
}
