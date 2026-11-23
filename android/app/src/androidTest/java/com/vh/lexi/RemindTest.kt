package com.vh.lexi

import android.app.NotificationManager
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.vh.lexi.core.ForgotKind
import com.vh.lexi.core.RemindSettings
import com.vh.lexi.core.forgotOf
import com.vh.lexi.remind.Reminders
import com.vh.lexi.ui.MainActivity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.util.Calendar
import java.util.regex.Pattern

private const val SHOTS = "/data/local/tmp/lexi-shots"

private fun sh(cmd: String) {
    val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(cmd)
    ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
}

private fun screenshot(name: String) {
    Thread.sleep(400)
    sh("mkdir -p $SHOTS")
    sh("screencap -p $SHOTS/$name.png")
}

private fun until(label: String, ms: Long = 10_000, cond: () -> Boolean) {
    val end = System.currentTimeMillis() + ms
    while (!cond()) {
        if (System.currentTimeMillis() > end) { screenshot("fail-remind-" + label.replace(' ', '-')); throw AssertionError("timeout waiting for $label") }
        Thread.sleep(100)
    }
}

private fun ours(app: LexiApp) = app.getSystemService(NotificationManager::class.java).activeNotifications.filter { it.id == Reminders.NOTIFICATION_ID }

/** Two marked words in their own deck: allocate (meaning + sound, marked first) and venue (sound). */
private fun seedReminderWords(app: LexiApp) {
    val now = System.currentTimeMillis()
    val day = 86_400_000L
    val notes = JSONArray()
    listOf(listOf("allocate", "phân bổ; phân phối", listOf("meaning", "sound")), listOf("venue", "địa điểm tổ chức", listOf("sound"))).forEachIndexed { i, (w, vi, kinds) ->
        @Suppress("UNCHECKED_CAST")
        notes.put(JSONObject().put("id", "r$i").put("type", "vocab").put("deckId", "dr").put("createdAt", now - 30 * day).put("updatedAt", now - 3 * day)
            .put("forgot", JSONArray(kinds as List<String>)).put("forgotAt", now - 3 * day + i * 1000)
            .put("fields", JSONObject().put("word", w).put("vi", vi).put("pos", "verb").put("ipa", if (i == 0) "/ˈæl.ə.keɪt/" else "/ˈven.juː/")))
    }
    val backup = JSONObject().put("app", "vhub-lexi").put("version", 1).put("exportedAt", now)
        .put("decks", JSONArray().put(JSONObject().put("id", "dr").put("name", "Nhắc").put("createdAt", now).put("updatedAt", now)))
        .put("notes", notes).put("cards", JSONArray()).put("reviews", JSONArray()).put("daily", JSONArray()).put("prefs", JSONObject.NULL)
    runBlocking { app.data.loaded.first { it }; app.data.importJson(backup.toString()) }
    until("seeded", 20_000) { app.data.notes.value.count { it.deckId == "dr" && forgotOf(it).isNotEmpty() } == 2 }
}

private fun cleanUp(app: LexiApp) {
    Reminders.setSettings(app, RemindSettings())
    Reminders.saveState(app, com.vh.lexi.core.RemindState())
    app.getSystemService(NotificationManager::class.java).cancel(Reminders.NOTIFICATION_ID)
    runBlocking { app.data.deleteDeckAndContents("dr") }
    until("cleaned", 10_000) { app.data.notes.value.none { it.deckId == "dr" } }
}

/**
 * "Từ hay quên" reminders in the system: the job posts the notification (not drawn by the test), it shows in the
 * notification shade, and its buttons are pressed there: "Đã nhớ" clears the mark, "Hoàn tác" brings it back.
 * No activity: the shade would pause it, and the buttons must work with the app closed anyway. Screenshots 25-26.
 */
class RemindShadeTest {
    private val device: UiDevice get() = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val app: LexiApp get() = ApplicationProvider.getApplicationContext()

    @After
    fun tearDown() {
        device.pressBack()
        sh("cmd statusbar collapse")
        cleanUp(app)
    }

