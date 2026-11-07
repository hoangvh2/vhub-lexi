package com.vh.lexi.core

import java.text.Normalizer
import java.util.regex.Pattern

/**
 * Hints while studying (port of shared/hints.ts): the memory tip and the learner's own notes, opened from the front.
 * The buttons wake after a few seconds on a review card, level 1 shows a cue and level 2 the whole text with the
 * answer blanked, a hint caps the rating, and a word that leaned on hints lately gets them locked.
 * shared/vectors/hints.json pins every function here.
 */

private const val STRONG_DAYS = 21.0

/** How long the hint buttons stay asleep after the front appears. New and (re)learning cards: no wait. */
fun hintGateMs(state: Int, stability: Double): Long = when {
    state != CardState.REVIEW -> 0
    stability >= STRONG_DAYS -> 6000
    else -> 4000
}

/** The best rating a recall helped by a hint of this level (0 none, 1 cue, 2 whole) may get. */
fun maxRating(level: Int): Int = when (level) { 2 -> 2; 1 -> 3; else -> 4 }

/** A part of a hint text; masked parts are the answer and are drawn as a blank. */
data class Seg(val text: String, val masked: Boolean)

private fun nfc(s: String) = Normalizer.normalize(s, Normalizer.Form.NFC)
private val RE_SPECIAL = Regex("[.*+?^\${}()|\\[\\]\\\\]")
private fun esc(s: String) = RE_SPECIAL.replace(s) { "\\" + it.value }

/** Meanings in the `vi` field, without context labels and one- or two-letter pieces, longest first. */
fun meaningTerms(vi: String): List<String> {
    val out = LinkedHashSet<String>()
    for (raw in vi.split(Regex("[;,/]|\n"))) {
        val t = nfc(raw).replace(Regex("\\([^)]*\\)"), " ").replace(Regex("\\s+"), " ").trim().lowercase()
        if (t.length >= 3) out += t
    }
    return out.sortedByDescending { it.length }
}

/**
 * Blanks out the answer of the card in a hint text: the Vietnamese meaning when the card shows the English word
 * (recognize), the English word in any form when the card asks for it (recall, cloze, listen).
 */
fun maskHint(text: String, note: Note, templateId: String): List<Seg> {
    val src = nfc(text)
    val ranges = mutableListOf<Pair<Int, Int>>()
    if (templateId == "recognize") {
        for (term in meaningTerms(note.fields["vi"].str())) {
            val p = Pattern.compile("(?<![\\p{L}\\p{N}])" + esc(term).replace(" ", "\\s+") + "(?![\\p{L}\\p{N}])", Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE)
            val m = p.matcher(src)
            while (m.find()) ranges += m.start() to m.end()
        }
    } else {
        val word = note.fields["word"].str()
        var from = 0
        while (word.isNotEmpty() && from < src.length) {
            val at = findWord(src.substring(from), word) ?: break
            ranges += (from + at.first) to (from + at.second)
            from += at.second
        }
    }
    val segs = mutableListOf<Seg>()
    var pos = 0
    for ((s, e) in ranges.sortedBy { it.first }) {
        if (e <= pos) continue
        val start = maxOf(s, pos)
        if (start > pos) segs += Seg(src.substring(pos, start), false)
        segs += Seg(src.substring(start, e), true)
        pos = e
    }
    if (pos < src.length) segs += Seg(src.substring(pos), false)
    return segs
}

private const val CUE_WORDS = 6
private val SOUND = Regex("^Đọc như \"[^\"]+\"")
private val CLAUSE = Regex("^(.{6,}?)[:;.,!?—–]")
private val CUT_TAIL = Regex("[\\s:;,.—–-]+$")

/** Level 1: a sound-alike tip keeps just its sound, anything else its first line's first clause, at most six words. */
fun hintCue(text: String): String {
    val t = nfc(text).replace(Regex("[^\\S\\n]+"), " ").replace(Regex("\\s*\\n\\s*"), "\n").trim()
    SOUND.find(t)?.let { return it.value + "…" }
    val line = t.split("\n")[0]
    val clause = CLAUSE.find(line)?.groupValues?.get(1) ?: line
    val cut = clause.split(" ").take(CUE_WORDS).joinToString(" ")
    return if (cut.length < t.length) CUT_TAIL.replace(cut, "") + "…" else cut
}

/** One past answer of a note, in any order. */
data class HintLog(val reviewedAt: Long, val rating: Int, val hint: Int = 0)

fun ReviewLog.hintLog() = HintLog(reviewedAt, rating, hint)

/** A hint in 3 of the last 5 answers; two clean Good/Easy answers in a row clear it at once. */
fun hintDependent(logs: List<HintLog>): Boolean {
    val last = logs.sortedByDescending { it.reviewedAt }.take(5)
    fun clean(l: HintLog) = l.hint == 0 && l.rating >= 3
    if (last.size >= 2 && clean(last[0]) && clean(last[1])) return false
    return last.count { it.hint > 0 } >= 3
}

/** Start the answer side's example list at a different example each review (by the card's review count). */
fun rotateExamples(blocks: List<Block>, reps: Int): List<Block> {
    // The short phrases (one per meaning) keep their place; only the full example sentences take turns.
    val at = blocks.indices.filter { (blocks[it] as? Block.Example)?.phrase == false }
    if (at.size < 2) return blocks
    val shift = ((reps % at.size) + at.size) % at.size
    if (shift == 0) return blocks
    val examples = at.map { blocks[it] }
    val out = blocks.toMutableList()
    at.forEachIndexed { j, i -> out[i] = examples[(j + shift) % examples.size] }
    return out
}
