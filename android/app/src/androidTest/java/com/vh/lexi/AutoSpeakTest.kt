package com.vh.lexi

import android.content.Context
import android.os.ParcelFileDescriptor
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.printToString
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.ui.MainActivity
import com.vh.lexi.util.Speech
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Records what the app would say instead of speaking. */
private class RecordingSpeech(context: Context) : Speech(context) {
    val spoken = CopyOnWriteArrayList<String>()
    val stops = AtomicInteger()
    override fun speak(text: String) { spoken.add(text) }
    override fun speakSlow(text: String) { spoken.add(text) }
    override fun stop() { stops.incrementAndGet() }
}

/**
 * Auto-speak ("Khi hiện thẻ"): nothing is read aloud on Today, only the card on screen is read, a fill-in-the-blank card
 * reads nothing and silences the card before it, and coming back to the tab resumes the session.
 * Regression: the card picked while Today was showing was read aloud, then the session started on another card.
 */
class AutoSpeakTest {
    private companion object { const val SHOTS = "/data/local/tmp/lexi-shots" }

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app get() = rule.activity.application as LexiApp
    private lateinit var realSpeech: Speech
    private var realAutoSpeak = "off"

    private fun sh(cmd: String) {
        val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(cmd)
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        sh("mkdir -p $SHOTS")
        sh("screencap -p $SHOTS/$name.png")
    }

    private fun count(m: SemanticsMatcher) = rule.onAllNodes(m, useUnmergedTree = true).fetchSemanticsNodes().size
    private fun exists(tag: String) = count(hasTestTag(tag)) > 0
    private val anyCard = SemanticsMatcher("study card") { n -> n.config.getOrElse(SemanticsProperties.TestTag) { "" }.startsWith("study-card-") }
    private fun cardTemplate(): String? = rule.onAllNodes(anyCard, useUnmergedTree = true).fetchSemanticsNodes().firstOrNull()
        ?.config?.get(SemanticsProperties.TestTag)?.removePrefix("study-card-")
    private fun onScreen(text: String) = count(SemanticsMatcher("text $text") { n -> n.config.getOrElse(SemanticsProperties.Text) { emptyList() }.any { text in it.text } }) > 0

    private fun waitFor(label: String, ms: Long = 10_000, cond: () -> Boolean) {
        try {
            rule.waitUntil(ms, cond)
        } catch (e: Throwable) {
            shot("fail-autospeak-$label")
            throw AssertionError("timeout waiting for $label\n" + rule.onAllNodes(isRoot()).printToString(maxDepth = 12).take(6000), e)
        }
    }

    private fun seed() {
        val now = System.currentTimeMillis()
        val day = 86_400_000L
        val notes = JSONArray()
        val cards = JSONArray()
        // harbor: its recognition card is due (reads "harbor"). voyage: its fill-in-the-blank card is due (reads nothing).
        for ((i, w) in listOf("harbor" to "recognize", "voyage" to "cloze").withIndex()) {
            val id = "as$i"
            notes.put(JSONObject().put("id", id).put("type", "vocab").put("deckId", "as").put("createdAt", now - 30 * day).put("updatedAt", now - 30 * day)
                .put("fields", JSONObject().put("word", w.first).put("vi", "nghĩa $i").put("pos", "noun").put("examples", JSONArray().put("The ${w.first} was far from the city."))))
            for (t in listOf("recognize", "cloze")) {
                val due = if (t == w.second) now - day else now + 20 * day
                cards.put(JSONObject().put("id", "$id.$t").put("noteId", id).put("deckId", "as").put("template", t).put("state", 2).put("due", due)
                    .put("stability", 12.5).put("difficulty", 5.0).put("scheduledDays", 9.0).put("learningSteps", 0).put("reps", 5).put("lapses", 0)
                    .put("createdAt", now - 30 * day).put("updatedAt", now - 10 * day).put("lastReview", now - 10 * day))
            }
        }
        val backup = JSONObject().put("app", "vhub-lexi").put("version", 1).put("exportedAt", now)
            .put("decks", JSONArray().put(JSONObject().put("id", "as").put("name", "Auto speak").put("createdAt", now).put("updatedAt", now)))
            .put("notes", notes).put("cards", cards).put("reviews", JSONArray()).put("daily", JSONArray()).put("prefs", JSONObject.NULL)
        runBlocking { app.data.importJson(backup.toString()) }
        rule.waitUntil(20_000) { app.data.cards.value.count { it.deckId == "as" } >= 4 }
    }

