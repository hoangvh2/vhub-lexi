package com.vh.lexi.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Daily
import com.vh.lexi.core.Note
import com.vh.lexi.core.Queue
import com.vh.lexi.core.dayId
import com.vh.lexi.core.forecast
import com.vh.lexi.core.heatLevel
import com.vh.lexi.core.heatmap
import com.vh.lexi.core.lessonName
import com.vh.lexi.core.nextDayStart
import com.vh.lexi.core.str
import com.vh.lexi.core.streak
import com.vh.lexi.ui.theme.Lexi
import com.vh.lexi.ui.theme.Quicksand
import com.vh.lexi.ui.theme.clay
import com.vh.lexi.ui.theme.gradientPill
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import kotlin.math.PI
import kotlin.math.sin

private const val DAY_MS = 86_400_000L
private const val PATH_WINDOW = 8
private const val HEAT_WEEKS = 18
private val WEEKDAYS = listOf("T2", "T3", "T4", "T5", "T6", "T7", "CN")
private val WEEKDAY_LONG = listOf("Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật")

private fun greeting(hour: Int) = when {
    hour < 11 -> "Chào buổi sáng"
    hour < 14 -> "Chào buổi trưa"
    hour < 18 -> "Chào buổi chiều"
    else -> "Chào buổi tối"
}

/** A lesson tag with how many of its notes have been started. */
data class LessonProgress(val tag: String, val started: Int, val count: Int)

/**
 * Home of the study tab (Today.tsx, phone layout): one clay card with the progress orb, due/new/streak, the week and
 * the button to start; the lesson path as tiles; recent activity and the words forgotten most often.
 */
