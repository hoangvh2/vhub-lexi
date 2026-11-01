package com.vh.lexi.ui

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.AiError
import com.vh.lexi.core.Deck
import com.vh.lexi.core.ExtractedPassage
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.IMPORT_TOPICS
import com.vh.lexi.core.ImportDraft
import com.vh.lexi.core.LETTERS
import com.vh.lexi.core.POS_NAMES
import com.vh.lexi.core.PRACTICE_DECK
import com.vh.lexi.core.PROBLEM_TEXT
import com.vh.lexi.core.aiFields
import com.vh.lexi.core.answer
import com.vh.lexi.core.analyze
import com.vh.lexi.core.buildIndex
import com.vh.lexi.core.completeSentence
import com.vh.lexi.core.draftsFrom
import com.vh.lexi.core.existingSentences
import com.vh.lexi.core.grammarFields
import com.vh.lexi.core.latestTestName
import com.vh.lexi.core.problems
import com.vh.lexi.core.recommended
import com.vh.lexi.core.sentenceAround
import com.vh.lexi.core.testTag
import com.vh.lexi.core.viFor
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.util.Images
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MAX_IMAGES = 6

/** A word of a passage the learner does not have yet, with what the offline dictionary suggests. */
private data class WordRow(val key: String, val count: Int, val sentence: String, val vi: String, val en: String, val ipa: String, val pos: String, val picked: Boolean = false) {
    val usable get() = vi.isNotBlank() || en.isNotBlank()
}

private data class PassageView(val label: String, val coverage: Int?, val words: List<WordRow>)

/**
 * Nhập nhanh từ đề (web: ImportPanel.tsx): screenshots of the questions the learner missed, or their pasted text, are read by
 * the `extract-questions` function; each question becomes a row to check, and only rows the learner keeps become grammar
 * cards. A reading passage goes to the unknown-words check, and the words picked there become vocabulary cards. The AI only
 * proposes: nothing is saved before the learner has seen the row.
 */
