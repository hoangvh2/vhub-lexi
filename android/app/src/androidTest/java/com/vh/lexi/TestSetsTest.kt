package com.vh.lexi

import android.graphics.BitmapFactory
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Base64
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.core.Extracted
import com.vh.lexi.core.ExtractedPassage
import com.vh.lexi.core.ExtractedQuestion
import com.vh.lexi.core.str
import com.vh.lexi.ui.MainActivity
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.io.File

/**
 * Bộ đề on the device, with the PDF fixtures the web tests use (web/test/fixtures, made by tools/fixtures/make-test-pdf.py)
 * and the `extract-questions` function replaced by a canned answer: PdfBox reads the text in column order, the key page
 * is found and only its answers are sent, PDFium draws a 1-bit copier scan, then the test is taken, graded, logged and its
 * missed questions become cards. Deleting and starting over both ask first.
 */
@OptIn(ExperimentalTestApi::class)
class TestSetsTest {
    private companion object { const val SHOTS = "/data/local/tmp/lexi-shots" }

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app get() = rule.activity.application as LexiApp
    private val calls = mutableListOf<Pair<List<String>, String>>()

    private fun q(number: Int, kind: String, stem: String, options: List<String>, passage: Int? = null) = ExtractedQuestion(
        number = number, kind = kind, stem = stem, options = listOf("A", "B", "C", "D").zip(options).toMap(), correct = null, result = "unknown",
        topic = if (kind == "fill") "Khác" else "", rule = "", translation = "", flags = emptyList(), passage = passage,
    )

    private val canned = Extracted(
        passages = listOf(ExtractedPassage(1, "Questions 147-149", "NOTICE\nThe community pool opens at 9 a.m. on weekdays.", false)),
        questions = listOf(
            q(101, "fill", "Ms. Tran asked the staff to submit their travel _____ by Friday.", listOf("receipts", "receive", "received", "receiving")),
            q(102, "fill", "The new printer is _____ faster than the one we used last year.", listOf("much", "very", "many", "most")),
            q(147, "reading", "For whom is the notice most likely intended?", listOf("Lifeguards", "Swimmers", "Coaches", "Painters"), passage = 1),
        ),
    )

    @Before
    fun setUp() {
        File(app.filesDir, "testsets").deleteRecursively()
        runBlockingLoad()
        app.extractOverride = { images, text -> synchronized(calls) { calls += images to text }; if (images.isEmpty()) canned else Extracted(emptyList(), listOf(q(1, "fill", "She _____ to work by bus.", listOf("go", "goes", "going", "gone")))) }
    }

    @After
    fun tearDown() {
        app.extractOverride = null
    }

    private fun runBlockingLoad() = kotlinx.coroutines.runBlocking { app.testSets.load(force = true) }

    private fun sh(cmd: String) {
        val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(cmd)
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        sh("mkdir -p $SHOTS")
        sh("screencap -p $SHOTS/$name.png")
    }

    private fun waitFor(label: String, ms: Long = 15_000, cond: () -> Boolean) {
        try {
            rule.waitUntil(ms, cond)
        } catch (e: Throwable) {
            shot("fail-sets-$label")
            throw AssertionError("timeout waiting for $label\n" + rule.onAllNodes(androidx.compose.ui.test.isRoot()).printToString(maxDepth = 14).take(6000), e)
        }
    }

    private fun count(tag: String) = rule.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size
    private fun countText(text: String) = rule.onAllNodes(hasText(text, substring = true), useUnmergedTree = true).fetchSemanticsNodes().size
    private fun textOf(tag: String): String = rule.textOfTag(tag)

    /** A fixture PDF copied where the app can open it, handed to the screen as a picked file would be. */
    private fun importFixture(name: String) {
        val file = File(app.cacheDir, name)
        InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { i -> file.outputStream().use { i.copyTo(it) } }
        app.pendingPdf.value = Uri.fromFile(file)
        waitFor("pdf-facts-$name", 30_000) { count("pdf-facts") > 0 }
    }

