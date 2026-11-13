package com.vh.lexi.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.DRILL_ROUND
import com.vh.lexi.core.DrillItem
import com.vh.lexi.core.DrillMode
import com.vh.lexi.core.ForgotKind
import com.vh.lexi.core.Note
import com.vh.lexi.core.Verdict
import com.vh.lexi.core.afterAnswer
import com.vh.lexi.core.answerHint
import com.vh.lexi.core.checkTyped
import com.vh.lexi.core.drillRound
import com.vh.lexi.core.forgotNotes
import com.vh.lexi.core.forgotOf
import com.vh.lexi.core.items as fieldItems
import com.vh.lexi.core.shortMeaning
import com.vh.lexi.core.str
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.ui.theme.Quicksand
import com.vh.lexi.ui.theme.clay
import kotlinx.coroutines.launch

private val ForgotKind.short get() = if (this == ForgotKind.MEANING) "Nghĩa" else "Phát âm"

/**
 * The "hay quên" mark on a word card, next to the hint buttons (web Forgot.tsx ForgotButton): one tap opens two
 * toggles (meaning, sound), each one write of the note. The card's FSRS state and the answer are not touched.
 */
@Composable
internal fun ForgotButton(app: LexiApp, note: Note, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    val toast = LocalToaster.current
    val scope = rememberCoroutineScope()
    val notes by app.data.notes.collectAsState()
    val live = notes.firstOrNull { it.id == note.id } ?: note
    val kinds = forgotOf(live)
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Surface(
            onClick = { open = true },
            shape = CircleShape,
            color = if (kinds.isNotEmpty()) c.roseDeep else c.roseSoft,
            modifier = Modifier.size(42.dp).testTag("forgot-btn").semantics {
                contentDescription = if (kinds.isEmpty()) "Đánh dấu hay quên" else "Hay quên: " + kinds.joinToString(", ") { it.short.lowercase() }
            },
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(if (kinds.isNotEmpty()) Icons.Filled.Bookmark else Icons.Filled.BookmarkBorder, null, tint = if (kinds.isNotEmpty()) c.surface else c.roseDeep, modifier = Modifier.size(20.dp))
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = RoundedCornerShape(20.dp), containerColor = c.surface) {
            Column(Modifier.width(240.dp).padding(horizontal = 12.dp, vertical = 4.dp).testTag("forgot-pop"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Từ này hay quên…", fontWeight = FontWeight.Bold, color = c.ink, fontSize = 14.sp)
                for (k in ForgotKind.entries) {
                    val on = k in kinds
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 46.dp).clip(RoundedCornerShape(14.dp)).background(if (on) c.roseSoft else c.surface2)
                            .clickable(role = Role.Checkbox) {
                                scope.launch {
                                    app.data.setForgot(live, k, !on)
                                    // Once per word, when it joins the list; no action button: a snackbar with one stays until tapped.
                                    if (!on && kinds.isEmpty()) toast("Đã thêm vào Từ hay quên")
                                }
                            }
                            .semantics { selected = on }.testTag("forgot-${k.key}").padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Box(Modifier.size(22.dp).background(if (on) c.roseDeep else c.surface, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
                            if (on) Icon(Icons.Filled.Check, null, tint = c.surface, modifier = Modifier.size(15.dp))
                        }
                        Text(k.label, fontWeight = FontWeight.Bold, color = if (on) c.roseDeep else c.ink)
                    }
                }
                Text("Chỉ để luyện thêm, không đổi lịch ôn.", fontSize = 12.sp, color = c.muted)
            }
        }
    }
}

private enum class ForgotFilter { ALL, MEANING, SOUND }

