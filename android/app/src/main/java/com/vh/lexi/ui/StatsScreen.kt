package com.vh.lexi.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.lerp
import com.vh.lexi.ui.theme.clay
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.Effort
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.HEAT_STEPS
import com.vh.lexi.core.NEW_WORD_ANSWERS
import com.vh.lexi.core.Roadmap
import com.vh.lexi.core.SimInput
import com.vh.lexi.core.WEEKDAYS
import com.vh.lexi.core.WeekCompare
import com.vh.lexi.core.WordStatus
import com.vh.lexi.core.dayId
import com.vh.lexi.core.dm
import com.vh.lexi.core.effortOf
import com.vh.lexi.core.forecast
import com.vh.lexi.core.heatLevelFixed
import com.vh.lexi.core.heatmap
import com.vh.lexi.core.isMaterial
import com.vh.lexi.core.minutes
import com.vh.lexi.core.nextDayStart
import com.vh.lexi.core.overdueCount
import com.vh.lexi.core.paceOf
import com.vh.lexi.core.ratingMix
import com.vh.lexi.core.recallNow
import com.vh.lexi.core.retention
import com.vh.lexi.core.simulate
import com.vh.lexi.core.span
import com.vh.lexi.core.streak
import com.vh.lexi.core.weekCompare
import com.vh.lexi.core.weekdayOf
import com.vh.lexi.core.wordStatus
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min

private const val DAY = 86_400_000L
private val PRESETS = listOf(10, 15, 20, 25)

private class PaceChip(val key: String, val label: String, val value: Double?) // value null = the learner's real pace

/** Same as the web: a number with at most one decimal and a comma, without a trailing ",0". */
private fun fmt(n: Double): String {
    val r = Fsrs.jsRound(n * 10) / 10.0
    return if (r == Math.floor(r)) r.toLong().toString() else r.toString().replace('.', ',')
}

