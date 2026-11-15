package com.vh.lexi.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.vh.lexi.LexiApp
import androidx.compose.runtime.rememberCoroutineScope
import com.vh.lexi.core.AudioSplit
import com.vh.lexi.core.MarkError
import com.vh.lexi.core.MarkField
import com.vh.lexi.core.PartCuts
import com.vh.lexi.core.PartWindow
import com.vh.lexi.core.TestSet
import com.vh.lexi.core.clearMark
import com.vh.lexi.core.formatClock
import com.vh.lexi.core.markParts
import com.vh.lexi.core.parseClock
import com.vh.lexi.core.partWindow
import com.vh.lexi.core.setMark
import com.vh.lexi.core.trackOf
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.util.AudioLevels
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Where each Part of a one-file Listening test is in the audio: the learner plays the file, taps "Đặt … tại" at the moment
 * a Part begins or ends (or types the time) and nudges it second by second. Saved with the set (web: ui/PartMarks.tsx).
 */

/** Change a set's Part marks in the stored set (not the copy a screen started with); the store saves and syncs it. */
internal fun updateCuts(app: LexiApp, id: String, change: (PartCuts) -> PartCuts) {
    val s = app.testSets.sets.value.firstOrNull { it.id == id } ?: return
    val c = change(s.cuts)
    if (c != s.cuts) app.testSets.saveSoon(app.scope, s.copy(cuts = c))
}

private fun errorText(e: MarkError) = when (e) {
    MarkError.NEGATIVE -> "Thời gian không hợp lệ."
    MarkError.ORDER -> "Mốc phải tăng dần: Part sau không được nằm trước Part trước, và Part phải kết thúc sau khi bắt đầu."
}

/** A row of the editor: one moment to set. A boundary is the end of one Part and the start of the next. */
private sealed class MarkRow(val id: String, val label: String, val note: String) {
    class Start(val part: Int, label: String, note: String) : MarkRow("s$part", label, note)
    class End(val part: Int, label: String, note: String) : MarkRow("e$part", label, note)
    class Bound(val a: Int, val b: Int, label: String, note: String) : MarkRow("b$a", label, note)

    val hasDefault get() = note.startsWith("mặc định")
}

private fun rowsOf(cuts: PartCuts, order: List<Int>): List<MarkRow> {
    val rows = mutableListOf<MarkRow>()
    rows += MarkRow.Start(order.first(), "Bắt đầu Part ${order.first()}", "mặc định 0:00")
    for (i in 0 until order.size - 1) {
        val a = order[i]
        val b = order[i + 1]
        val e = cuts[a]?.end
        val s = cuts[b]?.start
        if (e != null && s != null && e != s) {
            rows += MarkRow.End(a, "Kết thúc Part $a", "")
            rows += MarkRow.Start(b, "Bắt đầu Part $b", "")
        } else rows += MarkRow.Bound(a, b, "Part $a | Part $b", "kết thúc Part $a cũng là bắt đầu Part $b")
    }
    rows += MarkRow.End(order.last(), "Kết thúc Part ${order.last()}", "mặc định hết file")
    return rows
}

private fun valueOf(cuts: PartCuts, r: MarkRow): Long? = when (r) {
    is MarkRow.Start -> cuts[r.part]?.start
    is MarkRow.End -> cuts[r.part]?.end
    is MarkRow.Bound -> cuts[r.a]?.end ?: cuts[r.b]?.start
}

private fun MarkRow.partAndField(): Pair<Int, MarkField> = when (this) {
    is MarkRow.Start -> part to MarkField.START
    is MarkRow.End -> part to MarkField.END
    is MarkRow.Bound -> a to MarkField.END
}

private fun MarkRow.firstPart(): Int = when (this) { is MarkRow.Start -> part; is MarkRow.End -> part; is MarkRow.Bound -> a }

/** What a file looks like: its loudest level per second and its long silences. Kept while the app runs (decoding is the cost). */
private class Wave(val env: List<Double>, val gaps: List<Pair<Long, Long>>, val durationMs: Long)

private val waves = mutableMapOf<String, Wave>()

/**
 * The file drawn as a strip of bars (one per second) with its long silences shaded, the marks as lines and the playhead:
 * tap to move there. The silences are where a Part may begin or end, shown for the learner to judge, not decided for them.
 */
