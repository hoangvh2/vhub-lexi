package com.vh.lexi.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.cloud.Account
import com.vh.lexi.core.DictEntry
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.Lookup
import com.vh.lexi.core.Note
import com.vh.lexi.core.POS_NAMES
import com.vh.lexi.core.items
import com.vh.lexi.core.mergeEnrich
import com.vh.lexi.core.normalizeWord
import com.vh.lexi.core.str
import com.vh.lexi.core.template
import com.vh.lexi.core.viFor
import com.vh.lexi.core.wantedTemplates
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private data class SenseRef(val pos: String, val def: String, val ex: List<String>)

private fun senseList(e: DictEntry?): List<SenseRef> =
    e?.pos?.flatMap { p -> p.senses.map { SenseRef(POS_NAMES[p.pos] ?: p.pos, it.def, it.examples) } } ?: emptyList()

private class Draft(
    word: String = "", ipa: String = "", pos: String = "", en: String = "", vi: String = "", examples: String = "", examplesVi: String = "", mnemonic: String = "", ai: Set<String> = emptySet(),
) {
    var word by mutableStateOf(word)
    var ipa by mutableStateOf(ipa)
    var pos by mutableStateOf(pos)
    var en by mutableStateOf(en)
    var vi by mutableStateOf(vi)
    var examples by mutableStateOf(examples)
    var examplesVi by mutableStateOf(examplesVi)
    var mnemonic by mutableStateOf(mnemonic)
    var ai by mutableStateOf(ai)

    /** True while the Vietnamese meaning is still the dictionary's suggestion (not typed, not from AI). */
    fun viFromDict(e: DictEntry?) = e != null && vi.isNotEmpty() && "vi" !in ai && vi == e.viFor(pos)

    fun fillFrom(e: DictEntry, picked: List<SenseRef>, keepUser: Boolean) {
        val followPos = !keepUser || vi.isEmpty() || viFromDict(e)
        word = e.word; ipa = e.ipa
        pos = picked.firstOrNull()?.pos ?: ""
        if (followPos) vi = e.viFor(pos)
        en = picked.joinToString("; ") { it.def }
        examples = picked.flatMap { it.ex }.distinct().take(3).joinToString("\n")
        examplesVi = ""
        if (!keepUser) { mnemonic = ""; ai = emptySet() }
    }

    fun clear() { word = ""; ipa = ""; pos = ""; en = ""; vi = ""; examples = ""; examplesVi = ""; mnemonic = ""; ai = emptySet() }
}