    @Test
    fun theJobPostsAWordAndTheShadeButtonsWork() {
        sh("pm grant ${app.packageName} android.permission.POST_NOTIFICATIONS")
        assertTrue("notifications allowed", Reminders.canNotify(app))
        seedReminderWords(app)
        device.pressHome()

        // A one-slot window around now, so the slot (its middle) is five minutes ago.
        val cal = Calendar.getInstance()
        val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        assumeTrue("not right at midnight", nowMin in 40..1400)
        Reminders.setSettings(app, RemindSettings(on = true, perDay = 1, start = nowMin - 20, end = nowMin + 10))
        // Turning it on queues a check right away (WorkManager), which shows the word marked longest ago.
        until("notification posted", 30_000) { ours(app).isNotEmpty() }
        val posted = ours(app).single().notification
        assertEquals("allocate /ˈæl.ə.keɪt/", posted.extras.getCharSequence("android.title").toString())
        assertEquals("Nghĩa và cách đọc của từ này là gì?", posted.extras.getCharSequence("android.text").toString())
        assertTrue("meaning in the expanded text", posted.extras.getCharSequence("android.bigText").toString().endsWith("phân bổ"))
        assertEquals(listOf("Đã nhớ", "Chưa nhớ", "Ôn ngay"), posted.actions.map { it.title.toString() })
        assertEquals("level after the first show", 1, Reminders.loadState(app).words["r0"]?.level)
        // The next check is queued for the next slot.
        val wm = WorkManager.getInstance(app)
        until("next check queued", 15_000) {
            runBlocking { wm.getWorkInfosForUniqueWorkFlow(Reminders.WORK).first() }.let { l -> l.any { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED } && l.none { it.state == WorkInfo.State.RUNNING } }
        }

        // In the shade, as the learner sees it.
        device.openNotification()
        assertTrue("shade shows the word", device.wait(Until.hasObject(By.textContains("allocate")), 10_000))
        screenshot("25-remind-shade")
        val done = device.wait(Until.findObject(By.text(Pattern.compile("(?i)đã nhớ"))), 5_000)
        assertNotNull("Đã nhớ button", done)
        done.click()
        until("mark cleared", 15_000) { app.data.notes.value.first { it.id == "r0" }.forgot.isEmpty() }
        assertTrue("undo offered", device.wait(Until.hasObject(By.textContains("Đã bỏ")), 10_000))
        screenshot("26-remind-done-undo")
        device.wait(Until.findObject(By.text(Pattern.compile("(?i)hoàn tác"))), 5_000).click()
        until("mark back", 15_000) { forgotOf(app.data.notes.value.first { it.id == "r0" }) == listOf(ForgotKind.MEANING, ForgotKind.SOUND) }
        assertEquals("mark time back", app.data.notes.value.first { it.id == "r1" }.forgotAt!! - 1000, app.data.notes.value.first { it.id == "r0" }.forgotAt)
        until("undo notification gone") { ours(app).isEmpty() }

        // The same slot is never shown twice.
        assertNull("same slot not shown twice", runBlocking { Reminders.check(app) })
        Thread.sleep(500)
        assertTrue("nothing posted again", ours(app).isEmpty())

        // "Chưa nhớ": back from tomorrow, level 0, the notification goes away.
        Reminders.saveState(app, com.vh.lexi.core.RemindState(mapOf("r1" to com.vh.lexi.core.RemindWord(3, 0)), 0))
        runBlocking { Reminders.handle(app, Reminders.ACTION_NOT_YET, "r1", emptyList(), null) }
        val w = Reminders.loadState(app).words.getValue("r1")
        assertEquals("level after Chưa nhớ", 0, w.level)
        assertTrue("from tomorrow", w.next > System.currentTimeMillis() + 20 * 3_600_000L)
    }
}

/**
 * In the app: a tap on a reminder opens practice for its word, the settings panel, and "Đã nhớ" in the list.
 * Screenshots 27-29.
 */
class RemindTest {
    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun exists(tag: String) = rule.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()

    private fun waitFor(label: String, ms: Long = 10_000, cond: () -> Boolean) {
        try {
            rule.waitUntil(ms, cond)
        } catch (e: Throwable) {
            screenshot("fail-remind-" + label.replace(' ', '-'))
            rule.onAllNodes(isRoot()).printToString(maxDepth = 14).take(6000).lines().forEach { Log.i("LEXI_PERF", "dump $label: $it") }
            throw AssertionError("timeout waiting for $label", e)
        }
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        screenshot(name)
    }

    @After
    fun tearDown() = cleanUp(rule.activity.application as LexiApp)

    @Test
    fun tapOpensPracticeAndTheListOffersDaNho() {
        val app = rule.activity.application as LexiApp
        seedReminderWords(app)
        Reminders.setSettings(app, RemindSettings(on = true))

        // A tap on the notification ("Ôn ngay" carries the same intent) hands the word to the app (MainActivity
        // handleRemind sets this); the Từ hay quên screen opens on a round of it. (Starting the intent from the test
        // opens a second MainActivity over the test rule's own, which the rule then cannot close.)
        Reminders.pendingDrill.value = "r0"
        waitFor("drill for the word", 20_000) { exists("drill-card") }
        shot("27-remind-tap-drill")
        rule.onNodeWithTag("drill-quit").performClick()
        waitFor("list") { exists("forgot-screen") && !exists("drill-card") }

        rule.onNodeWithTag("forgot-screen").performScrollToNode(hasTestTag("remind-panel"))
        waitFor("panel") { exists("remind-panel") }
        shot("28-remind-panel")
        rule.onNodeWithTag("forgot-screen").performScrollToNode(hasTestTag("row-done"))
        waitFor("rows") { exists("row-done") }
        rule.onAllNodes(hasTestTag("row-done"))[0].performClick()
        waitFor("removed from list", 10_000) { app.data.notes.value.count { it.deckId == "dr" && forgotOf(it).isNotEmpty() } == 1 }
        shot("29-remind-list-done")
    }
}