@Composable
private fun Waveform(wave: Wave, marks: List<Long>, at: Long, onSeek: (Long) -> Unit) {
    val c = Lexi.colors
    val accent = c.accent
    val ink = c.ink
    Canvas(
        Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(12.dp)).background(c.surface2)
            .pointerInput(wave) { detectTapGestures { o -> onSeek((o.x / size.width * wave.durationMs).toLong().coerceIn(0, wave.durationMs)) } }
            .testTag("marks-wave"),
    ) {
        val w = size.width
        val h = size.height
        fun x(ms: Long) = ms.toFloat() / maxOf(1L, wave.durationMs) * w
        for ((a, b) in wave.gaps) if (b - a >= AudioSplit.ANSWER_PAUSE_MS) drawRect(accent.copy(alpha = 0.16f), Offset(x(a), 0f), Size(maxOf(2f, x(b) - x(a)), h))
        val bar = w / maxOf(1, wave.env.size)
        wave.env.forEachIndexed { i, db ->
            val k = ((db + 60) / 60).coerceIn(0.04, 1.0).toFloat()
            drawRect(accent.copy(alpha = 0.85f), Offset(i * bar + bar * 0.1f, h / 2 - h * k / 2), Size(maxOf(1f, bar * 0.8f), h * k))
        }
        for (m in marks) drawLine(ink, Offset(x(m), 0f), Offset(x(m), h), strokeWidth = 3f)
        drawLine(Color(0xFFE5484D), Offset(x(at), 0f), Offset(x(at), h), strokeWidth = 3f)
    }
}

private val SKIPS = listOf(-10_000, -5_000, -1_000, 1_000, 5_000, 10_000)
private fun skipLabel(ms: Int) = (if (ms < 0) "−" else "+") + (kotlin.math.abs(ms) / 1000)

/** A key of the seek row: a plain box, so seven of them share a narrow phone's width evenly. */
@Composable
private fun SkipKey(label: String, tag: String, modifier: Modifier, primary: Boolean = false, content: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val c = Lexi.colors
    Box(
        modifier.height(46.dp).clip(RoundedCornerShape(14.dp)).background(if (primary) c.accent else c.surface2)
            .clickable(role = Role.Button, onClick = onClick).testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content() else Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.ink, maxLines = 1)
    }
}

