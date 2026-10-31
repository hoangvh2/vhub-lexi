package com.vh.lexi.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

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
 * Home of the study tab (Today.tsx, phone layout): a hero card with today's progress and one button to start, tiles
 * for due/new/streak, the lesson path, recent activity and the words forgotten most often.
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

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 16.dp).testTag("today"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Hero
        val ringColor = if (finished) c.sun else c.accent
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(if (c.hero.size > 1) Brush.linearGradient(c.hero) else Brush.linearGradient(listOf(c.surface, c.surface)))
                .border(1.dp, c.line, RoundedCornerShape(22.dp)).padding(horizontal = 18.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(150.dp).testTag("today-ring"), contentAlignment = Alignment.Center) {
                Box(Modifier.size(132.dp).background(c.surface.copy(alpha = 0.7f), CircleShape))
                CircularProgressIndicator(
                    progress = { frac }, modifier = Modifier.fillMaxSize(), color = ringColor, trackColor = c.accent.copy(alpha = 0.16f).compositeOver(c.surface2),
                    strokeWidth = 12.dp, strokeCap = StrokeCap.Round, gapSize = 0.dp,
                )
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$done/$total", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = c.ink)
                    Text("thẻ hôm nay", fontSize = 12.sp, color = c.muted)
                }
            }
            Text(
                "${WEEKDAY_LONG[date.dayOfWeek.value - 1]}, ${date.dayOfMonth}/${date.monthValue}".uppercase(),
                Modifier.padding(top = 8.dp), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, color = if (finished) c.sun else c.accent,
            )
            Text(if (finished) "Xong phần hôm nay 🎉" else greeting(LocalTime.now().hour), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = c.ink, textAlign = TextAlign.Center)
            Text(
                when {
                    left > 0 -> "Hôm nay còn $left thẻ, khoảng $minutes phút."
                    finished && tomorrow > 0 -> "Bạn đã ôn $done thẻ. Ngày mai có $tomorrow thẻ đang chờ."
                    finished -> "Bạn đã ôn $done thẻ. Ngày mai chưa có thẻ nào đến hạn."
                    else -> "Hôm nay không có thẻ đến hạn."
                },
                color = c.muted, textAlign = TextAlign.Center,
            )
            val label = if (left == 0) "Học thêm hoặc ôn trước" else if (done == 0) "Bắt đầu học" else "Học tiếp"
            if (left > 0) {
                Button(onClick = onStart, Modifier.fillMaxWidth().padding(top = 10.dp).heightIn(min = 54.dp).testTag("start-study"), shape = RoundedCornerShape(16.dp)) {
                    Text(label, fontSize = 17.sp)
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.padding(start = 8.dp).size(18.dp))
                }
            } else {
                OutlinedButton(
                    onClick = onStart, Modifier.fillMaxWidth().padding(top = 10.dp).heightIn(min = 52.dp).testTag("start-study"), shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = c.surface, contentColor = c.accent), border = BorderStroke(1.dp, c.line),
                ) {
                    Text(label, fontSize = 16.sp)
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.padding(start = 8.dp).size(18.dp))
                }
            }
            if (current != null) {
                val n = lessonName(current.tag)
                OutlinedButton(
                    onClick = { onLesson(current.tag) }, shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.outlinedButtonColors(containerColor = c.surface.copy(alpha = 0.6f), contentColor = c.ink), border = BorderStroke(1.dp, c.line),
                ) { Text(if (n.num != null) "Bài ${n.num} · ${n.title}" else n.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }

        // Tiles
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val due = queue.counts.review + queue.counts.learning
            StatTile(
                Icons.Filled.CalendarMonth, c.sky, c.skySoft, "Đến hạn", "$due", "today-due",
                when {
                    queue.counts.learning > 0 -> "${queue.counts.learning} thẻ đang học"
                    queue.counts.review > 0 -> "Cần ôn hôm nay"
                    tomorrow > 0 -> "Ngày mai $tomorrow"
                    else -> "Đã ôn hết"
                },
                Modifier.weight(1f),
            )
            StatTile(
                Icons.Filled.Star, c.sun, c.sunSoft, "Từ mới", "${queue.counts.new}", "today-new",
                if (queue.counts.new == 0 && newToday >= newPerDay) "Đủ $newPerDay từ hôm nay" else "Đã học $newToday/$newPerDay hôm nay",
                Modifier.weight(1f),
            )
        }
        Tile(Modifier.testTag("today-streak")) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TileIcon(Icons.Filled.LocalFireDepartment, c.fire, c.fireSoft)
                Column {
                    Text("Chuỗi học", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.muted)
                    Text("${streak(daily, now, dayStartHour)} ngày", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.ink)
                }
            }
            WeekDots(daily, now, dayStartHour, todayId)
        }

        // Lesson path
        if (lessons.isNotEmpty()) {
            Tile(Modifier.testTag("today-lesson")) {
                PanelHead("Lộ trình bài học", "${lessons.count { it.started >= it.count }}/${lessons.size} bài xong")
                if (current != null) {
                    val n = lessonName(current.tag)
                    Column(Modifier.fillMaxWidth().background(c.accentSoft, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.size(50.dp).background(c.accent, RoundedCornerShape(15.dp)), contentAlignment = Alignment.Center) {
                                Text(n.num ?: "•", color = c.onAccent, fontSize = 19.sp, fontWeight = FontWeight.Bold)
                            }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text("Bài đang học", fontSize = 12.sp, color = c.muted)
                                Text(n.title, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = c.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Meter(current.started.toFloat() / current.count, c.accent, c.accent.copy(alpha = 0.18f).compositeOver(c.surface), 8.dp)
                                Text("${current.started}/${current.count} từ đã bắt đầu", fontSize = 12.sp, color = c.muted)
                            }
                        }
                        Button(onClick = { onLesson(current.tag) }, Modifier.fillMaxWidth().testTag("study-lesson"), shape = RoundedCornerShape(12.dp)) { Text("Học bài này") }
                    }
                }
                val from = maxOf(0, minOf(currentIdx - 2, lessons.size - PATH_WINDOW))
                val shown = if (allLessons) lessons else lessons.drop(from).take(PATH_WINDOW)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (l in shown) LessonRow(l, l == current) { onLesson(l.tag) }
                }
                if (lessons.size > PATH_WINDOW) {
                    TextButton(onClick = { allLessons = !allLessons }, Modifier.fillMaxWidth().testTag("all-lessons")) {
                        Text(if (allLessons) "Thu gọn" else "Xem tất cả ${lessons.size} bài", color = c.ink, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        // Activity
        Tile {
            PanelHead("Hoạt động", "%,d lượt ôn".format(answers).replace(',', '.'))
            val max = maxOf(1L, heat.maxOfOrNull { it.count } ?: 1L)
            val levels = listOf(c.surface2) + listOf(0.25f, 0.5f, 0.75f, 1f).map { c.accent.copy(alpha = it).compositeOver(c.surface2) }
            Canvas(Modifier.fillMaxWidth().aspectRatio(HEAT_WEEKS / 7f)) {
                val step = size.width / HEAT_WEEKS
                val cell = step * 0.8f
                for (h in heat) {
                    drawRoundRect(levels[heatLevel(h.count, max)], Offset(h.week * step, h.dow * step), Size(cell, cell), CornerRadius(cell * 0.25f))
                }
            }
        }

        // Words to watch
        if (watch.isNotEmpty()) {
            Tile(Modifier.testTag("today-watch")) {
                PanelHead("Từ hay quên", null)
                for ((i, w) in watch.withIndex()) {
                    if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(w.first.fields["word"].str(), fontWeight = FontWeight.Bold, color = c.ink, maxLines = 1)
                        Text(w.first.fields["vi"].str(), Modifier.weight(1f), fontSize = 13.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("quên ${w.second}", Modifier.background(c.againSoft, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.again)
                    }
                }
            }
        }
    }
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
private fun Tile(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), color = Lexi.colors.surface, border = BorderStroke(1.dp, Lexi.colors.line)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
private fun TileIcon(icon: ImageVector, fg: Color, bg: Color) {
    Box(Modifier.size(42.dp).background(bg, RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(22.dp), tint = fg) }
}

@Composable
private fun StatTile(icon: ImageVector, fg: Color, bg: Color, label: String, value: String, tag: String, note: String, modifier: Modifier = Modifier) {
    val c = Lexi.colors
    Surface(modifier, shape = RoundedCornerShape(18.dp), color = c.surface, border = BorderStroke(1.dp, c.line)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TileIcon(icon, fg, bg)
                Column {
                    Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.muted)
                    Text(value, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.ink, modifier = Modifier.testTag(tag))
                }
            }
            Text(note, fontSize = 12.sp, color = c.muted)
        }
    }
}

