package com.vh.lexi.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.material3.RadioButton
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
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.Edit
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.Card
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.BatchProgress
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Note
import com.vh.lexi.core.batchSummary
import com.vh.lexi.core.BatchMode
import com.vh.lexi.core.hasAi
import com.vh.lexi.core.hasPhrases
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.forgotOf
import androidx.compose.runtime.key
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.filled.Bookmark
import com.vh.lexi.core.isMaterial
import com.vh.lexi.core.noteType
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private enum class Filter(val label: String) { ALL("Tất cả"), NEW("Mới"), LEARNING("Đang học"), REVIEW("Ôn tập"), SUSPENDED("Đã ẩn"), LEECH("Thẻ khó"), FORGOT("Hay quên"), NO_AI("Chưa có AI"), NO_PHRASES("Chưa có cụm ngắn") }

/** The AI dialog: skip words already filled, replace existing meanings (full mode only), and what the AI writes. */
private data class AiDialog(val skipDone: Boolean, val overwrite: Boolean, val mode: BatchMode)

/** Daily AI allowance (LIMITS.dailyEnrich in functions/src/config.ts). */
private const val DAILY_AI = 300
private enum class Sort(val label: String) { RECENT("Mới thêm"), ALPHA("A → Z"), DUE("Sắp đến hạn") }

