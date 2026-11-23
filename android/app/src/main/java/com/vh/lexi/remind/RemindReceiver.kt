package com.vh.lexi.remind

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.vh.lexi.LexiApp
import com.vh.lexi.core.ForgotKind
import kotlinx.coroutines.launch

/** The "Đã nhớ", "Chưa nhớ" and "Hoàn tác" buttons of a reminder; works with the app closed (no screen opens). */
class RemindReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val action = intent.action ?: return
        val noteId = intent.getStringExtra(Reminders.EXTRA_NOTE) ?: return
        val kinds = intent.getStringExtra(Reminders.EXTRA_KINDS).orEmpty().split(",").mapNotNull { k -> ForgotKind.entries.firstOrNull { it.key == k } }
        val at = if (intent.hasExtra(Reminders.EXTRA_AT)) intent.getLongExtra(Reminders.EXTRA_AT, 0) else null
        val app = ctx.applicationContext as LexiApp
        val done = goAsync()
        app.scope.launch {
            try {
                Reminders.handle(app, action, noteId, kinds, at)
            } finally {
                done.finish()
            }
        }
    }
}
