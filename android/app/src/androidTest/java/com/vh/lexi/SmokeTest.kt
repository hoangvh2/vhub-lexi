package com.vh.lexi

import android.accessibilityservice.AccessibilityServiceInfo
import android.graphics.Rect
import android.os.ParcelFileDescriptor
import android.view.accessibility.AccessibilityWindowInfo
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.ui.MainActivity
import org.junit.Rule
import org.junit.Test

/**
 * End-to-end on a real (emulated) device, phone-only mode: add a word through the offline dictionary, study it,
 * look at every screen. Screenshots are written to /data/local/tmp/lexi-shots for review (CI publishes them).
 */
@OptIn(ExperimentalTestApi::class)
class SmokeTest {
    private companion object { const val SHOTS = "/data/local/tmp/lexi-shots" }

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    // The shell (uid 2000) owns /data/local/tmp, so the screenshots are taken through UiAutomation's shell and
    // survive the uninstall that Gradle does after the run; CI pulls them from there.
    private fun sh(cmd: String) {
        val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(cmd)
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        sh("mkdir -p $SHOTS")
        sh("screencap -p $SHOTS/$name.png")
    }

    /** waitUntil that leaves a screenshot and the semantics tree behind when it times out. */
    private fun waitFor(label: String, cond: () -> Boolean) {
        try {
            rule.waitUntil(10_000, cond)
        } catch (e: Throwable) {
            shot("fail-$label")
            throw AssertionError("timeout waiting for $label\n" + rule.onRoot().printToString(maxDepth = 12).take(6000), e)
        }
    }

    // --- Soft keyboard. CI emulators have a hardware keyboard, which hides the on-screen one unless this is set.

