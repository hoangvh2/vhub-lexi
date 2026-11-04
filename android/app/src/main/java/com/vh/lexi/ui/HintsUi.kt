package com.vh.lexi.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.Note
import com.vh.lexi.core.hintCue
import com.vh.lexi.core.maskHint
import com.vh.lexi.core.str
import com.vh.lexi.data.LexiData
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.launch

/** "memo" = the memory tip (field mnemonic), "notes" = the learner's own notes. Same rules as web/src/ui/Hints.tsx. */
internal enum class HintKind(val field: String, val label: String, val tag: String) {
    MEMO("mnemonic", "Mẹo", "hint-memo"),
    NOTES("notes", "Ghi chú", "hint-notes"),
}

/**
 * The two hint buttons in the corner of the front. Asleep for [gateMs] (a ring fills meanwhile), locked on a word
 * that leaned on hints lately; tapping a sleeping, locked or empty button says why instead of opening.
 */
@Composable
internal fun HintButtons(note: Note, levels: Map<HintKind, Int>, gateMs: Long, locked: Boolean, onOpen: (HintKind) -> Unit, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    val toast = LocalToaster.current
    val progress = remember(note.id) { Animatable(if (gateMs == 0L) 1f else 0f) }
    LaunchedEffect(note.id, gateMs) { if (gateMs > 0) progress.animateTo(1f, tween(gateMs.toInt(), easing = LinearEasing)) }
    val awake = progress.value >= 1f
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (kind in HintKind.entries) {
            val has = note.fields[kind.field].str().isNotEmpty()
            val level = levels[kind] ?: 0
            Box(contentAlignment = Alignment.Center) {
                Surface(
                    onClick = {
                        when {
                            locked -> toast("Từ này bạn hay cần gợi ý. Lần này hãy tự nhớ, mẹo và ghi chú có ở mặt sau.")
                            !awake -> toast("Thử tự nhớ thêm vài giây nhé")
                            !has -> toast(if (kind == HintKind.MEMO) "Từ này chưa có mẹo. Lật đáp án rồi bấm Sửa mẹo để thêm." else "Chưa có ghi chú. Lật đáp án rồi bấm Sửa để thêm.")
                            else -> onOpen(kind)
                        }
                    },
                    shape = CircleShape,
                    color = if (level > 0) c.accent else c.accentSoft,
                    modifier = Modifier.size(42.dp).alpha(if (!awake || locked || !has) 0.45f else 1f).testTag(kind.tag)
                        .semantics { contentDescription = kind.label + when (level) { 1 -> ": xem đầy đủ"; 2 -> ": đang mở"; else -> ": gợi ý" } },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(if (kind == HintKind.MEMO) Icons.Filled.Lightbulb else Icons.Filled.EditNote, null, tint = if (level > 0) c.onAccent else c.accent, modifier = Modifier.size(20.dp))
                    }
                }
                if (!awake && !locked) {
                    Canvas(Modifier.size(48.dp)) { drawArc(c.accent, -90f, 360f * progress.value, false, style = Stroke(3.dp.toPx())) }
                }
                if (locked) Box(Modifier.align(Alignment.TopEnd).size(10.dp).background(c.peachDeep, CircleShape).testTag("hint-dot"))
            }
        }
    }
}

/** Opened hints on the front: level 1 the cue, level 2 the whole text; the answer is blanked in both. */
@Composable
internal fun HintBoxes(note: Note, templateId: String, levels: Map<HintKind, Int>) {
    val c = Lexi.colors
    val open = HintKind.entries.filter { (levels[it] ?: 0) > 0 }
    if (open.isEmpty()) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (kind in open) {
            val level = levels[kind] ?: 0
            val text = note.fields[kind.field].str()
            val shown = if (level == 1) hintCue(text) else text
            val masked = buildAnnotatedString {
                for (s in maskHint(shown, note, templateId)) {
                    if (s.masked) withStyle(SpanStyle(color = androidx.compose.ui.graphics.Color.Transparent, background = c.ink.copy(alpha = 0.16f))) { append(s.text) } else append(s.text)
                }
            }
            HintBox(kind, "${kind.label} · ${if (level == 1) "gợi ý" else "đầy đủ"}".uppercase(), Modifier.testTag("hint-box-${if (kind == HintKind.MEMO) "memo" else "notes"}")) {
                Text(masked, fontSize = 15.5.sp, lineHeight = 23.sp, color = c.ink)
            }
        }
        val top = open.maxOf { levels[it] ?: 0 }
        Text("Đã dùng gợi ý: lần này ${if (top == 2) "tối đa là Khó" else "không chấm Dễ"}.", Modifier.fillMaxWidth(), fontSize = 12.5.sp, color = c.muted, textAlign = TextAlign.Center)
    }
}

