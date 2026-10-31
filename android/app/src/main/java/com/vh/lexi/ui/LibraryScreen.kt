package com.vh.lexi.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.Card
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.BatchProgress
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Note
import com.vh.lexi.core.batchSummary
import com.vh.lexi.core.hasAi
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.noteType
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private enum class Filter(val label: String) { ALL("Tất cả"), NEW("Mới"), LEARNING("Đang học"), REVIEW("Ôn tập"), SUSPENDED("Đã ẩn"), LEECH("Thẻ khó"), NO_AI("Chưa có AI") }
private enum class Sort(val label: String) { RECENT("Mới thêm"), ALPHA("A → Z"), DUE("Sắp đến hạn") }

private fun matches(f: Filter, n: Note, cs: List<Card>) = when (f) {
    Filter.ALL -> true
    Filter.NO_AI -> n.type == "vocab" && !hasAi(n.aiFields)
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
    val prefs by data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()
    val batch by app.aiBatch.progress.collectAsState()
    val aiAvailable = account is Account.SignedIn && prefs.aiEnabled

    var q by remember { mutableStateOf("") }
    var deck by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf(Filter.ALL) }
    var sort by remember { mutableStateOf(Sort.RECENT) }
    var editing by remember { mutableStateOf<String?>(null) }
    var deckDialog by remember { mutableStateOf<Pair<String?, String>?>(null) }
    var confirmDeck by remember { mutableStateOf<com.vh.lexi.core.Deck?>(null) }
    var sortMenu by remember { mutableStateOf(false) }
    var deckMenu by remember { mutableStateOf(false) }
    var selecting by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    // The AI dialog: (skip words AI already filled, replace existing meanings).
    var aiDialog by remember { mutableStateOf<Pair<Boolean, Boolean>?>(null) }
    // The "replace meanings?" question of a starting batch: title, message, answer.
    var overwriteAsk by remember { mutableStateOf<Triple<String, String, CompletableDeferred<Boolean>>?>(null) }
    val now = System.currentTimeMillis()

    val byNote = remember(cards) { cards.groupBy { it.noteId } }
    val rows = remember(notes, byNote, q, deck, filter, sort) {
        val needle = q.trim().lowercase()
        val list = notes.filter { n ->
            val def = noteType(n.type) ?: return@filter false
            (deck == null || n.deckId == deck) && (needle.isEmpty() || def.searchText(n).contains(needle)) && matches(filter, n, byNote[n.id].orEmpty())
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
            if (aiAvailable) TextButton(onClick = { selecting = !selecting; selected = emptySet() }, Modifier.testTag("lib-select")) { Text(if (selecting) "Xong" else "Chọn") }
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
            for (f in Filter.entries) if (f != Filter.NO_AI || aiAvailable) FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(f.label) })
        }
        batch?.let { BatchCard(it, onStop = app.aiBatch::stop, onClose = app.aiBatch::dismiss) }
        if (selecting) {
            val vocab = selected.count { id -> notes.any { it.id == id && it.type == "vocab" } }
            Row(
                Modifier.fillMaxWidth().background(c.surface, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 6.dp).testTag("bulk-bar"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("${selected.size} đã chọn", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                val all = selected.size == rows.size && rows.isNotEmpty()
                TextButton(onClick = { selected = if (all) emptySet() else rows.map { it.id }.toSet() }) { Text(if (all) "Bỏ chọn" else "Chọn hết ${rows.size}", maxLines = 1) }
                Button(onClick = { aiDialog = true to false }, enabled = vocab > 0 && batch?.running != true, modifier = Modifier.testTag("bulk-ai")) {
                    Icon(Icons.Filled.AutoAwesome, null); Text(" AI", maxLines = 1)
                }
            }
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
                    val picked = n.id in selected
                    Row(
                        Modifier.fillMaxWidth().clickable { if (selecting) { selected = if (picked) selected - n.id else selected + n.id } else editing = n.id }.padding(vertical = 10.dp),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (selecting) Checkbox(checked = picked, onCheckedChange = null) else WordStatus(cs)
                        Column(Modifier.weight(1f)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(def.title(n), fontWeight = FontWeight.Bold)
                                Text(decks.firstOrNull { it.id == n.deckId }?.name.orEmpty(), color = c.muted, fontSize = 12.sp)
                            }
                            Text(def.subtitle(n), color = c.muted, maxLines = 1, fontSize = 14.sp)
                        }
                        if (hasAi(n.aiFields)) Pill("AI", PillKind.AI)
                        if (cs.any(::isLeech)) Pill("Khó", PillKind.BAD)
                        Pill(if (soon != null) dueLabel(soon, now) else if (cs.isNotEmpty() && cs.all { it.suspended }) "Đã ẩn" else "Mới")
                    }
                    HorizontalDivider(color = c.line)
                }
            }
        }
    }

    editing?.let { id -> notes.firstOrNull { it.id == id }?.let { NoteEditor(data, it) { editing = null } } }

    aiDialog?.let { (skipDone, overwrite) ->
        val ids = notes.filter { it.id in selected && it.type == "vocab" && (!skipDone || !hasAi(it.aiFields)) }.map { it.id }
        AlertDialog(
            onDismissRequest = { aiDialog = null },
            title = { Text("Điền bằng AI cho ${ids.size} từ") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Mỗi từ có tối đa 3 nghĩa theo ngữ cảnh, câu ví dụ kèm bản dịch và một truyện chêm. AI chạy nền, bạn có thể ôn bài trong lúc chờ. Mỗi từ dùng 1 lượt AI, tối đa 300 lượt mỗi ngày.")
                    Row(Modifier.fillMaxWidth().clickable { aiDialog = !skipDone to overwrite }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = skipDone, onCheckedChange = null); Text(" Bỏ qua từ đã điền bằng AI")
                    }
                    Row(Modifier.fillMaxWidth().clickable { aiDialog = skipDone to !overwrite }.testTag("bulk-overwrite"), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = overwrite, onCheckedChange = null); Text(" Thay nghĩa tiếng Việt đang có")
                    }
                    Text("Tắt: chỉ điền chỗ trống, giữ nghĩa bạn đã ghi.", color = c.muted, fontSize = 13.sp)
                }
            },
            dismissButton = { TextButton(onClick = { aiDialog = null }) { Text("Huỷ") } },
            confirmButton = {
                Button(enabled = ids.isNotEmpty(), modifier = Modifier.testTag("bulk-start"), onClick = {
                    aiDialog = null
                    // On the app scope, so the batch outlives this screen; on Main, because it updates Compose state.
                    app.scope.launch(Dispatchers.Main) {
                        val res = app.aiBatch.confirmAndRun(ids, overwrite) { title, message -> CompletableDeferred<Boolean>().also { overwriteAsk = Triple(title, message, it) }.await() }
                        if (res != null) { selecting = false; selected = emptySet(); toast(batchSummary(res)) }
                    }
                }) { Text("Bắt đầu") }
            },
        )
    }

    overwriteAsk?.let { (title, message, ask) ->
        ConfirmDialog(
            title = title, message = message,
            confirm = "Thay và chạy", destructive = true,
            onConfirm = { overwriteAsk = null; ask.complete(true) },
            onDismiss = { overwriteAsk = null; ask.complete(false) },
        )
    }

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

