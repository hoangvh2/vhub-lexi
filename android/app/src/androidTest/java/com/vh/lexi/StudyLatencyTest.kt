package com.vh.lexi

import android.util.Log
import android.view.Choreographer
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.printToString
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.data.Col
import com.vh.lexi.data.toDoc
import com.vh.lexi.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.concurrent.thread

/**
 * Rating a card must move on at once with a full-size collection: 600 words (examples and a memory tip each), 1,200
 * cards, 20,000 review logs (an Anki history), 300 days of counters. VH saw ~1.75 s before the next card and then
 * ~3.5 s of an empty card on his phone. Each rating is followed by the server echo that CloudSync writes to Room
 * (the card and the day's counters), as with a signed-in account.
 *
 * Measured per rating: tap to the next card's front on screen, and the longest gap between two frames in the 2.5 s
 * after the tap (the screen "freezing"). Logged as LEXI_PERF for CI logs; the limits are far above a healthy run and
 * far below what VH saw, so the test fails on a regression of that kind, not on emulator noise.
 */
@OptIn(ExperimentalTestApi::class)
class StudyLatencyTest {
    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun seed(app: LexiApp) {
        val now = System.currentTimeMillis()
        val day = 86_400_000L
        val notes = JSONArray()
        val cards = JSONArray()
        val reviews = JSONArray()
        val daily = JSONArray()
        for (i in 0 until 600) {
            val w = "word" + ('a' + i % 26) + i
            notes.put(JSONObject().put("id", "n$i").put("type", "vocab").put("deckId", "d1").put("tags", JSONArray().put("lesson-${i % 50}"))
                .put("createdAt", now - 100 * day).put("updatedAt", now - 100 * day)
                .put("fields", JSONObject().put("word", w).put("vi", "nghĩa số $i; hàng hoá").put("en", "meaning $i of the word").put("pos", "noun")
                    .put("examples", JSONArray().put("They will $w the plan tomorrow.").put("A second $w example here."))
                    .put("mnemonic", if (i % 3 != 0) "Đọc như \"con vịt $i\"" else "")))
            for (t in listOf("recognize", "cloze")) {
                val review = i < 400
                val card = JSONObject().put("id", "n$i.$t").put("noteId", "n$i").put("deckId", "d1").put("template", t)
                    .put("state", if (review) 2 else 0).put("due", if (review) now - (i % 40) * day / 2 + (i % 7) * day else now - 100 * day + i)
                    .put("stability", if (review) 10.0 else 0.0).put("difficulty", if (review) 5.0 else 0.0).put("scheduledDays", if (review) 10.0 else 0.0)
                    .put("learningSteps", 0).put("reps", if (review) 5 else 0).put("lapses", 0).put("createdAt", now - 100 * day).put("updatedAt", now - 11 * day)
                if (review) card.put("lastReview", now - 11 * day)
                cards.put(card)
            }
        }
        for (j in 0 until 20_000) {
            val n = "n${j % 400}"; val t = if (j % 2 == 1) "cloze" else "recognize"; val at = now - 400 * day + j * 60_000L
            reviews.put(JSONObject().put("id", "$n.$t@$at").put("cardId", "$n.$t").put("noteId", n).put("deckId", "d1").put("rating", 3).put("state", 2)
                .put("stability", 10.0).put("difficulty", 5.0).put("scheduledDays", 10.0).put("reviewedAt", at).put("durationMs", 4000).put("device", "anki"))
        }
        for (d in 1 until 300) {
            daily.put(JSONObject().put("id", com.vh.lexi.core.dayId(now - d * day, 4)).put("newCards", 5).put("reviews", 40)
                .put("again", 2).put("hard", 5).put("good", 30).put("easy", 3).put("ms", 600_000L).put("updatedAt", now))
        }
        val backup = JSONObject().put("app", "vhub-lexi").put("version", 1).put("exportedAt", now)
            .put("decks", JSONArray().put(JSONObject().put("id", "d1").put("name", "TOEIC 600").put("createdAt", now).put("updatedAt", now)))
            .put("notes", notes).put("cards", cards).put("reviews", reviews).put("daily", daily).put("prefs", JSONObject.NULL)
        runBlocking { app.data.importJson(backup.toString()) }
        rule.waitUntil(60_000) { app.data.cards.value.size >= 1200 && app.data.notes.value.size >= 600 }
    }