@Composable
private fun HintBox(kind: HintKind, label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = Lexi.colors
    Column(
        modifier.fillMaxWidth().background(if (kind == HintKind.MEMO) c.memo else c.butterSoft, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.7.sp, color = if (kind == HintKind.MEMO) c.mintDeep else c.butterDeep)
        content()
    }
}

/** After the answer: the tip and the learner's notes, with a way to edit them right here. */
@Composable
internal fun MemoryPanel(note: Note, showMemo: Boolean, onEdit: () -> Unit) {
    val c = Lexi.colors
    val memo = if (showMemo) note.fields["mnemonic"].str() else ""
    val notes = note.fields["notes"].str()
    if (memo.isEmpty() && notes.isEmpty()) {
        TextButton(onClick = onEdit, modifier = Modifier.testTag("memory-add")) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(" Thêm mẹo hoặc ghi chú", fontSize = 13.sp) }
        return
    }
    Column(Modifier.fillMaxWidth().testTag("memory"), verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (memo.isNotEmpty()) HintBox(HintKind.MEMO, "MẸO NHỚ") { Text(memo, fontSize = 15.5.sp, lineHeight = 23.sp, color = c.ink) }
        if (notes.isNotEmpty()) HintBox(HintKind.NOTES, "GHI CHÚ CỦA TÔI") { Text(notes, fontSize = 15.5.sp, lineHeight = 23.sp, color = c.ink) }
        TextButton(onClick = onEdit, modifier = Modifier.testTag("memory-edit")) { Icon(Icons.Filled.Edit, null, Modifier.size(15.dp)); Text(" Sửa mẹo và ghi chú", fontSize = 13.sp) }
    }
}

/**
 * Edit the tip and the notes of one word without leaving the session. "AI gợi ý mẹo" asks for a tip for this word
 * only (one AI use) and puts it in the box; nothing is saved until "Lưu". Scheduling is not touched.
 */
@Composable
internal fun MemoryEditor(data: LexiData, note: Note, aiAvailable: Boolean, askAi: suspend (Note) -> String, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val toast = LocalToaster.current
    val word = note.fields["word"].str()
    var memo by remember { mutableStateOf(note.fields["mnemonic"].str()) }
    var notes by remember { mutableStateOf(note.fields["notes"].str()) }
    var aiMemo by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("$word · mẹo và ghi chú") },
        text = {
            ResizeDialogForKeyboard()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = memo, onValueChange = { memo = it.take(300) }, minLines = 2,
                    label = { Text("Mẹo nhớ" + if (aiMemo != null && memo == aiMemo) " · AI" else "") },
                    placeholder = { Text("Đọc như \"con vịt\": cố thuyết phục một con vịt…") },
                    modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("memo-input"),
                )
                if (aiAvailable) {
                    OutlinedButton(enabled = !busy, modifier = Modifier.testTag("ai-memo"), onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val m = askAi(note)
                                if (m.isEmpty()) toast("AI chưa nghĩ ra mẹo ngắn cho từ này. Hãy thử lại hoặc tự viết.") else { memo = m; aiMemo = m }
                            } catch (e: Exception) {
                                toast(e.message ?: "Không gọi được AI, thử lại sau")
                            } finally {
                                busy = false
                            }
                        }
                    }) { Icon(Icons.Filled.AutoAwesome, null, Modifier.size(16.dp)); Text(if (busy) "  AI đang nghĩ…" else if (memo.isNotBlank()) "  AI gợi ý mẹo khác (1 lượt)" else "  AI gợi ý mẹo (1 lượt)", fontSize = 13.sp) }
                }
                OutlinedTextField(
                    value = notes, onValueChange = { notes = it.take(500) }, minLines = 3,
                    label = { Text("Ghi chú của tôi") },
                    placeholder = { Text("Điều bạn hay nhầm, cách dùng, từ hay đi kèm…") },
                    modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("notes-input"),
                )
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Huỷ") } },
        confirmButton = {
            Button(enabled = !busy, modifier = Modifier.testTag("memory-save"), onClick = {
                val m = memo.trim()
                val n = notes.trim()
                // The AI label stays only on a tip the learner did not change (just written by AI here, or untouched before).
                val ai = note.aiFields.toMutableSet()
                if (aiMemo != null && m == aiMemo) ai += "mnemonic" else if (m != note.fields["mnemonic"].str()) ai -= "mnemonic"
                if (m.isEmpty()) ai -= "mnemonic"
                scope.launch {
                    data.updateNote(note, fields = note.fields + mapOf("mnemonic" to FieldValue.Text(m), "notes" to FieldValue.Text(n)), aiFields = ai.toList())
                    toast("Đã lưu mẹo và ghi chú")
                    onClose()
                }
            }) { Text("Lưu") }
        },
    )
}
