package com.vh.lexi

import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.hasText
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

    @Test
    fun addStudyAndBrowse() {
        rule.waitForIdle()
        shot("01-start")

        rule.onNodeWithTag("nav-add").performClick()
        rule.onNodeWithTag("word-input").performTextInput("serendipity")
        waitFor("lookup") { rule.onAllNodesWithTextCount("good luck in making") > 0 }
        shot("02-add-lookup")

        rule.onNodeWithTag("vi-input").performTextInput("sự tình cờ may mắn")
        shot("03-add-filled")
        rule.onNodeWithTag("save-word").performClick()
        waitFor("saved") { rule.onAllNodesWithTextCount("Đã thêm") > 0 }

        rule.onNodeWithTag("nav-study").performClick()
        waitFor("study-card") { rule.onAllNodesWithTextCount("serendipity") > 0 }
        shot("04-study-front")
        rule.onNodeWithTag("show-answer").performClick()
        rule.onNodeWithTag("rate-3").assertIsDisplayed()
        shot("05-study-back")
        rule.onNodeWithTag("rate-3").performClick()
        waitFor("session-done") { rule.onAllNodesWithTagCount("session-done") > 0 }
        shot("06-session-done")

        rule.onNodeWithTag("nav-library").performClick()
        waitFor("library-item") { rule.onAllNodesWithTextCount("serendipity") > 0 }
        shot("07-library")
        rule.onNodeWithTag("nav-stats").performClick()
        shot("08-stats")
        rule.onNodeWithTag("nav-settings").performClick()
        shot("09-settings")
    }
}

private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTextCount(text: String) =
    onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().size

private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>.onAllNodesWithTagCount(tag: String) =
    onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