/** "Từ hay quên": the marked words, FSRS's most-forgotten words as suggestions, and a practice round (web ForgotPage). */
@Composable
internal fun ForgotScreen(app: LexiApp, onClose: () -> Unit) {
    val c = Lexi.colors
    val scope = rememberCoroutineScope()
    val toast = LocalToaster.current
    val notes by app.data.notes.collectAsState()
    val cards by app.data.cards.collectAsState()
    val marked = remember(notes) { forgotNotes(notes) }
    val notesById = remember(notes) { notes.associateBy { it.id } }
    val suggested = remember(cards, notesById) { wordsToWatch(cards, notesById, 40).filter { it.first.type == "vocab" && forgotOf(it.first).isEmpty() }.take(10) }
    var filter by remember { mutableStateOf(ForgotFilter.ALL) }
    var round by remember { mutableStateOf<List<DrillItem>?>(null) }
    val shown = when (filter) {
        ForgotFilter.ALL -> marked
        ForgotFilter.MEANING -> marked.filter { ForgotKind.MEANING in forgotOf(it) }
        ForgotFilter.SOUND -> marked.filter { ForgotKind.SOUND in forgotOf(it) }
    }
    fun count(k: ForgotKind) = marked.count { k in forgotOf(it) }

    round?.let { r ->
        DrillRun(app, r, notesById, onExit = { round = null }, onAgain = { round = drillRound(shown, notes, System.currentTimeMillis().toString()) })
        return
    }

    LazyColumn(Modifier.fillMaxSize().testTag("forgot-screen"), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { ScreenHeader("Từ hay quên") { TextButton(onClick = onClose, modifier = Modifier.testTag("forgot-close")) { Text("Đóng") } } }
        item { Text("Luyện thêm những từ bạn hay quên nghĩa hoặc cách đọc, ngoài lịch ôn. Không tính vào FSRS: lịch ôn, độ khó và lịch sử ôn của thẻ giữ nguyên.", fontSize = 13.sp, color = c.muted) }
        item {
            Panel(Modifier.testTag("forgot-hero")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${marked.size} từ", fontFamily = Quicksand, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = c.ink)
                        Text("${count(ForgotKind.MEANING)} quên nghĩa · ${count(ForgotKind.SOUND)} quên phát âm", fontSize = 13.sp, color = c.muted)
                    }
                }
                Button(
                    onClick = {
                        val items = drillRound(shown, notes, System.currentTimeMillis().toString())
                        if (items.isEmpty()) toast("Chưa có bài luyện cho các từ này: thêm nghĩa tiếng Việt cho từ quên nghĩa.") else round = items
                    },
                    enabled = shown.isNotEmpty(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("drill-start"),
                ) {
                    Icon(Icons.Filled.Bolt, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                    Text("Luyện ${minOf(shown.size, DRILL_ROUND)} từ", fontWeight = FontWeight.Bold)
                }
            }
        }
        if (marked.isNotEmpty()) item {
            Row(Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(50)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (f in ForgotFilter.entries) {
                    val sel = f == filter
                    val label = when (f) { ForgotFilter.ALL -> "Tất cả ${marked.size}"; ForgotFilter.MEANING -> "Nghĩa ${count(ForgotKind.MEANING)}"; ForgotFilter.SOUND -> "Phát âm ${count(ForgotKind.SOUND)}" }
                    Box(
                        Modifier.weight(1f).heightIn(min = 38.dp).clip(RoundedCornerShape(50)).background(if (sel) c.surface else c.surface2)
                            .clickable(role = Role.Tab) { filter = f }.testTag("forgot-filter-${f.name.lowercase()}"),
                        contentAlignment = Alignment.Center,
                    ) { Text(label, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (sel) c.accent else c.muted, maxLines = 1) }
                }
            }
        }
        if (marked.isEmpty()) item {
            Column(Modifier.fillMaxWidth().padding(vertical = 28.dp).testTag("forgot-empty"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.BookmarkBorder, null, tint = c.muted, modifier = Modifier.size(30.dp))
                Text("Chưa có từ nào. Khi học hoặc ôn, bấm biểu tượng đánh dấu cạnh nút Mẹo để thêm từ vào đây.", color = c.muted, textAlign = TextAlign.Center)
            }
        }
        items(shown, key = { it.id }) { n -> ForgotRow(app, n) }
        if (suggested.isNotEmpty()) item {
            Panel(Modifier.testTag("forgot-suggested")) {
                Text("Quên nhiều trong lịch ôn", fontFamily = Quicksand, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = c.ink)
                Text("theo số lần chấm Quên", fontSize = 12.sp, color = c.muted)
                for ((n, lapses) in suggested) {
                    Row(
                        Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(16.dp)).padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(n.fields["word"].str(), fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 1)
                        Text(shortMeaning(n), Modifier.weight(1f), fontSize = 13.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Pill("quên $lapses", PillKind.BAD)
                        IconButton(onClick = { scope.launch { app.data.setForgot(n, ForgotKind.MEANING, true) } }, modifier = Modifier.testTag("forgot-suggest-add")) {
                            Icon(Icons.Filled.Add, "Đánh dấu ${n.fields["word"].str()}", tint = c.accent)
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.heightIn(min = 24.dp)) }
    }
}

@Composable
private fun ForgotRow(app: LexiApp, n: Note) {
    val c = Lexi.colors
    val scope = rememberCoroutineScope()
    val kinds = forgotOf(n)
    val word = n.fields["word"].str()
    val ipa = n.fields["ipa"].str()
    Row(
        Modifier.fillMaxWidth().background(c.surface, RoundedCornerShape(20.dp)).padding(start = 4.dp, end = 10.dp, top = 6.dp, bottom = 6.dp).testTag("forgot-row"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconButton(onClick = { app.speech.speak(word) }) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Nghe $word", tint = c.accent) }
        Column(Modifier.weight(1f)) {
            // The word gets the whole first line; the IPA goes with the meaning on the second, so a narrow phone never
            // squeezes the word to "…".
            Text(word, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf(shortMeaning(n).ifEmpty { "Chưa có nghĩa" }, ipa).filter { it.isNotEmpty() }.joinToString(" · "), fontSize = 13.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        for (k in ForgotKind.entries) {
            val on = k in kinds
            Box(
                Modifier.heightIn(min = 34.dp).clip(RoundedCornerShape(50)).background(if (on) c.roseSoft else c.surface2)
                    .clickable(role = Role.Checkbox) { scope.launch { app.data.setForgot(n, k, !on) } }
                    .semantics { selected = on }.testTag("row-${k.key}").padding(horizontal = 9.dp),
                contentAlignment = Alignment.Center,
            ) { Text(k.short, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = if (on) c.roseDeep else c.muted, maxLines = 1) }
        }
    }
}

private data class DrillAnswer(val right: Boolean, val verdict: Verdict? = null, val picked: String? = null, val typed: String? = null)

/** One practice round: answers live here only, nothing is written, so FSRS stays as it was (web Forgot.tsx DrillRun). */
@Composable
private fun DrillRun(app: LexiApp, items: List<DrillItem>, notesById: Map<String, Note>, onExit: () -> Unit, onAgain: () -> Unit) {
    val c = Lexi.colors
    var queue by remember(items) { mutableStateOf(items.filter { it.noteId in notesById }) }
    val total = remember(items) { queue.size }
    var missed by remember(items) { mutableStateOf(setOf<String>()) }
    var done by remember(items) { mutableIntStateOf(0) }
    var answer by remember(items) { mutableStateOf<DrillAnswer?>(null) }
    var typed by remember(items) { mutableStateOf("") }
    var heard by remember(items) { mutableStateOf(false) }
    var turn by remember(items) { mutableIntStateOf(0) }
    val item = queue.firstOrNull()
    val note = item?.let { notesById[it.noteId] }
    val word = note?.fields?.get("word").str()

    LaunchedEffect(items, turn) { if (item?.mode == DrillMode.LISTEN) app.speech.speakSlow(word) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp).testTag("drill"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (item == null || note == null) {
            val words = missed.map { it.substringBefore('/') }.distinct().mapNotNull { notesById[it] }
            Panel(Modifier.testTag("drill-done")) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.Check, null, tint = c.mintDeep, modifier = Modifier.size(30.dp))
                    Text("Xong vòng luyện", fontFamily = Quicksand, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.ink)
                    Text("$total bài, đúng ngay lần đầu ${total - missed.size}/$total.", color = c.ink, modifier = Modifier.testTag("drill-score"))
                    if (words.isNotEmpty()) Text("Cần luyện thêm: " + words.joinToString(", ") { it.fields["word"].str() }, color = c.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag("drill-missed"))
                    Text("Lịch ôn FSRS không đổi: vòng luyện này không ghi lượt ôn nào.", fontSize = 12.sp, color = c.muted, textAlign = TextAlign.Center)
                    Button(onClick = onAgain, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("drill-again")) { Text("Luyện vòng nữa", fontWeight = FontWeight.Bold) }
                    OutlinedButton(onClick = onExit, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("drill-exit")) { Text("Về danh sách") }
                }
            }
            return@Column
        }

        fun finish(right: Boolean, a: DrillAnswer = DrillAnswer(right)) {
            answer = a.copy(right = right)
            if (!right) missed = missed + "${item.noteId}/${item.mode.key}"
            if (item.mode != DrillMode.LISTEN && item.mode != DrillMode.SAY) app.speech.speak(word)
        }
        fun next() {
            val right = answer?.right == true
            queue = afterAnswer(queue, right)
            if (right) done += 1
            answer = null; typed = ""; heard = false; turn += 1
        }
        fun check() {
            if (typed.isBlank()) return
            val v = checkTyped(typed, listOf(word))
            finish(v != Verdict.WRONG, DrillAnswer(v != Verdict.WRONG, verdict = v, typed = typed))
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onExit, modifier = Modifier.testTag("drill-quit")) { Icon(Icons.Filled.Close, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Dừng") }
            Spacer(Modifier.weight(1f))
            Text("Còn ${queue.size} · đã đúng $done/$total", fontSize = 13.sp, color = c.muted, modifier = Modifier.testTag("drill-left"))
        }
        Box(Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(50))) {
            Box(Modifier.fillMaxWidth(done.toFloat() / maxOf(1, total)).heightIn(min = 8.dp).background(c.accent, RoundedCornerShape(50)))
        }
        val ipa = note.fields["ipa"].str()
        val mode = when (item.mode) { DrillMode.SAY, DrillMode.LISTEN -> c.listen; DrillMode.MEANING -> c.accent; DrillMode.RECALL -> c.peachDeep }
        Column(
            Modifier.fillMaxWidth().clay(c, RoundedCornerShape(32.dp)).padding(20.dp).animateContentSize().testTag("drill-card"),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(10.dp).background(mode, CircleShape))
                Text(
                    when (item.mode) { DrillMode.MEANING -> "Chọn nghĩa đúng"; DrillMode.RECALL -> "Gõ từ tiếng Anh"; DrillMode.SAY -> "Đọc to từ này"; DrillMode.LISTEN -> "Nghe và gõ từ" },
                    fontWeight = FontWeight.Bold, color = mode, fontSize = 14.sp, modifier = Modifier.testTag("drill-mode-${item.mode.key}"),
                )
            }
            when (item.mode) {
                DrillMode.MEANING, DrillMode.SAY -> {
                    Text(word, fontFamily = Quicksand, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = c.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag("drill-word"))
                    if (ipa.isNotEmpty() && (item.mode == DrillMode.MEANING || answer != null || heard)) Text(ipa, color = c.muted, fontSize = 15.sp)
                }
                DrillMode.RECALL -> {
                    Text(shortMeaning(note), fontFamily = Quicksand, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = c.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag("drill-meaning"))
                    val pos = note.fields["pos"].str()
                    if (pos.isNotEmpty()) Text(pos, color = c.muted, fontSize = 13.sp)
                    if (answer == null) AnswerHint(answerHint(word, 1), "${word.count { !it.isWhitespace() }} chữ cái", mode)
                }
                DrillMode.LISTEN -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { app.speech.speakSlow(word) }, modifier = Modifier.heightIn(min = 52.dp).testTag("drill-play"), colors = ButtonDefaults.buttonColors(containerColor = c.listen)) {
                        Icon(Icons.AutoMirrored.Filled.VolumeUp, null); Spacer(Modifier.width(6.dp)); Text("Nghe lại", fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (item.mode == DrillMode.MEANING) {
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (id in item.options.orEmpty()) {
                        val o = notesById[id]
                        val a = answer
                        val (bg, fg) = when {
                            a == null -> c.surface2 to c.ink
                            id == item.noteId -> c.mintSoft to c.mintDeep
                            id == a.picked -> c.roseSoft to c.roseDeep
                            else -> c.surface2 to c.muted
                        }
                        Box(
                            Modifier.fillMaxWidth().heightIn(min = 50.dp).clip(RoundedCornerShape(18.dp)).background(bg)
                                .clickable(enabled = a == null, role = Role.Button) { finish(id == item.noteId, DrillAnswer(id == item.noteId, picked = id)) }
                                .testTag(if (id == item.noteId) "drill-opt-right" else "drill-opt").padding(horizontal = 16.dp, vertical = 12.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) { Text(o?.let(::shortMeaning) ?: "", fontWeight = FontWeight.Bold, color = fg) }
                    }
                }
            }

            if ((item.mode == DrillMode.RECALL || item.mode == DrillMode.LISTEN) && answer == null) {
                OutlinedTextField(
                    value = typed, onValueChange = { typed = it }, singleLine = true, placeholder = { Text("Gõ từ…") },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { check() }),
                    modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping().testTag("drill-input"),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { finish(false, DrillAnswer(false, verdict = Verdict.WRONG)) }, modifier = Modifier.testTag("drill-giveup")) { Text("Không nhớ") }
                    Button(onClick = { check() }, modifier = Modifier.testTag("drill-check")) { Text("Kiểm tra", fontWeight = FontWeight.Bold) }
                }
            }

            if (item.mode == DrillMode.SAY && answer == null) {
                if (!heard) {
                    Text("Đọc thành tiếng trước, rồi bấm nghe để so.", color = c.muted, textAlign = TextAlign.Center)
                    Button(onClick = { heard = true; app.speech.speak(word) }, modifier = Modifier.testTag("drill-hear")) {
                        Icon(Icons.AutoMirrored.Filled.VolumeUp, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Nghe cách đọc", fontWeight = FontWeight.Bold)
                    }
                } else {
                    TextButton(onClick = { app.speech.speakSlow(word) }) { Text("Nghe chậm") }
                    Text("Bạn đọc có giống không?", color = c.muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedButton(onClick = { finish(false) }, modifier = Modifier.testTag("drill-say-no")) { Text("Chưa giống") }
                        Button(onClick = { finish(true) }, modifier = Modifier.testTag("drill-say-yes")) { Text("Đọc đúng", fontWeight = FontWeight.Bold) }
                    }
                }
            }

            answer?.let { a ->
                Column(Modifier.fillMaxWidth().testTag("drill-answer"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val label = if (a.right) (if (a.verdict == Verdict.CLOSE) "Gần đúng" else "Đúng rồi") else "Chưa đúng, sẽ hỏi lại"
                    Pill(label + (if (a.typed != null && a.verdict != Verdict.CORRECT) " · bạn gõ “${a.typed}”" else ""), if (a.right) PillKind.OK else PillKind.BAD, Modifier.testTag("drill-verdict"), wrap = true)
                    if (item.mode != DrillMode.SAY) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(word, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.ink)
                        if (ipa.isNotEmpty()) Text(ipa, color = c.muted, fontSize = 14.sp)
                        IconButton(onClick = { app.speech.speak(word) }) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Nghe $word", tint = c.accent) }
                    }
                    val vi = note.fields["vi"].str()
                    if (vi.isNotEmpty()) Text(vi, fontWeight = FontWeight.Bold, color = c.ink, textAlign = TextAlign.Center)
                    note.fields["examples"].fieldItems().firstOrNull()?.let { Text(it, fontSize = 14.sp, color = c.muted, textAlign = TextAlign.Center) }
                }
            }
        }
        if (answer != null) {
            Button(onClick = { next() }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("drill-next")) { Text("Tiếp", fontWeight = FontWeight.Bold, fontSize = 16.sp) }
        }
    }
}
