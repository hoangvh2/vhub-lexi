package com.vh.lexi.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.AnswerMode
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.LEARN_AHEAD_MS
import com.vh.lexi.core.QueueInput
import com.vh.lexi.core.SessionState
import com.vh.lexi.core.Verdict
import com.vh.lexi.core.buildQueue
import com.vh.lexi.core.checkTyped
import com.vh.lexi.core.dayId
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.pickNext
import com.vh.lexi.core.suggestedRating
import com.vh.lexi.core.template
import com.vh.lexi.data.Reviewed
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private data class Session(val answered: Int = 0, val again: Int = 0, val ms: Long = 0, val shown: Int = 0, val shownNew: Int = 0)

@Composable
fun StudyScreen(app: LexiApp, onAdd: () -> Unit) {
    val data = app.data
    val toast = LocalToaster.current
    val scope = rememberCoroutineScope()
    val cards by data.cards.collectAsState()
    val notes by data.notes.collectAsState()
    val decks by data.decks.collectAsState()
    val daily by data.daily.collectAsState()
    val prefs by data.prefs.collectAsState()
    val loaded by data.loaded.collectAsState()

    var deckId by remember { mutableStateOf<String?>(null) }
    var buried by remember { mutableStateOf(emptySet<String>()) }
    var session by remember { mutableStateOf(Session()) }
    var extraNew by remember { mutableStateOf(0) }
    var ahead by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var revealed by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var verdict by remember { mutableStateOf<Verdict?>(null) }
    var editing by remember { mutableStateOf<String?>(null) }
    var deckMenu by remember { mutableStateOf(false) }
    val history = remember { mutableStateListOf<Reviewed>() }
    val holder = remember { arrayOf<String?>(null) } // id of the card on screen; kept until it is answered
    var shownAt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(20_000)
            now = System.currentTimeMillis()
        }
    }

    val notesById = remember(notes) { notes.associateBy { it.id } }
    val queue = remember(cards, notesById, daily, prefs, now, deckId, buried, extraNew, ahead) {
        buildQueue(
            QueueInput(
                cards = cards,
                eligible = { c -> notesById[c.noteId]?.let { n -> template(n.type, c.template)?.applies(n) == true } == true },
                today = daily.firstOrNull { it.id == dayId(now, prefs.dayStartHour) },
                prefs = prefs.copy(newPerDay = prefs.newPerDay + extraNew),
                now = now, deckId = deckId, buried = buried, learnAheadMs = ahead,
            ),
        )
    }

    // Keep showing the same card until it is answered, even if the queue changes underneath.
    val card: Card? = holder[0]?.let { id -> queue.all.firstOrNull { it.id == id } }
        ?: pickNext(queue, SessionState(session.shown, session.shownNew), now).also { holder[0] = it?.id }
    val note = card?.let { notesById[it.noteId] }
    val tpl = if (card != null && note != null) template(note.type, card.template) else null

    LaunchedEffect(card?.id) {
        revealed = false; typed = ""; verdict = null; shownAt = System.currentTimeMillis()
        if (tpl != null && note != null && prefs.autoSpeak == "front") tpl.speakFront(note)?.let { app.speech.speak(it) }
    }

    fun reveal(v: Verdict? = null) {
        if (revealed || tpl == null || note == null) return
        revealed = true
        if (v != null) verdict = v
        if (prefs.autoSpeak != "off") tpl.speakBack(note)?.let { app.speech.speak(it) }
    }

    fun rate(r: Int) {
        val c = card ?: return
        if (!revealed || busy) return
        busy = true
        val dur = System.currentTimeMillis() - shownAt
        val wasNew = c.state == CardState.NEW
        scope.launch {
            val res = data.review(c, r, dur)
            history.add(res); if (history.size > 10) history.removeAt(0)
            buried = buried + c.noteId
            session = Session(session.answered + 1, session.again + if (r == 1) 1 else 0, session.ms + minOf(dur, 120_000), session.shown + 1, session.shownNew + if (wasNew) 1 else 0)
            holder[0] = null
            now = System.currentTimeMillis()
            busy = false
        }
    }

    fun undo() {
        val last = history.lastOrNull() ?: return
        if (busy) return
        busy = true
        history.removeAt(history.lastIndex)
        scope.launch {
            data.undo(last)
            buried = buried - last.prev.noteId
            session = session.copy(answered = maxOf(0, session.answered - 1), again = maxOf(0, session.again - if (last.delta.rating == 1) 1 else 0), shown = maxOf(0, session.shown - 1), shownNew = maxOf(0, session.shownNew - last.delta.newCards))
            holder[0] = last.prev.id
            now = System.currentTimeMillis()
            busy = false
            toast("Đã hoàn tác lần trả lời trước")
        }
    }

    if (!loaded) return Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Đang tải dữ liệu…", color = Lexi.colors.muted) }

    if (notes.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text("Chưa có từ nào", style = MaterialTheme.typography.titleLarge)
            Text("Thêm từ đầu tiên: chỉ cần gõ từ tiếng Anh, thẻ sẽ tự điền phiên âm, nghĩa và ví dụ.", Modifier.padding(vertical = 12.dp), color = Lexi.colors.muted, textAlign = TextAlign.Center)
            Button(onClick = onAdd) { Icon(Icons.Filled.Add, null); Text("  Thêm từ") }
        }
        return
    }

    val c = Lexi.colors
    val total = queue.counts.new + queue.counts.learning + queue.counts.review
    val doneFrac = if (session.answered + total == 0) 1f else session.answered.toFloat() / (session.answered + total)
    val kind = card?.let { if (it.state == CardState.NEW) "new" else if (it.state == CardState.REVIEW) "review" else "learn" }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Mới ${queue.counts.new}", color = c.easy, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, textDecoration = if (kind == "new") androidx.compose.ui.text.style.TextDecoration.Underline else null)
            Text("Đang học ${queue.counts.learning}", color = c.again, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, textDecoration = if (kind == "learn") androidx.compose.ui.text.style.TextDecoration.Underline else null)
            Text("Ôn ${queue.counts.review}", color = c.good, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, textDecoration = if (kind == "review") androidx.compose.ui.text.style.TextDecoration.Underline else null)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                OutlinedButton(onClick = { deckMenu = true }) { Text(decks.firstOrNull { it.id == deckId }?.name ?: "Tất cả bộ thẻ", fontSize = 13.sp, maxLines = 1) }
                DropdownMenu(expanded = deckMenu, onDismissRequest = { deckMenu = false }) {
                    DropdownMenuItem(text = { Text("Tất cả bộ thẻ") }, onClick = { deckId = null; holder[0] = null; deckMenu = false })
                    for (d in decks) DropdownMenuItem(text = { Text(d.name) }, onClick = { deckId = d.id; holder[0] = null; deckMenu = false })
                }
            }
        }
        LinearProgressIndicator(progress = { doneFrac }, Modifier.fillMaxWidth(), color = c.accent, trackColor = c.line)

        if (card == null || note == null || tpl == null) {
            DoneCard(
                session = session, waitingMs = cards.filter { (it.state == CardState.LEARNING || it.state == CardState.RELEARNING) && !it.suspended && it.due > now && (deckId == null || it.deckId == deckId) }.minOfOrNull { it.due }?.let { it - now },
                hasMoreNew = cards.any { it.state == CardState.NEW && !it.suspended }, canUndo = history.isNotEmpty(),
                onContinue = { ahead = LEARN_AHEAD_MS; holder[0] = null }, onMore = { extraNew += 5; holder[0] = null }, onUndo = ::undo, onAdd = onAdd,
            )
        } else {
            Surface(
                shape = RoundedCornerShape(22.dp), color = c.surface, border = BorderStroke(1.dp, c.line), shadowElevation = 2.dp,
                modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp).then(if (!revealed && tpl.mode == AnswerMode.FLIP) Modifier.clickable { reveal() } else Modifier),
            ) {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                    BlocksView(tpl.front(note, prefs.layout), onSpeak = app.speech::speak)
                    if (tpl.mode == AnswerMode.TYPE && !revealed) {
                        OutlinedTextField(
                            value = typed, onValueChange = { typed = it }, singleLine = true, placeholder = { Text("Gõ đáp án…") },
                            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 20.sp, textAlign = TextAlign.Center),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, autoCorrectEnabled = false),
                            keyboardActions = KeyboardActions(onDone = { reveal(checkTyped(typed, tpl.expected(note))) }),
                            modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { reveal(checkTyped(typed, tpl.expected(note))) }) { Text("Kiểm tra") }
                            TextButton(onClick = { reveal(Verdict.WRONG) }) { Text("Không nhớ") }
                        }
                    }
                    if (revealed) {
                        androidx.compose.material3.HorizontalDivider(color = c.line)
                        verdict?.let { v ->
                            Pill(
                                (when (v) { Verdict.CORRECT -> "Chính xác"; Verdict.CLOSE -> "Gần đúng"; Verdict.WRONG -> "Chưa đúng" }) + if (typed.isNotBlank() && v != Verdict.CORRECT) " · bạn gõ “$typed”" else "",
                                when (v) { Verdict.CORRECT -> PillKind.OK; Verdict.CLOSE -> PillKind.WARN; Verdict.WRONG -> PillKind.BAD },
                            )
                        }
                        BlocksView(tpl.back(note, prefs.layout), onSpeak = app.speech::speak)
                    } else if (tpl.mode == AnswerMode.FLIP) {
                        Text("Chạm thẻ để xem đáp án", color = c.muted, fontSize = 13.sp)
                    }
                }
            }

            if (!revealed && tpl.mode == AnswerMode.FLIP) {
                Button(onClick = { reveal() }, Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("show-answer")) { Text("Hiện đáp án", fontSize = 16.sp) }
            } else if (revealed) {
                val fsrs = remember(prefs.desiredRetention) { Fsrs(prefs.desiredRetention) }
                val suggested = verdict?.let(::suggestedRating)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((r, label) in listOf(1 to "Quên", 2 to "Khó", 3 to "Tốt", 4 to "Dễ")) {
                        val (fg, soft) = when (r) { 1 -> c.again to c.againSoft; 2 -> c.hard to c.hardSoft; 3 -> c.good to c.goodSoft; else -> c.easy to c.easySoft }
                        val next = fsrs.next(card, now, r)
                        Surface(
                            onClick = { rate(r) }, modifier = Modifier.weight(1f).heightIn(min = 62.dp).testTag("rate-$r"), shape = RoundedCornerShape(14.dp),
                            color = if (suggested == r) soft else c.surface, border = BorderStroke(1.5.dp, if (suggested == r) fg else c.line),
                        ) {
                            Column(Modifier.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Text(label, color = fg, fontWeight = FontWeight.Bold)
                                Text(Fsrs.formatInterval(next.due - now), color = c.muted, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Row {
                    TextButton(onClick = ::undo, enabled = history.isNotEmpty()) { Icon(Icons.AutoMirrored.Filled.Undo, null, Modifier.size(16.dp)); Text(" Hoàn tác", fontSize = 13.sp) }
                    TextButton(onClick = { editing = note.id }) { Icon(Icons.Filled.Edit, null, Modifier.size(16.dp)); Text(" Sửa", fontSize = 13.sp) }
                    TextButton(onClick = {
                        val hidden = card
                        scope.launch {
                            data.setSuspended(hidden, true)
                            holder[0] = null
                            toast("Đã ẩn thẻ này")
                        }
                    }) { Icon(Icons.Filled.VisibilityOff, null, Modifier.size(16.dp)); Text(" Ẩn", fontSize = 13.sp) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (isLeech(card)) Pill("Khó · quên ${card.lapses}", PillKind.BAD)
                    Pill(tpl.label.substringBefore(" ("), PillKind.PLAIN)
                }
            }
        }
    }

    editing?.let { id -> notesById[id]?.let { NoteEditor(data, it) { editing = null } } }
}

@Composable
private fun DoneCard(session: Session, waitingMs: Long?, hasMoreNew: Boolean, canUndo: Boolean, onContinue: () -> Unit, onMore: () -> Unit, onUndo: () -> Unit, onAdd: () -> Unit) {
    val c = Lexi.colors
    Panel(Modifier.testTag("session-done")) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (session.answered > 0) "Xong!" else "Hết thẻ hôm nay", fontSize = 34.sp, fontWeight = FontWeight.Bold, color = c.accent)
            if (session.answered > 0) {
                val acc = ((session.answered - session.again) * 100) / session.answered
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat("${session.answered}", "thẻ đã trả lời")
                    Stat("$acc%", "nhớ đúng")
                    Stat("${maxOf(1, (session.ms / 60_000).toInt())}p", "thời gian")
                }
            } else {
                Text("Không có thẻ đến hạn. Quay lại sau, hoặc thêm từ mới.", color = c.muted, textAlign = TextAlign.Center)
            }
            if (waitingMs != null) Text("Còn thẻ đang học, thẻ kế tiếp quay lại sau ${Fsrs.formatInterval(waitingMs)}.", color = c.muted, textAlign = TextAlign.Center)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (waitingMs != null) Button(onClick = onContinue) { Text("Học tiếp ngay") }
                if (hasMoreNew) OutlinedButton(onClick = onMore) { Text("Thêm 5 từ mới") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAdd) { Text("Thêm từ") }
                if (canUndo) TextButton(onClick = onUndo) { Text("Hoàn tác") }
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String) {
    Column(Modifier.background(Lexi.colors.surface2, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 10.dp)) {
        Text(value, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 12.sp, color = Lexi.colors.muted)
    }
}