@Composable
fun ImportScreen(app: LexiApp, onClose: () -> Unit) {
    val context = LocalContext.current
    val data = app.data
    val toast = LocalToaster.current
    val scope = rememberCoroutineScope()
    val notes by data.notes.collectAsState()
    val cards by data.cards.collectAsState()
    val prefs by data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()
    val shared by app.pendingShare.collectAsState()
    val c = Lexi.colors
    val available = account is Account.SignedIn && prefs.aiEnabled

    var uris by remember { mutableStateOf(listOf<Uri>()) }
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<ImportDraft>?>(null) }
    var passages by remember { mutableStateOf(listOf<ExtractedPassage>()) }
    var skipped by remember { mutableStateOf(0) }
    var view by remember { mutableStateOf<PassageView?>(null) }
    var saving by remember { mutableStateOf(false) }

    // Where the cards go: an existing deck, or a new one made on first save. The default is a deck of their own.
    val decks by data.decks.collectAsState()
    var pickedDeck by remember { mutableStateOf<String?>(null) }
    var newDeck by remember { mutableStateOf<String?>(null) }
    val selectedId = pickedDeck?.takeIf { id -> decks.any { it.id == id } } ?: decks.firstOrNull { it.name == PRACTICE_DECK }?.id
    val newName: String? = newDeck ?: if (selectedId == null) PRACTICE_DECK else null
    suspend fun resolveDeck(): String? {
        val name = newName
        if (name != null) {
            val n = name.trim()
            if (n.isEmpty()) return null
            val d = data.createDeck(n)
            pickedDeck = d.id
            newDeck = null
            return d.id
        }
        return selectedId
    }
    val picker: @Composable () -> Unit = {
        DeckPicker(decks, selectedId, newName, onPick = { pickedDeck = it; newDeck = null }, onNew = { newDeck = it }, onExisting = { decks.firstOrNull()?.let { d -> pickedDeck = d.id; newDeck = null } })
    }

    val testName = remember(notes) { latestTestName(notes) }
    val existing = remember(notes) { existingSentences(notes) }

    BackHandler { if (view != null) view = null else onClose() }

    LaunchedEffect(shared) {
        if (shared.isNotEmpty()) {
            uris = (uris + shared).distinct().take(MAX_IMAGES)
            app.pendingShare.value = emptyList()
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_IMAGES)) { picked ->
        uris = (uris + picked).distinct().take(MAX_IMAGES)
    }

    fun run() {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try {
                val encoded = withContext(Dispatchers.IO) { uris.mapNotNull { Images.encode(context, it) } }
                if (uris.isNotEmpty() && encoded.size < uris.size) { error = "Không đọc được một số ảnh. Thử chụp lại hoặc chọn ảnh khác."; return@launch }
                val r = app.cloud.extractQuestions(encoded, text.trim())
                val (drafts, sk) = draftsFrom(r, existing)
                if (drafts.isEmpty() && r.passages.isEmpty()) error = "Không thấy câu hỏi nào trong nội dung này. Thử ảnh rõ hơn hoặc dán văn bản."
                else { rows = drafts; passages = r.passages; skipped = sk }
            } catch (e: CancellationException) {
                throw e
            } catch (e: AiError) {
                error = e.message ?: "Chưa đọc được."
            } catch (_: Exception) {
                error = "Chưa đọc được. Kiểm tra mạng rồi thử lại, hoặc dán văn bản thay cho ảnh."
            } finally {
                busy = false
            }
        }
    }

    fun reset() { rows = null; passages = emptyList(); skipped = 0; uris = emptyList(); text = ""; error = ""; view = null }

    fun patch(key: String, change: (ImportDraft) -> ImportDraft) { rows = rows?.map { if (it.key == key) change(it) else it } }

    fun saveRows() {
        val current = rows ?: return
        val chosen = current.filter { it.include && it.problems(existing).block.isEmpty() }
        if (chosen.isEmpty() || saving) return
        saving = true
        scope.launch {
            try {
                val tags = listOf("ngu-phap") + listOfNotNull(testName?.let(::testTag))
                val deckId = resolveDeck()
                for (d in chosen) data.addNote("grammar", d.grammarFields().mapValues { FieldValue.Text(it.value) }, deckId = deckId, aiFields = d.aiFields(), tags = tags)
                toast("Đã thêm ${chosen.size} thẻ ngữ pháp" + (testName?.let { " · $it" } ?: ""))
                val done = chosen.map { it.key }.toSet()
                val left = current.filter { it.key !in done }
                if (left.isEmpty() && passages.isEmpty()) reset() else rows = left
            } finally {
                saving = false
            }
        }
    }

    fun openPassage(p: ExtractedPassage) {
        scope.launch {
            val a = withContext(Dispatchers.Default) {
                val an = analyze(p.text, buildIndex(notes, cards))
                val list = an.unknown.sortedWith(compareByDescending<com.vh.lexi.core.UnknownWord> { it.count }.thenBy { it.key }).take(60).map { u ->
                    val look = app.dictionary.lookup(u.key)
                    val first = look?.entry?.pos?.firstOrNull()
                    val pos = first?.let { POS_NAMES[it.pos] ?: it.pos } ?: ""
                    WordRow(
                        key = look?.entry?.word ?: u.key, count = u.count, sentence = sentenceAround(p.text, u.first.start),
                        vi = look?.entry?.viFor(pos).orEmpty(), en = first?.senses?.firstOrNull()?.def.orEmpty(), ipa = look?.entry?.ipa.orEmpty(), pos = pos,
                    )
                }
                PassageView(p.label.ifEmpty { "Đoạn đọc" }, an.coverage?.let { Math.round(it * 100).toInt() }, list)
            }
            view = a
        }
    }

    fun saveWords() {
        val v = view ?: return
        val chosen = v.words.filter { it.picked && it.usable }
        if (chosen.isEmpty() || saving) return
        saving = true
        scope.launch {
            try {
                val tags = listOfNotNull(testName?.let(::testTag))
                val deckId = resolveDeck()
                for (w in chosen) {
                    val fields = mapOf<String, FieldValue>(
                        "word" to FieldValue.Text(w.key), "ipa" to FieldValue.Text(w.ipa), "pos" to FieldValue.Text(w.pos),
                        "vi" to FieldValue.Text(w.vi), "en" to FieldValue.Text(w.en), "examples" to FieldValue.Items(listOf(w.sentence)),
                    )
                    data.addNote("vocab", fields, deckId = deckId, tags = tags)
                }
                toast("Đã thêm ${chosen.size} từ" + (testName?.let { " · $it" } ?: ""))
                val picked = chosen.map { it.key }.toSet()
                view = v.copy(words = v.words.filter { it.key !in picked })
            } finally {
                saving = false
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp).testTag("import-screen"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenHeader("Nhập từ đề thi") { TextButton(onClick = { if (view != null) view = null else onClose() }) { Text(if (view != null) "Quay lại" else "Đóng") } }

        val v = view
        if (v != null) {
            WordsView(v, saving, testName, picker, onToggle = { key -> view = v.copy(words = v.words.map { if (it.key == key) it.copy(picked = !it.picked) else it }) }, onSave = ::saveWords)
            return@Column
        }

        if (rows == null && passages.isEmpty()) {
            Panel(Modifier.testTag("import-input")) {
                Text("Ảnh chụp cả đáp án đúng (màu xanh) và lựa chọn sai của bạn (màu đỏ) thì AI tự nhận ra. Đoạn đọc dài: chụp nhiều ảnh nối tiếp, AI ghép lại. Mỗi lần dùng khoảng 2–3 lượt AI trong 300 lượt/ngày; ảnh chỉ dùng cho lần đọc này, không được lưu.", fontSize = 13.sp, color = c.muted)
                if (uris.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    uris.forEachIndexed { i, u -> Thumb(u) { uris = uris.filterIndexed { k, _ -> k != i } } }
                }
                OutlinedButton(
                    onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = uris.size < MAX_IMAGES, modifier = Modifier.fillMaxWidth().testTag("import-pick"),
                ) { Icon(Icons.Filled.AddPhotoAlternate, null); Text("  Chọn ảnh (${uris.size}/$MAX_IMAGES)") }
                OutlinedTextField(
                    value = text, onValueChange = { text = it.take(12_000) }, minLines = 3, maxLines = 8, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("import-text"),
                    label = { Text("Hoặc dán văn bản của câu hỏi") },
                    placeholder = { Text("vd: 101. ___ you need any help, please call us. (A) Should (B) Because  Đáp án: A") },
                )
                if (error.isNotEmpty()) Pill(error, PillKind.BAD, wrap = true)
                if (!available) Text("Cần đăng nhập Google và bật “Điền bằng AI” trong Cài đặt để dùng tính năng này.", fontSize = 13.sp, color = c.muted)
                Button(onClick = ::run, enabled = available && !busy && (uris.isNotEmpty() || text.trim().length >= 20), modifier = Modifier.fillMaxWidth().testTag("import-run")) {
                    Icon(Icons.Filled.AutoAwesome, null); Text(if (busy) "  Đang đọc…" else "  Đọc câu hỏi")
                }
            }
            return@Column
        }

        val list = rows.orEmpty()
        if (list.isNotEmpty()) {
            val chosen = list.count { it.include && it.problems(existing).block.isEmpty() }
            picker()
            Text("Câu ngữ pháp (${list.size})", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            Text("Kiểm tra từng câu với đề gốc. Câu có cảnh báo được bỏ chọn sẵn.", fontSize = 13.sp, color = c.muted)
            for (d in list) DraftCard(d, existing) { next -> patch(d.key) { next } }
            Button(onClick = ::saveRows, enabled = chosen > 0 && !saving, modifier = Modifier.fillMaxWidth().testTag("import-save")) { Icon(Icons.Filled.Check, null); Text("  Lưu $chosen thẻ") }
        }
        if (skipped > 0) Text("$skipped câu hiểu bài / chèn câu không thành thẻ ngữ pháp; đoạn đọc của chúng ở bên dưới.", fontSize = 13.sp, color = c.muted)
        if (passages.isNotEmpty()) {
            Text("Đoạn đọc (${passages.size})", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
            for (p in passages) Panel(Modifier.testTag("import-passage")) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(p.label.ifEmpty { "Đoạn ${p.id}" }, Modifier.weight(1f), fontWeight = FontWeight.Bold)
                    if (p.truncated) Pill("Có thể bị cắt", PillKind.WARN)
                }
                if (p.truncated) Text("Ảnh có vẻ thiếu phần cuối của đoạn: chụp thêm rồi đọc lại.", fontSize = 12.sp, color = c.muted)
                Text(p.text, maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = 13.sp, color = c.muted)
                OutlinedButton(onClick = { openPassage(p) }, Modifier.testTag("import-use-passage")) { Text("Tìm từ lạ trong đoạn này") }
            }
        }
        TextButton(onClick = ::reset) { Text(if (list.isEmpty()) "Xong" else "Làm lại") }
    }
}

@Composable
private fun Thumb(uri: Uri, onRemove: () -> Unit) {
    val context = LocalContext.current
    var bmp by remember(uri) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(uri) { bmp = withContext(Dispatchers.IO) { Images.thumbnail(context, uri)?.asImageBitmap() } }
    Box(Modifier.size(width = 84.dp, height = 112.dp).clip(RoundedCornerShape(12.dp)).background(Lexi.colors.surface2)) {
        bmp?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter) }
        IconButton(onClick = onRemove, Modifier.align(Alignment.TopEnd).size(32.dp)) { Icon(Icons.Filled.Close, "Bỏ ảnh") }
    }
}