/** Progress of the AI batch, shown while it runs and until dismissed. */
@Composable
private fun BatchCard(b: BatchProgress, onStop: () -> Unit, onClose: () -> Unit) {
    val c = Lexi.colors
    Column(Modifier.fillMaxWidth().background(c.accentSoft, RoundedCornerShape(14.dp)).padding(12.dp).testTag("batch"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.AutoAwesome, null, tint = c.accent)
            Text(
                if (b.running) "Đang điền AI ${b.done + b.failed}/${b.total} từ" + (if (b.failed > 0) " · ${b.failed} lỗi" else "") else batchSummary(b),
                Modifier.weight(1f), fontSize = 14.sp,
            )
            if (b.running) OutlinedButton(onClick = onStop, Modifier.testTag("batch-stop")) { Text("Dừng") } else TextButton(onClick = onClose) { Text("Đóng") }
        }
        LinearProgressIndicator(
            progress = { if (b.total == 0) 0f else (b.done + b.failed).toFloat() / b.total },
            Modifier.fillMaxWidth().height(6.dp), color = c.accent, trackColor = c.surface, gapSize = 0.dp, drawStopIndicator = {},
        )
    }
}

/** How far along a word is (Library.tsx WordStatus): not started, being learnt, or known (every card at a 21-day interval or more). */
@Composable
private fun WordStatus(cs: List<Card>) {
    val c = Lexi.colors
    val live = cs.filter { !it.suspended }
    val st = when {
        live.isEmpty() || live.all { it.state == CardState.NEW } -> "Chưa học"
        live.all { it.state == CardState.REVIEW && it.scheduledDays >= 21 } -> "Đã thuộc"
        else -> "Đang học"
    }
    val color = when (st) { "Đã thuộc" -> c.good; "Đang học" -> c.hard; else -> c.line }
    androidx.compose.foundation.layout.Box(
        Modifier.size(20.dp).border(2.dp, color, androidx.compose.foundation.shape.CircleShape)
            .drawBehind {
                when (st) {
                    "Đã thuộc" -> drawCircle(color)
                    "Đang học" -> drawArc(color, -90f, 180f, useCenter = true)
                }
            }
            .semantics { contentDescription = st }.testTag("word-status"),
    )
}
