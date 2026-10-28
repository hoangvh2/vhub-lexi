package com.vh.lexi.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.LexiApp
import com.vh.lexi.core.cardCounts
import com.vh.lexi.core.dayId
import com.vh.lexi.core.forecast
import com.vh.lexi.core.heatLevel
import com.vh.lexi.core.heatmap
import com.vh.lexi.core.retention
import com.vh.lexi.core.streak
import com.vh.lexi.ui.theme.Lexi

@Composable
fun StatsScreen(app: LexiApp) {
    val cards by app.data.cards.collectAsState()
    val notes by app.data.notes.collectAsState()
    val daily by app.data.daily.collectAsState()
    val prefs by app.data.prefs.collectAsState()
    val now = System.currentTimeMillis()
    val c = Lexi.colors

    val counts = remember(cards) { cardCounts(cards) }
    val fc = remember(cards, prefs.dayStartHour) { forecast(cards, now, prefs.dayStartHour) }
    val heat = remember(daily, prefs.dayStartHour) { heatmap(daily, now, prefs.dayStartHour) }
    val today = daily.firstOrNull { it.id == dayId(now, prefs.dayStartHour) }
    val ret = retention(daily, now, prefs.dayStartHour)
    val st = streak(daily, now, prefs.dayStartHour)

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenHeader("Thống kê")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatTile("${notes.size}", "từ trong thư viện")
            StatTile("${(today?.newCards ?: 0) + (today?.reviews ?: 0)}", "thẻ đã học hôm nay")
            StatTile("$st", "ngày liên tiếp")
            StatTile(ret?.let { "${Math.round(it * 100)}%" } ?: "–", "nhớ đúng (30 ngày)")
        }

        Panel {
            Text("Sắp đến hạn · 14 ngày tới", fontWeight = FontWeight.Bold)
            if (fc.all { it == 0 }) Text("Chưa có thẻ nào đang chờ ôn.", color = c.muted, fontSize = 13.sp)
            val max = (fc.maxOrNull() ?: 1).coerceAtLeast(1)
            Canvas(Modifier.fillMaxWidth().height(110.dp)) {
                val barW = size.width / fc.size
                fc.forEachIndexed { i, n ->
                    val h = (n.toFloat() / max) * (size.height - 8f)
                    drawRoundRect(
                        color = if (i == 0) c.again else c.accent,
                        topLeft = Offset(i * barW + barW * 0.15f, size.height - h),
                        size = Size(barW * 0.7f, h.coerceAtLeast(if (n > 0) 3f else 0f)),
                        cornerRadius = CornerRadius(4f, 4f),
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Nay", color = c.muted, fontSize = 11.sp)
                Text("+7", color = c.muted, fontSize = 11.sp)
                Text("+13", color = c.muted, fontSize = 11.sp)
            }
        }

        Panel {
            Text("Tình trạng thẻ", fontWeight = FontWeight.Bold)
            val seg = listOf(
                Triple("Mới", counts.new, c.easy), Triple("Đang học", counts.learning, c.again),
                Triple("Mới ôn (<21 ngày)", counts.young, c.hard), Triple("Thuộc (≥21 ngày)", counts.mature, c.good),
            )
            val total = seg.sumOf { it.second }.coerceAtLeast(1)
            Row(Modifier.fillMaxWidth().height(14.dp).background(c.surface2, RoundedCornerShape(7.dp))) {
                for ((_, n, color) in seg) if (n > 0) Box(Modifier.weight(n.toFloat() / total).height(14.dp).background(color))
            }
            for ((label, n, color) in seg) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(10.dp).background(color, RoundedCornerShape(3.dp)))
                        Text(label)
                    }
                    Text("$n", fontWeight = FontWeight.Bold)
                }
            }
            if (counts.suspended > 0) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Đã ẩn", color = c.muted); Text("${counts.suspended}", fontWeight = FontWeight.Bold) }
        }

        Panel {
            Text("Hoạt động · 26 tuần", fontWeight = FontWeight.Bold)
            val maxCount = (heat.maxOfOrNull { it.count } ?: 1L).coerceAtLeast(1L)
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                Canvas(Modifier.size(width = (26 * 15 + 2).dp, height = (7 * 15).dp)) {
                    val cell = 15.dp.toPx()
                    for (h in heat) {
                        val lvl = heatLevel(h.count, maxCount)
                        val color: Color = if (lvl == 0) c.surface2 else lerp(c.surface2, c.accent, lvl / 4f)
                        drawRoundRect(color, Offset(h.week * cell, h.dow * cell), Size(cell - 3.dp.toPx(), cell - 3.dp.toPx()), CornerRadius(4f, 4f))
                    }
                }
            }
        }
    }
}

@Composable
private fun StatTile(value: String, label: String) {
    Column(Modifier.background(Lexi.colors.surface2, RoundedCornerShape(12.dp)).padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(label, fontSize = 12.sp, color = Lexi.colors.muted)
    }
}
