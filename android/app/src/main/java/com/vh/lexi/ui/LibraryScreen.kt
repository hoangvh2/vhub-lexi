package com.vh.lexi.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.noteType
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.launch

private enum class Filter(val label: String) { ALL("Tất cả"), NEW("Mới"), LEARNING("Đang học"), REVIEW("Ôn tập"), SUSPENDED("Đã ẩn"), LEECH("Thẻ khó") }
private enum class Sort(val label: String) { RECENT("Mới thêm"), ALPHA("A → Z"), DUE("Sắp đến hạn") }

private fun matches(f: Filter, cs: List<Card>) = when (f) {
    Filter.ALL -> true
    Filter.NEW -> cs.any { it.state == CardState.NEW }
    Filter.LEARNING -> cs.any { it.state == CardState.LEARNING || it.state == CardState.RELEARNING }
    Filter.REVIEW -> cs.any { it.state == CardState.REVIEW }
    Filter.SUSPENDED -> cs.any { it.suspended }
    Filter.LEECH -> cs.any(::isLeech)
}

private fun dueLabel(c: Card, now: Long): String = when {
    c.suspended -> "Đã ẩn"
    c.state == CardState.NEW -> "Mới"
    c.due <= now -> "Đến hạn"
    else -> "sau " + Fsrs.formatInterval(c.due - now)
}