    private fun openSets() {
        rule.onNodeWithTag("nav-study").performClick()
        waitFor("today") { count("open-testsets") > 0 }
        rule.onNodeWithTag("open-testsets").performScrollTo().performClick()
        waitFor("testsets-screen") { count("testsets-screen") > 0 }
    }

    /** The answer [letter] of the question numbered [n] in the runner. */
    private fun pick(n: Int, letter: String) {
        val card = hasTestTag("runner-q") and hasAnyDescendant(hasText("$n.", substring = true))
        rule.onNodeWithTag("runner-list").performScrollToNode(card)
        rule.onAllNodes(hasTestTag("opt-$letter") and hasAnyAncestor(card))[0].performClick()
    }

    private fun dialogButton(text: String) = rule.onAllNodes(hasText(text) and hasClickAction()).onLast()

    @Test
    fun textPdfToResultAndCards() {
        openSets()
        waitFor("sets-empty") { count("sets-empty") > 0 }
        importFixture("reading-test.pdf")
        assertTrue(textOf("pdf-pages"), textOf("pdf-pages").contains("3 trang"))
        assertTrue(textOf("pdf-key"), textOf("pdf-key").contains("17 câu (trang 3)"))
        assertTrue(textOf("pdf-read"), textOf("pdf-read").contains("1 phần, ≈ 2 lượt AI"))
        shot("sets-01-facts")
        rule.onNodeWithTag("pdf-read").performScrollTo().performClick()
        waitFor("pdf-preview") { count("pdf-preview") > 0 }

        // One call: both question pages in reading order (column 1 before column 2), only their answers, no key page.
        assertEquals(1, calls.size)
        val (images, text) = calls[0]
        assertEquals(0, images.size)
        assertTrue(text.take(400), text.indexOf("105.") in 0 until text.indexOf("106."))
        assertTrue(text.indexOf("110.") < text.indexOf("131."))
        assertTrue(text.contains("Answer key (data, from the same test): 101 (A), 102 (A)"))
        assertTrue(!text.contains("ANSWER KEY"))
        assertTrue(textOf("pdf-total"), textOf("pdf-total").contains("3 câu"))
        assertEquals(0, count("pdf-fix")) // every answer comes from the PDF's key
        shot("sets-02-preview")
        rule.onNodeWithTag("pdf-save").performScrollTo().performClick()
        waitFor("set-row") { count("set-row") > 0 }

        // Take it; leaving keeps the answers.
        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("runner") { count("runner-list") > 0 }
        assertTrue(textOf("runner-clock").matches(Regex("\\d\\d:\\d\\d")))
        pick(101, "A") // right
        pick(102, "B") // wrong
        waitFor("count-2") { textOf("runner-count").contains("2/3") }
        shot("sets-03-runner")
        rule.onNodeWithTag("runner-exit").performClick()
        waitFor("in-progress") { countText("Đang làm · 2/3 câu") > 0 }
        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("runner-again") { count("runner-list") > 0 }
        rule.onNodeWithTag("runner-submit").performClick()
        waitFor("submit-dialog") { countText("Còn 1 câu chưa làm") > 0 }
        dialogButton("Nộp bài").performClick()
        waitFor("result") { count("runner-result") > 0 }
        assertEquals("1/3", textOf("result-score"))
        assertTrue(textOf("result-p5"), textOf("result-p5").contains("1/2"))
        assertTrue(textOf("result-p7"), textOf("result-p7").contains("0/1"))
        shot("sets-04-result")

        // Logged as a "test" note (the web's Kết quả bài shows it after sync).
        rule.onNodeWithTag("result-save").performClick()
        waitFor("result-saved") { app.data.notes.value.any { it.type == "test" && it.fields["p5"].str() == "1/2" } }
        waitFor("saved-label") { countText("Đã lưu vào Kết quả bài") > 0 }

        // The missed fill-in question becomes a card through the same review as "Nhập câu sai"; the reading one is skipped.
        rule.onNodeWithTag("result-cards").performClick()
        waitFor("cards-review") { count("import-draft") > 0 }
        assertEquals(1, count("import-draft"))
        assertTrue(countText("Thẻ từ câu sai") > 0)
        rule.onNodeWithTag("import-save").performScrollTo().performClick()
        waitFor("card-saved") { app.data.notes.value.any { it.type == "grammar" && it.fields["sentence"].str().contains("much faster") } }
        rule.onAllNodes(hasText("Xong")).onLast().performScrollTo().performClick()
        waitFor("back-to-result") { count("runner-result") > 0 }

        // Starting over asks first: "Huỷ" keeps the result, "Làm lại" clears the answers.
        rule.onNodeWithTag("result-again").performClick()
        waitFor("again-dialog") { countText("Làm lại từ đầu?") > 0 }
        dialogButton("Huỷ").performClick()
        waitFor("kept") { count("runner-result") > 0 && countText("Làm lại từ đầu?") == 0 }
        rule.onNodeWithTag("result-again").performClick()
        waitFor("again-dialog-2") { countText("Làm lại từ đầu?") > 0 }
        dialogButton("Làm lại").performClick()
        // The dialog's window must be gone before the next tap, or the tap lands on it and only dismisses it.
        waitFor("fresh") { count("runner-count") > 0 && textOf("runner-count").contains("0/3") && countText("Làm lại từ đầu?") == 0 }
        rule.waitForIdle()
        rule.onNodeWithTag("runner-exit").performClick()

        // Deleting asks first: "Huỷ" keeps the set, "Xoá" removes it and its file.
        waitFor("list") { count("set-row") > 0 }
        rule.onNodeWithTag("set-delete").performScrollTo().performClick()
        waitFor("delete-dialog") { countText("Xoá bộ đề?") > 0 }
        dialogButton("Huỷ").performClick()
        waitFor("not-deleted") { countText("Xoá bộ đề?") == 0 }
        assertEquals(1, count("set-row"))
        assertEquals(1, File(app.filesDir, "testsets").listFiles { f -> f.name.endsWith(".json") }!!.size)
        rule.onNodeWithTag("set-delete").performScrollTo().performClick()
        waitFor("delete-dialog-2") { countText("Xoá bộ đề?") > 0 }
        dialogButton("Xoá").performClick()
        waitFor("deleted") { count("sets-empty") > 0 }
        assertEquals(0, File(app.filesDir, "testsets").listFiles { f -> f.name.endsWith(".json") }!!.size)
    }

