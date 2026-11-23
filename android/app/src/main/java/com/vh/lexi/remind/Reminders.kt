package com.vh.lexi.remind

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.vh.lexi.LexiApp
import com.vh.lexi.R
import com.vh.lexi.core.ForgotKind
import com.vh.lexi.core.Note
import com.vh.lexi.core.RemindSettings
import com.vh.lexi.core.RemindState
import com.vh.lexi.core.RemindWord
import com.vh.lexi.core.afterNotYet
import com.vh.lexi.core.afterShown
import com.vh.lexi.core.cleanSettings
import com.vh.lexi.core.dueSlot
import com.vh.lexi.core.forgotOf
import com.vh.lexi.core.nextSlot
import com.vh.lexi.core.pickWord
import com.vh.lexi.core.pruneState
import com.vh.lexi.core.remindMessage
import com.vh.lexi.core.slotHandled
import com.vh.lexi.core.str
import com.vh.lexi.ui.MainActivity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * "Từ hay quên" reminders on Android (web: web/src/lib/remind.ts; schedule: core Remind.kt). A one-off WorkManager job
 * waits for the next slot, shows one marked word, and queues the next one; WorkManager keeps it across reboots and
 * Doze may hold it back a little. The schedule lives in this phone's SharedPreferences, never in Firestore; the only
 * synced write is "Đã nhớ", which clears the mark on the note (one note write).
 */
object Reminders {
    const val CHANNEL = "forgot-reminders"
    const val NOTIFICATION_ID = 4711
    const val WORK = "forgot-reminder"
    private const val PREFS = "lexi_remind"

    const val ACTION_DONE = "com.vh.lexi.remind.DONE"
    const val ACTION_NOT_YET = "com.vh.lexi.remind.NOT_YET"
    const val ACTION_UNDO = "com.vh.lexi.remind.UNDO"
    const val EXTRA_NOTE = "noteId"
    const val EXTRA_KINDS = "kinds"
    const val EXTRA_AT = "forgotAt"
    /** On the MainActivity intent of a tap on the notification ("Ôn ngay"): practise that word. */
    const val EXTRA_DRILL = "remindDrill"

    /** The word a tap on a notification asked to practise; the Từ hay quên screen takes it and empties this. */
    val pendingDrill = MutableStateFlow<String?>(null)

    /** Settings shown on screen; changed through [setSettings]. */
    val settings = MutableStateFlow(RemindSettings())

    fun tz(now: Long) = TimeZone.getDefault().getOffset(now) / 60_000

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun loadSettings(ctx: Context): RemindSettings {
        val o = prefs(ctx).getString("settings", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return RemindSettings()
        return cleanSettings(o.opt("on"), o.opt("perDay") as? Number, o.opt("start") as? Number, o.opt("end") as? Number)
    }

    fun setSettings(ctx: Context, s: RemindSettings) {
        val c = cleanSettings(s)
        prefs(ctx).edit().putString("settings", JSONObject().put("on", c.on).put("perDay", c.perDay).put("start", c.start).put("end", c.end).toString()).apply()
        settings.value = c
        schedule(ctx, checkNow = true)
    }

    @Synchronized fun loadState(ctx: Context): RemindState {
        val o = prefs(ctx).getString("state", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return RemindState()
        val w = o.optJSONObject("words") ?: JSONObject()
        val words = w.keys().asSequence().associateWith { k -> w.getJSONObject(k).let { RemindWord(it.getInt("level"), it.getLong("next")) } }
        return RemindState(words, o.optLong("lastSlot", 0))
    }

    @Synchronized fun saveState(ctx: Context, st: RemindState) {
        val w = JSONObject()
        for ((k, v) in st.words) w.put(k, JSONObject().put("level", v.level).put("next", v.next))
        prefs(ctx).edit().putString("state", JSONObject().put("words", w).put("lastSlot", st.lastSlot).toString()).commit()
    }

    fun canNotify(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    private fun channel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Nhắc Từ hay quên", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Mỗi lần một từ trong danh sách Từ hay quên, giãn dần khi bạn nhớ."
            },
        )
    }

