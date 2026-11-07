package com.vh.lexi.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vh.lexi.core.FLASH_ANSWER_MS
import com.vh.lexi.core.FLASH_WORDS_MS
import com.vh.lexi.core.LETTER_STEP_MS
import com.vh.lexi.core.Note
import com.vh.lexi.core.flashWords
import com.vh.lexi.core.letterCount
import com.vh.lexi.core.nextRung
import com.vh.lexi.core.otherPhrase
import com.vh.lexi.ui.theme.Lexi
import kotlinx.coroutines.delay

private val NEXT_LABEL = mapOf(1 to "Cụm ở nghĩa khác", 2 to "Hiện dần chữ cái", 3 to "Chớp 4 từ", 4 to "Chớp đáp án")
private val CAP_LABEL = mapOf(1 to "tối đa Tốt", 2 to "tối đa Khó", 3 to "tối đa Khó", 4 to "tính là Lại")
private val USED = mapOf(1 to "cụm nghĩa khác", 2 to "chữ cái", 3 to "4 từ chớp", 4 to "đáp án chớp")

/**
 * The recall ladder under a typing card (port of web Ladder.tsx, rules in core Ladder.kt): more help, a lower best
 * rating, and the word is always typed. Only the newest rung is open; older rungs fold into one line.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
internal fun Ladder(
    note: Note,
    reps: Int,
    word: String,
    pool: () -> List<String>,
    seed: String,
    gateMs: Long,
    locked: Boolean,
    mode: Color,
    onChange: (rung: Int, extraLetters: Int) -> Unit,
) {
    val c = Lexi.colors
    val toast = LocalToaster.current
    var rung by remember(note.id) { mutableStateOf(0) }
    var awake by remember(note.id) { mutableStateOf(gateMs == 0L) }
    var flash by remember(note.id) { mutableStateOf<List<String>?>(null) }
    var extra by remember(note.id) { mutableStateOf(0) }
    val other = remember(note, reps) { otherPhrase(note, reps) }
    val letters = letterCount(word)
    val alpha = remember(note.id) { Animatable(0f) }

    LaunchedEffect(note.id, gateMs) { if (gateMs > 0) { delay(gateMs); awake = true } }

    // Rung 2: a new letter every 2 s, until one is left.
    LaunchedEffect(note.id, rung) {
        if (rung != 2) return@LaunchedEffect
        while (extra < maxOf(0, letters - 2)) {
            delay(LETTER_STEP_MS)
            extra++
            onChange(2, extra)
        }
    }

    // Rungs 3 and 4: a flash that goes away by itself.
    LaunchedEffect(note.id, rung) {
        if (rung != 3 && rung != 4) return@LaunchedEffect
        val ms = if (rung == 4) FLASH_ANSWER_MS else FLASH_WORDS_MS
        flash = if (rung == 4) listOf(word) else (flashWords(word, pool(), seed) ?: listOf(word))
        alpha.snapTo(0f)
        alpha.animateTo(1f, tween(120))
        delay(maxOf(0L, ms - 240))
        alpha.animateTo(0f, tween(120))
        flash = null
    }

    val next = nextRung(rung, other != null)
    val used = (1..4).filter { it < rung && (it != 1 || other != null) }
    Column(Modifier.fillMaxWidth().testTag("ladder"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (used.isNotEmpty()) Text("Đã dùng: " + used.joinToString(" · ") { USED.getValue(it) }, Modifier.testTag("ladder-used"), fontSize = 12.sp, color = c.muted)
        AnimatedVisibility(rung == 1 && other != null, enter = fadeIn(tween(220)) + slideInVertically(tween(220)) { it / 4 }) {
            val o = other
            if (o != null) Column(
                Modifier.fillMaxWidth().testTag("ladder-phrase").background(mode.copy(alpha = 0.10f), RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                Text("NGHĨA KHÁC", fontSize = 11.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.7.sp, color = mode)
                Text(
                    buildAnnotatedString {
                        for (s in o.segs) {
                            if (s.masked) withStyle(SpanStyle(color = Color.Transparent, background = mode.copy(alpha = 0.28f))) { append("      ") } else append(s.text)
                        }
                    },
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.ink,
                )
                if (o.vi.isNotEmpty()) Text(o.vi, fontSize = 13.sp, color = c.muted)
            }
        }
        if (rung == 3 || rung == 4) {
            Column(Modifier.fillMaxWidth().heightIn(min = 64.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                val words = flash
                if (words != null) {
                    // Not clickable and hidden from screen readers: it is there to be seen for a moment, not read out.
                    FlowRow(
                        Modifier.alpha(alpha.value).testTag("ladder-flash").clearAndSetSemantics { }
                            .background(mode.copy(alpha = 0.12f), RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        for (w in words) Text(w, fontSize = if (words.size == 1) 26.sp else 20.sp, fontWeight = FontWeight.Bold, color = mode, textAlign = TextAlign.Center)
                    }
                } else Text(if (rung == 4) "Đáp án đã ẩn, hãy gõ lại" else "Bạn đã thấy 4 từ, hãy gõ lại", fontSize = 13.sp, color = c.muted)
            }
        }
        if (next != null) {
            OutlinedButton(
                onClick = {
                    when {
                        flash != null -> Unit
                        locked -> toast("Từ này bạn hay cần gợi ý. Lần này hãy tự nhớ.")
                        !awake -> toast("Thử tự nhớ thêm vài giây nhé")
                        else -> { rung = next; onChange(next, extra) }
                    }
                },
                modifier = Modifier.testTag("ladder-btn").alpha(if (awake && !locked) 1f else 0.55f),
            ) {
                Text(NEXT_LABEL.getValue(next))
                Text("  " + CAP_LABEL.getValue(next), fontSize = 11.sp, color = c.muted)
            }
        }
    }
}