    // The database outlives this class: put back the voice, the setting and an empty collection for the other tests.
    @After
    fun tearDown() {
        app.speech = realSpeech
        runBlocking {
            app.data.savePrefs(app.data.prefs.value.copy(autoSpeak = realAutoSpeak))
            app.data.deleteDeckAndContents("as")
        }
        rule.waitUntil(10_000) { app.data.notes.value.none { it.deckId == "as" } }
    }

    /** Checks the card now on screen: a word card reads its word (once), a fill-in-the-blank card reads nothing. */
    private fun checkShownCard(rec: RecordingSpeech, label: String): String {
        waitFor("card-$label") { cardTemplate() != null }
        val t = cardTemplate()!!
        if (t == "recognize") {
            waitFor("spoken-$label") { rec.spoken.isNotEmpty() }
            assertEquals("word card reads its own word ($label)", listOf("harbor"), rec.spoken.toList())
            assertTrue("the word read is the one on screen", onScreen("harbor"))
        } else {
            assertEquals("cloze", t)
            rule.waitForIdle()
            Thread.sleep(800)
            assertEquals("a fill-in-the-blank card reads nothing ($label)", emptyList<String>(), rec.spoken.toList())
        }
        return t
    }

    @Test
    fun readsOnlyTheCardOnScreen() {
        realSpeech = app.speech
        realAutoSpeak = app.data.prefs.value.autoSpeak
        val rec = RecordingSpeech(app)
        app.speech = rec
        seed()
        runBlocking { app.data.savePrefs(app.data.prefs.value.copy(autoSpeak = "front")) }
        rule.waitUntil(5_000) { app.data.prefs.value.autoSpeak == "front" }

        // Today: the queue is counted, no card is picked, nothing is said.
        rule.onNodeWithTag("nav-library").performClick()
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("today", 20_000) { exists("start-study") }
        rule.waitForIdle()
        Thread.sleep(1_000)
        assertEquals("nothing is read on Today", emptyList<String>(), rec.spoken.toList())
        shot("25-autospeak-today")

        rule.onNodeWithTag("start-study").performClick()
        val first = checkShownCard(rec, "first")

        // Leaving the tab silences the card; coming back resumes the session on a card (not Today).
        val stops = rec.stops.get()
        rule.onNodeWithTag("nav-library").performClick()
        waitFor("stopped on leave") { rec.stops.get() > stops }
        rec.spoken.clear()
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("resumed") { cardTemplate() != null }
        assertTrue("resume opens the card, not Today", !exists("start-study"))
        assertEquals(first, checkShownCard(rec, "resumed"))

        // Answer it: the next card is the other kind; the one before is silenced first.
        if (exists("show-answer")) rule.onNodeWithTag("show-answer").performSemanticsAction(SemanticsActions.OnClick)
        else rule.onNodeWithText("Không nhớ").performScrollTo().performClick()
        waitFor("rating") { exists("rate-3") }
        rec.spoken.clear()
        val beforeNext = rec.stops.get()
        rule.onNodeWithTag("rate-3").performSemanticsAction(SemanticsActions.OnClick)
        waitFor("next card") { cardTemplate() != null && cardTemplate() != first }
        assertTrue("the card before is silenced", rec.stops.get() > beforeNext)
        checkShownCard(rec, "second")
        shot("26-autospeak-second")

        // Tapping the tab again goes back to Today.
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("today-again") { exists("start-study") }
    }
}