@Composable
private fun DraftCard(d: ImportDraft, existing: Set<String>, onChange: (ImportDraft) -> Unit) {
    val c = Lexi.colors
    val pr = d.problems(existing)
    val blocked = pr.block.isNotEmpty()
    var open by remember(d.key) { mutableStateOf(false) }
    // A rule and a translation written for one answer are wrong for another, unless the learner wrote them.
    fun withAnswer(letter: String): ImportDraft {
        val next = d.copy(correct = letter, rule = if ("rule" in d.edited) d.rule else "", translation = if ("translation" in d.edited) d.translation else "")
        return next.copy(include = next.recommended(existing))
    }
    fun edit(key: String, change: ImportDraft): ImportDraft = change.copy(edited = if (key in change.edited) change.edited else change.edited + key)

    Panel(Modifier.testTag("import-draft")) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Checkbox(checked = d.include && !blocked, onCheckedChange = { onChange(d.copy(include = it)) }, enabled = !blocked, modifier = Modifier.testTag("draft-include"))
            Text(
                (d.number?.let { "Câu $it. " } ?: "") + completeSentence(d.stem, d.answer()).ifEmpty { d.stem },
                Modifier.weight(1f).padding(top = 12.dp), fontSize = 15.sp,
            )
        }
        for (k in pr.block) Pill(PROBLEM_TEXT[k] ?: k, PillKind.BAD, wrap = true)
        for (k in pr.warn) Pill(PROBLEM_TEXT[k] ?: k, if (k == "right") PillKind.PLAIN else PillKind.WARN, wrap = true)
        for (l in LETTERS) {
            val opt = d.options[l].orEmpty()
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(enabled = opt.isNotBlank()) { onChange(withAnswer(l)) }.padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                RadioButton(selected = d.correct == l, onClick = null, enabled = opt.isNotBlank(), modifier = Modifier.padding(start = 6.dp))
                Text("$l  ${opt.ifEmpty { "—" }}", fontSize = 14.sp, color = if (d.correct == l) c.ink else c.muted, fontWeight = if (d.correct == l) FontWeight.Bold else FontWeight.Normal)
            }
        }
        TextButton(onClick = { open = !open }) { Text(if (open) "Ẩn chi tiết" else "Sửa chi tiết") }
        if (open) {
            OutlinedTextField(value = d.stem, onValueChange = { s -> val n = d.copy(stem = s); onChange(n.copy(include = n.recommended(existing))) }, label = { Text("Câu (chỗ trống là _____)") }, minLines = 2, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping())
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (t in IMPORT_TOPICS) FilterChip(selected = d.topic == t, onClick = { onChange(edit("topic", d.copy(topic = if (d.topic == t) "" else t))) }, label = { Text(t) })
            }
            OutlinedTextField(
                value = d.rule, onValueChange = { onChange(edit("rule", d.copy(rule = it.take(300)))) }, minLines = 2,
                label = { Text("Quy tắc" + if ("rule" in d.aiFields()) " · AI" else "") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
            )
            OutlinedTextField(
                value = d.translation, onValueChange = { onChange(edit("translation", d.copy(translation = it.take(300)))) },
                label = { Text("Nghĩa của câu" + if ("translation" in d.aiFields()) " · AI" else "") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
            )
        }
    }
}

