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
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.printToString
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.core.Extracted
import com.vh.lexi.core.ExtractedPassage
import com.vh.lexi.core.ExtractedQuestion
import com.vh.lexi.cloud.SetsCloud
import com.vh.lexi.core.Attempt
import com.vh.lexi.core.CloudMeta
import com.vh.lexi.core.SetQuestion
import com.vh.lexi.core.SetSource
import com.vh.lexi.core.TestSet
import com.vh.lexi.core.contentOf
import com.vh.lexi.core.metaOf
import com.vh.lexi.core.str
import com.vh.lexi.core.toJson
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

    @get:Rule
    val testName = org.junit.rules.TestName()

    /** A stuck test fails in minutes instead of holding the whole CI job until its 25-minute limit. */
    @get:Rule
    val timeout: org.junit.rules.Timeout = org.junit.rules.Timeout.builder().withTimeout(4, java.util.concurrent.TimeUnit.MINUTES).build()

    private var watchdog: Thread? = null

    @Before
    fun setUp() {
        // A test stuck on a blocked main thread never reaches its own timeouts: log what the main thread is doing.
        android.util.Log.i("LEXI_PERF", "start ${testName.methodName}")
        val testThread = Thread.currentThread()
        watchdog = Thread {
            try {
                while (true) {
                    Thread.sleep(60_000)
                    val main = android.os.Looper.getMainLooper().thread
                    android.util.Log.i("LEXI_PERF", "watchdog: main thread ${main.state}")
                    main.stackTrace.take(40).forEach { android.util.Log.i("LEXI_PERF", "watchdog |   at $it") }
                    android.util.Log.i("LEXI_PERF", "watchdog: test thread ${testThread.state}")
                    testThread.stackTrace.take(60).forEach { android.util.Log.i("LEXI_PERF", "watchdog test |   at $it") }
                }
            } catch (_: InterruptedException) {
            }
        }.apply { isDaemon = true; start() }
        File(app.filesDir, "testsets").deleteRecursively()
        runBlockingLoad()
        app.extractOverride = { images, text -> synchronized(calls) { calls += images to text }; if (images.isEmpty()) canned else Extracted(emptyList(), listOf(q(1, "fill", "She _____ to work by bus.", listOf("go", "goes", "going", "gone")))) }
    }

    @After
    fun tearDown() {
        watchdog?.interrupt()
        app.extractOverride = null
        app.testSets.useCloud(null)
    }

    /** The account in memory (Firestore documents + Storage files), as the web would have filled it. */
    private class FakeAccount : SetsCloud {
        val docs = java.util.concurrent.ConcurrentHashMap<String, CloudMeta>()
        val files = java.util.concurrent.ConcurrentHashMap<String, ByteArray>()
        override suspend fun list() = docs.values.toList()
        override suspend fun putFile(id: String, path: String, file: File, contentType: String, onSent: (Long) -> Unit) {
            files["$id/$path"] = file.readBytes()
            onSent(file.length())
        }
        override suspend fun getFile(id: String, path: String, into: File) {
            into.parentFile?.mkdirs()
            into.writeBytes(files["$id/$path"] ?: error("object-not-found"))
        }
        override suspend fun putMeta(meta: CloudMeta) { docs[meta.id] = meta }
        override suspend fun remove(id: String, files: List<String>) {
            docs.remove(id)
            files.forEach { this.files.remove("$id/$it") }
        }
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
        android.util.Log.i("LEXI_PERF", "wait $label")
        try {
            rule.waitUntil(ms, cond)
        } catch (e: Throwable) {
            shot("fail-sets-$label")
            val tree = rule.onAllNodes(androidx.compose.ui.test.isRoot()).printToString(maxDepth = 14).take(6000)
            // CI prints the LEXI_PERF log tag after the run; the Gradle console shows only the first lines of a failure.
            tree.lines().forEach { android.util.Log.i("LEXI_PERF", "sets-$label | $it") }
            // The app's own warnings (a PDF open that failed or was cancelled), copied under the tag CI prints.
            val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("logcat -d -t 400 -s Lexi:I AndroidRuntime:E")
            ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().readLines().takeLast(120).forEach { android.util.Log.i("LEXI_PERF", "sets-$label log | $it") }
            throw AssertionError("timeout waiting for $label\n$tree", e)
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

    /** A text that starts with [prefix]: "3. " must not find question 33. */
    private fun startsWith(prefix: String) = SemanticsMatcher("text starts with $prefix") { n ->
        n.config.getOrElse(SemanticsProperties.Text) { emptyList() }.any { it.text.startsWith(prefix) }
    }

    /** The answer [letter] of the question numbered [n] in the runner. */
    private fun pick(n: Int, letter: String) {
        val card = hasTestTag("runner-q") and hasAnyDescendant(startsWith("$n. "))
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
        // A semantics click: a toast at the top of the screen may still cover the back arrow for a few seconds.
        rule.onNodeWithTag("runner-exit").performSemanticsAction(SemanticsActions.OnClick)
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
        // A semantics click: a toast at the top of the screen may still cover the back arrow for a few seconds.
        rule.onNodeWithTag("runner-exit").performSemanticsAction(SemanticsActions.OnClick)

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

    /** Ends typing as a learner would, with a tap on an empty spot: a focused field pulls the page back to itself. */
    private fun doneTyping() {
        rule.onNodeWithTag("lc-help").performTouchInput { click() } // no scroll: just above the fields being typed in
        rule.waitForIdle()
    }

    /** Fixture files copied where the app can open them, handed to the screen as picked audio would be. */
    private fun pickAudio(vararg names: String) {
        app.pendingAudio.value = names.map { name ->
            val file = File(app.cacheDir, name)
            InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { i -> file.outputStream().use { i.copyTo(it) } }
            Uri.fromFile(file)
        }
    }

    private fun lq(number: Int, stem: String, options: List<String>) = q(number, "reading", stem, options).copy(part = 5)

    /** Every file kept for the set (audio and photos), in its own folder. */
    private fun media(): Int = File(app.filesDir, "testsets/media").listFiles().orEmpty().sumOf { it.listFiles().orEmpty().size }

    @Test
    fun listeningPlaysFileAfterFileAndGradesLc() {
        // The model also "reads" question 4 of Part 2 from the page text: Lexi must drop it (Part 2 is made from numbers).
        app.extractOverride = { images, text ->
            synchronized(calls) { calls += images to text }
            Extracted(emptyList(), listOf(
                q(4, "reading", "Mark your answer on your answer sheet.", listOf("", "", "", "")),
                lq(32, "Where most likely are the speakers?", listOf("At a bank", "At a hotel", "At a train station", "At a bookstore")),
                lq(33, "What does the woman ask for?", listOf("A receipt", "A gift bag", "A discount", "A catalog")),
                lq(34, "What will the man do next?", listOf("Check the storage room", "Call a manager", "Print a coupon", "Close the store")),
            ))
        }
        openSets()
        importFixture("listening-test.pdf")
        rule.onNodeWithTag("set-range").performScrollTo().performTextReplacement("2-4")
        rule.onNodeWithTag("set-section-lc").performScrollTo().performClick()
        waitFor("lc-setup") { count("lc-setup") > 0 }
        rule.onNodeWithTag("lc-p1").performScrollTo().performTextReplacement("1-2")
        rule.onNodeWithTag("lc-p2").performScrollTo().performTextReplacement("3-5")
        doneTyping()
        // The photo page is found from its "PART 1" heading and shown small, the way it will show in the test.
        waitFor("photos-found") { count("lc-photos-found") > 0 }
        assertTrue(textOf("lc-photos-found"), textOf("lc-photos-found").contains("trang 1."))
        waitFor("photo-thumb") { count("lc-photo-thumb") == 1 }
        rule.onNodeWithTag("lc-photos").performScrollTo().performTextReplacement("1")
        doneTyping()
        pickAudio("listening-03.mp3", "listening-01.mp3", "listening-02.mp3")
        waitFor("audio-count") { textOf("lc-audio-count").contains("3 file") }
        assertTrue(textOf("lc-audio-list"), Regex("listening-01.*listening-02.*listening-03").containsMatchIn(textOf("lc-audio-list")))
        assertTrue(textOf("pdf-key"), textOf("pdf-key").contains("8 câu (trang 4)"))
        assertTrue(textOf("pdf-read"), textOf("pdf-read").contains("1 phần, ≈ 2 lượt AI"))
        shot("sets-06-lc-setup")
        rule.onNodeWithTag("pdf-read").performScrollTo().performClick()
        waitFor("lc-preview") { count("pdf-preview") > 0 }
        assertEquals(1, calls.size)
        assertTrue("the photo page went to the AI", !calls[0].second.contains("PART 1"))
        assertTrue(calls[0].second.contains("32 (D)"))
        assertTrue(textOf("pdf-total"), textOf("pdf-total").contains("8 câu"))
        assertTrue(textOf("pdf-total-p1").contains("Part 1: 2"))
        assertTrue(textOf("pdf-total-p2").contains("Part 2: 3"))
        assertTrue(textOf("pdf-total-p3").contains("Part 3: 3"))
        assertEquals("3 file nghe", textOf("pdf-audio").trim())
        assertEquals(0, count("pdf-noanswer"))
        rule.onNodeWithTag("pdf-save").performScrollTo().performClick()
        waitFor("lc-row") { count("set-row") > 0 }
        assertTrue(textOf("set-lc"), textOf("set-lc").contains("Listening · 3 file nghe"))
        assertEquals(4, media())

        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("lc-runner") { count("runner-list") > 0 }
        waitFor("picture", 20_000) { count("runner-picture") > 0 }
        assertEquals(1, count("runner-picture"))
        assertTrue(textOf("part-help-1"), textOf("part-help-1").contains("nhìn ảnh, nghe 4 câu"))
        assertEquals(0, count("part1-no-photos"))
        // Straight through, file after file, like the exam: the position moves to the second file by itself.
        rule.onNodeWithTag("listen-toggle").performClick()
        waitFor("file-1") { textOf("listen-pos").contains("File 1/3") }
        waitFor("file-2", 15_000) { textOf("listen-pos").contains("File 2/3") }
        shot("sets-07-lc-runner")
        rule.onNodeWithTag("listen-toggle").performClick()
        waitFor("paused") { textOf("listen-toggle").contains("Nghe tiếp") }
        // Key: 1 A, 2 C, 3 B, 4 A, 5 C, 32 D, 33 B, 34 A. Right on 1, 3, 32; wrong on 2; the rest blank.
        pick(1, "A")
        pick(2, "A")
        pick(3, "B")
        pick(32, "D")
        waitFor("lc-count") { textOf("runner-count").contains("4/8") }
        rule.onNodeWithTag("runner-submit").performClick()
        waitFor("lc-submit") { countText("Còn 4 câu chưa làm") > 0 }
        dialogButton("Nộp bài").performClick()
        waitFor("lc-result") { count("runner-result") > 0 }
        assertEquals("3/8", textOf("result-score"))
        assertTrue(textOf("result-lc"), textOf("result-lc").contains("LC: 3/8"))
        assertTrue(textOf("result-p1"), textOf("result-p1").contains("Part 1: 1/2"))
        assertTrue(textOf("result-p2"), textOf("result-p2").contains("Part 2: 1/3"))
        assertTrue(textOf("result-p3"), textOf("result-p3").contains("Part 3: 1/3"))
        assertEquals(0, count("result-p5"))
        shot("sets-08-lc-result")
        rule.onNodeWithTag("runner-exit").performSemanticsAction(SemanticsActions.OnClick)

        // Deleting asks first; "Xoá" takes the audio and the photo off the device too.
        waitFor("lc-list") { count("set-row") > 0 }
        rule.onNodeWithTag("set-delete").performScrollTo().performClick()
        waitFor("lc-delete-dialog") { countText("Xoá bộ đề?") > 0 }
        dialogButton("Huỷ").performClick()
        waitFor("lc-not-deleted") { countText("Xoá bộ đề?") == 0 }
        assertEquals(4, media())
        rule.onNodeWithTag("set-delete").performScrollTo().performClick()
        waitFor("lc-delete-dialog-2") { countText("Xoá bộ đề?") > 0 }
        dialogButton("Xoá").performClick()
        waitFor("lc-deleted") { count("sets-empty") > 0 }
        assertEquals(0, media())
    }

    @Test
    fun listeningAsksForPart1PhotoPages() {
        openSets()
        // A scanned book: no text layer, so Lexi cannot find the photo pages and asks for them.
        importFixture("reading-test-scan.pdf")
        rule.onNodeWithTag("set-range").performScrollTo().performTextReplacement("1-2")
        rule.onNodeWithTag("set-section-lc").performScrollTo().performClick()
        waitFor("lc-setup") { count("lc-setup") > 0 }
        rule.onNodeWithTag("lc-p1").performScrollTo().performTextReplacement("1-2")
        rule.onNodeWithTag("lc-p2").performScrollTo().performTextReplacement("3-5")
        doneTyping()
        waitFor("photos-need") { count("lc-photos-need") > 0 }
        assertEquals(0, count("lc-photos-found"))
        rule.onNodeWithTag("pdf-read").performScrollTo().assertIsNotEnabled()
        shot("sets-10-lc-photos-need")
        rule.onNodeWithTag("lc-photos").performScrollTo().performTextReplacement("1-2")
        doneTyping()
        waitFor("photos-given") { count("lc-photos-need") == 0 }
        waitFor("photo-thumbs", 20_000) { count("lc-photo-thumb") == 2 }
        shot("sets-11-lc-photos-typed")
        // Part 1 on photo pages 1-2, Part 2 numbers only: nothing for the AI to read.
        assertTrue(textOf("pdf-read"), textOf("pdf-read").contains("không cần AI"))
        rule.onNodeWithTag("pdf-read").performScrollTo().performClick()
        waitFor("photo-preview") { count("pdf-preview") > 0 }
        rule.onNodeWithTag("pdf-save").performScrollTo().performClick()
        waitFor("photo-row") { count("set-row") > 0 }
        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("photo-runner") { count("runner-list") > 0 }
        // Each photo page sits above its own questions (page 1 above 1, page 2 above 2): the list composes what is on screen.
        waitFor("pictures", 20_000) { count("runner-picture") > 0 }
        assertTrue(textOf("part-help-1"), textOf("part-help-1").contains("nghe 4 câu mô tả"))
        assertEquals(0, count("part1-no-photos"))
        shot("sets-12-lc-runner-photos")
    }

    @Test
    fun listeningOneFilePerQuestionWithoutAi() {
        openSets()
        importFixture("listening-test.pdf")
        rule.onNodeWithTag("set-range").performScrollTo().performTextReplacement("4")
        rule.onNodeWithTag("set-section-lc").performScrollTo().performClick()
        waitFor("lc-setup") { count("lc-setup") > 0 }
        rule.onNodeWithTag("lc-p1").performScrollTo().performTextReplacement("1-2")
        rule.onNodeWithTag("lc-p2").performScrollTo().performTextReplacement("")
        doneTyping()
        pickAudio("listening-01.mp3", "listening-02.mp3")
        waitFor("audio-2") { textOf("lc-audio-count").contains("2 file") }
        assertTrue(textOf("pdf-read"), textOf("pdf-read").contains("không cần AI"))
        rule.onNodeWithTag("pdf-read").performScrollTo().performClick()
        waitFor("p1-preview") { count("pdf-preview") > 0 }
        assertEquals(0, calls.size)
        assertTrue(textOf("pdf-audio"), textOf("pdf-audio").contains("mỗi câu một file"))
        rule.onNodeWithTag("pdf-save").performScrollTo().performClick()
        waitFor("p1-row") { count("set-row") > 0 }
        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("p1-runner") { count("runner-list") > 0 }
        assertEquals(0, count("listen-bar"))
        waitFor("q-play") { count("q-play") == 2 }
        val plays = rule.onAllNodes(hasTestTag("q-play"))
        plays[1].performClick()
        waitFor("own-playing") { rule.textOfNth("q-play", 1).contains("Dừng") }
        assertTrue(rule.textOfNth("q-play", 0).contains("Nghe"))
        plays[1].performClick()
        waitFor("own-stopped") { rule.textOfNth("q-play", 1).contains("Nghe") }
    }

    private fun card(n: Int) = hasTestTag("runner-q") and hasAnyDescendant(startsWith("$n. "))

    /** The replay range shown on question [n], scrolled into view first (the list only composes what is on screen). */
    private fun rangeOf(n: Int): String {
        rule.onNodeWithTag("runner-list").performScrollToNode(card(n))
        return rule.onAllNodes(hasTestTag("q-replay-range") and hasAnyAncestor(card(n)), useUnmergedTree = true).fetchSemanticsNodes()
            .flatMap { it.allTexts() }.joinToString(" ")
    }

    private fun tapIn(n: Int, tag: String) {
        rule.onNodeWithTag("runner-list").performScrollToNode(card(n))
        rule.onAllNodes(hasTestTag(tag) and hasAnyAncestor(card(n)))[0].performClick()
    }

    @Test
    fun longFileIsSplitByItsAnswerPausesAndReplayed() {
        openSets()
        importFixture("listening-test.pdf")
        rule.onNodeWithTag("set-range").performScrollTo().performTextReplacement("4")
        rule.onNodeWithTag("set-section-lc").performScrollTo().performClick()
        waitFor("lc-setup") { count("lc-setup") > 0 }
        rule.onNodeWithTag("lc-p1").performScrollTo().performTextReplacement("")
        rule.onNodeWithTag("lc-p2").performScrollTo().performTextReplacement("3-5")
        doneTyping()
        pickAudio("listening-part2.mp3")
        waitFor("audio-1") { textOf("lc-audio-count").contains("1 file") }
        rule.onNodeWithTag("pdf-read").performScrollTo().performClick()
        waitFor("p2-preview") { count("pdf-preview") > 0 }
        rule.onNodeWithTag("pdf-save").performScrollTo().performClick()
        waitFor("p2-row") { count("set-row") > 0 }
        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("p2-runner") { count("runner-list") > 0 && count("listen-bar") > 0 }
        pick(3, "B")
        rule.onNodeWithTag("runner-submit").performClick()
        waitFor("p2-submit") { countText("Còn 2 câu chưa làm") > 0 }
        dialogButton("Nộp bài").performClick()
        waitFor("p2-result") { count("runner-result") > 0 }
        assertEquals(0, count("q-replay"))

        // Decoded on the phone, measured, split at its answer pauses. The fixture's questions start at 7 s, 15.5 s, 24 s.
        rule.onNodeWithTag("result-split").performScrollTo().performClick()
        waitFor("split", 30_000) { count("result-split") == 0 }
        // Missed: 4 and 5 (left blank). Question 5 starts on a frame boundary (24.0 s): one 50 ms frame either way is 0:23 or 0:24.
        assertTrue(rangeOf(4), Regex("^File 1 · 0:1[56]–0:(19|20)$").matches(rangeOf(4)))
        assertTrue(rangeOf(5), Regex("^File 1 · 0:2[345]–0:2[789]$").matches(rangeOf(5)))
        rule.onNodeWithTag("runner-list").performScrollToNode(hasTestTag("result-toggle"))
        rule.onNodeWithTag("result-toggle").performClick()
        assertTrue(rangeOf(3), Regex("^File 1 · 0:0[67]–0:1[01]$").matches(rangeOf(3)))
        shot("sets-09-lc-replay")

        // Heard again from its start, and it stops at the end of the question by itself, not running into the next one.
        val before = rangeOf(4)
        tapIn(4, "q-replay-play")
        waitFor("replaying") { textOf("listen-toggle").contains("Tạm dừng") }
        assertTrue(textOf("listen-pos"), Regex("File 1/1 · 0:1[5-7]").containsMatchIn(textOf("listen-pos")))
        waitFor("stopped", 12_000) { textOf("listen-toggle").contains("Nghe tiếp") }
        assertTrue(textOf("listen-pos"), Regex("File 1/1 · 0:(19|20)").containsMatchIn(textOf("listen-pos")))

        // Started too late: 2 s earlier, kept in the file on the phone.
        val from = Regex("0:(\\d\\d)–").find(before)!!.groupValues[1].toInt()
        tapIn(4, "q-replay-earlier")
        waitFor("nudged") { rangeOf(4).contains("0:${(from - 2).toString().padStart(2, '0')}–") }
        val id = app.testSets.sets.value.first().id
        waitFor("nudge-written") {
            val f = File(app.filesDir, "testsets").listFiles { x -> x.name.endsWith(".json") }!!.first()
            val q4 = com.vh.lexi.core.testSetFromJson(org.json.JSONObject(f.readText())).questions.first { it.number == 4 }
            q4.clip != null && q4.clip!!.from / 1000 == (from - 2).toLong()
        }
        rule.onNodeWithTag("runner-exit").performSemanticsAction(SemanticsActions.OnClick)
        waitFor("p2-list") { count("set-row") > 0 }
        runBlockingLoad()
        rule.onNodeWithTag("set-open").performScrollTo().performClick()
        waitFor("p2-reopen") { count("runner-result") > 0 }
        assertEquals(0, count("result-split"))
        assertEquals(id, app.testSets.sets.value.first().id)
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

    @Test
    fun syncWithTheAccount() {
        val acct = FakeAccount()
        // A set imported on another device (the web): its questions in set.json, the attempt in the document.
        fun q(i: Int, n: Int, correct: String) = SetQuestion(
            i = i, number = n, part = 5, kind = "fill", stem = "Question $n _____ here.", options = mapOf("A" to "one", "B" to "two", "C" to "three", "D" to "four"),
            correct = correct, passage = null, topic = "Khác", rule = "", translation = "", flags = emptyList(),
        )
        val web = TestSet(
            id = "web-set-1", name = "Đề từ máy tính", createdAt = 1_000, updatedAt = 2_000, section = "rc", source = SetSource("ets.pdf", 2),
            passages = emptyList(), questions = listOf(q(0, 101, "A"), q(1, 102, "B")), attempt = Attempt(1_500, 60_000, mapOf(0 to "A")),
        )
        acct.files["web-set-1/set.json"] = contentOf(web).toJson().toString().toByteArray()
        acct.docs["web-set-1"] = metaOf(web, 900)
        app.testSets.useCloud(acct)

        openSets()
        waitFor("set-remote") { count("set-remote") > 0 }
        assertEquals(0, count("set-row"))
        assertTrue(textOf("set-remote-size"), textOf("set-remote-size").contains("Trên tài khoản"))
        assertTrue(count("sets-cloud") > 0)
        shot("sets-sync-1-remote")
        rule.onNodeWithTag("set-download").performScrollTo().performClick()
        waitFor("runner-after-download") { count("runner-list") > 0 }
        val got = app.testSets.sets.value.single()
        assertEquals(mapOf(0 to "A"), got.attempt?.answers)
        assertTrue(got.syncedAt != null)

        // Continue here: the answer goes back to the document.
        pick(102, "C")
        rule.onNodeWithTag("runner-exit").performSemanticsAction(SemanticsActions.OnClick)
        waitFor("set-row") { count("set-row") > 0 }
        kotlinx.coroutines.runBlocking { app.testSets.flushSync() }
        val state = acct.docs.getValue("web-set-1").state
        assertTrue(state, state.contains("\"1\":\"C\"") && state.contains("\"0\":\"A\""))
        shot("sets-sync-2-continued")

        // A set made on this phone is uploaded: its file, then its document.
        kotlinx.coroutines.runBlocking {
            app.testSets.save(web.copy(id = "phone-set-1", name = "Đề trên điện thoại", attempt = null, createdAt = 3_000))
            app.testSets.flushSync()
        }
        assertTrue(acct.files.containsKey("phone-set-1/set.json"))
        assertEquals(listOf("set.json"), acct.docs.getValue("phone-set-1").files)

        // Delete asks first and says it is everywhere: Huỷ keeps it, Xoá removes it from the account.
        rule.onAllNodes(hasTestTag("set-delete"))[0].performScrollTo().performClick()
        waitFor("delete-dialog") { countText("khỏi tài khoản và mọi thiết bị") > 0 }
        dialogButton("Huỷ").performClick()
        assertEquals(2, acct.docs.size)
        rule.onAllNodes(hasTestTag("set-delete"))[0].performScrollTo().performClick()
        waitFor("delete-dialog-2") { countText("khỏi tài khoản và mọi thiết bị") > 0 }
        dialogButton("Xoá").performClick()
        waitFor("one-left") { acct.docs.size == 1 && count("set-row") == 1 }
        // Deleted on another device: gone from the account, so this phone drops its copy on the next sync.
        acct.docs.clear()
        kotlinx.coroutines.runBlocking { app.testSets.sync() }
        waitFor("sets-empty-after-sync") { count("sets-empty") > 0 }
        assertTrue(app.testSets.sets.value.isEmpty())
    }
}

private fun AndroidComposeTestRule<*, *>.textOfTag(tag: String): String =
    onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().flatMap { it.allTexts() }.joinToString(" ")

private fun AndroidComposeTestRule<*, *>.textOfNth(tag: String, i: Int): String =
    onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes()[i].allTexts().joinToString(" ")

private fun androidx.compose.ui.semantics.SemanticsNode.allTexts(): List<String> =
    config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text } + children.flatMap { it.allTexts() }
