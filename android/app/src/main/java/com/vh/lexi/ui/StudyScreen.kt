package com.vh.lexi.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.AnswerMode
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Confusable
import com.vh.lexi.core.answerHint
import com.vh.lexi.core.confusables
import com.vh.lexi.core.letterCount
import com.vh.lexi.core.matchConfusable
import com.vh.lexi.core.str
import com.vh.lexi.core.suggestedRatingWith
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.LEARN_AHEAD_MS
import com.vh.lexi.core.QueueInput
import com.vh.lexi.core.SessionState
import com.vh.lexi.core.Verdict
import com.vh.lexi.core.buildQueue
import com.vh.lexi.core.meaningsByNote
import com.vh.lexi.core.checkTyped
import com.vh.lexi.core.dayId
import com.vh.lexi.core.dueWithin
import com.vh.lexi.core.streak
import com.vh.lexi.core.tagCounts
import com.vh.lexi.core.isLeech
import com.vh.lexi.core.isLesson
import com.vh.lexi.core.lessonTitle
import com.vh.lexi.core.pickNext
import com.vh.lexi.core.template
import com.vh.lexi.data.Reviewed
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.ui.theme.Quicksand
import com.vh.lexi.ui.theme.clay
import com.vh.lexi.ui.theme.gradientPill
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** One answer of this session, for the summary at the end. */
private data class Answered(val noteId: String, val word: String, val vi: String, val rating: Int)
private data class Session(val answered: Int = 0, val again: Int = 0, val ms: Long = 0, val shown: Int = 0, val shownNew: Int = 0, val log: List<Answered> = emptyList())
private const val DAY_MS = 86_400_000L