@Composable
fun StatsScreen(app: LexiApp) {
    val cards by app.data.cards.collectAsState()
    val notes by app.data.notes.collectAsState()
    val daily by app.data.daily.collectAsState()
    val prefs by app.data.prefs.collectAsState()
    val c = Lexi.colors
    val now = System.currentTimeMillis()
    val todayEnd = nextDayStart(now, prefs.dayStartHour)
    val todayStart = todayEnd - DAY

    val eligible = remember(notes) { eligibility(notes.associateBy { it.id }) }
    val studied = remember(cards, eligible) { cards.filter(eligible) }
    // The roadmap counts vocabulary words; grammar patterns have cards (they show in the due forecast) but are not "từ".
    val vocab = remember(studied, notes) {
        val ids = notes.filter { it.type == "vocab" }.mapTo(HashSet()) { it.id }
        studied.filter { it.noteId in ids }
    }
    val weights = remember(prefs.fsrsWeights) { prefs.fsrsWeights?.toDoubleArray() }
    val status = remember(vocab) { wordStatus(vocab) }
    val recall = remember(vocab, weights) { recallNow(vocab, System.currentTimeMillis(), weights ?: Fsrs.DEFAULT_W) }
    val fc = remember(studied, prefs.dayStartHour) { forecast(studied, System.currentTimeMillis(), prefs.dayStartHour) }
    val overdue = remember(studied, prefs.dayStartHour) { overdueCount(studied, System.currentTimeMillis(), prefs.dayStartHour) }
    val pace = remember(daily, prefs.dayStartHour) { paceOf(daily, System.currentTimeMillis(), prefs.dayStartHour) }
    val mix = remember(daily, prefs.dayStartHour) { ratingMix(daily, System.currentTimeMillis(), prefs.dayStartHour) }
    val effort = remember(daily, prefs.dayStartHour) { effortOf(daily, System.currentTimeMillis(), prefs.dayStartHour) }
    val week = remember(daily, prefs.dayStartHour) { weekCompare(daily, System.currentTimeMillis(), prefs.dayStartHour) }
    val today = daily.firstOrNull { it.id == dayId(now, prefs.dayStartHour) }
    val ret = retention(daily, now, prefs.dayStartHour)
    val st = streak(daily, now, prefs.dayStartHour)

    val realKnown = pace.observedDays >= 7 && pace.perDay > 0
    var pick by remember { mutableStateOf<String?>(null) }
    val chips = remember(prefs.newPerDay, realKnown, pace.perDay) {
        val vals = (PRESETS + prefs.newPerDay).filter { it > 0 }.distinct().sorted()
        val out = vals.map { PaceChip(it.toString(), "$it từ/ngày" + if (it == prefs.newPerDay) " (đang đặt)" else "", it.toDouble()) }.toMutableList()
        if (realKnown) out.add(0, PaceChip("real", "Thực tế ${fmt(pace.perDay)}/ngày", null))
        out
    }
    val selected = chips.firstOrNull { it.key == pick } ?: chips.firstOrNull { it.key == (if (realKnown) "real" else prefs.newPerDay.toString()) } ?: chips.first()
    val effective = selected.value ?: pace.perDay

    var rm by remember { mutableStateOf<Roadmap?>(null) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<String?>(null) }
    val doneNew = (today?.newCards ?: 0L).toInt()
    val doneReviews = (today?.reviews ?: 0L).toInt()
    LaunchedEffect(vocab, effective, prefs.dayStartHour, prefs.maxReviewsPerDay, prefs.desiredRetention, weights?.toList(), mix.toList(), doneNew, doneReviews) {
        if (status.total == 0) {
            rm = null
            return@LaunchedEffect
        }
        busy = true
        delay(150)
        try {
            val t = System.currentTimeMillis()
            val input = SimInput(
                cards = vocab, now = t, todayEnd = nextDayStart(t, prefs.dayStartHour), pace = effective, maxReviewsPerDay = prefs.maxReviewsPerDay,
                desiredRetention = prefs.desiredRetention, w = weights, mix = mix, doneNewWords = doneNew, doneReviews = doneReviews,
            )
            // The simulation is about a second of arithmetic on a desktop: keep it off the main thread.
            rm = withContext(Dispatchers.Default) { simulate(input) }
            failed = null
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            failed = e.message ?: e.javaClass.simpleName
        } finally {
            busy = false
        }
    }

    val newLeft = min(status.unseen, max(0, prefs.newPerDay - doneNew))
    val dueToday = fc[0]
    val todayMin = minutes((dueToday + newLeft * NEW_WORD_ANSWERS).toDouble(), effort.secPerCard)
    val target = Math.round(prefs.desiredRetention * 100).toInt()
    val recalledPct = if (recall.started > 0) Math.round(recall.recalled / recall.started * 100).toInt() else 0

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp).testTag("stats-screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScreenHeader("Thống kê")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("Hôm nay còn", "$dueToday ôn + $newLeft mới", todayMin?.let { "≈ $it phút" } ?: "chưa đủ dữ liệu để ước tính", Modifier.weight(1f))
            StatTile("Nhớ được lúc này (ước tính)", "${Math.round(recall.recalled)}/${recall.started} từ", if (recall.started > 0) "$recalledPct% từ đã học" else "chưa học từ nào", Modifier.weight(1f))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val low = ret != null && ret * 100 < target - 2
            StatTile(
                "Nhớ đúng 30 ngày", ret?.let { "${Math.round(it * 100)}%" } ?: "–",
                if (ret == null) "chưa có dữ liệu" else if (low) "thấp hơn mục tiêu $target%" else "đạt mục tiêu $target%",
                Modifier.weight(1f), subColor = if (low) c.roseDeep else c.muted,
            )
            StatTile("Chuỗi ngày học", "$st ngày", if (pace.observedDays > 0) "${pace.activeDays}/${pace.observedDays} ngày gần đây" else "bắt đầu hôm nay", Modifier.weight(1f))
        }

        if (status.total == 0) {
            Panel {
                Text("${notes.count { isMaterial(it) }} từ trong thư viện", fontWeight = FontWeight.Bold, modifier = Modifier.testTag("stat-words"))
                Text("Thêm từ để thấy lộ trình học và dự báo.", color = c.muted)
            }
        } else {
            RoadmapPanel(status, rm, busy, failed, todayStart, effective, chips, selected.key, { pick = it }, realKnown, pace.observedDays, effort.secPerCard)
            ForecastPanel(fc, overdue, effective, status.unseen, todayStart, effort)
            WeekPanel(week, daily, now, prefs.dayStartHour)
            Panel {
                Text("${notes.count { isMaterial(it) }} từ trong thư viện", fontWeight = FontWeight.Bold, modifier = Modifier.testTag("stat-words"))
                StatusBars(status)
            }
        }
    }
}

