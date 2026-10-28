package com.vh.lexi

import android.graphics.Bitmap
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.hasText
import androidx.test.platform.app.InstrumentationRegistry
import com.vh.lexi.ui.MainActivity
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.io.FileOutputStream

/**
 * End-to-end on a real (emulated) device, phone-only mode: add a word through the offline dictionary, study it,
 * look at every screen. Screenshots are written to /data/local/tmp/lexi-shots for review (CI publishes them).
 */
@OptIn(ExperimentalTestApi::class)
class SmokeTest {
    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun shot(name: String) {
        rule.waitForIdle()
        val bmp: Bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val dir = File("/data/local/tmp/lexi-shots").also { it.mkdirs() }
        FileOutputStream(File(dir, "$name.png")).use { bmp.compress(Bitmap.CompressFormat.PNG, 90, it) }
    }

    @Test
    fun addStudyAndBrowse() {
        rule.waitForIdle()
        shot("01-start")

        rule.onNodeWithTag("nav-add").performClick()
        rule.onNodeWithTag("word-input").performTextInput("serendipity")
        rule.waitUntil(10_000) { rule.onAllNodesWithTextCount("good luck in making") > 0 }
        shot("02-add-lookup")

        rule.onNodeWithTag("vi-input").performTextInput("sự tình cờ may mắn")
        shot("03-add-filled")
        rule.onNodeWithTag("save-word").performClick()

        rule.onNodeWithTag("nav-study").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTextCount("serendipity") > 0 }
        shot("04-study-front")
        rule.onNodeWithTag("show-answer").performClick()
        rule.onNodeWithTag("rate-3").assertIsDisplayed()
        shot("05-study-back")
        rule.onNodeWithTag("rate-3").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTagCount("session-done") > 0 }
        shot("06-session-done")

        rule.onNodeWithTag("nav-library").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTextCount("serendipity") > 0 }
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