/** Pauses the sound and the clock when the app goes to the background; frees the player when the screen closes. */
@Composable
private fun rememberPlayer(app: LexiApp, set: TestSet): ListenPlayer {
    val toast = LocalToaster.current
    val player = remember(set.id) { ListenPlayer(set.tracks, app.testSets::mediaFile) { toast(it) } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs); player.release() }
    }
    return player
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PartMarksEditor(app: LexiApp, set: TestSet, part: Int?, onClose: () -> Unit) {
    val toast = LocalToaster.current
    val c = Lexi.colors
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val player = rememberPlayer(app, set)
    val cuts = set.cuts
    val order = remember(set.questions) { markParts(set.questions) }
    val rows = rowsOf(cuts, order)
    val firstRow = rows.firstOrNull { r -> if (r is MarkRow.Bound) r.a == part || r.b == part else r.firstPart() == part } ?: rows.first()
    var sel by rememberSaveable { mutableStateOf(firstRow.id) }
    val row = rows.firstOrNull { it.id == sel } ?: rows.first()
    var typed by rememberSaveable { mutableStateOf(valueOf(cuts, firstRow)?.let(::formatClock) ?: "") }
    var drag by remember { mutableStateOf<Float?>(null) }
    var clearing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var wave by remember { mutableStateOf<Wave?>(null) }
    var drawing by remember { mutableStateOf(false) }
    val trackNow = player.track ?: trackOf(cuts, order, row.firstPart())
    // The playhead is shown (and set as a mark) in whole seconds: what is read is what is saved.
    val atMs: Long = if (player.track != null) (drag?.toLong() ?: player.atMs.toLong()) / 1000 * 1000 else 0L

    // The file is opened (at the first mark) so its length is known and the slider works.
    LaunchedEffect(player) { player.seekTo(trackNow, valueOf(cuts, firstRow) ?: 0L) }

    fun pick(r: MarkRow) {
        sel = r.id
        val v = valueOf(cuts, r)
        typed = v?.let(::formatClock) ?: ""
        // The playhead goes to the mark, so nudging starts from it.
        if (v != null) player.seekTo(trackOf(cuts, order, r.firstPart()), v)
    }

    /** Sets the selected moment to [ms]; false (and says why) when it would put the Parts out of order. */
    fun apply(ms: Long): Boolean {
        val (p, f) = row.partAndField()
        val check = setMark(cuts, order, p, f, ms, trackNow, true)
        if (check.error != null) { toast(errorText(check.error!!)); return false }
        updateCuts(app, set.id) { setMark(it, order, p, f, ms, trackNow, true).cuts }
        typed = formatClock(ms)
        return true
    }

    fun applyTyped() {
        // The keyboard closes: it would cover the seek keys just below the field.
        focus.clearFocus()
        keyboard?.hide()
        val ms = parseClock(typed) ?: return toast("Nhập dạng mm:ss, ví dụ 21:34 (hoặc 1:02:03, hoặc số giây).")
        if (apply(ms)) player.seekTo(trackNow, ms)
    }

    fun drawWave() {
        val t = set.tracks.getOrNull(trackNow) ?: return
        waves[t.key]?.let { wave = it; return }
        drawing = true
        scope.launch {
            try {
                val w = withContext(Dispatchers.IO) {
                    val l = AudioLevels.read(app.testSets.mediaFile(t.key).takeIf { it.exists() } ?: error("missing audio"))
                    Wave(AudioSplit.envelope(l.levels), AudioSplit.findGaps(l.levels), l.durationMs)
                }
                waves[t.key] = w
                wave = w
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                toast("Không đọc được file nghe để vẽ sóng âm")
            } finally {
                drawing = false
            }
        }
    }

    /** Playhead and box go to a suggested moment, to be listened to and confirmed with "Đặt". */
    fun goTo(ms: Long) {
        val t = Math.round(ms / 100.0) * 100
        typed = formatClock(t)
        player.seekTo(trackNow, t)
    }

    fun nudgeBy(ms: Int) = player.skip(ms)
    fun listenFrom(ms: Long?, back: Long = 0) = player.playWindow(trackNow, maxOf(0L, (ms ?: 0L) - back), null)
    fun togglePlay() { if (player.playing) player.pause() else if (player.track == null) listenFrom(valueOf(cuts, row)) else player.toggle() }

    val filled = order.count { partWindow(cuts, order, it) is PartWindow.Ok }
    val duration = player.durationMs
    val v = valueOf(cuts, row)

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp).testTag("marks-editor"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose, Modifier.testTag("marks-close")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Quay lại") }
            Text("Mốc Part · ${set.name}", Modifier.weight(1f), fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Pill("$filled/${order.size} Part", if (filled == order.size) PillKind.OK else PillKind.WARN, Modifier.testTag("marks-count"))
        }
        Panel(Modifier.testTag("marks-player")) {
            Text(formatClock(atMs), Modifier.fillMaxWidth().testTag("marks-at"), fontSize = 44.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            Slider(
                value = (drag ?: player.atMs.toFloat()).coerceIn(0f, maxOf(1, duration).toFloat()),
                onValueChange = { drag = it },
                onValueChangeFinished = { drag?.let { player.seekTo(trackNow, it.toLong()) }; drag = null },
                valueRange = 0f..maxOf(1, duration).toFloat(),
                modifier = Modifier.testTag("marks-seek"),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("0:00", fontSize = 12.sp, color = c.muted)
                Text(if (duration > 0) "tổng ${formatClock(duration / 1000 * 1000L)}" else "", fontSize = 12.sp, color = c.muted)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (ms in SKIPS.take(3)) SkipKey(skipLabel(ms), "skip$ms", Modifier.weight(1f)) { nudgeBy(ms) }
                SkipKey("", "marks-play", Modifier.weight(1.3f), primary = true, content = {
                    Icon(if (player.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (player.playing) "Tạm dừng" else "Phát", tint = c.onAccent)
                }) { togglePlay() }
                for (ms in SKIPS.drop(3)) SkipKey(skipLabel(ms), "skip+$ms", Modifier.weight(1f)) { nudgeBy(ms) }
            }
            Button(onClick = { apply(atMs) }, Modifier.fillMaxWidth().testTag("marks-here")) { Text("Đặt “${row.label}” tại ${formatClock(atMs)}", maxLines = 2) }
            Text("Nghe tới lúc Part bắt đầu (hoặc kết thúc), tua từng giây cho đúng, rồi bấm đặt.", fontSize = 12.sp, color = c.muted)
        }
        Panel(Modifier.testTag("marks-wave-panel")) {
            val wv = wave
            if (wv != null) {
                Waveform(wv, rows.mapNotNull { valueOf(cuts, it) }, atMs, ::goTo)
                Text("Khoảng lặng gần ${row.label}:", fontSize = 12.sp, color = c.muted)
                FlowRow(Modifier.testTag("marks-suggest"), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AudioSplit.snapCandidates(wv.gaps, valueOf(cuts, row) ?: atMs).forEachIndexed { i, ms ->
                        OutlinedButton(onClick = { goTo(ms) }, Modifier.testTag("marks-suggest-$i")) { Text(formatClock(Math.round(ms / 100.0) * 100)) }
                    }
                }
                Text("Vùng tô đậm là khoảng lặng từ 2,5 giây. Chạm vào một gợi ý để nghe lại, đúng thì bấm “Đặt”. Lexi không tự đặt mốc.", fontSize = 12.sp, color = c.muted)
            } else OutlinedButton(onClick = ::drawWave, enabled = !drawing, modifier = Modifier.fillMaxWidth().testTag("marks-wave-draw")) {
                Text(if (drawing) "Đang đọc file nghe…" else "Vẽ sóng âm và gợi ý khoảng lặng")
            }
        }
        Panel(Modifier.testTag("marks-rows")) {
            for (r in rows) {
                val value = valueOf(cuts, r)
                val on = r.id == row.id
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (on) c.accent.copy(alpha = 0.16f) else c.surface2).testTag("mark-${r.id}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(Modifier.weight(1f).clickable { pick(r) }.padding(horizontal = 12.dp, vertical = 12.dp).testTag("mark-pick-${r.id}"), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(r.label, fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Text(
                            value?.let(::formatClock) ?: if (r.hasDefault) r.note else "chưa đặt", Modifier.testTag("mark-time-${r.id}"),
                            fontSize = 14.sp, fontWeight = FontWeight.Bold, color = if (value == null && !r.hasDefault) c.hard else if (value == null) c.muted else c.ink,
                        )
                    }
                    IconButton(onClick = { listenFrom(value ?: 0L, if (value != null) 3000L else 0L) }, enabled = value != null || r.hasDefault, modifier = Modifier.testTag("mark-listen-${r.id}")) {
                        Icon(Icons.Filled.PlayArrow, "Nghe thử ${r.label}")
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = typed, onValueChange = { typed = it }, singleLine = true, label = { Text(row.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    placeholder = { Text("mm:ss") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { applyTyped() }),
                    modifier = Modifier.weight(1f).testTag("marks-typed"),
                )
                Button(onClick = { applyTyped() }, Modifier.testTag("marks-apply")) { Text("Đặt") }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (row is MarkRow.Bound) TextButton(onClick = {
                    val value = valueOf(cuts, row)
                    if (value == null) toast("Đặt mốc trước, rồi tách.")
                    else updateCuts(app, set.id) { setMark(it, order, row.b, MarkField.START, value + 1000, trackNow, false).cuts }
                }, Modifier.testTag("marks-split")) { Text("Tách") }
                val prevEnd = if (row is MarkRow.Start) cuts[row.part - 1]?.end else null
                if (row is MarkRow.Start && prevEnd != null && prevEnd != cuts[row.part]?.start) TextButton(onClick = {
                    updateCuts(app, set.id) { setMark(it, order, row.part, MarkField.START, prevEnd, trackNow, true).cuts }
                }, Modifier.testTag("marks-join")) { Text("Nối với Part trước") }
                TextButton(onClick = { clearing = true }, enabled = v != null, modifier = Modifier.testTag("marks-clear")) { Text("Xoá mốc") }
            }
        }
    }
    if (clearing && v != null) ConfirmDialog(
        title = "Xoá mốc này?",
        message = "${row.label} (${formatClock(v)}) sẽ bị xoá, Part này lại chưa có điểm ${if (row is MarkRow.Start) "bắt đầu" else "kết thúc"}. Âm thanh và bài làm không bị ảnh hưởng.",
        confirm = "Xoá mốc", destructive = true,
        onConfirm = {
            clearing = false
            updateCuts(app, set.id) { cs ->
                when (row) {
                    is MarkRow.Bound -> clearMark(clearMark(cs, row.b, MarkField.START), row.a, MarkField.END)
                    is MarkRow.Start -> clearMark(cs, row.part, MarkField.START)
                    is MarkRow.End -> clearMark(cs, row.part, MarkField.END)
                }
            }
        },
        onDismiss = { clearing = false },
    )
}

/**
 * What the test shows in place of the listening bar when one Part of a one-file test is taken on its own: the Part's
 * stretch of the audio, play, ±10 s to hear a bit again, "from the start of the Part", and a way to fix the marks.
 */
@Composable
internal fun PartPlayer(set: TestSet, part: Int, player: ListenPlayer, onEdit: () -> Unit) {
    val c = Lexi.colors
    val order = remember(set.questions) { markParts(set.questions) }
    val w = partWindow(set.cuts, order, part)
    if (w !is PartWindow.Ok) {
        Panel(Modifier.padding(horizontal = 16.dp).testTag("part-gate")) {
            Text("Part $part chưa có điểm ${if ((w as PartWindow.Missing).field == MarkField.START) "bắt đầu" else "kết thúc"}", fontWeight = FontWeight.Bold)
            Text("File nghe là một file dài: cho Lexi biết Part này nằm ở đâu để chỉ phát đúng đoạn của nó. Chỉ cần làm một lần cho bộ đề.", fontSize = 13.sp, color = c.muted)
            Button(onClick = onEdit, Modifier.fillMaxWidth().testTag("part-gate-set")) { Text("Đặt mốc Part") }
        }
        return
    }
    val from = w.from
    val to = w.to
    val at = player.atMs.toLong()
    val inside = player.track == w.track && at >= from - 300 && (to == null || at < to - 300)
    val total = if (to != null) to - from else maxOf(0L, player.durationMs - from)
    val rel = if (inside) maxOf(0L, at - from) else 0L
    fun play() { if (inside && player.track != null) player.toggle() else player.playWindow(w.track, from, to) }
    fun skip(ms: Int) = player.skip(ms, from.toInt(), to?.toInt())

    Panel(Modifier.padding(horizontal = 16.dp).testTag("part-player")) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Nghe Part $part", fontWeight = FontWeight.Bold)
            Pill("${formatClock(from)} → ${if (to == null) "hết file" else formatClock(to)}", PillKind.OK, Modifier.testTag("part-window"))
        }
        LinearProgressIndicator(progress = { if (total > 0) (rel.toFloat() / total).coerceIn(0f, 1f) else 0f }, Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(formatClock(rel / 1000 * 1000), Modifier.testTag("part-pos"), fontSize = 12.sp, color = c.muted)
            Text(if (total > 0) formatClock(total / 1000 * 1000) else "", fontSize = 12.sp, color = c.muted)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            SkipKey("⟲10", "part-back10", Modifier.weight(1f)) { skip(-10_000) }
            SkipKey("−5", "part-back5", Modifier.weight(1f)) { skip(-5_000) }
            SkipKey("", "part-play", Modifier.weight(1.3f), primary = true, content = {
                Icon(if (player.playing && inside) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (player.playing && inside) "Tạm dừng" else "Phát", tint = c.onAccent)
            }) { play() }
            SkipKey("+5", "part-fwd5", Modifier.weight(1f)) { skip(5_000) }
            SkipKey("⟳10", "part-fwd10", Modifier.weight(1f)) { skip(10_000) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { player.playWindow(w.track, from, to) }, Modifier.testTag("part-restart")) { Text("Nghe lại từ đầu Part") }
            TextButton(onClick = onEdit, Modifier.testTag("part-edit")) { Text("Chỉnh mốc") }
        }
    }
}