@Composable
internal fun TodayPanel(
    cards: List<Card>, notesById: Map<String, Note>, queue: Queue, daily: List<Daily>, dayStartHour: Int, newPerDay: Int, now: Long,
    lessons: List<LessonProgress>, onStart: () -> Unit, onLesson: (String) -> Unit,
) {
    val c = Lexi.colors
    // Cards, not answers: a card answered today and not waiting again is done; one in the queue is left.
    val waiting = (queue.learning + queue.review + queue.newCards).map { it.id }.toSet()
    val dayStart = nextDayStart(now, dayStartHour) - DAY_MS
    val done = cards.count { (it.lastReview ?: 0L) >= dayStart && it.id !in waiting }
    val left = waiting.size
    val total = done + left
    val frac = if (total == 0) 0f else done.toFloat() / total
    val finished = left == 0 && done > 0
    // Water level in the orb; a sliver stays visible once anything is done.
    val fill = if (finished) 1f else if (frac > 0f) maxOf(0.06f, frac) else 0f
    val todayId = dayId(now, dayStartHour)
    val newToday = daily.firstOrNull { it.id == todayId }?.newCards ?: 0
    val tomorrow = forecast(cards, now, dayStartHour, 2).getOrElse(1) { 0 }
    val answers = daily.sumOf { it.newCards + it.reviews }
    val perCardMs = if (answers > 0) daily.sumOf { it.ms } / answers else 10_000L
    val minutes = maxOf(1L, (left * perCardMs + 30_000) / 60_000)
    val currentIdx = lessons.indexOfFirst { it.started < it.count }
    val current = lessons.getOrNull(currentIdx)
    val date = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault())
    val watch = remember(cards, notesById) { wordsToWatch(cards, notesById) }
    val heat = remember(daily, dayStartHour, todayId) { heatmap(daily, now, dayStartHour, HEAT_WEEKS) }
    var allLessons by remember { mutableStateOf(false) }
    // Blocks float up one after another the first time the screen shows (Today.tsx: motion.ts enter()).
    val shown = remember { Animatable(0f) }
    LaunchedEffect(Unit) { shown.animateTo(1f, tween(700, easing = FastOutSlowInEasing)) }
    fun Modifier.enter(i: Int) = graphicsLayer {
        val t = ((shown.value * 1.6f) - i * 0.15f).coerceIn(0f, 1f)
        alpha = t; translationY = (1f - t) * 40f
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 14.dp).testTag("today"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.enter(0).padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "${WEEKDAY_LONG[date.dayOfWeek.value - 1]}, ${date.dayOfMonth}/${date.monthValue}".uppercase(),
                fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.8.sp, color = c.accent,
            )
            Text(if (finished) "Xong phần hôm nay" else greeting(LocalTime.now().hour), fontFamily = Quicksand, fontSize = 27.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = c.ink)
            Text(
                when {
                    left > 0 -> "Hôm nay còn $left thẻ, khoảng $minutes phút."
                    finished && tomorrow > 0 -> "Bạn đã ôn $done thẻ. Ngày mai có $tomorrow thẻ đang chờ."
                    finished -> "Bạn đã ôn $done thẻ. Ngày mai chưa có thẻ nào đến hạn."
                    else -> "Hôm nay không có thẻ đến hạn."
                },
                fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.muted,
            )
        }

        // One clay card: the progress orb, the three numbers that matter, the week and the button to start.
        Column(Modifier.enter(1).fillMaxWidth().clay(c, RoundedCornerShape(28.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Orb(fill, "$done/$total", finished)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    MiniStat(Icons.Filled.CalendarMonth, c.peachDeep, c.peachSoft, BLOB_A, "${queue.counts.review + queue.counts.learning}", "Đến hạn", "today-due")
                    MiniStat(Icons.Filled.Star, c.mintDeep, c.mintSoft, BLOB_B, "${queue.counts.new}", "Từ mới", "today-new")
                    MiniStat(Icons.Filled.LocalFireDepartment, c.butterDeep, c.butterSoft, BLOB_C, "${streak(daily, now, dayStartHour)}", "ngày liên tiếp", "today-streak")
                }
            }
            Text(
                when {
                    queue.counts.learning > 0 -> "${queue.counts.learning} thẻ đang học"
                    queue.counts.new == 0 && newToday >= newPerDay -> "Đủ $newPerDay từ mới hôm nay"
                    else -> "Đã học $newToday/$newPerDay từ mới hôm nay"
                },
                Modifier.padding(horizontal = 4.dp), fontSize = 12.5.sp, fontWeight = FontWeight.Bold, color = c.muted,
            )
            WeekDots(daily, now, dayStartHour, todayId)
            val label = if (left == 0) "Học thêm hoặc ôn trước" else if (done == 0) "Bắt đầu học" else "Học tiếp"
            PrimaryPill(label, onStart, Modifier.fillMaxWidth().testTag("start-study"), big = true, soft = left == 0)
            if (current != null) {
                val n = lessonName(current.tag)
                SoftPill(if (n.num != null) "Bài ${n.num} · ${n.title}" else n.title, { onLesson(current.tag) }, Modifier.fillMaxWidth())
            }
        }

        // Lesson path
        if (lessons.isNotEmpty()) {
            Panel(Modifier.enter(2).testTag("today-lesson")) {
                PanelHead("Lộ trình bài học", "${lessons.count { it.started >= it.count }}/${lessons.size} bài xong")
                if (current != null) {
                    val n = lessonName(current.tag)
                    Column(Modifier.fillMaxWidth().background(c.accentSoft, RoundedCornerShape(24.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Box(Modifier.size(56.dp).gradientPill(c, BLOB_A), contentAlignment = Alignment.Center) {
                                Text(n.num ?: "•", color = Color.White, fontFamily = Quicksand, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("Bài đang học", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.muted)
                                Text(n.title, fontFamily = Quicksand, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = c.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Meter(current.started.toFloat() / current.count, c.accent, c.accent.copy(alpha = 0.14f).compositeOver(c.surface), 10.dp)
                                Text("${current.started}/${current.count} từ đã bắt đầu", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.muted)
                            }
                        }
                        PrimaryPill("Học bài này", { onLesson(current.tag) }, Modifier.fillMaxWidth().testTag("study-lesson"))
                    }
                }
                val from = maxOf(0, minOf(currentIdx - 2, lessons.size - PATH_WINDOW))
                val visible = if (allLessons) lessons else lessons.drop(from).take(PATH_WINDOW)
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (pair in visible.chunked(2)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (l in pair) LessonTile(l, l == current, Modifier.weight(1f)) { onLesson(l.tag) }
                        if (pair.size == 1) Box(Modifier.weight(1f))
                    }
                }
                if (lessons.size > PATH_WINDOW) {
                    TextButton(onClick = { allLessons = !allLessons }, Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("all-lessons")) {
                        Text(if (allLessons) "Thu gọn" else "Xem tất cả ${lessons.size} bài", color = c.ink, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
        }

        // Activity
        Panel(Modifier.enter(3)) {
            PanelHead("Hoạt động", "%,d lượt ôn".format(answers).replace(',', '.'))
            val max = maxOf(1L, heat.maxOfOrNull { it.count } ?: 1L)
            val levels = listOf(c.surface2) + listOf(0.3f, 0.55f, 0.8f, 1f).map { c.accent2.copy(alpha = it).compositeOver(c.surface2) }
            Canvas(Modifier.fillMaxWidth().aspectRatio(HEAT_WEEKS / 7f)) {
                val step = size.width / HEAT_WEEKS
                val cell = step * 0.8f
                for (h in heat) {
                    drawRoundRect(levels[heatLevel(h.count, max)], Offset(h.week * step, h.dow * step), Size(cell, cell), CornerRadius(cell * 0.33f))
                }
            }
        }

        // Words to watch
        if (watch.isNotEmpty()) {
            Panel(Modifier.enter(4).testTag("today-watch")) {
                PanelHead("Từ hay quên", null)
                for (w in watch) {
                    Row(
                        Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(w.first.fields["word"].str(), fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 1)
                        Text(w.first.fields["vi"].str(), Modifier.weight(1f), fontSize = 13.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Pill("quên ${w.second}", PillKind.BAD)
                    }
                }
            }
        }
    }
}

/** Blob shapes for icon backgrounds, so the three numbers do not look stamped from one mould. */
private val BLOB_A = RoundedCornerShape(topStartPercent = 42, topEndPercent = 58, bottomEndPercent = 54, bottomStartPercent = 46)
private val BLOB_B = RoundedCornerShape(topStartPercent = 55, topEndPercent = 45, bottomEndPercent = 48, bottomStartPercent = 52)
private val BLOB_C = RoundedCornerShape(topStartPercent = 48, topEndPercent = 52, bottomEndPercent = 42, bottomStartPercent = 58)

/**
 * Today's progress as water in a glass ball: it rises to its level once, and its surface keeps rolling slowly as a wave.
 * Both animations follow the system animator scale, so "remove animations" leaves a still level.
 */
@Composable
private fun Orb(fill: Float, text: String, finished: Boolean) {
    val c = Lexi.colors
    val level = remember { Animatable(0f) }
    LaunchedEffect(fill) { level.animateTo(fill, tween(1400, delayMillis = 250, easing = FastOutSlowInEasing)) }
    val phase by rememberInfiniteTransition(label = "wave").animateFloat(
        0f, (2 * PI).toFloat(), infiniteRepeatable(tween(4200, easing = LinearEasing)), label = "phase",
    )
    val deep = fill >= 0.55f
    val ring = if (finished) c.accent2.copy(alpha = 0.35f) else c.accentSoft.copy(alpha = 0.8f)
    Box(
        Modifier.size(118.dp).border(5.dp, ring, CircleShape).padding(5.dp).clip(CircleShape).background(c.surface2).testTag("today-ring"),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val f = level.value
            if (f <= 0f) return@Canvas
            fun wave(amp: Float, shift: Float, color: Brush, alpha: Float) {
                val top = size.height * (1f - f)
                val path = Path().apply {
                    moveTo(0f, size.height)
                    var x = 0f
                    while (x <= size.width) {
                        lineTo(x, top + amp * sin(phase + shift + x / size.width * 2f * PI.toFloat()))
                        x += 4f
                    }
                    lineTo(size.width, size.height)
                    close()
                }
                drawPath(path, color, alpha = alpha)
            }
            val water = Brush.verticalGradient(c.hero, startY = size.height * (1f - f) - 6f, endY = size.height)
            wave(5.dp.toPx(), PI.toFloat(), water, 0.45f)
            wave(4.dp.toPx(), 0f, water, 1f)
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(text, fontFamily = Quicksand, fontSize = 27.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold, color = if (deep) Color.White else c.ink)
            Text(
                "thẻ hôm nay",
                Modifier.background(if (deep) Color.White.copy(alpha = 0.18f) else c.surface.copy(alpha = 0.72f), CircleShape).padding(horizontal = 7.dp, vertical = 1.dp),
                fontSize = 10.5.sp, fontWeight = FontWeight.ExtraBold, color = if (deep) Color.White else c.muted,
            )
        }
    }
}

@Composable
private fun MiniStat(icon: ImageVector, fg: Color, bg: Color, shape: RoundedCornerShape, value: String, label: String, tag: String) {
    val c = Lexi.colors
    Row(Modifier.testTag(if (tag == "today-streak") tag else "$tag-row"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        Box(Modifier.size(32.dp).background(bg, shape), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(17.dp), tint = fg) }
        Text(value, Modifier.widthIn(min = 24.dp).then(if (tag == "today-streak") Modifier else Modifier.testTag(tag)), fontFamily = Quicksand, fontSize = 21.sp, fontWeight = FontWeight.Bold, color = c.ink)
        Text(label, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The lavender gradient pill; [soft] is the quieter version for "nothing left today". */
@Composable
internal fun PrimaryPill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, big: Boolean = false, soft: Boolean = false) {
    val c = Lexi.colors
    val shape = RoundedCornerShape(50)
    Row(
        modifier.heightIn(min = if (big) 56.dp else 48.dp).then(if (soft) Modifier.background(c.accentSoft, shape) else Modifier.gradientPill(c, shape))
            .clip(shape).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 22.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        val fg = if (soft) c.accent else c.onAccent
        Text(label, fontFamily = Quicksand, fontSize = if (big) 18.sp else 16.sp, fontWeight = FontWeight.Bold, color = fg)
        if (big) Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.padding(start = 8.dp).size(20.dp), tint = fg)
    }
}

@Composable
private fun SoftPill(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    val shape = RoundedCornerShape(50)
    Box(
        modifier.heightIn(min = 46.dp).clip(shape).background(c.surface2).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontWeight = FontWeight.Bold, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}

/** Forgotten most often, recently forgotten first (Today.tsx `watch`). */
private fun wordsToWatch(cards: List<Card>, notesById: Map<String, Note>): List<Pair<Note, Int>> {
    val byNote = HashMap<String, Pair<Int, Long>>()
    for (card in cards) {
        if (card.suspended || card.lapses == 0) continue
        val (lapses, last) = byNote[card.noteId] ?: (0 to 0L)
        val at = if (card.state == CardState.RELEARNING) Long.MAX_VALUE else card.lastReview ?: 0L
        byNote[card.noteId] = (lapses + card.lapses) to maxOf(last, at)
    }
    return byNote.entries.filter { it.key in notesById }
        .sortedWith(compareByDescending<Map.Entry<String, Pair<Int, Long>>> { it.value.first }.thenByDescending { it.value.second })
        .take(5).map { notesById.getValue(it.key) to it.value.first }
}

@Composable
private fun PanelHead(title: String, aside: String?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontFamily = Quicksand, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Lexi.colors.ink)
        if (aside != null) Text(aside, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Lexi.colors.muted)
    }
}

@Composable
private fun Meter(frac: Float, color: Color, track: Color, height: androidx.compose.ui.unit.Dp) {
    LinearProgressIndicator(
        progress = { frac }, Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height / 2)),
        color = color, trackColor = track, gapSize = 0.dp, drawStopIndicator = {},
    )
}

/** This study week, Monday first: butter dots with a tick for days with any study; today ringed. */
@Composable
private fun WeekDots(daily: List<Daily>, now: Long, dayStartHour: Int, todayId: String) {
    val c = Lexi.colors
    val active = daily.filter { it.newCards + it.reviews > 0 }.map { it.id }.toSet()
    val todayStart = now - dayStartHour * 3_600_000L
    val dow = Instant.ofEpochMilli(todayStart).atZone(ZoneId.systemDefault()).dayOfWeek.value - 1 // Monday = 0
    val monday = todayStart - dow * DAY_MS
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        WEEKDAYS.forEachIndexed { i, label ->
            val t = monday + i * DAY_MS + dayStartHour * 3_600_000L
            val id = dayId(t, dayStartHour)
            val on = id in active
            val isToday = id == todayId
            val future = t > now && !isToday
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(
                    Modifier.size(30.dp).graphicsLayer { alpha = if (future) 0.5f else 1f }
                        .then(if (on) Modifier.shadow(4.dp, CircleShape, ambientColor = c.butter, spotColor = c.butter) else Modifier)
                        .background(if (on) c.butter else c.surface2, CircleShape)
                        .then(if (isToday && !on) Modifier.border(2.5.dp, c.butter, CircleShape) else Modifier),
                    contentAlignment = Alignment.Center,
                ) { if (on) Icon(Icons.Filled.Check, null, Modifier.size(16.dp), tint = Color(0xFF5B3D00)) }
                Text(label, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, color = if (isToday) c.ink else c.muted)
            }
        }
    }
}

@Composable
private fun LessonTile(l: LessonProgress, current: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = Lexi.colors
    val n = lessonName(l.tag)
    val full = l.started >= l.count
    val part = l.started > 0 && !full
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier.clay(c, shape, elevation = 5.dp).then(if (current) Modifier.border(2.5.dp, c.accent, shape) else Modifier)
            .clip(shape).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            Modifier.size(34.dp).then(
                if (current) Modifier.gradientPill(c, CircleShape)
                else Modifier.background(if (full) c.mintSoft else if (part) c.accentSoft else c.surface2, CircleShape),
            ),
            contentAlignment = Alignment.Center,
        ) {
            if (full) Icon(Icons.Filled.Check, null, Modifier.size(17.dp), tint = c.mintDeep)
            else Text(n.num ?: "•", fontFamily = Quicksand, fontSize = 13.5.sp, fontWeight = FontWeight.Bold, color = if (current) Color.White else if (part) c.accent else c.muted)
        }
        Text(n.title, fontFamily = Quicksand, fontSize = 14.5.sp, fontWeight = FontWeight.Bold, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Meter(l.started.toFloat() / l.count, c.accent, c.line, 7.dp)
        Text("${l.started}/${l.count} từ", fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = c.muted)
    }
}