private fun matches(f: Filter, n: Note, cs: List<Card>) = when (f) {
    Filter.ALL -> true
    Filter.NO_AI -> n.type == "vocab" && !hasAi(n.aiFields)
    Filter.NO_PHRASES -> n.type == "vocab" && !hasPhrases(n.fields)
    Filter.NEW -> cs.any { it.state == CardState.NEW }
    Filter.LEARNING -> cs.any { it.state == CardState.LEARNING || it.state == CardState.RELEARNING }
    Filter.REVIEW -> cs.any { it.state == CardState.REVIEW }
    Filter.SUSPENDED -> cs.any { it.suspended }
    Filter.LEECH -> cs.any(::isLeech)
    Filter.FORGOT -> forgotOf(n).isNotEmpty()
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
    // The note open in the read view ("Xem"): tapping a row opens it, its "Sửa" button opens the editor.
    var viewing by remember { mutableStateOf<String?>(null) }
    var covered by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    var deckDialog by remember { mutableStateOf<Pair<String?, String>?>(null) }
    var confirmDeck by remember { mutableStateOf<com.vh.lexi.core.Deck?>(null) }
    var sortMenu by remember { mutableStateOf(false) }
    var deckMenu by remember { mutableStateOf(false) }
    var selecting by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var aiDialog by remember { mutableStateOf<AiDialog?>(null) }
    // "Chuyển sang bộ khác" dialog for the chosen words.
    var moveDialog by remember { mutableStateOf(false) }
    // The "replace meanings?" question of a starting batch: title, message, answer.
    var overwriteAsk by remember { mutableStateOf<Triple<String, String, CompletableDeferred<Boolean>>?>(null) }
    val now = System.currentTimeMillis()

    val byNote = remember(cards) { cards.groupBy { it.noteId } }
    val rows = remember(notes, byNote, q, deck, filter, sort) {
        val needle = q.trim().lowercase()
        val list = notes.filter { n ->
            val def = noteType(n.type) ?: return@filter false
            isMaterial(n) && (deck == null || n.deckId == deck) && (needle.isEmpty() || def.searchText(n).contains(needle)) && matches(filter, n, byNote[n.id].orEmpty())
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
            Pill("${notes.count { isMaterial(it) }} từ")
            // Compact buttons, and an icon instead of "+ Bộ thẻ": otherwise "Thư viện" has no room on a 320dp phone.
            TextButton(
                onClick = { selecting = !selecting; selected = emptySet() }, Modifier.defaultMinSize(minWidth = 1.dp).testTag("lib-select"),
                contentPadding = PaddingValues(horizontal = 8.dp),
            ) { Text(if (selecting) "Xong" else "Chọn", maxLines = 1, softWrap = false) }
            androidx.compose.material3.IconButton(onClick = { deckDialog = null to "" }, modifier = Modifier.size(40.dp).testTag("lib-new-deck")) {
                Icon(Icons.Filled.CreateNewFolder, contentDescription = "Thêm bộ thẻ")
            }
        }
        OutlinedTextField(value = q, onValueChange = { q = it }, singleLine = true, placeholder = { Text("Tìm từ, nghĩa, ví dụ…") }, modifier = Modifier.fillMaxWidth())
        // A long deck name must shorten itself: it used to squeeze the sort button onto two lines and "Sửa bộ thẻ"
        // to zero width, where its text wrapped one letter per line and left a tall empty band above the filters.
        Row(Modifier.fillMaxWidth().testTag("lib-deck-row"), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.foundation.layout.Box(Modifier.weight(1f, fill = false)) {
                OutlinedButton(onClick = { deckMenu = true }) {
                    Text(decks.firstOrNull { it.id == deck }?.name ?: "Tất cả bộ thẻ", maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                DropdownMenu(expanded = deckMenu, onDismissRequest = { deckMenu = false }) {
                    DropdownMenuItem(text = { Text("Tất cả bộ thẻ") }, onClick = { deck = null; deckMenu = false })
                    for (d in decks) DropdownMenuItem(text = { Text(d.name) }, onClick = { deck = d.id; deckMenu = false })
                }
            }
            androidx.compose.foundation.layout.Box {
                OutlinedButton(onClick = { sortMenu = true }) { Text(sort.label, maxLines = 1, softWrap = false) }
                DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                    for (s in Sort.entries) DropdownMenuItem(text = { Text(s.label) }, onClick = { sort = s; sortMenu = false })
                }
            }
            if (deck != null) androidx.compose.material3.IconButton(
                onClick = { deckDialog = deck to (decks.firstOrNull { it.id == deck }?.name ?: "") }, modifier = Modifier.testTag("deck-edit"),
            ) { Icon(Icons.Filled.Edit, contentDescription = "Sửa bộ thẻ") }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (f in Filter.entries) if ((f != Filter.NO_AI && f != Filter.NO_PHRASES) || aiAvailable) FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(f.label) })
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
                OutlinedButton(onClick = { moveDialog = true }, enabled = selected.isNotEmpty(), modifier = Modifier.testTag("bulk-move"), contentPadding = PaddingValues(horizontal = 12.dp)) {
                    Text("Chuyển bộ", maxLines = 1)
                }
                if (aiAvailable) Button(onClick = { aiDialog = AiDialog(true, false, if (filter == Filter.NO_PHRASES) BatchMode.PHRASES else BatchMode.FULL) }, enabled = vocab > 0 && batch?.running != true, modifier = Modifier.testTag("bulk-ai"), contentPadding = PaddingValues(horizontal = 12.dp)) {
                    Icon(Icons.Filled.AutoAwesome, null); Text(" AI", maxLines = 1)
                }
            }
        }

        if (!loaded) Text("Đang tải…", color = c.muted)
        else if (rows.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (notes.none { isMaterial(it) }) "Thư viện trống" else "Không có kết quả", style = MaterialTheme.typography.titleLarge)
                Text(if (notes.none { isMaterial(it) }) "Thêm từ đầu tiên để bắt đầu." else "Thử đổi từ khoá hoặc bộ lọc.", color = c.muted)
                if (notes.none { isMaterial(it) }) Button(onClick = onAdd) { Text("Thêm từ") }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().testTag("lib-list")) {
                items(rows, key = { it.id }) { n ->
                    val def = noteType(n.type)!!
                    val cs = byNote[n.id].orEmpty()
                    val soon = cs.filter { it.state != CardState.NEW }.minByOrNull { it.due }
                    val picked = n.id in selected
                    Row(
                        Modifier.fillMaxWidth().clickable { if (selecting) { selected = if (picked) selected - n.id else selected + n.id } else viewing = n.id }.padding(vertical = 10.dp).testTag("lib-item"),
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (selecting) Checkbox(checked = picked, onCheckedChange = null) else WordStatus(cs)
                        Column(Modifier.weight(1f)) {
                            // A long title (a grammar sentence) must not squeeze the deck name to zero width: it would wrap one letter per line and stretch the row over the whole screen.
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                                Text(def.title(n), Modifier.weight(1f, fill = false), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(decks.firstOrNull { it.id == n.deckId }?.name.orEmpty(), Modifier.widthIn(max = 110.dp), color = c.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(def.subtitle(n), color = c.muted, maxLines = 1, fontSize = 14.sp)
                        }
                        if (hasAi(n.aiFields)) Pill("AI", PillKind.AI)
                        if (cs.any(::isLeech)) Pill("Khó", PillKind.BAD)
                        if (forgotOf(n).isNotEmpty()) Box(Modifier.size(26.dp).background(c.roseSoft, CircleShape).testTag("lib-forgot"), contentAlignment = Alignment.Center) {
                            Icon(Icons.Filled.Bookmark, "Hay quên", tint = c.roseDeep, modifier = Modifier.size(15.dp))
                        }
                        Pill(if (soon != null) dueLabel(soon, now) else if (cs.isNotEmpty() && cs.all { it.suspended }) "Đã ẩn" else "Mới")
                    }
                    HorizontalDivider(color = c.line)
                }
            }
        }
    }

    if (!selecting) viewing?.let { id ->
        notes.firstOrNull { it.id == id }?.let { n ->
            val i = rows.indexOfFirst { it.id == id }
            fun step(d: Int) {
                if (rows.isEmpty()) return
                viewing = rows[if (i < 0) 0 else (i + d).coerceIn(0, rows.size - 1)].id
            }
            NoteViewScreen(
                note = n, cards = byNote[n.id].orEmpty(), decks = decks, prefs = prefs, index = i, total = rows.size,
                covered = covered, onCover = { covered = it }, onSpeak = app.speech::speak,
                onPrev = { step(-1) }, onNext = { step(1) }, onEdit = { editing = id }, onClose = { viewing = null },
                mark = if (n.type == "vocab") ({ key(n.id) { ForgotButton(app, n) } }) else null,
            )
        }
    }
    editing?.let { id -> notes.firstOrNull { it.id == id }?.let { NoteEditor(data, it, aiAvailable = aiAvailable, askPhrases = { w, pos, en, vi -> app.cloud.enrichPhrases(w, pos, en, vi) }) { editing = null } } }

    aiDialog?.let { dlg ->
        val phrases = dlg.mode == BatchMode.PHRASES
        val ids = notes.filter { it.id in selected && it.type == "vocab" && (!dlg.skipDone || !(if (phrases) hasPhrases(it.fields) else hasAi(it.aiFields))) }.map { it.id }
        val days = maxOf(1, (ids.size + DAILY_AI - 1) / DAILY_AI)
        AlertDialog(
            onDismissRequest = { aiDialog = null },
            title = { Text(if (phrases) "Thêm cụm ngắn cho ${ids.size} từ" else "Điền bằng AI cho ${ids.size} từ") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = !phrases, onClick = { aiDialog = dlg.copy(mode = BatchMode.FULL) }, label = { Text("Điền đầy đủ") })
                        FilterChip(selected = phrases, onClick = { aiDialog = dlg.copy(mode = BatchMode.PHRASES) }, label = { Text("Chỉ cụm ngắn") }, modifier = Modifier.testTag("bulk-mode-phrases"))
                    }
                    if (phrases) {
                        Text("Mỗi từ thêm tối đa 3 cụm 3–5 từ, mỗi cụm một nghĩa (ví dụ accommodate 200 guests: chứa được 200 khách). Thẻ điền từ sẽ hỏi lần lượt từng nghĩa. Nghĩa, ví dụ và mẹo bạn đã có không bị đổi, cụm bạn tự viết cũng được giữ nguyên.")
                    } else {
                        Text("Mỗi từ có tối đa 3 nghĩa theo ngữ cảnh, câu ví dụ kèm bản dịch và một mẹo nhớ ngắn.")
                    }
                    Text(
                        "AI chạy nền, bạn có thể ôn bài trong lúc chờ. Mỗi từ dùng 1 lượt AI (tối đa $DAILY_AI lượt mỗi ngày" +
                            (if (ids.size > DAILY_AI) ", nên khoảng $days ngày: hôm sau lọc “${if (phrases) "Chưa có cụm ngắn" else "Chưa có AI"}” để chạy tiếp" else "") +
                            ") và 1 lần ghi dữ liệu, không tốn thêm lượt đọc.",
                        color = c.muted, fontSize = 13.sp,
                    )
                    Row(Modifier.fillMaxWidth().clickable { aiDialog = dlg.copy(skipDone = !dlg.skipDone) }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = dlg.skipDone, onCheckedChange = null); Text(if (phrases) " Bỏ qua từ đã có cụm ngắn" else " Bỏ qua từ đã điền bằng AI")
                    }
                    if (!phrases) {
                        Row(Modifier.fillMaxWidth().clickable { aiDialog = dlg.copy(overwrite = !dlg.overwrite) }.testTag("bulk-overwrite"), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = dlg.overwrite, onCheckedChange = null); Text(" Thay nghĩa tiếng Việt đang có")
                        }
                        Text("Tắt: chỉ điền chỗ trống, giữ nghĩa bạn đã ghi.", color = c.muted, fontSize = 13.sp)
                    }
                }
            },
            dismissButton = { TextButton(onClick = { aiDialog = null }) { Text("Huỷ") } },
            confirmButton = {
                Button(enabled = ids.isNotEmpty(), modifier = Modifier.testTag("bulk-start"), onClick = {
                    aiDialog = null
                    // On the app scope, so the batch outlives this screen; on Main, because it updates Compose state.
                    app.scope.launch(Dispatchers.Main) {
                        val res = app.aiBatch.confirmAndRun(ids, dlg.overwrite, dlg.mode) { title, message -> CompletableDeferred<Boolean>().also { overwriteAsk = Triple(title, message, it) }.await() }
                        if (res != null) { selecting = false; selected = emptySet(); toast(batchSummary(res)) }
                    }
                }) { Text("Bắt đầu") }
            },
        )
    }

    if (moveDialog) {
        val picked = notes.filter { it.id in selected }
        val from = picked.map { it.deckId }.toSet()
        var target by remember { mutableStateOf(decks.firstOrNull { !(from.size == 1 && it.id in from) }?.id) }
        var newName by remember { mutableStateOf("") }
        var busy by remember { mutableStateOf(false) }
        val already = if (target == null) 0 else picked.count { it.deckId == target }
        val count = picked.size - already
        AlertDialog(
            onDismissRequest = { if (!busy) moveDialog = false },
            title = { Text("Chuyển ${picked.size} từ sang bộ khác") },
            text = {
                ResizeDialogForKeyboard()
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    val names = from.mapNotNull { id -> decks.firstOrNull { it.id == id }?.name }
                    if (names.isNotEmpty()) Text("Đang ở: " + if (names.size > 3) names.take(3).joinToString(", ") + " và ${names.size - 3} bộ khác" else names.joinToString(", "), color = c.muted, fontSize = 13.sp)
                    for (d in decks) {
                        Row(Modifier.fillMaxWidth().clickable { target = d.id }.testTag("move-deck-${d.name}"), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = target == d.id, onClick = null); Text(" ${d.name}", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    Row(Modifier.fillMaxWidth().clickable { target = null }.testTag("move-new"), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = target == null, onClick = null); Text(" + Bộ thẻ mới…")
                    }
                    if (target == null) OutlinedTextField(value = newName, onValueChange = { newName = it.take(60) }, singleLine = true, label = { Text("Tên bộ thẻ mới") }, modifier = Modifier.fillMaxWidth().testTag("move-name"))
                    Text("Lịch ôn, độ nhớ và lịch sử trả lời của từng thẻ được giữ nguyên; chỉ đổi bộ thẻ." + if (already > 0) " $already từ đã ở bộ này nên bỏ qua." else "", color = c.muted, fontSize = 13.sp)
                }
            },
            dismissButton = { TextButton(onClick = { moveDialog = false }, enabled = !busy) { Text("Huỷ") } },
            confirmButton = {
                Button(
                    enabled = !busy && (if (target == null) newName.isNotBlank() else count > 0),
                    modifier = Modifier.testTag("move-start"),
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val deck = target?.let { id -> decks.firstOrNull { it.id == id } } ?: data.createDeck(newName)
                                val moved = data.moveNotes(selected, deck.id)
                                moveDialog = false; selecting = false; selected = emptySet()
                                toast(if (moved > 0) "Đã chuyển $moved từ sang “${deck.name}”" else "Các từ đã chọn đều đã ở “${deck.name}”")
                            } catch (e: Exception) {
                                toast("Không chuyển được: ${e.message}")
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) { Text(if (target == null) "Tạo bộ và chuyển ${picked.size} từ" else "Chuyển $count từ") }
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
                if (b.running) "${if (b.mode == BatchMode.PHRASES) "Đang thêm cụm ngắn" else "Đang điền AI"} ${b.done + b.failed}/${b.total} từ" + (if (b.failed > 0) " · ${b.failed} lỗi" else "") else batchSummary(b),
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