private fun lessonLabel(t: String, started: Int, total: Int) = "${lessonTitle(t)} · $started/$total" + if (started >= total) " ✓" else ""

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
    // Like Anki's "learn ahead limit": when nothing else is left, a learning card due within 20 minutes is shown now.
    var ahead by remember { mutableLongStateOf(LEARN_AHEAD_MS) }
    // The tab opens on Today; the session starts from its button (or a lesson picked there).
    var started by remember { mutableStateOf(false) }
    // Custom study: one lesson/topic tag, and review cards due in the next N days.
    var tag by remember { mutableStateOf<String?>(null) }
    var aheadDays by remember { mutableStateOf(0) }
    var tagMenu by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var revealed by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var verdict by remember { mutableStateOf<Verdict?>(null) }
    // Typing cards: hint letters shown beyond the first, and the confusable word typed on the first try (one retry).
    var extraHints by remember { mutableStateOf(0) }
    var mixedUp by remember { mutableStateOf<Confusable?>(null) }
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
    val meanings = remember(notes) { meaningsByNote(notes) }
    val tags = remember(notes) { tagCounts(notes.map { it.tags }) }
    // Per tag: notes started (any card past "new"), for "01-contract · 8/12".
    val startedByTag = remember(cards, notes) {
        val studied = cards.filter { it.state != CardState.NEW }.map { it.noteId }.toSet()
        val m = HashMap<String, Int>()
        for (n in notes) if (n.id in studied) for (t in n.tags) m[t] = (m[t] ?: 0) + 1
        m
    }
    val tagNotes = remember(notes, tag) { tag?.let { t -> notes.filter { t in it.tags }.map { it.id }.toSet() } }
    val eligible: (Card) -> Boolean = { c -> notesById[c.noteId]?.let { n -> template(n.type, c.template)?.applies(n) == true } == true }
    val queue = remember(cards, notesById, meanings, daily, prefs, now, deckId, buried, extraNew, ahead, tagNotes, aheadDays) {
        buildQueue(
            QueueInput(
                cards = cards,
                eligible = eligible,
                today = daily.firstOrNull { it.id == dayId(now, prefs.dayStartHour) },
                prefs = prefs.copy(newPerDay = prefs.newPerDay + extraNew),
                now = now, deckId = deckId, buried = buried, learnAheadMs = ahead, meanings = meanings,
                noteIds = tagNotes, reviewAheadDays = aheadDays,
            ),
        )
    }

    // Keep showing the same card until it is answered, even if the queue changes underneath.
    val card: Card? = holder[0]?.let { id -> queue.all.firstOrNull { it.id == id } }
        ?: pickNext(queue, SessionState(session.shown, session.shownNew), now).also { holder[0] = it?.id }
    val note = card?.let { notesById[it.noteId] }
    val tpl = if (card != null && note != null) template(note.type, card.template) else null
    val similar = remember(note, notes) { note?.let { confusables(it, notes) } ?: emptyList() }

    // Keyed by card and turn: a learning card can come straight back (learn-ahead) and must start unanswered again.
    LaunchedEffect(card?.id, session.shown) {
        revealed = false; typed = ""; verdict = null; extraHints = 0; mixedUp = null; shownAt = System.currentTimeMillis()
        // Listening cards always play the sentence; others read the front aloud if the learner chose that.
        if (tpl != null && note != null && (prefs.autoSpeak == "front" || tpl.id == "listen")) tpl.speakFront(note)?.let { app.speech.speak(it) }
    }

    fun reveal(v: Verdict? = null) {
        if (revealed || tpl == null || note == null) return
        revealed = true
        if (v != null) verdict = v
        if (prefs.autoSpeak != "off") tpl.speakBack(note)?.let { app.speech.speak(it) }
    }

    fun submitTyped() {
        if (tpl == null || note == null) return
        val v = checkTyped(typed, tpl.expected(note))
        // Another word of the learner's with this meaning: not a lapse. Say which word it was and allow one more try.
        val other = if (v == Verdict.WRONG && mixedUp == null) matchConfusable(typed, similar) else null
        if (other != null) {
            mixedUp = other
            typed = ""
            return
        }
        reveal(v)
    }

    fun rate(r: Int) {
        val c = card ?: return
        if (!revealed || busy) return
        busy = true
        val dur = System.currentTimeMillis() - shownAt
        val wasNew = c.state == CardState.NEW
        val answered = note?.let { Answered(it.id, it.fields["word"].str(), it.fields["vi"].str(), r) }
        scope.launch {
            val res = data.review(c, r, dur)
            history.add(res); if (history.size > 10) history.removeAt(0)
            buried = buried + c.noteId
            session = Session(session.answered + 1, session.again + if (r == 1) 1 else 0, session.ms + minOf(dur, 120_000), session.shown + 1, session.shownNew + if (wasNew) 1 else 0, if (answered != null) session.log + answered else session.log)
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
            session = session.copy(answered = maxOf(0, session.answered - 1), again = maxOf(0, session.again - if (last.delta.rating == 1) 1 else 0), shown = maxOf(0, session.shown - 1), shownNew = maxOf(0, session.shownNew - last.delta.newCards), log = session.log.dropLast(1))
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

    if (!started) {
        TodayPanel(
            cards = cards, notesById = notesById, queue = queue, daily = daily, dayStartHour = prefs.dayStartHour, newPerDay = prefs.newPerDay, now = now,
            lessons = tags.filter { isLesson(it.first) }.map { LessonProgress(it.first, startedByTag[it.first] ?: 0, it.second) },
            onStart = { started = true; holder[0] = null },
            onLesson = { t -> tag = t; aheadDays = 0; started = true; holder[0] = null },
        )
        return
    }

    val c = Lexi.colors
    val total = queue.counts.new + queue.counts.learning + queue.counts.review
    val doneFrac = if (session.answered + total == 0) 1f else session.answered.toFloat() / (session.answered + total)
    val kind = card?.let { if (it.state == CardState.NEW) "new" else if (it.state == CardState.REVIEW) "review" else "learn" }
    val answer = if (note != null && tpl != null) tpl.expected(note).firstOrNull() ?: "" else ""
    val letters = letterCount(answer)

    val fsrs = remember(prefs.desiredRetention, prefs.fsrsWeights) { prefs.fsrs() }
    val suggested = verdict?.let { suggestedRatingWith(it, extraHints, mixedUp != null) }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Deck picker on its own line: next to the three count chips it was squeezed to one letter on a 320dp phone.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f, fill = false)) {
                    OutlinedButton(onClick = { deckMenu = true }, Modifier.testTag("deck-pick")) {
                        Text(decks.firstOrNull { it.id == deckId }?.name ?: "Tất cả bộ thẻ", fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    DropdownMenu(expanded = deckMenu, onDismissRequest = { deckMenu = false }) {
                        DropdownMenuItem(text = { Text("Tất cả bộ thẻ") }, onClick = { deckId = null; holder[0] = null; deckMenu = false })
                        for (d in decks) DropdownMenuItem(text = { Text(d.name) }, onClick = { deckId = d.id; holder[0] = null; deckMenu = false })
                    }
                }
                if (tags.isNotEmpty()) Box(Modifier.weight(1f, fill = false)) {
                    OutlinedButton(onClick = { tagMenu = true }, Modifier.testTag("tag-pick")) {
                        Text(tag?.let(::lessonTitle) ?: "Tất cả bài", fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    DropdownMenu(expanded = tagMenu, onDismissRequest = { tagMenu = false }) {
                        DropdownMenuItem(text = { Text("Tất cả bài") }, onClick = { tag = null; aheadDays = 0; holder[0] = null; tagMenu = false })
                        for ((t, n) in tags) DropdownMenuItem(text = { Text(lessonLabel(t, startedByTag[t] ?: 0, n)) }, onClick = { tag = t; aheadDays = 0; holder[0] = null; tagMenu = false })
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CountChip("Mới ${queue.counts.new}", c.easy, kind == "new")
                CountChip("Đang học ${queue.counts.learning}", c.again, kind == "learn")
                CountChip("Ôn ${queue.counts.review}", c.good, kind == "review")
            }
            LinearProgressIndicator(progress = { doneFrac }, Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)), color = c.accent, trackColor = c.line, gapSize = 0.dp, drawStopIndicator = {})

            if (card == null || note == null || tpl == null) {
                val nextLesson = tag?.let { t ->
                    val i = tags.indexOfFirst { it.first == t }
                    if ((startedByTag[t] ?: 0) < (tags.getOrNull(i)?.second ?: 0)) null
                    else tags.drop(i + 1).firstOrNull { isLesson(it.first) && (startedByTag[it.first] ?: 0) < it.second }?.first
                }
                DoneCard(
                    streak = streak(daily, now, prefs.dayStartHour), dueTomorrow = dueWithin(cards, eligible, now, prefs.dayStartHour, 1, deckId, tagNotes),
                    nextLesson = nextLesson, onLesson = { t -> tag = t; aheadDays = 0; holder[0] = null },
                    session = session, waitingMs = cards.filter { (it.state == CardState.LEARNING || it.state == CardState.RELEARNING) && !it.suspended && it.due > now && (deckId == null || it.deckId == deckId) }.minOfOrNull { it.due }?.let { it - now },
                    hasMoreNew = cards.any { it.state == CardState.NEW && !it.suspended && eligible(it) && (deckId == null || it.deckId == deckId) && (tagNotes == null || it.noteId in tagNotes) }, canUndo = history.isNotEmpty(),
                    aheadCount = dueWithin(cards, eligible, now, prefs.dayStartHour, aheadDays + 1, deckId, tagNotes) - dueWithin(cards, eligible, now, prefs.dayStartHour, aheadDays, deckId, tagNotes),
                    onContinue = { ahead = DAY_MS; holder[0] = null }, onMore = { extraNew += 5; holder[0] = null }, onAhead = { aheadDays += 1; holder[0] = null }, onUndo = ::undo, onAdd = onAdd,
                )
            } else {
                val mode = modeColor(tpl.id)
                // Each new card eases in (fade + small rise) instead of popping, so a long session feels calmer.
                val appear = remember(card.id, session.shown) { Animatable(0f) }
                LaunchedEffect(card.id, session.shown) { appear.animateTo(1f, tween(280)) }
                Box(
                    modifier = Modifier.fillMaxWidth().heightIn(min = 320.dp)
                        .graphicsLayer { alpha = appear.value; translationY = (1f - appear.value) * 28f; val s = 0.97f + 0.03f * appear.value; scaleX = s; scaleY = s }
                        .clay(c, RoundedCornerShape(32.dp)).clip(RoundedCornerShape(32.dp))
                        .then(if (!revealed && tpl.mode == AnswerMode.FLIP) Modifier.clickable { reveal() } else Modifier),
                ) {
                  Column {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 24.dp).animateContentSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically)) {
                        // What the card asks for; once answered, the space goes to the answer so the rating row stays in view.
                        if (!revealed) ModeHeader(tpl.id, tpl.label, mode)
                        BlocksView(tpl.front(note, prefs.layout), onSpeak = app.speech::speak, onSpeakSlow = app.speech::speakSlow, mode = mode)
                        if (tpl.mode == AnswerMode.TYPE && !revealed && answer.isNotEmpty()) {
                            AnswerHint(answerHint(answer, 1 + extraHints), letters, answer.trim().split(Regex("\\s+")).size, mode)
                            if (similar.isNotEmpty()) NotThese(similar.take(3))
                        }
                        if (tpl.mode == AnswerMode.TYPE && !revealed) {
                            OutlinedTextField(
                                value = typed, onValueChange = { typed = it }, singleLine = true, placeholder = { Text("Gõ đáp án…") },
                                // Part of the field, so keepVisibleWhileTyping keeps it above the keyboard together with the input.
                                supportingText = mixedUp?.let { o -> { MixedUp(o) } },
                                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 20.sp, textAlign = TextAlign.Center),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done, autoCorrectEnabled = false),
                                keyboardActions = KeyboardActions(onDone = { submitTyped() }),
                                modifier = Modifier.fillMaxWidth().keepVisibleWhileTyping(),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { submitTyped() }, Modifier.testTag("type-check")) { Text("Kiểm tra") }
                                TextButton(onClick = { reveal(Verdict.WRONG) }) { Text("Không nhớ") }
                            }
                            if (letters - 1 - extraHints > 1) {
                                OutlinedButton(onClick = { extraHints++ }, Modifier.testTag("more-hint")) { Text("Gợi ý thêm chữ") }
                            }
                        }
                        if (revealed) {
                            androidx.compose.material3.HorizontalDivider(color = c.line)
                            verdict?.let { v ->
                                Pill(
                                    (when (v) { Verdict.CORRECT -> "✓ Chính xác"; Verdict.CLOSE -> "✓ Gần đúng"; Verdict.WRONG -> "✕ Chưa đúng" }) +
                                        (if (typed.isNotBlank() && v != Verdict.CORRECT) " · bạn gõ “$typed”" else "") +
                                        (mixedUp?.let { " · lần đầu gõ “${it.word}”" } ?: if (extraHints > 0) " · có dùng gợi ý" else ""),
                                    when (v) { Verdict.CORRECT -> PillKind.OK; Verdict.CLOSE -> PillKind.WARN; Verdict.WRONG -> PillKind.BAD },
                                    Modifier.testTag("verdict"),
                                    wrap = true,
                                )
                            }
                            BlocksView(tpl.back(note, prefs.layout), onSpeak = app.speech::speak, onSpeakSlow = app.speech::speakSlow, mode = mode)
                        } else if (tpl.mode == AnswerMode.FLIP) {
                            Text("Chạm thẻ để xem đáp án", color = c.muted, fontSize = 13.sp)
                        }
                    }
                  }
                }

                if (revealed) {
                    if (similar.isNotEmpty()) Compare(note.fields["word"].str(), note.fields["pos"].str(), note.fields["en"].str(), similar.take(3))
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
                    }
                }
            }
        }

        // Pinned under the scrolling card: two examples with translations must not push the buttons off the screen.
        if (card != null && note != null && tpl != null && (revealed || tpl.mode == AnswerMode.FLIP)) {
            Box(Modifier.fillMaxWidth().background(c.bg).padding(horizontal = 16.dp, vertical = 10.dp)) {
                if (!revealed && tpl.mode == AnswerMode.FLIP) {
                    PrimaryPill("Hiện đáp án", { reveal() }, Modifier.fillMaxWidth().testTag("show-answer"), big = false)
                } else if (revealed) {
                    // Pastel buttons with ink labels; the one suggested by the typed answer gets a ring in its own deep tone.
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        for ((r, label) in listOf(1 to "Quên", 2 to "Khó", 3 to "Tốt", 4 to "Dễ")) {
                            val (fg, soft) = when (r) { 1 -> c.again to c.againSoft; 2 -> c.hard to c.hardSoft; 3 -> c.good to c.goodSoft; else -> c.easy to c.easySoft }
                            val next = fsrs.next(card, now, r)
                            val shape = RoundedCornerShape(24.dp)
                            Surface(
                                onClick = { rate(r) }, modifier = Modifier.weight(1f).heightIn(min = 66.dp).testTag("rate-$r"), shape = shape,
                                color = soft, border = if (suggested == r) BorderStroke(2.5.dp, fg) else BorderStroke(1.5.dp, Brush.verticalGradient(0f to c.hi, 0.4f to Color.Transparent)),
                                shadowElevation = 3.dp,
                            ) {
                                Column(Modifier.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                    Text(label, color = c.ink, fontFamily = Quicksand, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                    Text(Fsrs.formatInterval(next.due - now), color = c.muted, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    editing?.let { id -> notesById[id]?.let { NoteEditor(data, it) { editing = null } } }
}

/** What the card asks for, in the learner's words; shown at the top of the card. */
private val MODE_TITLE = mapOf("recognize" to "Nhớ nghĩa của từ", "recall" to "Gõ từ tiếng Anh", "cloze" to "Điền từ vào câu", "listen" to "Nghe và gõ từ")

/** The question under the title, where the mode needs one. */
private val MODE_Q = mapOf("recall" to "Từ tiếng Anh nào có nghĩa là…", "listen" to "Nghe câu, gõ từ còn thiếu. Bấm loa để nghe lại.")

/** One colour per kind of card (same as the web app). */
@Composable
private fun modeColor(templateId: String): Color {
    val c = Lexi.colors
    return when (templateId) { "recall" -> c.easy; "cloze" -> c.hard; "listen" -> c.listen; else -> c.accent }
}

@Composable
private fun ModeHeader(templateId: String, label: String, mode: Color) {
    val c = Lexi.colors
    Column(Modifier.fillMaxWidth().testTag("card-mode"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            Modifier.background(mode.copy(alpha = 0.14f).compositeOver(c.surface), CircleShape).padding(start = 10.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(8.dp).background(mode, CircleShape))
            Text((MODE_TITLE[templateId] ?: label).uppercase(), fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.7.sp, color = mode)
        }
        MODE_Q[templateId]?.let { Text(it, fontSize = 14.sp, lineHeight = 20.sp, color = c.muted, textAlign = TextAlign.Center) }
    }
}

/** Queue count as a small chip; the kind of the card on screen is outlined. */
@Composable
private fun CountChip(text: String, color: Color, on: Boolean) {
    val c = Lexi.colors
    Text(
        text, Modifier.clay(c, CircleShape, elevation = 3.dp).then(if (on) Modifier.border(2.dp, color, CircleShape) else Modifier).padding(horizontal = 12.dp, vertical = 5.dp),
        color = color, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp, maxLines = 1,
    )
}

/** The answer's first letter(s) and its length: "c _ _ _ _ _ _ _", "8 chữ cái". */
@Composable
private fun AnswerHint(hint: String, letters: Int, words: Int, mode: Color) {
    val c = Lexi.colors
    // Narrower cells for long answers so "procrastination" still fits on one line of a phone card.
    val long = hint.length > 11
    val cell = if (long) 13.dp else 20.dp
    Column(Modifier.testTag("answer-hint"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(if (long) 3.dp else 4.dp)) {
            for (ch in hint) {
                if (ch == ' ') Spacer(Modifier.width(cell / 2))
                else Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (ch == '_') "" else ch.toString(), Modifier.width(cell), fontSize = if (long) 15.sp else 19.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = mode, textAlign = TextAlign.Center)
                    Box(Modifier.width(cell).height(2.5.dp).background(if (ch == '_') c.line else mode))
                }
            }
        }
        Text((if (words > 1) "$words từ, " else "") + "$letters chữ cái", fontSize = 12.sp, color = c.muted)
    }
}

@Composable
private fun NotThese(others: List<Confusable>) {
    val c = Lexi.colors
    val text = buildAnnotatedString {
        append("Trong bộ thẻ của bạn, ")
        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("không phải") }
        append(": ")
        others.forEachIndexed { i, o ->
            if (i > 0) append(" · ")
            withStyle(SpanStyle(color = c.ink, textDecoration = TextDecoration.LineThrough)) { append(o.word) }
        }
    }
    Text(text, Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 6.dp).testTag("not-these"), fontSize = 13.sp, color = c.muted, textAlign = TextAlign.Center)
}

/** First try was another of the learner's words with this meaning: name it, show its definition, allow a retry. */
@Composable
private fun MixedUp(other: Confusable) {
    val c = Lexi.colors
    Column(Modifier.fillMaxWidth().testTag("mixed-up"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Pill("Đúng nghĩa, nhưng là từ khác: ${other.word}", PillKind.WARN, wrap = true)
        Text("Gõ lại một lần, lần này không tính là quên.", fontSize = 13.sp, color = c.muted, textAlign = TextAlign.Center)
        if (other.en.isNotEmpty()) {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(other.word) }
                    append((if (other.pos.isNotEmpty()) " (${other.pos})" else "") + ": " + other.en)
                },
                Modifier.background(c.surface2, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 6.dp), fontSize = 13.sp, color = c.ink, textAlign = TextAlign.Center,
            )
        }
    }
}

/** After the answer: the word under review next to the learner's words it is easy to mix up with. */
@Composable
private fun Compare(word: String, pos: String, en: String, others: List<Confusable>) {
    val c = Lexi.colors
    @Composable
    fun Item(w: String, p: String, vi: String, def: String, mine: Boolean) {
        Column(Modifier.fillMaxWidth().background(if (mine) c.accentSoft else c.surface2, RoundedCornerShape(18.dp)).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(w, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.ink)
            if (p.isNotEmpty()) Text(p, fontSize = 12.sp, color = c.muted)
            if (vi.isNotEmpty()) Text(vi, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.ink)
            if (def.isNotEmpty()) Text(def, fontSize = 13.sp, color = c.ink)
        }
    }
    Column(Modifier.fillMaxWidth().testTag("compare"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("DỄ NHẦM VỚI", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.7.sp, color = c.muted)
        Item(word, pos, "", en, mine = true)
        for (o in others) Item(o.word, o.pos, o.vi, o.en, mine = false)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DoneCard(
    session: Session, waitingMs: Long?, streak: Int, dueTomorrow: Int, nextLesson: String?, onLesson: (String) -> Unit,
    hasMoreNew: Boolean, canUndo: Boolean, aheadCount: Int, onContinue: () -> Unit, onMore: () -> Unit, onAhead: () -> Unit, onUndo: () -> Unit, onAdd: () -> Unit,
) {
    val c = Lexi.colors
    // Last answer per word, keeping the worst: a word forgotten then got right in its learning step counts as forgotten.
    val words = LinkedHashMap<String, Answered>()
    for (a in session.log) { val prev = words[a.noteId]; words[a.noteId] = if (prev != null && prev.rating < a.rating) prev else a }
    val list = words.values.sortedBy { it.rating }
    val forgot = list.filter { it.rating == 1 }
    Panel(Modifier.testTag("session-done")) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (session.answered > 0) StreakBubble(streak)
            Text(if (session.answered > 0) "Xong phần này!" else "Hết thẻ hôm nay", fontFamily = Quicksand, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = c.ink)
            if (session.answered > 0) {
                val acc = ((session.answered - session.again) * 100) / session.answered
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat("${words.size}", "từ đã ôn")
                    Stat("$acc%", "nhớ đúng")
                    Stat("${maxOf(1, (session.ms / 60_000).toInt())}p", "thời gian")
                }
            } else {
                Text("Không có thẻ đến hạn. Quay lại sau, hoặc thêm từ mới.", color = c.muted, textAlign = TextAlign.Center)
            }
            if (forgot.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().background(c.againSoft, RoundedCornerShape(20.dp)).padding(horizontal = 14.dp, vertical = 10.dp).testTag("recap-forgot"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("CẦN CHÚ Ý", fontSize = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.7.sp, color = c.again)
                    for (a in forgot.take(6)) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(a.word, fontWeight = FontWeight.Bold)
                        Text(a.vi, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (list.isNotEmpty()) {
                FlowRow(Modifier.fillMaxWidth().testTag("recap"), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (a in list) {
                        val (fg, soft) = when (a.rating) { 1 -> c.again to c.againSoft; 2 -> c.hard to c.hardSoft; 3 -> c.good to c.goodSoft; else -> c.easy to c.easySoft }
                        Text(a.word, Modifier.background(soft, CircleShape).padding(horizontal = 12.dp, vertical = 4.dp), color = fg, fontWeight = FontWeight.ExtraBold, fontSize = 13.sp)
                    }
                }
            }
            if (waitingMs != null) Text("Còn thẻ đang học, thẻ kế tiếp quay lại sau ${Fsrs.formatInterval(waitingMs)}.", color = c.muted, textAlign = TextAlign.Center)
            else if (session.answered > 0) Text(if (dueTomorrow > 0) "Ngày mai có $dueTomorrow thẻ cần ôn." else "Ngày mai chưa có thẻ nào đến hạn.", color = c.muted, textAlign = TextAlign.Center)
            if (nextLesson != null) PrimaryPill("Sang bài tiếp: ${lessonTitle(nextLesson)}", { onLesson(nextLesson) }, Modifier.testTag("next-lesson"))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (waitingMs != null) Button(onClick = onContinue) { Text("Học tiếp ngay") }
                if (hasMoreNew) OutlinedButton(onClick = onMore) { Text("Thêm 5 từ mới") }
            }
            if (aheadCount > 0) OutlinedButton(onClick = onAhead, Modifier.testTag("review-ahead")) { Text("Ôn trước $aheadCount thẻ sắp đến hạn") }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onAdd) { Text("Thêm từ") }
                if (canUndo) TextButton(onClick = onUndo) { Text("Hoàn tác") }
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String) {
    Column(Modifier.background(Lexi.colors.surface2, RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontFamily = Quicksand, fontSize = 22.sp, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Lexi.colors.muted)
    }
}

/**
 * The finish screen's reward: a glossy lavender bubble with the streak (or a tick) that pops in with a bounce, and a few
 * small bubbles drifting up from behind it (Study.tsx: motion.ts celebrate()).
 */
@Composable
private fun StreakBubble(streak: Int) {
    val c = Lexi.colors
    val pop = remember { Animatable(0f) }
    val drift = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        launch { pop.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = 260f)) }
        drift.animateTo(1f, tween(1800, delayMillis = 150, easing = FastOutSlowInEasing))
    }
    val fizz = listOf(c.accent2, c.peach, c.mint, c.butter, c.rose)
    Box(Modifier.size(170.dp, 150.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val t = drift.value
            if (t <= 0f || t >= 1f) return@Canvas
            for (i in 0 until 12) {
                val angle = (-90f + (i - 5.5f) * 13f) * (PI.toFloat() / 180f)
                val dist = (60f + (i * 37 % 50)) * density * t
                val r = (4f + (i * 7 % 6)) * density * (1f - 0.4f * t)
                drawCircle(fizz[i % fizz.size], r, Offset(center.x + cos(angle) * dist, center.y + sin(angle) * dist), alpha = (1f - t) * 0.9f)
            }
        }
        Box(
            Modifier.size(124.dp).graphicsLayer { scaleX = 0.3f + 0.7f * pop.value; scaleY = 0.3f + 0.7f * pop.value; alpha = pop.value.coerceIn(0f, 1f) }
                .gradientPill(c, CircleShape)
                .background(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.45f), Color.Transparent), center = Offset(110f, 95f), radius = 150f), CircleShape)
                .semantics(mergeDescendants = true) { contentDescription = if (streak > 0) "$streak ngày học liên tiếp" else "Đã xong" },
            contentAlignment = Alignment.Center,
        ) {
            if (streak > 0) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("$streak", fontFamily = Quicksand, fontSize = 40.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("ngày liền", fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = Color.White.copy(alpha = 0.92f))
            } else Icon(Icons.Filled.Check, null, Modifier.size(54.dp), tint = Color.White)
        }
    }
}
