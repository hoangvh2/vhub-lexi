package com.vh.lexi

import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollToNode
import androidx.test.uiautomator.UiDevice
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.printToString
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.core.ForgotKind
import com.vh.lexi.core.forgotOf
import com.vh.lexi.ui.MainActivity
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Rule
import org.junit.Test

/**
 * "Từ hay quên": mark a word from the study card (meaning + sound), open the list from Today, run a practice round
 * with a wrong answer in it, and prove FSRS is untouched: cards, review log and day counters are the same JSON before
 * marking and after the round. Screenshots 17-22 for the PR.
 */
class ForgotTest {
    private companion object { const val SHOTS = "/data/local/tmp/lexi-shots" }

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun sh(cmd: String) {
        val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(cmd)
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        sh("mkdir -p $SHOTS")
        sh("screencap -p $SHOTS/$name.png")
    }

    private fun exists(tag: String) = rule.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    private fun waitFor(label: String, ms: Long = 10_000, cond: () -> Boolean) {
        try {
            rule.waitUntil(ms, cond)
        } catch (e: Throwable) {
            shot("fail-forgot-" + label.replace(' ', '-'))
            rule.onAllNodes(isRoot()).printToString(maxDepth = 14).take(6000).lines().forEach { Log.i("LEXI_PERF", "dump $label: $it") }
            throw AssertionError("timeout waiting for $label\n" + rule.onAllNodes(isRoot()).printToString(maxDepth = 14).take(6000), e)
        }
    }

    private fun textOf(tag: String): String = rule.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().first()
        .config.getOrElse(SemanticsProperties.Text) { emptyList() }.joinToString("") { it.text }

    // word, meaning, pos, lapses (0 = never forgotten), new card?
    private val words = listOf(
        listOf("postpone", "hoãn lại; trì hoãn", "verb", 0, true),
        listOf("receipt", "biên lai", "noun", 4, false),
        listOf("venue", "địa điểm tổ chức", "noun", 2, false),
        listOf("attend", "tham dự", "verb", 0, false),
        listOf("budget", "ngân sách", "noun", 0, false),
        listOf("colleague", "đồng nghiệp", "noun", 1, false),
        listOf("launch", "ra mắt sản phẩm", "verb", 0, false),
    )

    private fun seed(app: LexiApp) {
        val now = System.currentTimeMillis()
        val day = 86_400_000L
        val notes = JSONArray()
        val cards = JSONArray()
        val reviews = JSONArray()
        words.forEachIndexed { i, w ->
            notes.put(JSONObject().put("id", "f$i").put("type", "vocab").put("deckId", "d1").put("createdAt", now - 30 * day).put("updatedAt", now - 30 * day)
                .put("fields", JSONObject().put("word", w[0]).put("vi", w[1]).put("pos", w[2]).put("ipa", "/${w[0]}/")
                    .put("examples", JSONArray().put("We will ${w[0]} it next week."))))
            val isNew = w[4] as Boolean
            val lapses = w[3] as Int
            val card = JSONObject().put("id", "f$i.recognize").put("noteId", "f$i").put("deckId", "d1").put("template", "recognize")
                .put("state", if (isNew) 0 else 2).put("due", if (isNew) now - day else now + 5 * day)
                .put("stability", if (isNew) 0.0 else 12.5).put("difficulty", if (isNew) 0.0 else 6.25).put("scheduledDays", if (isNew) 0.0 else 9.0)
                .put("learningSteps", 0).put("reps", if (isNew) 0 else 6).put("lapses", lapses).put("createdAt", now - 30 * day).put("updatedAt", now - 4 * day)
            if (!isNew) card.put("lastReview", now - 4 * day)
            cards.put(card)
            if (!isNew) reviews.put(JSONObject().put("id", "f$i.recognize@${now - 4 * day}").put("cardId", "f$i.recognize").put("noteId", "f$i").put("deckId", "d1")
                .put("rating", 3).put("state", 2).put("stability", 12.5).put("difficulty", 6.25).put("scheduledDays", 9.0).put("reviewedAt", now - 4 * day).put("durationMs", 4000).put("device", "android"))
        }
        val backup = JSONObject().put("app", "vhub-lexi").put("version", 1).put("exportedAt", now)
            .put("decks", JSONArray().put(JSONObject().put("id", "d1").put("name", "TOEIC").put("createdAt", now).put("updatedAt", now)))
            .put("notes", notes).put("cards", cards).put("reviews", reviews).put("daily", JSONArray()).put("prefs", JSONObject.NULL)
        runBlocking { app.data.importJson(backup.toString()) }
        rule.waitUntil(20_000) { app.data.notes.value.size >= words.size && app.data.cards.value.size >= words.size }
    }

