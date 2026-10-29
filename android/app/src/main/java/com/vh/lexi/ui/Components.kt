package com.vh.lexi.ui

import android.view.WindowManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.onFocusEvent
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogWindowProvider
import com.vh.lexi.core.Block
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.launch

/**
 * Keeps a focused text field entirely in view in its scroll container, also when the keyboard (or a resized dialog)
 * shrinks the viewport afterwards. On its own Compose only scrolls the cursor line into view, which leaves the rest
 * of the field half under the keyboard or under a bar pinned above it. Driven by layout rather than by the keyboard
 * height, so it does not depend on when the inset animation and the viewport resize land.
 */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.keepVisibleWhileTyping(): Modifier = composed {
    val requester = remember { BringIntoViewRequester() }
    val scope = rememberCoroutineScope()
    var focused by remember { mutableStateOf(false) }
    bringIntoViewRequester(requester)
        .onFocusEvent {
            focused = it.isFocused
            if (focused) scope.launch { requester.bringIntoView() }
        }
        .onGloballyPositioned { c ->
            // Clipped by the viewport while focused: scroll it back into full view (a no-op once it fits).
            if (focused && c.boundsInWindow().height < c.size.height - 1) scope.launch { requester.bringIntoView() }
        }
}

/**
 * Call inside a dialog that has text fields. Dialog windows pan for the keyboard by default (the whole dialog slides
 * up until the focused field clears it), which pushes the buttons under the keyboard. Resizing instead keeps the
 * buttons above it and lets the form scroll in the room that is left.
 */
@Suppress("DEPRECATION") // ADJUST_RESIZE is deprecated for edge-to-edge windows; dialog windows still fit system windows
@Composable
fun ResizeDialogForKeyboard() {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window
    SideEffect { window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE) }
}

/** Shows a short message (snackbar) with an optional action. Provided by MainActivity. */
class Toaster(val show: (message: String, action: String?, onAction: (() -> Unit)?) -> Unit) {
    operator fun invoke(message: String) = show(message, null, null)
}

val LocalToaster = compositionLocalOf { Toaster { _, _, _ -> } }

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = Lexi.colors.surface,
        border = BorderStroke(1.dp, Lexi.colors.line),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

enum class PillKind { PLAIN, OK, WARN, BAD, AI }

@Composable
fun Pill(text: String, kind: PillKind = PillKind.PLAIN, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    val (bg, fg) = when (kind) {
        PillKind.PLAIN -> c.surface2 to c.muted
        PillKind.OK -> c.accentSoft to c.accent
        PillKind.WARN -> c.hardSoft to c.hard
        PillKind.BAD -> c.againSoft to c.again
        PillKind.AI -> c.easySoft to c.easy
    }
    Box(modifier.background(bg, CircleShape).padding(horizontal = 10.dp, vertical = 3.dp)) {
        Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/**
 * Every destructive action (delete, sign out) goes through this dialog; no gesture may skip it.
 * Cancel on the left, the action on the right, red when [destructive].
 */
@Composable
fun ConfirmDialog(title: String, message: String, confirm: String, destructive: Boolean = false, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Huỷ") } },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirm, color = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
        },
    )
}

/** Renders template blocks (core/NoteTypes.kt): the same description drives the web UI. */
@Composable
fun BlocksView(blocks: List<Block>, onSpeak: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (b in blocks) when (b) {
            is Block.Title -> Text(b.text, fontSize = 38.sp, lineHeight = 42.sp, fontWeight = FontWeight.Bold, color = c.ink, textAlign = TextAlign.Center)
            is Block.Ipa -> Text("/" + b.text.trim('/') + "/", fontSize = 18.sp, color = c.muted)
            is Block.Badge -> Pill(b.text, PillKind.OK)
            is Block.Speak -> Surface(
                onClick = { onSpeak(b.text) }, shape = CircleShape, color = c.surface2, border = BorderStroke(1.dp, c.line),
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.VolumeUp, contentDescription = "Nghe phát âm ${b.text}", tint = c.ink, modifier = Modifier.size(18.dp))
                    Text("Nghe", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.ink)
                }
            }
            is Block.Text -> when (b.tone) {
                "strong" -> Text(b.text, fontSize = 22.sp, lineHeight = 29.sp, fontWeight = FontWeight.SemiBold, color = c.ink, textAlign = TextAlign.Center)
                "muted" -> Text(b.text, fontSize = 15.sp, color = c.muted, textAlign = TextAlign.Center)
                else -> Text(b.text, fontSize = 15.sp, color = c.ink, textAlign = TextAlign.Center)
            }
            is Block.Quote -> Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(c.accent))
                Text(b.text, Modifier.padding(start = 12.dp), fontSize = 17.sp, lineHeight = 24.sp, color = c.ink)
            }
        }
    }
}

@Composable
fun ScreenHeader(title: String, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        trailing()
    }
}

val ScreenPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
