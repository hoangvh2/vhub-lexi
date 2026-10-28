package com.vh.lexi.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.unit.dp
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.Note
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.noteType
import com.vh.lexi.core.template
import com.vh.lexi.data.LexiData
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.launch

/** Edits any note through its registered field list, so new note types need no new editor. */
@Composable
fun NoteEditor(data: LexiData, note: Note, onClose: () -> Unit) {
    val def = noteType(note.type) ?: return
    val scope = rememberCoroutineScope()
    val toast = LocalToaster.current
    val decks by data.decks.collectAsState()
    val allCards by data.cards.collectAsState()
    val cards = allCards.filter { it.noteId == note.id }

    var texts by remember { mutableStateOf(def.fields.associate { f -> f.key to (note.fields[f.key]?.let { v -> if (v is FieldValue.Items) v.value.joinToString("\n") else (v as FieldValue.Text).value } ?: "") }) }
    var deckId by remember { mutableStateOf(note.deckId) }
    var tags by remember { mutableStateOf(note.tags.joinToString(", ")) }
    var confirmDelete by remember { mutableStateOf(false) }

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
            Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 460.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (f in def.fields) {
                    OutlinedTextField(
                        value = texts[f.key].orEmpty(),
                        onValueChange = { v -> texts = texts + (f.key to v) },
                        label = { Text(f.label + if (note.aiFields.contains(f.key)) " · AI" else "") },
                        singleLine = f.kind == "text",
                        minLines = if (f.kind == "list") 2 else 1,
                        modifier = Modifier.fillMaxWidth(),
                    )
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
                OutlinedTextField(value = tags, onValueChange = { tags = it }, label = { Text("Thẻ gắn (phân cách bằng dấu phẩy)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (cards.isNotEmpty()) {
                    Text("Thẻ ôn tập", style = MaterialTheme.typography.labelMedium, color = Lexi.colors.muted)
                    for (c in cards) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(template(note.type, c.template)?.label ?: c.template, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            if (isLeech(c)) Pill("Khó · quên ${c.lapses}", PillKind.BAD)
                            TextButton(onClick = { scope.launch { data.setSuspended(c, !c.suspended) } }) { Text(if (c.suspended) "Hiện lại" else "Ẩn") }
                        }
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
            Button(enabled = valid, onClick = {
                // A field the user edited is no longer "AI": keep the label only on untouched values.
                val untouched = note.aiFields.filter { k -> value(k) == note.fields[k] || (value(k) is FieldValue.Items && note.fields[k] is FieldValue.Items && (value(k) as FieldValue.Items).value.map { it.trim() }.filter { it.isNotEmpty() } == (note.fields[k] as FieldValue.Items).value) }
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
