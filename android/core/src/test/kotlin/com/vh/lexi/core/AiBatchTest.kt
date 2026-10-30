package com.vh.lexi.core

import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Same cases as web/test/enrich.test.ts (runBatch / confirmAndRun). */
class AiBatchTest {
    private fun note(id: String, word: String, extra: Map<String, FieldValue> = emptyMap()) =
        Note(id, "vocab", "d", mapOf("word" to FieldValue.Text(word)) + extra, createdAt = 0, updatedAt = 0)

    private class Setup(words: List<String>, val call: suspend (String) -> Enriched, concurrency: Int = 2) {
        val db = ConcurrentHashMap<String, Note>()
        val ids = words.indices.map { "n$it" }
        val batch = AiBatch(
            call = { w, _, _, _ -> call(w) },
            getNote = { db[it] },
            save = { n, f, ai -> db[n.id] = n.copy(fields = f, aiFields = ai.toList()) },
            concurrency = concurrency, retryDelayMs = 0,
        )
        init { words.forEachIndexed { i, w -> db["n$i"] = Note("n$i", "vocab", "d", mapOf("word" to FieldValue.Text(w)), createdAt = 0, updatedAt = 0) } }
    }

    @Test
    fun `fills every selected note, a few at a time`() = runBlocking {
        val inFlight = AtomicInteger()
        var peak = 0
        val s = Setup(listOf("alpha", "beta", "gamma", "delta", "omega"), {
            peak = maxOf(peak, inFlight.incrementAndGet()); delay(20); inFlight.decrementAndGet(); Enriched(vi = "nghĩa")
        })
        val p = s.batch.run(s.ids)
        assertEquals(BatchProgress(running = false, total = 5, done = 5), p)
        assertEquals(2, peak)
        assertEquals(true, s.db.values.all { it.fields["vi"].str() == "nghĩa" && "vi" in it.aiFields })
    }

    @Test
    fun `stops when the daily allowance runs out and keeps what was saved`() = runBlocking {
        val n = AtomicInteger()
        val s = Setup(listOf("a1", "a2", "a3", "a4"), { if (n.incrementAndGet() > 2) throw AiError(AiError.Kind.QUOTA, "x") else Enriched(vi = "ok") }, concurrency = 1)
        val p = s.batch.run(s.ids)
        assertEquals(2, p.done)
        assertEquals(StopReason.QUOTA, p.stopped)
        assertEquals(2, s.db.values.count { it.fields["vi"].str() == "ok" })
    }

    @Test
    fun `retries a temporary failure once, then counts it and moves on`() = runBlocking {
        val calls = mutableListOf<String>()
        val s = Setup(listOf("good", "flaky", "broken"), { w ->
            calls += w
            if (w == "broken" || (w == "flaky" && calls.count { it == "flaky" } == 1)) throw AiError(AiError.Kind.TEMPORARY, "x")
            Enriched(vi = "ok")
        }, concurrency = 1)
        val p = s.batch.run(s.ids)
        assertEquals(2, p.done)
        assertEquals(1, p.failed)
        assertEquals(2, calls.count { it == "broken" })
    }

    @Test
    fun `stop ends the batch after the calls in flight`() = runBlocking {
        lateinit var s: Setup
        s = Setup(listOf("w1", "w2", "w3", "w4"), { s.batch.stop(); Enriched(vi = "ok") }, concurrency = 1)
        val p = s.batch.run(s.ids)
        assertEquals(1, p.done)
        assertEquals(StopReason.CANCEL, p.stopped)
    }

    @Test
    fun `does not overwrite an edit the learner made while the call was running`() = runBlocking {
        lateinit var s: Setup
        s = Setup(listOf("edit"), {
            s.db["n0"] = note("n0", "edit", mapOf("vi" to FieldValue.Text("tôi vừa sửa")))
            Enriched(vi = "AI", mnemonic = "Tôi edit lại bài.")
        })
        s.batch.run(s.ids)
        assertEquals("tôi vừa sửa", s.db["n0"]!!.fields["vi"].str())
        assertEquals("Tôi edit lại bài.", s.db["n0"]!!.fields["mnemonic"].str())
    }

    @Test
    fun `replacing meanings asks first - no leaves every note untouched, yes replaces`() = runBlocking {
        val calls = AtomicInteger()
        val s = Setup(listOf("keep"), { calls.incrementAndGet(); Enriched(vi = "(công việc) nghĩa AI") })
        s.db["n0"] = note("n0", "keep", mapOf("vi" to FieldValue.Text("nghĩa của tôi")))
        val asked = mutableListOf<String>()
        assertNull(s.batch.confirmAndRun(s.ids, overwriteVi = true) { title, _ -> asked += title; false })
        assertEquals(listOf("Thay nghĩa tiếng Việt của 1 từ?"), asked)
        assertEquals(0, calls.get())
        assertEquals("nghĩa của tôi", s.db["n0"]!!.fields["vi"].str())

        assertEquals(1, s.batch.confirmAndRun(s.ids, overwriteVi = true) { _, _ -> true }!!.done)
        assertEquals("(công việc) nghĩa AI", s.db["n0"]!!.fields["vi"].str())
    }

    @Test
    fun `filling only gaps never asks`() = runBlocking {
        val s = Setup(listOf("gap"), { Enriched(vi = "AI") })
        var asked = false
        s.batch.confirmAndRun(s.ids, overwriteVi = false) { _, _ -> asked = true; true }
        assertEquals(false, asked)
        assertEquals("AI", s.db["n0"]!!.fields["vi"].str())
    }
}
