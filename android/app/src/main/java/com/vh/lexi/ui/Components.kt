package com.vh.lexi.ui

import android.view.WindowManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogWindowProvider
import com.vh.lexi.core.Block
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.ui.theme.Quicksand
import com.vh.lexi.ui.theme.clay
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
    Column(
        modifier.fillMaxWidth().clay(Lexi.colors, RoundedCornerShape(26.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp), content = content,
    )
}

enum class PillKind { PLAIN, OK, WARN, BAD, AI }

@Composable
/** A short label; [wrap] lets a longer one (a verdict quoting the learner's answer) break lines instead of being cut off. */
fun Pill(text: String, kind: PillKind = PillKind.PLAIN, modifier: Modifier = Modifier, wrap: Boolean = false) {
    val c = Lexi.colors
    val (bg, fg) = when (kind) {
        PillKind.PLAIN -> c.surface2 to c.muted
        PillKind.OK -> c.mintSoft to c.mintDeep
        PillKind.WARN -> c.hardSoft to c.hard
        PillKind.BAD -> c.againSoft to c.again
        PillKind.AI -> c.easySoft to c.easy
    }
    Box(modifier.background(bg, if (wrap) RoundedCornerShape(16.dp) else CircleShape).padding(horizontal = 11.dp, vertical = 4.dp)) {
        Text(text, color = fg, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = if (wrap) Int.MAX_VALUE else 1, textAlign = if (wrap) TextAlign.Center else null)
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
fun BlocksView(blocks: List<Block>, onSpeak: (String) -> Unit, modifier: Modifier = Modifier, onSpeakSlow: (String) -> Unit = onSpeak, mode: Color = Lexi.colors.accent) {
    val c = Lexi.colors
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (b in blocks) when (b) {
            is Block.Title -> Text(b.text, fontSize = 38.sp, lineHeight = 42.sp, fontFamily = Quicksand, fontWeight = FontWeight.Bold, color = c.ink, textAlign = TextAlign.Center)
            is Block.Ipa -> Text("/" + b.text.trim('/') + "/", fontSize = 18.sp, color = c.muted)
            is Block.Badge -> Pill(b.text, PillKind.OK)
            is Block.Speak -> Surface(
                onClick = { onSpeak(b.text) }, shape = CircleShape, color = c.accentSoft,
            ) {
                Row(Modifier.heightIn(min = 40.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.VolumeUp, contentDescription = "Nghe phát âm ${b.text}", tint = c.accent, modifier = Modifier.size(18.dp))
                    Text("Nghe", fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = c.accent)
                }
            }
            is Block.Text -> when (b.tone) {
                "strong" -> senses(b.text)?.let { list ->
                    // "(công việc) trình diễn; (chung) chứng minh": one line per setting, the setting as a small label.
                    // The first sense sits in a soft butter bubble: the one thing the eye should land on after the word.
                    Column(Modifier.testTag("senses"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        for ((i, s) in list.withIndex()) Row(
                            (if (i == 0) Modifier.background(c.butterSoft, RoundedCornerShape(24.dp)).padding(horizontal = 16.dp, vertical = 6.dp) else Modifier),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(s.first, Modifier.background(c.surface.copy(alpha = 0.7f), CircleShape).padding(horizontal = 8.dp, vertical = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = mode)
                            Text(s.second, fontSize = if (i == 0) 22.sp else 19.sp, lineHeight = 28.sp, fontWeight = if (i == 0) FontWeight.ExtraBold else FontWeight.Bold, color = c.ink)
                        }
                    }
                } ?: Text(
                    b.text, Modifier.background(c.butterSoft, RoundedCornerShape(24.dp)).padding(horizontal = 20.dp, vertical = 8.dp),
                    fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.ExtraBold, color = c.ink, textAlign = TextAlign.Center,
                )
                "muted" -> Text(b.text, fontSize = 15.sp, lineHeight = 23.sp, color = c.muted, textAlign = TextAlign.Center)
                else -> Text(b.text, fontSize = 17.sp, lineHeight = 26.sp, color = c.ink, textAlign = TextAlign.Center)
            }
            is Block.Quote -> Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(mode))
                Text(b.text, Modifier.padding(start = 12.dp), fontSize = 18.sp, lineHeight = 27.sp, color = c.ink)
            }
            // The sentence with the studied word highlighted like a marker pen, its translation underneath.
            is Block.Example -> Column(
                Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 13.dp).testTag("example"),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val text = buildAnnotatedString {
                        val at = b.at
                        if (at == null) append(b.text)
                        else {
                            append(b.text.substring(0, at.first))
                            withStyle(SpanStyle(fontWeight = FontWeight.Bold, background = c.mark)) { append(b.text.substring(at.first, at.second)) }
                            append(b.text.substring(at.second))
                        }
                    }
                    Text(text, Modifier.weight(1f), fontSize = 17.sp, lineHeight = 26.sp, color = c.ink)
                    Surface(onClick = { onSpeak(b.text) }, shape = CircleShape, color = c.surface, modifier = Modifier.size(32.dp)) {
                        Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.VolumeUp, contentDescription = "Nghe câu ví dụ", tint = c.muted, modifier = Modifier.size(16.dp)) }
                    }
                }
                b.vi?.let { Text(it, fontSize = 15.sp, lineHeight = 23.sp, color = c.muted) }
            }
            // Folded behind a chip so the answer stays short; one tap opens it when the word does not come back.
            is Block.Memo -> {
                var open by remember(b) { mutableStateOf(false) }
                Column(
                    Modifier.then(if (open) Modifier.fillMaxWidth() else Modifier).background(c.memo, RoundedCornerShape(if (open) 16.dp else 50.dp))
                        .clickable { open = !open }.padding(horizontal = 14.dp, vertical = if (open) 12.dp else 8.dp).testTag("memo"),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Filled.AutoAwesome, null, tint = c.mintDeep, modifier = Modifier.size(14.dp))
                        Text("MẸO NHỚ", fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.8.sp, color = c.mintDeep)
                        Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = c.mintDeep, modifier = Modifier.size(16.dp))
                    }
                    if (open) Text(b.text, fontSize = 16.sp, lineHeight = 25.sp, color = c.ink)
                }
            }
            is Block.Fold -> {
                var open by remember(b) { mutableStateOf(false) }
                Column(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.clickable { open = !open }.heightIn(min = 36.dp).padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = c.muted, modifier = Modifier.size(18.dp))
                        Text(b.label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.muted)
                    }
                    AnimatedVisibility(open) { Text(b.text, Modifier.padding(start = 24.dp, bottom = 4.dp), fontSize = 15.sp, lineHeight = 23.sp, color = c.ink) }
                }
            }
            is Block.Listen -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Surface(
                    onClick = { onSpeak(b.text) }, shape = CircleShape, color = c.listen,
                    border = BorderStroke(8.dp, c.listenSoft), modifier = Modifier.size(104.dp).testTag("listen-play"),
                ) {
                    Box(contentAlignment = Alignment.Center) { Icon(Icons.Filled.VolumeUp, contentDescription = "Nghe câu", tint = Color.White, modifier = Modifier.size(36.dp)) }
                }
                TextButton(onClick = { onSpeakSlow(b.text) }, modifier = Modifier.testTag("listen-slow")) { Text("Nghe chậm", fontWeight = FontWeight.SemiBold, color = c.ink) }
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

/** Same split as web/src/ui/Blocks.tsx `senses`: (setting, meaning) pairs, or null when the text is not in that form. */
fun senses(vi: String): List<Pair<String, String>>? {
    if (!vi.startsWith("(")) return null
    val re = Regex("""^\(([^)]{1,24})\)\s*(.+)$""")
    val out = vi.split(Regex(""";\s*(?=\()""")).map { part -> re.find(part.trim())?.let { it.groupValues[1] to it.groupValues[2] } }
    return if (out.isNotEmpty() && out.all { it != null }) out.filterNotNull() else null
}