@Composable
private fun StatTile(title: String, value: String, sub: String, modifier: Modifier = Modifier, subColor: Color = Lexi.colors.muted) {
    val c = Lexi.colors
    Column(modifier.clay(c, RoundedCornerShape(22.dp), elevation = 4.dp).padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(sub, fontSize = 12.sp, color = subColor, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Collapsible(title: String, tag: String, content: @Composable ColumnScope.() -> Unit) {
    val c = Lexi.colors
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(c.surface2, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 6.dp)) {
        Text(
            (if (open) "▾ " else "▸ ") + title, color = c.accent, fontWeight = FontWeight.Bold, fontSize = 13.sp,
            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 8.dp).testTag(tag),
        )
        if (open) Column(verticalArrangement = Arrangement.spacedBy(4.dp), content = content)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(items: List<Pair<Color?, String>>) {
    val c = Lexi.colors
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((color, text) in items) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (color != null) Box(Modifier.size(10.dp).background(color, RoundedCornerShape(3.dp)))
                Text(text, fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
            }
        }
    }
}

// ------------------------------------------------------------------ drawing helpers

/** Draws [text] around [at]: centred, or starting (-1) / ending (1) there. */
private fun DrawScope.label(m: TextMeasurer, text: String, at: Offset, color: Color, align: Int = 0, bold: Boolean = false) {
    val r = m.measure(text, TextStyle(color = color, fontSize = 10.sp, fontWeight = if (bold) FontWeight.ExtraBold else FontWeight.Bold))
    val x = when (align) { -1 -> at.x; 1 -> at.x - r.size.width; else -> at.x - r.size.width / 2f }
    drawText(r, topLeft = Offset(x, at.y - r.size.height / 2f))
}

private fun DrawScope.dashed(color: Color, from: Offset, to: Offset, width: Float) =
    drawLine(color, from, to, strokeWidth = width, pathEffect = PathEffect.dashPathEffect(floatArrayOf(width * 4, width * 3)))

// ------------------------------------------------------------------ status

@Composable
private fun StatusBars(s: WordStatus) {
    val c = Lexi.colors
    val seg = listOf(
        Triple("Chưa học", s.unseen, c.accentSoft), Triple("Đang học", s.learning, c.rose),
        Triple("Đang ôn (<21 ngày)", s.young, c.butter), Triple("Thuộc (≥21 ngày)", s.mature, c.mint),
    )
    val total = max(1, s.total)
    Row(Modifier.fillMaxWidth().height(14.dp).background(c.surface2, RoundedCornerShape(7.dp))) {
        for ((_, n, color) in seg) if (n > 0) Box(Modifier.weight(n.toFloat() / total).height(14.dp).background(color))
    }
    for ((label, n, color) in seg) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(10.dp).background(color, RoundedCornerShape(5.dp)))
                Text(label, fontSize = 13.sp)
            }
            Text("$n từ · ${Math.round(n * 100.0 / total)}%", fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

// ------------------------------------------------------------------ roadmap

@Composable
private fun EtaBox(title: String, day: Int?, todayStart: Long, done: Boolean, sub: String, modifier: Modifier) {
    val c = Lexi.colors
    Column(modifier.background(c.surface2, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, fontSize = 12.5.sp, color = c.muted, fontWeight = FontWeight.Bold)
        Text(if (done) "Đã xong" else if (day == null) "Chưa rõ" else dm(todayStart, day), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(
            if (done) sub else if (day == null) "xa hơn 8 tháng với nhịp này" else (if (day == 0) "trong hôm nay" else "sau ${span(day)}") + " · $sub",
            fontSize = 12.sp, color = c.muted,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RoadmapPanel(
    s: WordStatus, rm: Roadmap?, busy: Boolean, error: String?, todayStart: Long, pace: Double, chips: List<PaceChip>, selected: String,
    onPick: (String) -> Unit, realKnown: Boolean, observedDays: Int, secPerCard: Double?,
) {
    val c = Lexi.colors
    val introDone = s.unseen == 0
    val matureDone = rm != null && s.mature >= rm.matureTarget
    val peakMin = rm?.let { minutes(it.peakLoad + pace * NEW_WORD_ANSWERS, secPerCard) }
    Panel(Modifier.testTag("stats-roadmap")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Lộ trình", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("ước tính từ dữ liệu của anh", fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EtaBox("Học hết từ mới", rm?.introDay, todayStart, introDone, "còn ${s.unseen} từ · ${fmt(pace)} từ/ngày", Modifier.weight(1f))
            EtaBox(
                "Thuộc 80% thư viện", rm?.matureDay, todayStart, matureDone,
                "hiện thuộc ${s.mature}/${s.total} từ (${Math.round(s.mature * 100.0 / max(1, s.total))}%)", Modifier.weight(1f),
            )
        }
        if (busy && rm == null) Text("Đang tính dự báo…", fontSize = 12.5.sp, color = c.muted)
        if (error != null) Text("Không tính được dự báo: $error", fontSize = 12.5.sp, color = c.muted)
        if (rm != null) {
            Box(Modifier.fillMaxWidth().testTag("rm-chart")) { RoadmapChart(rm, todayStart, if (busy) 0.55f else 1f) }
            Legend(listOf(c.mint to "Thuộc", c.butter to "Đang học + đang ôn", c.accentSoft to "Chưa học"))
        }
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Thử:", fontSize = 12.5.sp, color = c.muted, modifier = Modifier.padding(vertical = 9.dp))
            for (ch in chips) {
                val on = ch.key == selected
                Text(
                    ch.label, fontSize = 12.5.sp, fontWeight = FontWeight.ExtraBold, color = if (on) c.onAccent else c.ink,
                    modifier = Modifier.background(if (on) c.accent else c.surface2, RoundedCornerShape(50)).clickable { onPick(ch.key) }
                        .padding(horizontal = 12.dp, vertical = 9.dp).testTag("pace-${ch.key}"),
                )
            }
        }
        if (!realKnown) Text("Mới có $observedDays ngày dữ liệu nên chưa dùng nhịp thật (cần ít nhất 7 ngày). Đang tính theo mức đã chọn.", fontSize = 12.5.sp, color = c.muted)
        if (rm != null) {
            val intro = rm.introDay
            val head = if (introDone) "đã học hết từ mới" else if (intro == null) "chưa hết từ mới trong 8 tháng tới" else "hết từ mới ${dm(todayStart, intro)}"
            Text(
                "Với ${fmt(pace)} từ/ngày: $head, lúc cao điểm ôn khoảng ${rm.peakLoad} thẻ/ngày" + (peakMin?.let { " (~$it phút, kể cả từ mới)" } ?: "") + ".",
                fontSize = 13.sp, modifier = Modifier.fillMaxWidth().background(c.accentSoft, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
        Collapsible("Cách đọc và độ tin cậy", "rm-how") {
            for (line in listOf(
                "Máy chạy thử 12 lần việc học trong 8 tháng tới với bộ lập lịch FSRS thật trên thẻ của anh, rồi lấy trung vị.",
                "Giả định anh giữ nhịp từ mới như đang chọn, trả lời theo tỉ lệ Quên/Khó/Tốt/Dễ của 30 ngày qua, không nghỉ dài, không thêm từ mới vào thư viện, không đổi cài đặt.",
                "\"Thuộc\" = mọi thẻ của từ có khoảng ôn từ 21 ngày trở lên. Thẻ gõ của từ mới chỉ mở sau khi nhận diện đã sang Ôn, nên từ chưa thuộc ngay cả khi thẻ đầu đã dài.",
                "Độ chính xác chưa được đo. Ngày hết từ mới phụ thuộc chủ yếu vào việc anh có giữ nhịp không, không phụ thuộc FSRS.",
            )) Text("• $line", fontSize = 13.sp, color = c.muted)
        }
        Collapsible("Tình trạng từ chi tiết", "rm-status") { StatusBars(s) }
    }
}

@Composable
private fun RoadmapChart(rm: Roadmap, todayStart: Long, alpha: Float) {
    val c = Lexi.colors
    val tm = rememberTextMeasurer()
    Canvas(Modifier.fillMaxWidth().aspectRatio(340f / 150f)) {
        val sc = size.width / 340f
        val l = 4f; val r = 336f; val t = 12f; val b = 118f
        val n = rm.unseen.size
        fun x(i: Float) = (l + (r - l) * i / (n - 1)) * sc
        fun y(v: Int) = (b - (b - t) * v / max(1, rm.words)) * sc
        val top = rm.unseen.map { rm.words - it }
        fun band(lower: (Int) -> Int, upper: (Int) -> Int, color: Color, a: Float) {
            val p = Path()
            for (i in 0 until n) {
                if (i == 0) p.moveTo(x(0f), y(lower(0))) else p.lineTo(x(i.toFloat()), y(lower(i)))
            }
            for (i in n - 1 downTo 0) p.lineTo(x(i.toFloat()), y(upper(i)))
            p.close()
            drawPath(p, color, alpha = a * alpha)
        }
        band({ 0 }, { rm.mature[it] }, c.mint, 1f)
        band({ rm.mature[it] }, { top[it] }, c.butter, 0.8f)
        band({ top[it] }, { rm.words }, c.accentSoft, 1f)
        val y80 = y(rm.matureTarget)
        dashed(c.mintDeep, Offset(l * sc, y80), Offset(r * sc, y80), sc)
        label(tm, "80% = ${rm.matureTarget} từ", Offset((l + 2) * sc, y80 - 8.dp.toPx() / 2f - 2f), c.ink, -1, true)
        fun marker(day: Int?, text: String, sub: String?, align: Int, yText: Float) {
            if (day == null || day / 7f > n - 1) return
            val mx = x(day / 7f)
            dashed(c.ink, Offset(mx, t * sc), Offset(mx, b * sc), sc)
            val tx = if (align == -1) mx + 4 * sc else mx - 4 * sc
            label(tm, text, Offset(tx, yText * sc), c.ink, align, true)
            if (sub != null) label(tm, sub, Offset(tx, (yText + 11f) * sc), c.ink, align, true)
        }
        marker(rm.introDay, "Hết từ mới ${dm(todayStart, rm.introDay ?: 0)}", null, -1, t + 10f)
        marker(rm.matureDay, "Thuộc 80%", dm(todayStart, rm.matureDay ?: 0), 1, b - 30f)
        drawLine(c.line, Offset(l * sc, b * sc), Offset(r * sc, b * sc), strokeWidth = sc)
        for (i in listOf(0, 4, 8, n - 1)) {
            label(tm, dm(todayStart, 7 * i), Offset(x(i.toFloat()), (b + 14f) * sc), c.muted, if (i == 0) -1 else if (i == n - 1) 1 else 0)
        }
    }
}

// ------------------------------------------------------------------ forecast

@Composable
private fun ForecastPanel(fc: IntArray, overdue: Int, newPerDay: Double, unseen: Int, todayStart: Long, effort: Effort) {
    val c = Lexi.colors
    val tm = rememberTextMeasurer()
    val n = fc.size
    val news = IntArray(n)
    var left = unseen
    for (i in 0 until n) {
        val t = min(left, Fsrs.jsRound(newPerDay).toInt())
        news[i] = t
        left -= t
    }
    val maxV = max(1, max(fc.indices.maxOf { fc[it] + news[it] }, (effort.usual ?: 0L).toInt()))
    val sum = fc.sum()
    val sumMin = minutes(fc.indices.sumOf { (fc[it] + news[it] * NEW_WORD_ANSWERS).toDouble() }, effort.secPerCard)
    var heavy = 1
    for (i in 1 until n) if (fc[i] > fc[heavy]) heavy = i
    val hasMin = effort.secPerCard != null
    Panel(Modifier.testTag("stats-forecast")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Sắp đến hạn · 14 ngày", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("$sum lượt ôn" + (sumMin?.let { " · ≈ $it phút" } ?: ""), fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
        }
        if (sum == 0) Text("Chưa có thẻ nào đang chờ ôn.", fontSize = 13.sp, color = c.muted)
        val vbW = 4f * 2 + n * 24f
        val vbH = 112f + if (hasMin) 44f else 30f
        Canvas(Modifier.fillMaxWidth().aspectRatio(vbW / vbH)) {
            val sc = size.width / vbW
            val slot = 24f; val l = 4f; val b = 112f; val hMax = 78f
            fun h(v: Int) = v.toFloat() / maxV * hMax
            effort.usual?.let { u ->
                val yy = (b - h(u.toInt())) * sc
                dashed(c.muted, Offset(l * sc, yy), Offset((l + n * slot) * sc, yy), sc)
            }
            for (i in 0 until n) {
                val x0 = l + i * slot
                val bw = 16f
                val bx = x0 + (slot - bw) / 2f
                val hr = h(fc[i]); val hn = h(news[i])
                val radius = CornerRadius(4f * sc, 4f * sc)
                drawRoundRect(c.accent2, Offset(bx * sc, (b - hr) * sc), Size(bw * sc, hr * sc), radius)
                val od = if (i == 0) min(fc[i], overdue) else 0
                if (od > 0) drawRoundRect(c.rose, Offset(bx * sc, (b - hr) * sc), Size(bw * sc, h(od) * sc), radius)
                if (hn > 0) drawRoundRect(c.accentSoft, Offset(bx * sc, (b - hr - hn - 1f) * sc), Size(bw * sc, hn * sc), radius)
                label(tm, "${fc[i]}", Offset((x0 + slot / 2) * sc, (b - hr - hn - 8f) * sc), if (i == 0) c.peachDeep else c.ink, 0, true)
                label(tm, if (i == 0) "Nay" else weekdayOf(todayStart, i), Offset((x0 + slot / 2) * sc, (b + 13f) * sc), if (i == 0) c.peachDeep else c.muted)
                label(tm, dm(todayStart, i).take(2), Offset((x0 + slot / 2) * sc, (b + 25f) * sc), c.muted)
                if (hasMin) label(tm, "${minutes((fc[i] + news[i] * NEW_WORD_ANSWERS).toDouble(), effort.secPerCard)}′", Offset((x0 + slot / 2) * sc, (b + 38f) * sc), c.muted)
            }
            drawLine(c.line, Offset(l * sc, b * sc), Offset((l + n * slot) * sc, b * sc), strokeWidth = sc)
        }
        val legend = ArrayList<Pair<Color?, String>>()
        legend += c.accent2 to "Ôn đến hạn"
        if (overdue > 0) legend += c.rose to "Quá hạn ($overdue)"
        if (news.any { it > 0 }) legend += c.accentSoft to "Từ mới (~${Fsrs.jsRound(newPerDay).toInt()}/ngày)"
        effort.usual?.let { legend += null to "đường nét đứt = mức anh thường làm ($it/ngày)" }
        if (hasMin) legend += null to "′ = phút ước tính"
        Legend(legend)
        if (sum > 0 && fc[heavy] > 0) {
            val over = effort.usual?.let { fc[heavy] + news[heavy] > it } == true
            Text(
                "${weekdayOf(todayStart, heavy)} ${dm(todayStart, heavy)} nặng nhất trong 2 tuần tới: ${fc[heavy]} thẻ ôn" + (if (over) ", cao hơn mức anh thường làm (${effort.usual})." else "."),
                fontSize = 13.sp, modifier = Modifier.fillMaxWidth().background(c.butterSoft, RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
    }
}

// ------------------------------------------------------------------ week

private fun sign(n: Int) = if (n > 0) "↑" else if (n < 0) "↓" else "="

@Composable
private fun Delta(text: String, change: Int, goodWhenUp: Boolean = true) {
    val c = Lexi.colors
    Text(text, fontSize = 11.5.sp, fontWeight = FontWeight.ExtraBold, color = if (change == 0) c.muted else if ((change > 0) == goodWhenUp) c.mintDeep else c.roseDeep)
}

@Composable
private fun Kpi(value: String, label: String, modifier: Modifier, delta: (@Composable () -> Unit)? = null) {
    val c = Lexi.colors
    Column(modifier.background(c.surface2, RoundedCornerShape(14.dp)).padding(horizontal = 10.dp, vertical = 8.dp)) {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
        delta?.invoke()
    }
}

@Composable
private fun WeekPanel(w: WeekCompare, daily: List<com.vh.lexi.core.Daily>, now: Long, dayStartHour: Int) {
    val c = Lexi.colors
    val tm = rememberTextMeasurer()
    val a = w.thisWeek
    val p = w.lastWeek
    val pct = if (p.answers > 0) Math.round((a.answers - p.answers) * 100.0 / p.answers).toInt() else null
    val dMin = Math.round((a.ms - p.ms) / 60_000.0).toInt()
    val aRet = a.retention
    val pRet = p.retention
    val dRet = if (aRet != null && pRet != null) Math.round((aRet - pRet) * 100).toInt() else null
    val maxV = max(10L, max(w.prev.max(), w.now.maxOf { it ?: 0L })).toFloat()
    Panel(Modifier.testTag("stats-week")) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Tuần này", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text((if (w.days == 7) "cả tuần" else "${w.days} ngày đầu") + " so với tuần trước", fontSize = 12.sp, color = c.muted, fontWeight = FontWeight.Bold)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Kpi("${a.activeDays}/${w.days}", "ngày có học", Modifier.weight(1f)) { Delta("tuần trước ${p.activeDays}/${w.days}", a.activeDays - p.activeDays) }
            Kpi("${a.answers}", "lượt trả lời", Modifier.weight(1f)) { if (pct != null) Delta("${sign(pct)} ${Math.abs(pct)}% (${p.answers})", pct) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Kpi("${Math.round(a.ms / 60_000.0)}′", "thời gian", Modifier.weight(1f)) { if (p.ms > 0) Delta("${sign(dMin)} ${Math.abs(dMin)} phút", dMin) }
            Kpi(a.retention?.let { "${Math.round(it * 100)}%" } ?: "–", "nhớ đúng", Modifier.weight(1f)) { if (dRet != null) Delta("${sign(dRet)} ${Math.abs(dRet)} điểm", dRet) }
        }
        Canvas(Modifier.fillMaxWidth().aspectRatio(316f / 116f)) {
            val sc = size.width / 316f
            val slot = 44f; val b = 96f; val hm = 70f
            for (i in 0..6) {
                val x0 = 6f + i * slot
                val pv = w.prev[i]
                val cv = w.now[i]
                val hp = pv / maxV * hm
                val radius = CornerRadius(4f * sc, 4f * sc)
                drawRoundRect(c.surface2, Offset((x0 + 4f) * sc, (b - max(hp, 1f)) * sc), Size(16f * sc, max(hp, 1f) * sc), radius)
                if (pv > 0) label(tm, "$pv", Offset((x0 + 12f) * sc, (b - hp - 8f) * sc), c.muted)
                if (cv != null) {
                    val hc = max(cv / maxV * hm, 2f)
                    drawRoundRect(c.accent, Offset((x0 + 20f) * sc, (b - hc) * sc), Size(16f * sc, hc * sc), radius)
                    label(tm, "$cv", Offset((x0 + 28f) * sc, (b - hc - 8f) * sc), c.ink, 0, true)
                }
                label(tm, if (i == w.days - 1) "Nay" else WEEKDAYS[i], Offset((x0 + 20f) * sc, (b + 14f) * sc), if (i == w.days - 1) c.peachDeep else c.muted)
            }
            drawLine(c.line, Offset(0f, b * sc), Offset(size.width, b * sc), strokeWidth = sc)
        }
        Legend(listOf(c.accent to "Tuần này", c.surface2 to "Tuần trước", null to "số = lượt trả lời thẻ"))
        Collapsible("Lịch 12 tuần", "stats-calendar") {
            val heat = remember(daily, dayStartHour) { heatmap(daily, now, dayStartHour, 12) }
            val weeks = if (heat.isEmpty()) 12 else heat.maxOf { it.week } + 1
            val todayId = dayId(now, dayStartHour)
            Canvas(Modifier.fillMaxWidth().aspectRatio((22f + weeks * 18f) / (14f + 7 * 18f))) {
                val sc = size.width / (22f + weeks * 18f)
                val fills = listOf(0f, 0.28f, 0.52f, 0.76f, 1f)
                for (cell in heat) {
                    val color = lerp(c.surface2, c.accent, fills[heatLevelFixed(cell.count)])
                    val tl = Offset((22f + cell.week * 18f) * sc, (14f + cell.dow * 18f) * sc)
                    drawRoundRect(color, tl, Size(15f * sc, 15f * sc), CornerRadius(3f * sc, 3f * sc))
                    if (cell.id == todayId) drawRoundRect(c.peachDeep, tl, Size(15f * sc, 15f * sc), CornerRadius(3f * sc, 3f * sc), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5f * sc))
                }
                for (d in listOf(0, 2, 4, 6)) label(tm, WEEKDAYS[d], Offset(0f, (14f + d * 18f + 8f) * sc), c.muted, -1)
            }
            Legend(
                listOf(
                    c.surface2 to "0", lerp(c.surface2, c.accent, 0.28f) to "${HEAT_STEPS[0]}–${HEAT_STEPS[1] - 1}", lerp(c.surface2, c.accent, 0.52f) to "${HEAT_STEPS[1]}–${HEAT_STEPS[2] - 1}",
                    lerp(c.surface2, c.accent, 0.76f) to "${HEAT_STEPS[2]}–${HEAT_STEPS[3] - 1}", c.accent to "${HEAT_STEPS[3]}+",
                ),
            )
            Text("Mỗi ô là một ngày, mỗi cột là một tuần (T2 ở trên cùng, cột phải nhất là tuần này, viền cam là hôm nay). Thang màu cố định nên tuần nào cũng so được với nhau.", fontSize = 13.sp, color = c.muted)
        }
    }
}
