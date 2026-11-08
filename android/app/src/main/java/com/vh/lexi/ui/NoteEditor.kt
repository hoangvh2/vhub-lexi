package com.vh.lexi.ui

import androidx.compose.foundation.layout.Arrangement
import com.vh.lexi.core.parsePhrase
import androidx.compose.ui.unit.sp
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Icon
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.Note
import com.vh.lexi.core.Prefs
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.noteType
import com.vh.lexi.core.template
import com.vh.lexi.data.LexiData
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Edits any note through its registered field list, so new note types need no new editor. */
@Composable
fun NoteEditor(
    data: LexiData, note: Note,
    /** AI is on and signed in: show "AI thêm cụm ngắn" under the phrases field. */
    aiAvailable: Boolean = false,
    /** Asks the `enrich` function for short phrases (word, part of speech, English meaning, Vietnamese meanings): one AI use. */
    askPhrases: suspend (String, String?, String?, String?) -> List<String> = { _, _, _, _ -> emptyList() },
    onClose: () -> Unit,
) {
    val def = noteType(note.type) ?: return
    val scope = rememberCoroutineScope()
    val toast = LocalToaster.current
    val decks by data.decks.collectAsState()
    val allCards by data.cards.collectAsState()
    val cards = allCards.filter { it.noteId == note.id }
    val prefs by data.prefs.collectAsState()

    var texts by remember { mutableStateOf(def.fields.associate { f -> f.key to (note.fields[f.key]?.let { v -> if (v is FieldValue.Items) v.value.joinToString("\n") else (v as FieldValue.Text).value } ?: "") }) }
    var deckId by remember { mutableStateOf(note.deckId) }
    var tags by remember { mutableStateOf(note.tags.joinToString(", ")) }
    var confirmDelete by remember { mutableStateOf(false) }
    // Short phrases from AI: shown for review first, written into the field only when the learner takes them.
    var proposal by remember { mutableStateOf<List<String>?>(null) }
    var aiPhrases by remember { mutableStateOf<List<String>?>(null) }
    var aiBusy by remember { mutableStateOf(false) }

    fun value(key: String): FieldValue {
        val f = def.fields.first { it.key == key }
        val t = texts[key].orEmpty()
        return if (f.kind == "list") FieldValue.Items(t.split("\n")) else FieldValue.Text(t)
    }

    val valid = def.fields.filter { it.required }.all { texts[it.key].orEmpty().isNotBlank() }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Sửa từ") },
        text = {
            // AlertDialog already bounds the text slot to the room left by the title and buttons (also when the
            // keyboard shrinks the window), so the form only needs to scroll. A heightIn after verticalScroll would
            // clip the content instead of the viewport and leave nothing to scroll.
            ResizeDialogForKeyboard()
            Column(Modifier.verticalScroll(rememberScrollState()).testTag("note-editor-form"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (f in def.fields) {
                    OutlinedTextField(
                        value = texts[f.key].orEmpty(),
                        onValueChange = { v -> texts = texts + (f.key to v) },
                        label = { Text(f.label + if (note.aiFields.contains(f.key)) " · AI" else "") },
                        placeholder = f.placeholder?.let { p -> { Text(p) } },
                        singleLine = f.kind == "text",
                        minLines = if (f.kind == "list") 2 else 1,
                        modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
                    )
                    if (f.key == "phrases" && aiAvailable && note.type == "vocab") {
                        val offer = proposal
                        if (offer != null) {
                            Column(Modifier.fillMaxWidth().background(Lexi.colors.accentSoft, RoundedCornerShape(14.dp)).padding(12.dp).testTag("phrases-proposal"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("AI đề xuất · xem trước khi dùng", style = MaterialTheme.typography.labelMedium, color = Lexi.colors.accent)
                                for (l in offer) Text(l, color = Lexi.colors.ink)
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                    TextButton(onClick = { proposal = null }) { Text("Bỏ") }
                                    Button(modifier = Modifier.testTag("phrases-use"), onClick = {
                                        texts = texts + ("phrases" to offer.joinToString("\n")); aiPhrases = offer; proposal = null
                                    }) { Text("Dùng ${offer.size} cụm") }
                                }
                            }
                        } else {
                            OutlinedButton(enabled = !aiBusy && texts["word"].orEmpty().isNotBlank(), modifier = Modifier.testTag("ai-phrases"), onClick = {
                                aiBusy = true
                                scope.launch {
                                    try {
                                        val lines = askPhrases(texts["word"].orEmpty().trim(), texts["pos"].orEmpty().trim().ifEmpty { null }, texts["en"].orEmpty().trim().ifEmpty { null }, texts["vi"].orEmpty().trim().ifEmpty { null })
                                            .filter { parsePhrase(it) != null }
                                        if (lines.isEmpty()) toast("AI chưa tạo được cụm ngắn hợp lệ. Hãy thử lại hoặc tự viết.") else proposal = lines
                                    } catch (e: Exception) {
                                        toast(e.message ?: "Không gọi được AI, thử lại sau")
                                    } finally {
                                        aiBusy = false
                                    }
                                }
                            }) { Icon(Icons.Filled.AutoAwesome, null, Modifier.size(16.dp)); Text(if (aiBusy) "  AI đang nghĩ…" else "  AI thêm cụm ngắn (1 lượt)", fontSize = 13.sp) }
                        }
                        Text("Chỉ đổi ô này. Nghĩa, ví dụ và mẹo của bạn không bị đổi, và chưa lưu cho đến khi bạn bấm Lưu.", color = Lexi.colors.muted, fontSize = 13.sp)
                    }
                }
                if (decks.size > 1) {
                    Text("Bộ thẻ", style = MaterialTheme.typography.labelMedium, color = Lexi.colors.muted)
                    Column {
                        for (d in decks) {
                            Row(Modifier.fillMaxWidth()) {
                                androidx.compose.material3.RadioButton(selected = deckId == d.id, onClick = { deckId = d.id })
                                Text(d.name, Modifier.padding(top = 12.dp))
                            }
                        }
                    }
                }
                OutlinedTextField(value = tags, onValueChange = { tags = it }, label = { Text("Thẻ gắn (phân cách bằng dấu phẩy)") }, singleLine = true, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("note-editor-tags"))
                if (cards.isNotEmpty()) {
                    Text("Thẻ ôn tập", style = MaterialTheme.typography.labelMedium, color = Lexi.colors.muted)
                    for (c in cards) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(template(note.type, c.template)?.label ?: c.template, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            if (isLeech(c)) Pill("Khó · quên ${c.lapses}", PillKind.BAD)
                            TextButton(onClick = { scope.launch { data.setSuspended(c, !c.suspended) } }) { Text(if (c.suspended) "Hiện lại" else "Ẩn") }
                        }
                        Text(cardStats(c, prefs), Modifier.testTag("card-info"), style = MaterialTheme.typography.bodySmall, color = Lexi.colors.muted)
                    }
                }
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { confirmDelete = true }) { Text("Xoá từ", color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = onClose) { Text("Huỷ") }
            }
        },
        confirmButton = {
            Button(enabled = valid, modifier = Modifier.testTag("note-editor-save"), onClick = {
                // A field the user edited is no longer "AI": keep the label only on untouched values.
                val untouched = note.aiFields.filter { k -> value(k) == note.fields[k] || (value(k) is FieldValue.Items && note.fields[k] is FieldValue.Items && (value(k) as FieldValue.Items).value.map { it.trim() }.filter { it.isNotEmpty() } == (note.fields[k] as FieldValue.Items).value) }.toMutableList()
                if (aiPhrases != null && (value("phrases") as FieldValue.Items).value.map { it.trim() }.filter { it.isNotEmpty() } == aiPhrases && "phrases" !in untouched) untouched += "phrases"
                scope.launch {
                    data.updateNote(
                        note, fields = def.fields.associate { it.key to value(it.key) }, deckId = deckId, aiFields = untouched,
                        tags = tags.split(",").map { it.trim() }.filter { it.isNotEmpty() }.take(10),
                    )
                    toast("Đã lưu")
                    onClose()
                }
            }) { Text("Lưu") }
        },
    )

    if (confirmDelete) {
        ConfirmDialog(
            title = "Xoá từ này?",
            message = "“${def.title(note)}” và các thẻ ôn tập của nó sẽ bị xoá khỏi mọi thiết bị. Lịch sử ôn tập vẫn được giữ.",
            confirm = "Xoá", destructive = true,
            onConfirm = { confirmDelete = false; scope.launch { data.removeNote(note); toast("Đã xoá từ"); onClose() } },
            onDismiss = { confirmDelete = false },
        )
    }
}

private val STATE_LABEL = mapOf(CardState.NEW to "Mới", CardState.LEARNING to "Đang học", CardState.REVIEW to "Ôn tập", CardState.RELEARNING to "Học lại")
private val DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy")

/** Anki's "card info" in one line: state, interval, recall probability now, difficulty, reps and lapses, due date. */
internal fun cardStats(c: Card, prefs: Prefs, now: Long = System.currentTimeMillis()): String {
    if (c.state == CardState.NEW) return "Chưa học lần nào."
    val elapsed = c.lastReview?.let { maxOf(0.0, (now - it) / Fsrs.DAY_MS.toDouble()) } ?: 0.0
    val recall = if (c.stability > 0) prefs.fsrs().forgettingCurve(elapsed, c.stability) else 1.0
    val interval = if (c.scheduledDays >= 1) "${c.scheduledDays.toInt()} ngày" else "trong ngày"
    val due = Instant.ofEpochMilli(c.due).atZone(ZoneId.systemDefault()).format(DATE)
    return "${STATE_LABEL[c.state]} · khoảng $interval · nhớ ${(recall * 100).toInt()}% · độ khó ${"%.1f".format(c.difficulty)}/10 · ${c.reps} lượt, quên ${c.lapses} · đến hạn $due"
}