    /** Queues the next check at the next slot (or now, when [checkNow]); cancels it when reminders are off. */
    fun schedule(ctx: Context, checkNow: Boolean = false) {
        val wm = WorkManager.getInstance(ctx)
        val now = System.currentTimeMillis()
        val next = nextSlot(now, settings.value, tz(now))
        if (next == null) { wm.cancelUniqueWork(WORK); return }
        val delay = if (checkNow) 0L else (next - now + 30_000).coerceAtLeast(0)
        wm.enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<RemindWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).build())
    }

    /** Shows the current slot's word if that slot has not been handled yet; returns the note shown. */
    suspend fun check(app: LexiApp, now: Long = System.currentTimeMillis()): Note? {
        val s = settings.value
        if (!s.on || !canNotify(app)) return null
        withTimeoutOrNull(20_000) { app.data.loaded.first { it } } ?: return null
        val notes = app.data.notes.value
        synchronized(this) {
            val st = pruneState(loadState(app), notes)
            val slot = dueSlot(now, s, tz(now), st.lastSlot) ?: return null
            val n = pickWord(notes, st, now)
            if (n == null) { saveState(app, slotHandled(st, slot)); return null }
            post(app, n, st)
            saveState(app, afterShown(st, n.id, now, slot))
            return n
        }
    }

    /** "Gửi thử": the word the next reminder would show, now, without moving the schedule. */
    fun sendTest(app: LexiApp): Note? {
        if (!canNotify(app)) return null
        val notes = app.data.notes.value
        val st = pruneState(loadState(app), notes)
        val n = pickWord(notes, st, Long.MAX_VALUE) ?: return null
        post(app, n, st)
        return n
    }

    private fun pending(ctx: Context, action: String, n: Note, code: Int, extra: Intent.() -> Unit = {}): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, RemindReceiver::class.java).setAction(action).putExtra(EXTRA_NOTE, n.id).apply(extra),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun openDrill(ctx: Context, n: Note): PendingIntent =
        PendingIntent.getActivity(
            ctx, 3, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra(EXTRA_DRILL, n.id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    /** One notification at a time (same id): a new reminder replaces the last one. */
    @Suppress("MissingPermission") // canNotify() is checked by every caller
    fun post(ctx: Context, n: Note, st: RemindState) {
        channel(ctx)
        val m = remindMessage(n, st)
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(m.title)
            .setContentText(m.prompt)
            // Collapsed: the question only. Expanded: the meaning under it.
            .setStyle(NotificationCompat.BigTextStyle().bigText("${m.prompt}\n${m.answer}"))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openDrill(ctx, n))
            .addAction(0, "Đã nhớ", pending(ctx, ACTION_DONE, n, 1))
            .addAction(0, "Chưa nhớ", pending(ctx, ACTION_NOT_YET, n, 2))
            .addAction(0, "Ôn ngay", openDrill(ctx, n))
        if (canNotify(ctx)) NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build())
    }

    /** After "Đã nhớ": the same notification now says so and offers an undo for a while. */
    @Suppress("MissingPermission")
    private fun postDone(ctx: Context, n: Note, kinds: List<ForgotKind>, at: Long?) {
        channel(ctx)
        val word = n.fields["word"].str()
        val b = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("Đã bỏ “$word” khỏi Từ hay quên")
            .setContentText("Bấm Hoàn tác nếu bấm nhầm.")
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setTimeoutAfter(60_000)
            .setAutoCancel(true)
            .addAction(0, "Hoàn tác", pending(ctx, ACTION_UNDO, n, 4) { putExtra(EXTRA_KINDS, kinds.joinToString(",") { it.key }); if (at != null) putExtra(EXTRA_AT, at) })
        if (canNotify(ctx)) NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build())
    }

    /** "Đã nhớ": clears both marks; returns what an undo needs. */
    suspend fun remember(app: LexiApp, noteId: String): Pair<Note, Pair<List<ForgotKind>, Long?>>? {
        withTimeoutOrNull(20_000) { app.data.loaded.first { it } } ?: return null
        val n = app.data.notes.value.firstOrNull { it.id == noteId } ?: return null
        val kinds = forgotOf(n)
        if (kinds.isEmpty()) return null
        val at = n.forgotAt
        app.data.clearForgot(n)
        saveState(app, pruneState(loadState(app), app.data.notes.value))
        return n to (kinds to at)
    }

    suspend fun undo(app: LexiApp, noteId: String, kinds: List<ForgotKind>, at: Long?) {
        withTimeoutOrNull(20_000) { app.data.loaded.first { it } } ?: return
        val n = app.data.notes.value.firstOrNull { it.id == noteId } ?: return
        if (forgotOf(n).isNotEmpty() || kinds.isEmpty()) return
        app.data.restoreForgot(n, kinds, at)
    }

    /** "Chưa nhớ" on a notification, or a miss in practice: back from tomorrow, level 0. */
    fun notYet(ctx: Context, noteId: String) = synchronized(this) { saveState(ctx, afterNotYet(loadState(ctx), noteId, System.currentTimeMillis())) }

    /** A button on the notification (RemindReceiver). */
    suspend fun handle(app: LexiApp, action: String, noteId: String, kinds: List<ForgotKind>, at: Long?) {
        val nm = NotificationManagerCompat.from(app)
        when (action) {
            ACTION_DONE -> {
                val r = remember(app, noteId)
                if (r == null) nm.cancel(NOTIFICATION_ID) else postDone(app, r.first, r.second.first, r.second.second)
            }
            ACTION_NOT_YET -> { notYet(app, noteId); nm.cancel(NOTIFICATION_ID) }
            ACTION_UNDO -> { undo(app, noteId, kinds, at); nm.cancel(NOTIFICATION_ID) }
        }
    }

    /** At app start: the settings into memory and the next check queued (WorkManager also keeps it across reboots). */
    fun start(app: LexiApp) {
        settings.value = loadSettings(app)
        if (settings.value.on) schedule(app, checkNow = true)
    }
}

class RemindWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as LexiApp
        Reminders.check(app)
        Reminders.schedule(app)
        return Result.success()
    }
}