@Composable
fun LibraryScreen(app: LexiApp, onAdd: () -> Unit) {
    val data = app.data
    val toast = LocalToaster.current
    val scope = rememberCoroutineScope()
    val notes by data.notes.collectAsState()
    val cards by data.cards.collectAsState()
    val decks by data.decks.collectAsState()
    val loaded by data.loaded.collectAsState()

    var q by remember { mutableStateOf("") }
    var deck by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf(Filter.ALL) }
    var sort by remember { mutableStateOf(Sort.RECENT) }
    var editing by remember { mutableStateOf<String?>(null) }
    var deckDialog by remember { mutableStateOf<Pair<String?, String>?>(null) }
    var confirmDeck by remember { mutableStateOf<com.vh.lexi.core.Deck?>(null) }
    var sortMenu by remember { mutableStateOf(false) }
    var deckMenu by remember { mutableStateOf(false) }
    val now = System.currentTimeMillis()

    val byNote = remember(cards) { cards.groupBy { it.noteId } }
    val rows = remember(notes, byNote, q, deck, filter, sort) {
        val needle = q.trim().lowercase()
        val list = notes.filter { n ->
            val def = noteType(n.type) ?: return@filter false
            (deck == null || n.deckId == deck) && (needle.isEmpty() || def.searchText(n).contains(needle)) && matches(filter, byNote[n.id].orEmpty())
        }
        when (sort) {
            Sort.RECENT -> list.sortedByDescending { it.createdAt }
            Sort.ALPHA -> list.sortedBy { noteType(it.type)!!.title(it).lowercase() }
            Sort.DUE -> list.sortedBy { n -> byNote[n.id].orEmpty().filter { it.state != CardState.NEW }.minOfOrNull { it.due } ?: Long.MAX_VALUE }
        }
    }
    val c = Lexi.colors

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ScreenHeader("Thư viện") {
            Pill("${notes.size} từ")
            OutlinedButton(onClick = { deckDialog = null to "" }) { Text("+ Bộ thẻ", fontSize = 13.sp) }
        }
        OutlinedTextField(value = q, onValueChange = { q = it }, singleLine = true, placeholder = { Text("Tìm từ, nghĩa, ví dụ…") }, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.foundation.layout.Box {
                OutlinedButton(onClick = { deckMenu = true }) { Text(decks.firstOrNull { it.id == deck }?.name ?: "Tất cả bộ thẻ", maxLines = 1) }
                DropdownMenu(expanded = deckMenu, onDismissRequest = { deckMenu = false }) {
                    DropdownMenuItem(text = { Text("Tất cả bộ thẻ") }, onClick = { deck = null; deckMenu = false })
                    for (d in decks) DropdownMenuItem(text = { Text(d.name) }, onClick = { deck = d.id; deckMenu = false })
                }
            }
            androidx.compose.foundation.layout.Box {
                OutlinedButton(onClick = { sortMenu = true }) { Text(sort.label) }
                DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                    for (s in Sort.entries) DropdownMenuItem(text = { Text(s.label) }, onClick = { sort = s; sortMenu = false })
                }
            }
            if (deck != null) TextButton(onClick = { deckDialog = deck to (decks.firstOrNull { it.id == deck }?.name ?: "") }) { Text("Sửa bộ thẻ") }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (f in Filter.entries) FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(f.label) })
        }

        if (!loaded) Text("Đang tải…", color = c.muted)
        else if (rows.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (notes.isEmpty()) "Thư viện trống" else "Không có kết quả", style = MaterialTheme.typography.titleLarge)
                Text(if (notes.isEmpty()) "Thêm từ đầu tiên để bắt đầu." else "Thử đổi từ khoá hoặc bộ lọc.", color = c.muted)
                if (notes.isEmpty()) Button(onClick = onAdd) { Text("Thêm từ") }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                items(rows, key = { it.id }) { n ->
                    val def = noteType(n.type)!!
                    val cs = byNote[n.id].orEmpty()
                    val soon = cs.filter { it.state != CardState.NEW }.minByOrNull { it.due }
                    Row(Modifier.fillMaxWidth().clickable { editing = n.id }.padding(vertical = 10.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Column(Modifier.weight(1f)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(def.title(n), fontWeight = FontWeight.Bold)
                                Text(decks.firstOrNull { it.id == n.deckId }?.name.orEmpty(), color = c.muted, fontSize = 12.sp)
                            }
                            Text(def.subtitle(n), color = c.muted, maxLines = 1, fontSize = 14.sp)
                        }
                        if (cs.any(::isLeech)) Pill("Khó", PillKind.BAD)
                        Pill(if (soon != null) dueLabel(soon, now) else if (cs.isNotEmpty() && cs.all { it.suspended }) "Đã ẩn" else "Mới")
                    }
                    HorizontalDivider(color = c.line)
                }
            }
        }
    }

    editing?.let { id -> notes.firstOrNull { it.id == id }?.let { NoteEditor(data, it) { editing = null } } }

    deckDialog?.let { (id, name0) ->
        var name by remember(id) { mutableStateOf(name0) }
        AlertDialog(
            onDismissRequest = { deckDialog = null },
            title = { Text(if (id == null) "Bộ thẻ mới" else "Sửa bộ thẻ") },
            text = {
                ResizeDialogForKeyboard()
                OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true, label = { Text("Tên bộ thẻ") })
            },
            dismissButton = {
                Row {
                    if (id != null) TextButton(onClick = { confirmDeck = decks.firstOrNull { it.id == id }; deckDialog = null }) { Text("Xoá bộ thẻ", color = MaterialTheme.colorScheme.error) }
                    TextButton(onClick = { deckDialog = null }) { Text("Huỷ") }
                }
            },
            confirmButton = {
                Button(enabled = name.isNotBlank(), onClick = {
                    scope.launch {
                        if (id == null) data.createDeck(name) else decks.firstOrNull { it.id == id }?.let { data.renameDeck(it, name) }
                    }
                    deckDialog = null
                }) { Text("Lưu") }
            },
        )
    }

    confirmDeck?.let { d ->
        val count = notes.count { it.deckId == d.id }
        ConfirmDialog(
            title = "Xoá bộ “${d.name}”?",
            message = if (count > 0) "$count từ trong bộ này và toàn bộ thẻ ôn tập của chúng sẽ bị xoá khỏi mọi thiết bị." else "Bộ thẻ trống sẽ bị xoá.",
            confirm = "Xoá bộ thẻ", destructive = true,
            onConfirm = { confirmDeck = null; scope.launch { data.deleteDeckAndContents(d.id); if (deck == d.id) deck = null; toast("Đã xoá bộ thẻ") } },
            onDismiss = { confirmDeck = null },
        )
    }
}