    @Test
    fun copierScanIsDrawnAndTurned() {
        openSets()
        importFixture("reading-test-copier.pdf")
        assertTrue(textOf("pdf-scanned"), textOf("pdf-scanned").contains("1 trang scan"))
        waitFor("thumb-0", 20_000) { count("pdf-thumb-img-0") > 0 }
        rule.onNodeWithTag("pdf-turn").performScrollTo().performClick()
        waitFor("thumb-180", 20_000) { count("pdf-thumb-img-180") > 0 }
        shot("sets-05-scan-turned")
        rule.onNodeWithTag("set-key").performScrollTo().performTextInput("1 A 2 B 3 C")
        rule.onNodeWithTag("pdf-read").performScrollTo().performClick()
        waitFor("scan-preview", 30_000) { count("pdf-preview") > 0 }
        assertEquals(1, calls.size)
        val (images, text) = calls[0]
        assertEquals(1, images.size)
        assertTrue(text, text.startsWith("Answer key (data, from the same test): 1 (A), 2 (B), 3 (C)"))
        // A 1-bit CCITT page that failed to decode would come out white: the picture sent must carry ink.
        val bytes = Base64.decode(images[0], Base64.DEFAULT)
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        assertTrue("${bmp.width}x${bmp.height}", maxOf(bmp.width, bmp.height) == 1600)
        var dark = 0
        val px = IntArray(bmp.width * bmp.height)
        bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        for (p in px) if (((p shr 16 and 0xff) + (p shr 8 and 0xff) + (p and 0xff)) / 3 < 128) dark++
        assertTrue("dark pixels $dark of ${px.size}", dark > px.size / 200)
    }
}

private fun AndroidComposeTestRule<*, *>.textOfTag(tag: String): String =
    onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().flatMap { it.allTexts() }.joinToString(" ")

private fun androidx.compose.ui.semantics.SemanticsNode.allTexts(): List<String> =
    config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text } + children.flatMap { it.allTexts() }