@Composable
private fun PanelHead(title: String, aside: String?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Lexi.colors.ink)
        if (aside != null) Text(aside, fontSize = 13.sp, color = Lexi.colors.muted)
    }
}

@Composable
private fun Meter(frac: Float, color: Color, track: Color, height: androidx.compose.ui.unit.Dp) {
    LinearProgressIndicator(
        progress = { frac }, Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(height / 2)),
        color = color, trackColor = track, gapSize = 0.dp, drawStopIndicator = {},
    )
}

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
                    Modifier.size(28.dp).background(if (on) c.fire else Color.Transparent, CircleShape)
                        .border(2.dp, if (on || isToday) c.fire else c.line.copy(alpha = if (future) 0.55f else 1f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) { if (on) Icon(Icons.Filled.Check, null, Modifier.size(16.dp), tint = Color.White) }
                Text(label, fontSize = 11.sp, color = if (isToday) c.fire else c.muted, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal)
            }
        }
    }
}

@Composable
private fun LessonRow(l: LessonProgress, current: Boolean, onClick: () -> Unit) {
    val c = Lexi.colors
    val n = lessonName(l.tag)
    val full = l.started >= l.count
    val part = l.started > 0 && !full
    Surface(
        onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp), color = c.surface,
        border = BorderStroke(if (current) 2.dp else 1.dp, if (current) c.accent else c.line),
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(30.dp).background(if (full) c.accent else if (part) c.accentSoft else c.surface2, RoundedCornerShape(9.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (full) Icon(Icons.Filled.Check, null, Modifier.size(16.dp), tint = c.onAccent)
                else Text(n.num ?: "•", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (part) c.accent else c.muted)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(n.title, Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${l.started}/${l.count}", fontSize = 12.sp, color = c.muted)
                }
                Meter(l.started.toFloat() / l.count, c.accent, c.surface2, 4.dp)
            }
        }
    }
}