    private fun exists(tag: String) = rule.onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    /** Front of a card: flip ("Hiện đáp án") or typing ("Kiểm tra"). */
    private fun front() = exists("show-answer") || exists("type-check")

    private fun waitFor(label: String, ms: Long, cond: () -> Boolean) {
        try {
            rule.waitUntil(ms, cond)
        } catch (e: Throwable) {
            val tree = rule.onRoot(useUnmergedTree = true).printToString(maxDepth = 30)
            tree.chunked(3000).forEach { Log.i("LEXI_PERF", "tree for $label: $it") }
            throw AssertionError("timeout waiting for $label", e)
        }
    }

    /** Longest gap between frames while [block] runs and for [tailMs] after. */
    private class FrameGaps {
        @Volatile var running = false
        @Volatile var last = 0L
        @Volatile var max = 0L
        private val cb = object : Choreographer.FrameCallback {
            override fun doFrame(t: Long) {
                if (!running) return
                if (last != 0L) max = maxOf(max, (t - last) / 1_000_000)
                last = t
                Choreographer.getInstance().postFrameCallback(this)
            }
        }
        fun start() {
            max = 0; last = 0; running = true
            InstrumentationRegistry.getInstrumentation().runOnMainSync { Choreographer.getInstance().postFrameCallback(cb) }
        }
        fun stop(): Long { running = false; return max }
    }

    @Test
    fun ratingMovesToTheNextCardAtOnceWithAFullCollection() {
        val app = rule.activity.application as LexiApp
        seed(app)
        rule.onNodeWithTag("nav-library").performClick()
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("start-study", 20_000) { exists("start-study") }
        rule.onNodeWithTag("start-study").performClick()
        waitFor("first card", 20_000) { front() }

        val toCard = ArrayList<Long>()
        val gaps = ArrayList<Long>()
        val frames = FrameGaps()
        repeat(12) { k ->
            // A typing card is revealed with "Không nhớ"; the rating path is the same.
            if (exists("show-answer")) rule.onNodeWithTag("show-answer").performClick()
            else rule.onNodeWithText("Không nhớ").performScrollTo().performClick() // below the fold on a small screen
            waitFor("rating buttons $k", 10_000) { exists("rate-3") }
            rule.waitForIdle()
            Thread.sleep(400)
            frames.start()
            val t0 = System.nanoTime()
            rule.onNodeWithTag("rate-3").performClick()
            // The server's echo of this rating, as CloudSync writes it to Room ~0.3 s later (card + counters).
            thread {
                Thread.sleep(300)
                runBlocking {
                    val c = app.data.cards.value.maxByOrNull { it.updatedAt }
                    if (c != null) app.data.applyRemote(Col.CARDS, listOf(c.toDoc()), emptyList())
                    val d = app.data.daily.value.maxByOrNull { it.id }
                    if (d != null) app.data.applyRemote(Col.DAILY, listOf(d.toDoc()), emptyList())
                }
            }
            waitFor("next card $k", 15_000) { !exists("rate-3") && (front() || exists("session-done")) }
            toCard += (System.nanoTime() - t0) / 1_000_000
            Thread.sleep(2500)
            gaps += frames.stop()
            Log.i("LEXI_PERF", "rating $k: next card ${toCard.last()} ms, longest frame gap ${gaps.last()} ms")
        }
        val sorted = toCard.sorted()
        val median = sorted[sorted.size / 2]
        Log.i("LEXI_PERF", "next card median $median ms, max ${sorted.last()} ms; frame gap max ${gaps.max()} ms; all $toCard / $gaps")
        println("LEXI_PERF next card median $median ms, max ${sorted.last()} ms; frame gap max ${gaps.max()} ms; all $toCard / $gaps")
        assertTrue("next card median $median ms (all $toCard)", median < 600)
        assertTrue("longest frame gap ${gaps.max()} ms (all $gaps)", gaps.max() < 700)
    }
}