    private val device get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    /** Top edge of the on-screen keyboard in screen pixels, or null while it is not shown. */
    private fun keyboardTop(): Int? {
        val ua = InstrumentationRegistry.getInstrumentation().uiAutomation
        ua.serviceInfo = ua.serviceInfo.apply { flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        return ua.windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
            ?.let { w -> Rect().also(w::getBoundsInScreen) }?.takeIf { it.height() > 0 }?.top
    }

    private fun waitForKeyboard(label: String): Int {
        waitFor("keyboard-$label") { keyboardTop() != null }
        rule.waitForIdle() // let the layout follow the keyboard insets
        Thread.sleep(500) // the IME window animates in; its bounds settle after the insets do
        rule.waitForIdle()
        return keyboardTop()!!
    }

    private fun hideKeyboard() {
        rule.runOnUiThread { WindowCompat.getInsetsController(rule.activity.window, rule.activity.window.decorView).hide(WindowInsetsCompat.Type.ime()) }
        waitFor("keyboard-hidden") { keyboardTop() == null }
    }

    /** Screen bounds of a node in the activity window (edge-to-edge, so window = screen apart from the decor offset). */
    private fun screenBounds(tag: String): Rect {
        val b = rule.onNodeWithTag(tag).fetchSemanticsNode().boundsInWindow
        val at = IntArray(2).also { rule.activity.window.decorView.getLocationOnScreen(it) }
        return Rect(b.left.toInt() + at[0], b.top.toInt() + at[1], b.right.toInt() + at[0], b.bottom.toInt() + at[1])
    }

    private fun assertAboveKeyboard(what: String, bounds: Rect, keyboardTop: Int) {
        if (bounds.isEmpty || bounds.bottom > keyboardTop) {
            shot("fail-keyboard-$what")
            throw AssertionError("$what is under the keyboard: bounds=$bounds, keyboard top=$keyboardTop")
        }
    }

    /** A view in a dialog window, found through accessibility (dialogs are separate windows). */
    private fun dialogTextBounds(text: String): Rect =
        device.wait(Until.findObject(By.text(text)), 5_000)?.visibleBounds ?: throw AssertionError("no \"$text\" on screen")

    @Test
    fun addStudyAndBrowse() {
        sh("settings put secure show_ime_with_hard_keyboard 1")
        rule.waitForIdle()
        shot("01-start")

        rule.onNodeWithTag("nav-add").performClick()
        rule.onNodeWithTag("word-input").performTextInput("serendipity")
        waitFor("lookup") { rule.onAllNodesWithTextCount("good luck in making") > 0 }
        shot("02-add-lookup")

        // The Vietnamese meaning is suggested from the offline pack (Wiktionary); replace it with our own.
        waitFor("vi-suggestion") { rule.onAllNodesWithTextCount("khả năng cầu may") > 0 }
        rule.onNodeWithTag("vi-input").performTextClearance()
        rule.onNodeWithTag("vi-input").performTextInput("sự tình cờ may mắn")
        shot("03-add-filled")

        // Keyboard open on the last field: the field and the save bar must sit above the keyboard, and a real touch
        // on the save button must reach it (regression: the keyboard covered the lower form and the save button).
        rule.onNodeWithTag("mnemonic-input").performScrollTo().performClick()
        var kb = waitForKeyboard("add")
        rule.onNodeWithTag("mnemonic-input").performTextInput("seren-dipity: tình cờ")
        rule.waitForIdle()
        assertAboveKeyboard("mnemonic-input", screenBounds("mnemonic-input"), kb)
        val save = screenBounds("save-word")
        assertAboveKeyboard("save-word", save, kb)
        shot("03b-add-keyboard")
        device.click(save.centerX(), save.centerY())
        waitFor("saved") { rule.onAllNodesWithTextCount("Đã thêm") > 0 }
        hideKeyboard()

        rule.onNodeWithTag("nav-study").performClick()
        waitFor("study-card") { rule.onAllNodesWithTextCount("serendipity") > 0 }
        shot("04-study-front")
        rule.onNodeWithTag("show-answer").performSemanticsAction(SemanticsActions.OnClick) // the toast overlaps it
        // The mnemonic typed above makes the back taller than the 640dp CI screen, so the buttons may need a scroll.
        rule.onNodeWithTag("rate-3").performScrollTo().assertIsDisplayed()
        shot("05-study-back")
        rule.onNodeWithTag("rate-3").performSemanticsAction(SemanticsActions.OnClick)
        waitFor("session-done") { rule.onAllNodesWithTagCount("session-done") > 0 }
        shot("06-session-done")

        rule.onNodeWithTag("nav-library").performClick()
        waitFor("library-item") { rule.onAllNodesWithTextCount("serendipity") > 0 }
        shot("07-library")

        // Edit dialog: the form is taller than the dialog, so its last field must be reachable by scrolling, and
        // with the keyboard open that field and the buttons must stay above the keyboard.
        rule.onNodeWithText("serendipity").performClick()
        waitFor("note-editor") { rule.onAllNodesWithTagCount("note-editor-form") > 0 }
        rule.onNodeWithTag("note-editor-save").assertIsDisplayed()
        rule.onNodeWithTag("note-editor-form").performScrollToNode(hasTestTag("note-editor-tags"))
        rule.onNodeWithTag("note-editor-tags").assertIsDisplayed().performClick()
        kb = waitForKeyboard("note-editor")
        rule.onNodeWithTag("note-editor-tags").performTextInput("ielts")
        rule.waitForIdle()
        assertAboveKeyboard("note-editor-tags", dialogTextBounds("ielts"), kb)
        assertAboveKeyboard("note-editor-save", dialogTextBounds("Lưu"), kb)
        shot("07b-note-editor-keyboard")
        rule.onNodeWithText("Huỷ").performSemanticsAction(SemanticsActions.OnClick)
        waitFor("note-editor-closed") { rule.onAllNodesWithTagCount("note-editor-form") == 0 }
        waitFor("keyboard-hidden-after-dialog") { keyboardTop() == null }
        rule.onNodeWithTag("nav-stats").performClick()
        shot("08-stats")
        rule.onNodeWithTag("nav-settings").performClick()
        shot("09-settings")
        // A field in the middle of a long scrolling screen is brought into view above the keyboard.
        rule.onNodeWithTag("day-start-input").performScrollTo().performClick()
        kb = waitForKeyboard("settings")
        assertAboveKeyboard("day-start-input", screenBounds("day-start-input"), kb)
        shot("09b-settings-keyboard")
        hideKeyboard()
    }
}

private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTextCount(text: String) =
    onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().size

private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTagCount(tag: String) =
    onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