@Composable
private fun WordsView(v: PassageView, saving: Boolean, testName: String?, picker: @Composable () -> Unit, onToggle: (String) -> Unit, onSave: () -> Unit) {
    val c = Lexi.colors
    Panel(Modifier.testTag("import-words")) {
        Text(v.label, fontWeight = FontWeight.Bold)
        Text(
            (v.coverage?.let { "Bạn quen khoảng $it% số từ trong đoạn. " } ?: "") + if ((v.coverage ?: 0) >= 95) "Từ vựng không phải vấn đề chính của đoạn này." else "Dưới 95% thì đọc chậm và dễ hiểu sai: học các từ lạ dưới đây trước.",
            fontSize = 13.sp, color = c.muted,
        )
    }
    if (v.words.isEmpty()) Text("Không còn từ lạ nào trong đoạn này.", color = c.muted)
    for (w in v.words) Panel {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Checkbox(checked = w.picked && w.usable, onCheckedChange = { onToggle(w.key) }, enabled = w.usable, modifier = Modifier.testTag("word-pick"))
            Column(Modifier.weight(1f).padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(w.key, fontWeight = FontWeight.ExtraBold, fontSize = 16.sp)
                    if (w.pos.isNotEmpty()) Pill(w.pos)
                    if (w.count > 1) Text("×${w.count}", color = c.muted, fontSize = 12.sp)
                }
                Text(if (w.vi.isNotBlank()) w.vi else w.en.ifBlank { "Không có trong từ điển offline: thêm tay ở tab Thêm từ." }, fontSize = 14.sp, color = if (w.usable) c.ink else c.muted)
                Text("“${w.sentence}”", fontSize = 12.5.sp, color = c.muted, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    picker()
    val n = v.words.count { it.picked && it.usable }
    Button(onClick = onSave, enabled = n > 0 && !saving, modifier = Modifier.fillMaxWidth().testTag("import-save-words")) { Icon(Icons.Filled.Check, null); Text("  Thêm $n từ" + (testName?.let { " · $it" } ?: "")) }
}

/** "Lưu thẻ vào bộ": pick an existing deck or name a new one (made when the cards are saved). */
@Composable
private fun DeckPicker(decks: List<Deck>, selectedId: String?, newName: String?, onPick: (String) -> Unit, onNew: (String) -> Unit, onExisting: () -> Unit) {
    val c = Lexi.colors
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().testTag("deck-pick"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Lưu thẻ vào bộ", fontSize = 13.sp, color = c.muted)
        if (newName == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box {
                    OutlinedButton(onClick = { menu = true }) { Text(decks.firstOrNull { it.id == selectedId }?.name ?: "Mặc định", maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        for (d in decks) DropdownMenuItem(text = { Text(d.name) }, onClick = { onPick(d.id); menu = false })
                    }
                }
                OutlinedButton(onClick = { onNew("") }, modifier = Modifier.testTag("deck-new")) { Text("+ Mới") }
            }
        } else {
            OutlinedTextField(value = newName, onValueChange = { onNew(it.take(60)) }, singleLine = true, label = { Text("Tên bộ thẻ mới") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("deck-name"))
            if (decks.isNotEmpty()) TextButton(onClick = onExisting) { Text("Chọn bộ có sẵn") }
        }
    }
}