    /** Cards, review log and day counters as exported: what FSRS and the statistics read. Sorted by id. */
    private fun fsrsState(app: LexiApp): String {
        val root = JSONObject(runBlocking { app.data.exportJson() })
        return listOf("cards", "reviews", "daily").joinToString("\n") { k ->
            val a = root.optJSONArray(k) ?: JSONArray()
            List(a.length()) { a.getJSONObject(it) }.sortedBy { it.optString("id") }.joinToString("\n") { "$k ${it.toString()}" }
        }
    }

    // The app's database outlives this class; SmokeTest expects a fresh app (one new word = "0/1").
    @After
    fun tearDown() {
        val app = rule.activity.application as LexiApp
        runBlocking { app.data.deleteDeckAndContents("d1") }
        rule.waitUntil(10_000) { app.data.notes.value.none { it.id.startsWith("f") && it.deckId == "d1" } }
    }

    @Test
    fun markFromTheCardThenPractiseWithoutTouchingFsrs() {
        val app = rule.activity.application as LexiApp
        seed(app)
        val before = fsrsState(app)
        assertTrue("seeded cards exported", before.contains("f1.recognize"))

        // Mark "postpone" from its study card: meaning and sound.
        rule.onNodeWithTag("nav-library").performClick()
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("start-study", 20_000) { exists("start-study") }
        rule.onNodeWithTag("start-study").performClick()
        waitFor("forgot-btn") { exists("forgot-btn") }
        rule.onNodeWithTag("forgot-btn").performClick()
        waitFor("forgot-pop") { exists("forgot-meaning") }
        rule.onNodeWithTag("forgot-meaning").performClick()
        waitFor("meaning marked") { app.data.notes.value.first { it.id == "f0" }.forgot == listOf("meaning") }
        rule.onNodeWithTag("forgot-sound").performClick()
        waitFor("sound marked") { app.data.notes.value.first { it.id == "f0" }.forgot == listOf("meaning", "sound") }
        shot("17-forgot-pop")
        // Close the menu the way a learner would (system back dismisses the popup only).
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        waitFor("menu closed") { !exists("forgot-pop") }

        // Today: the panel leads to the list; a word FSRS says is forgotten often is suggested and marked with one tap.
        rule.onNodeWithTag("nav-library").performClick()
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("today-watch", 20_000) { exists("open-forgot") }
        rule.onNodeWithTag("open-forgot").performScrollTo().performClick()
        waitFor("forgot-screen") { exists("forgot-screen") && exists("forgot-row") }
        shot("18-forgot-list")
        rule.onNodeWithTag("forgot-screen").performScrollToNode(hasTestTag("forgot-suggest-add"))
        waitFor("suggestions") { exists("forgot-suggest-add") }
        shot("18b-forgot-suggested")
        rule.onAllNodes(hasTestTag("forgot-suggest-add")).onFirst().performClick() // receipt: 4 lapses, the most
        waitFor("receipt marked") { forgotOf(app.data.notes.value.first { it.id == "f1" }) == listOf(ForgotKind.MEANING) }
        rule.onNodeWithTag("forgot-screen").performScrollToIndex(0)

        // A practice round: one wrong choice, the rest right.
        rule.onNodeWithTag("drill-start").performClick()
        waitFor("drill") { exists("drill-card") }
        val byMeaning = words.associate { (it[1] as String).split(";")[0].trim() to it[0] as String }
        var wrongDone = false
        var steps = 0
        val seen = HashSet<String>()
        while (!exists("drill-done")) {
            assertTrue("round ends", steps++ < 30)
            // "Tiếp" must have moved on: the answer panel still showing means the old card, whose typing field is gone.
            waitFor("question $steps") { exists("drill-done") || (exists("drill-card") && !exists("drill-answer")) }
            if (exists("drill-done")) break
            when {
                exists("drill-opt-right") -> {
                    if (!wrongDone) { shot("19-drill-meaning"); rule.onAllNodes(hasTestTag("drill-opt")).onFirst().performScrollTo().performClick(); wrongDone = true; waitFor("wrong") { exists("drill-answer") }; shot("20-drill-wrong") }
                    else rule.onNodeWithTag("drill-opt-right").performScrollTo().performClick()
                }
                exists("drill-meaning") -> {
                    waitFor("recall input $steps") { exists("drill-input") }
                    val w = byMeaning.getValue(textOf("drill-meaning"))
                    rule.onNodeWithTag("drill-input").performTextInput(w)
                    if (seen.add("recall")) shot("21-drill-recall")
                    rule.onNodeWithTag("drill-check").performScrollTo().performClick()
                }
                exists("drill-play") -> {
                    waitFor("listen input $steps") { exists("drill-input") }
                    rule.onNodeWithTag("drill-input").performTextInput("postpone")
                    if (seen.add("listen")) shot("21b-drill-listen")
                    rule.onNodeWithTag("drill-check").performScrollTo().performClick()
                }
                exists("drill-hear") -> {
                    rule.onNodeWithTag("drill-hear").performScrollTo().performClick()
                    waitFor("say grade") { exists("drill-say-yes") }
                    rule.onNodeWithTag("drill-say-yes").performScrollTo().performClick()
                }
                else -> throw AssertionError("unknown drill state\n" + rule.onAllNodes(isRoot()).printToString(maxDepth = 14).take(4000))
            }
            waitFor("answer $steps") { exists("drill-next") }
            // After typing, the keyboard closes as the field goes away and the screen resizes under the tap; a tap that
            // lands while it moves can miss "Tiếp", so it is tapped again only while the answer is still showing.
            rule.runOnUiThread { WindowCompat.getInsetsController(rule.activity.window, rule.activity.window.decorView).hide(WindowInsetsCompat.Type.ime()) }
            for (tap in 1..3) {
                rule.waitForIdle()
                if (!exists("drill-next")) break
                rule.onNodeWithTag("drill-next").performScrollTo().performClick()
                try { rule.waitUntil(2_000) { !exists("drill-answer") } } catch (_: Throwable) { Log.i("LEXI_PERF", "drill-next tap $tap missed at step $steps") }
            }
        }
        shot("22-drill-done")
        assertTrue("the wrong choice is counted", textOf("drill-score").contains("đúng ngay lần đầu"))
        assertTrue("one miss reported", exists("drill-missed"))

        // FSRS untouched: the same cards, review log and day counters as before anything was marked.
        val after = fsrsState(app)
        Log.i("LEXI_FSRS", "fsrs state equal after mark + practice: ${before == after} (${before.length} chars)")
        assertEquals(before, after)
        val marked = app.data.notes.value.filter { it.forgot.isNotEmpty() }.map { it.id }.sorted()
        assertEquals(listOf("f0", "f1"), marked)

        // Library: "venue" is due in 5 days; its read view marks it now, and the "Hay quên" filter lists the marked words.
        rule.onNodeWithTag("nav-library").performClick()
        waitFor("library") { exists("lib-item") }
        rule.onAllNodes(hasSetTextAction()).onFirst().performTextInput("venue")
        waitFor("venue row") { rule.onAllNodes(hasTestTag("lib-item"), useUnmergedTree = true).fetchSemanticsNodes().size == 1 }
        rule.onNodeWithTag("lib-item").performClick()
        waitFor("note-view") { exists("note-view") && exists("forgot-btn") }
        rule.onNodeWithTag("forgot-btn").performClick()
        waitFor("view menu") { exists("forgot-sound") }
        rule.onNodeWithTag("forgot-sound").performClick()
        waitFor("venue marked") { forgotOf(app.data.notes.value.first { it.id == "f2" }) == listOf(ForgotKind.SOUND) }
        shot("23-library-view-mark")
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        waitFor("view menu closed") { !exists("forgot-pop") }
        rule.onNodeWithTag("view-close").performClick()
        waitFor("view closed") { !exists("note-view") }
        rule.onAllNodes(hasSetTextAction()).onFirst().performTextClearance()
        // The search keyboard leaves room for one or two rows on a 320x640 screen, and the list composes only what it shows.
        rule.runOnUiThread { WindowCompat.getInsetsController(rule.activity.window, rule.activity.window.decorView).hide(WindowInsetsCompat.Type.ime()) }
        rule.waitForIdle()
        rule.onNodeWithText("Hay quên").performScrollTo().performClick()
        // The list composes only the rows on screen, so the rows shown must all be marked, and each marked word must be
        // reachable by scrolling; an unmarked word is not in the list at all.
        fun count(tag: String) = rule.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size
        waitFor("forgot filter") { count("lib-item") > 0 && count("lib-item") == count("lib-forgot") }
        shot("24-library-filter")
        for (w in listOf("postpone", "receipt", "venue")) {
            rule.onNodeWithTag("lib-list").performScrollToNode(hasText(w))
            waitFor("filter row $w") { rule.onAllNodes(hasText(w), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        }
        assertTrue("an unmarked word is filtered out", runCatching { rule.onNodeWithTag("lib-list").performScrollToNode(hasText("attend")) }.isFailure)
        assertEquals(before, fsrsState(app))
    }
}
