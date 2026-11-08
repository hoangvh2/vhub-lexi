package com.vh.lexi.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Deck
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.Note
import com.vh.lexi.core.Prefs
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.noteType
import com.vh.lexi.core.noteView
import com.vh.lexi.core.template
import com.vh.lexi.ui.theme.Lexi

/**
 * The library's read view of one note ("Xem"), port of web/src/ui/NoteView.tsx: the whole note laid out like the
 * answer side of a card, each card's place in the review schedule, and a cover switch for a quick self-test.
 * Everything comes from what is already on the device; nothing is read from the server.
 */
@Composable
fun NoteViewScreen(
    note: Note, cards: List<Card>, decks: List<Deck>, prefs: Prefs, index: Int, total: Int,
    covered: Boolean, onCover: (Boolean) -> Unit, onSpeak: (String) -> Unit,
    onPrev: () -> Unit, onNext: () -> Unit, onEdit: () -> Unit, onClose: () -> Unit,
) {
    val c = Lexi.colors
    val def = noteType(note.type)
    val blocks = remember(note, covered) { noteView(note, covered) }
    val order = def?.templates?.map { it.id }.orEmpty()
    val sorted = cards.sortedBy { order.indexOf(it.template) }
    val scroll = rememberScrollState()
    LaunchedEffect(note.id) { scroll.scrollTo(0) }
    // Full screen and edge to edge, insets handled here: with the platform's own fitting, Android 15 laid the dialog
    // under the navigation bar and the end of a long note could not be scrolled into view.
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        val dark = c.dark
        SideEffect {
            (view.parent as? DialogWindowProvider)?.window?.let { w ->
                WindowCompat.getInsetsController(w, w.decorView).run {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
        }
        Surface(Modifier.fillMaxSize().testTag("note-view"), color = c.bg) {
            Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().background(c.surface).statusBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    RoundIcon(Icons.Filled.Close, "Đóng", "view-close", enabled = true, onClick = onClose)
                    RoundIcon(Icons.Filled.ChevronLeft, "Từ trước", "view-prev", enabled = total > 0 && index != 0, onClick = onPrev)
                    Text(
                        if (index >= 0) "${index + 1} / $total" else "– / $total", Modifier.weight(1f).testTag("view-pos"),
                        fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = c.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    RoundIcon(Icons.Filled.ChevronRight, "Từ sau", "view-next", enabled = total > 0 && index != total - 1, onClick = onNext)
                    Button(onClick = onEdit, modifier = Modifier.testTag("view-edit"), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp)) {
                        Icon(Icons.Filled.Edit, null, Modifier.size(16.dp))
                        Spacer(Modifier.size(6.dp))
                        Text("Sửa")
                    }
                }
                HorizontalDivider(color = c.line)
                Column(
                    Modifier.weight(1f).verticalScroll(scroll).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 16.dp).testTag("view-body"),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Column(
                        Modifier.fillMaxWidth().background(c.surface, RoundedCornerShape(24.dp)).padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            // The deck chip takes the room the switch leaves and shortens only a long name.
                            Box(Modifier.weight(1f)) { decks.firstOrNull { it.id == note.deckId }?.name?.let { Chip(it) } }
                            val label = if (note.type == "vocab") "Che nghĩa" else "Che đáp án"
                            Surface(
                                onClick = { onCover(!covered) }, shape = CircleShape, color = if (covered) c.accent else c.surface2,
                                modifier = Modifier.testTag("view-cover").semantics { role = Role.Switch; stateDescription = if (covered) "Đang che" else "Không che" },
                            ) {
                                Row(Modifier.heightIn(min = 36.dp).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Icon(if (covered) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, null, Modifier.size(16.dp), tint = if (covered) c.onAccent else c.muted)
                                    Text(label, fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = if (covered) c.onAccent else c.muted)
                                }
                            }
                        }
                        BlocksView(blocks, onSpeak = onSpeak, page = true, titleSize = if (note.type == "vocab") 36 else 26)
                    }
                    if (sorted.isNotEmpty()) Schedule(note, sorted, prefs)
                }
            }
        }
    }
}

@Composable
private fun RoundIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tag: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Lexi.colors
    IconButton(
        onClick = onClick, enabled = enabled, modifier = Modifier.size(40.dp).testTag(tag),
        colors = IconButtonDefaults.iconButtonColors(containerColor = c.surface2, contentColor = c.ink, disabledContainerColor = c.surface2.copy(alpha = 0.5f), disabledContentColor = c.muted.copy(alpha = 0.4f)),
    ) { Icon(icon, contentDescription = label) }
}

@Composable
private fun Chip(text: String, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    Text(
        text, modifier.border(1.dp, c.line, CircleShape).padding(horizontal = 10.dp, vertical = 3.dp),
        fontSize = 12.5.sp, color = c.muted, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
    )
}

/** Each card's place in the review schedule (same line as the editor's card info). */
@Composable
private fun Schedule(note: Note, cards: List<Card>, prefs: Prefs) {
    val c = Lexi.colors
    val now = System.currentTimeMillis()
    Column(
        Modifier.fillMaxWidth().background(c.surface, RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 14.dp).testTag("view-schedule"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("LỊCH ÔN", fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.8.sp, color = c.muted)
        for ((i, card) in cards.withIndex()) {
            if (i > 0) HorizontalDivider(color = c.line)
            Column(Modifier.testTag("view-card"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(template(note.type, card.template)?.label ?: card.template, Modifier.weight(1f), fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = c.ink)
                    if (isLeech(card)) Pill("Khó", PillKind.BAD)
                    val kind = when {
                        card.suspended -> PillKind.PLAIN
                        card.state == CardState.NEW -> PillKind.AI
                        card.due <= now -> PillKind.WARN
                        else -> PillKind.OK
                    }
                    Pill(scheduleLabel(card, now), kind)
                }
                Text(cardStats(card, prefs, now), fontSize = 13.sp, lineHeight = 19.sp, color = c.muted)
            }
        }
    }
}

private fun scheduleLabel(c: Card, now: Long): String = when {
    c.suspended -> "Đã ẩn"
    c.state == CardState.NEW -> "Mới"
    c.due <= now -> "Đến hạn"
    else -> "sau " + Fsrs.formatInterval(c.due - now)
}