@Composable
fun AddScreen(app: LexiApp) {
    val data = app.data
    val toast = LocalToaster.current
    val scope = rememberCoroutineScope()
    val decks by data.decks.collectAsState()
    val notes by data.notes.collectAsState()
    val prefs by data.prefs.collectAsState()
    val account by app.cloud.account.collectAsState()

    var q by remember { mutableStateOf("") }
    var suggestions by remember { mutableStateOf<List<DictEntry>>(emptyList()) }
    var hit by remember { mutableStateOf<Lookup?>(null) }
    var picked by remember { mutableStateOf(listOf(0)) }
    var searching by remember { mutableStateOf(false) }
    var aiBusy by remember { mutableStateOf(false) }
    var deckId by remember { mutableStateOf<String?>(null) }
    var newDeck by remember { mutableStateOf<String?>(null) }
    var deckMenu by remember { mutableStateOf(false) }
    val draft = remember { Draft() }
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    val senses = remember(hit) { senseList(hit?.entry) }

    LaunchedEffect(q) {
        val w = normalizeWord(q)
        if (w.length < 2) { suggestions = emptyList(); searching = false; return@LaunchedEffect }
        searching = true
        val (sugg, found) = withContext(Dispatchers.IO) { app.dictionary.suggest(w) to app.dictionary.lookup(w) }
        searching = false
        suggestions = sugg
        // Do not clobber a word the user is already editing unless they typed a different word.
        if (found != null && found.entry.word != draft.word && !(draft.word.isNotEmpty() && normalizeWord(draft.word) == w)) {
            hit = found
            val s = senseList(found.entry)
            picked = if (s.isEmpty()) emptyList() else listOf(0)
            draft.fillFrom(found.entry, s.take(1), keepUser = false)
        } else if (found == null && normalizeWord(draft.word) != w) {
            hit = null
            draft.clear()
        }
    }

    val manual = hit == null && !searching && normalizeWord(q).length >= 2
    val word = if (hit != null) draft.word.trim() else if (manual) normalizeWord(q) else ""
    val fields = mapOf<String, FieldValue>(
        "word" to FieldValue.Text(word), "ipa" to FieldValue.Text(draft.ipa), "pos" to FieldValue.Text(draft.pos), "en" to FieldValue.Text(draft.en),
        "vi" to FieldValue.Text(draft.vi), "examples" to FieldValue.Items(draft.examples.split("\n")),
        "examplesVi" to FieldValue.Items(draft.examplesVi.split("\n")), "mnemonic" to FieldValue.Text(draft.mnemonic),
    )
    val previewNote = Note("preview", "vocab", "", fields, createdAt = 0, updatedAt = 0)
    val cardCount = if (word.isNotEmpty()) wantedTemplates(previewNote, prefs.templates).size else 0
    val duplicate = word.isNotEmpty() && notes.any { it.type == "vocab" && it.fields["word"].str().equals(word, ignoreCase = true) }
    val canSave = word.isNotEmpty() && (draft.vi.isNotBlank() || draft.en.isNotBlank())
    val signedIn = account is Account.SignedIn
    val aiAvailable = signedIn && prefs.aiEnabled

    fun choose(l: Lookup) {
        hit = l
        val s = senseList(l.entry)
        picked = if (s.isEmpty()) emptyList() else listOf(0)
        draft.fillFrom(l.entry, s.take(1), keepUser = false)
        q = l.entry.word
    }

    fun save() {
        if (!canSave) return
        val snapshotFields = fields
        val ai = draft.ai.toList()
        val label = word
        val count = cardCount
        val target = deckId
        val nd = newDeck
        // Clear the form first so the next word can be typed immediately.
        q = ""; hit = null; draft.clear(); picked = listOf(0); suggestions = emptyList(); newDeck = null
        scope.launch {
            val dest = if (nd != null && nd.isNotBlank()) data.createDeck(nd).id else target
            data.addNote("vocab", snapshotFields, dest, ai)
            toast("Đã thêm “$label” · $count thẻ")
        }
    }

    fun enrich() {
        if (word.isEmpty() || aiBusy) return
        aiBusy = true
        scope.launch {
            try {
                val r = app.cloud.enrich(word, draft.pos.ifBlank { null }, draft.en.ifBlank { null }, draft.examples.split("\n").filter { it.isNotBlank() })
                // A meaning prefilled from the offline dictionary is replaced; one the learner typed is kept.
                val m = mergeEnrich(fields, draft.ai, r, overwriteVi = draft.viFromDict(hit?.entry))
                draft.vi = m.fields["vi"].str(); draft.en = m.fields["en"].str(); draft.mnemonic = m.fields["mnemonic"].str()
                draft.examples = m.fields["examples"].items().joinToString("\n")
                draft.examplesVi = m.fields["examplesVi"].items().joinToString("\n")
                draft.ai = m.aiFields
            } catch (e: Exception) {
                toast(e.message ?: "Không gọi được AI.")
            } finally {
                aiBusy = false
            }
        }
    }

    fun edited(key: String) { draft.ai = draft.ai - key }
    val c = Lexi.colors

    // The save action lives in a bar under the scrolling form, so it sits right above the keyboard while typing
    // instead of at the end of a long form that the keyboard covers.
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            ScreenHeader("Thêm từ") {
                if (!app.hasDictionary) Pill("Chưa có từ điển offline", PillKind.WARN) else Pill("Từ điển offline", PillKind.OK)
            }
            OutlinedTextField(
                value = q, onValueChange = { q = it }, singleLine = true, label = { Text("Từ hoặc cụm từ tiếng Anh") },
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 22.sp),
                keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, capitalization = KeyboardCapitalization.None),
                modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("word-input"),
            )

            if (suggestions.isNotEmpty() && normalizeWord(q) != hit?.entry?.word) {
                Surface(shape = RoundedCornerShape(12.dp), color = c.surface, border = BorderStroke(1.dp, c.line)) {
                    Column {
                        for (s in suggestions) Row(
                            Modifier.fillMaxWidth().clickable { scope.launch { withContext(Dispatchers.IO) { app.dictionary.lookup(s.word) }?.let(::choose) } }.padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(s.word, fontWeight = FontWeight.Bold)
                            Text(s.pos.firstOrNull()?.senses?.firstOrNull()?.def?.take(50).orEmpty(), color = c.muted, maxLines = 1)
                        }
                    }
                }
            }
            hit?.inflectedFrom?.let { Text("“$it” là dạng của ${hit?.entry?.word}.", color = c.muted) }
            if (manual) Text("Không có “${normalizeWord(q)}” trong từ điển offline. Bạn có thể tự nhập nghĩa${if (aiAvailable) " hoặc nhờ AI điền" else ""}.", color = c.muted)

            if (word.isNotEmpty()) {
                val tpl = template("vocab", "recognize")!!
                Text("Xem trước thẻ", style = MaterialTheme.typography.labelMedium, color = c.muted)
                Panel(Modifier.testTag("preview")) {
                    BlocksView(tpl.front(previewNote, prefs.layout), onSpeak = app.speech::speak)
                    androidx.compose.material3.HorizontalDivider(color = c.line)
                    BlocksView(tpl.back(previewNote, prefs.layout), onSpeak = app.speech::speak)
                }
            } else {
                Panel { Text("Gõ một từ để xem thẻ hiện ra ngay. Phiên âm, loại từ, định nghĩa và ví dụ lấy từ từ điển offline.", color = c.muted) }
            }

            if (senses.isNotEmpty()) {
                Text("Chọn nghĩa đưa vào thẻ", style = MaterialTheme.typography.labelMedium, color = c.muted)
                senses.forEachIndexed { i, s ->
                    val on = i in picked
                    Surface(
                        onClick = {
                            val next = if (on) picked - i else (picked + i).sorted()
                            picked = next
                            hit?.let { draft.fillFrom(it.entry, next.map { k -> senses[k] }, keepUser = true) }
                        },
                        shape = RoundedCornerShape(12.dp), color = if (on) c.accentSoft else c.surface, border = BorderStroke(1.5.dp, if (on) c.accent else c.line),
                    ) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Pill(s.pos, PillKind.OK)
                            Column(Modifier.weight(1f)) {
                                Text(s.def)
                                s.ex.firstOrNull()?.let { Text("“$it”", color = c.muted, fontSize = 13.sp) }
                            }
                        }
                    }
                }
            }

            if (word.isNotEmpty()) {
                OutlinedTextField(
                    value = draft.vi, onValueChange = { draft.vi = it; edited("vi") }, singleLine = true, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("vi-input"),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    label = { Text("Nghĩa tiếng Việt" + if ("vi" in draft.ai) " · AI" else if (draft.viFromDict(hit?.entry)) " · Wiktionary" else "") },
                    placeholder = { Text(if (aiAvailable) "Nhập hoặc bấm “Điền bằng AI”" else "Nhập nghĩa tiếng Việt") },
                )
                if (aiAvailable) OutlinedButton(onClick = ::enrich, enabled = !aiBusy) { Icon(Icons.Filled.AutoAwesome, null); Text(if (aiBusy) "  Đang điền…" else "  Điền bằng AI") }
                if (hit == null) OutlinedTextField(value = draft.en, onValueChange = { draft.en = it; edited("en") }, label = { Text("Định nghĩa tiếng Anh" + if ("en" in draft.ai) " · AI" else "") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping())
                OutlinedTextField(
                    value = draft.examples, onValueChange = { draft.examples = it; edited("examples") }, minLines = 2, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
                    label = { Text("Ví dụ (mỗi dòng một câu)" + if ("examples" in draft.ai) " · AI" else "") },
                )
                OutlinedTextField(
                    value = draft.examplesVi, onValueChange = { draft.examplesVi = it; edited("examplesVi") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
                    label = { Text("Dịch ví dụ (cùng thứ tự)" + if ("examplesVi" in draft.ai) " · AI" else "") },
                )
                OutlinedTextField(value = draft.mnemonic, onValueChange = { draft.mnemonic = it; edited("mnemonic") }, label = { Text("Mẹo nhớ / truyện chêm" + if ("mnemonic" in draft.ai) " · AI" else "") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("mnemonic-input"))

                val deckName = decks.firstOrNull { it.id == (deckId ?: prefs.defaultDeckId) }?.name ?: decks.firstOrNull()?.name ?: "Mặc định"
                if (newDeck == null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        androidx.compose.foundation.layout.Box {
                            OutlinedButton(onClick = { deckMenu = true }) { Text("Bộ thẻ: $deckName") }
                            DropdownMenu(expanded = deckMenu, onDismissRequest = { deckMenu = false }) {
                                for (d in decks) DropdownMenuItem(text = { Text(d.name) }, onClick = { deckId = d.id; deckMenu = false })
                            }
                        }
                        OutlinedButton(onClick = { newDeck = "" }) { Text("+ Mới") }
                    }
                } else {
                    OutlinedTextField(value = newDeck.orEmpty(), onValueChange = { newDeck = it }, singleLine = true, label = { Text("Tên bộ thẻ mới (vd: TOEIC)") }, modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping())
                }
                if (duplicate) Pill("“$word” đã có trong thư viện. Lưu sẽ tạo thêm một bản.", PillKind.WARN)
            }
        }
        if (word.isNotEmpty()) {
            HorizontalDivider(color = c.line)
            Column(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Button(onClick = ::save, enabled = canSave, modifier = Modifier.fillMaxWidth().testTag("save-word")) { Icon(Icons.Filled.Check, null); Text("  Lưu · $cardCount thẻ") }
                if (!canSave) Text("Cần có nghĩa tiếng Việt hoặc định nghĩa tiếng Anh.", color = c.muted, fontSize = 13.sp)
            }
        }
    }
}
