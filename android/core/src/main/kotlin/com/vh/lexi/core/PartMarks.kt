package com.vh.lexi.core

/**
 * Where each Part of a Listening test is inside its audio, set by the learner and kept with the set
 * (web: lib/partmarks.ts, the reference; vectors in shared/vectors/partmarks.json).
 *
 * A real test (ETS) is one long file, so "do Part 3 on its own" needs to know where Part 3 starts and ends. The marks are
 * boundaries: the end of Part 2 and the start of Part 3 are usually one moment, so setting one sets the other (until the
 * learner pulls them apart). The first Part of a file starts at 0:00 and the last ends with the file. Nothing is guessed:
 * a Part whose start or end is not known has no window.
 */
data class PartCut(val track: Int, val start: Long? = null, val end: Long? = null)
typealias PartCuts = Map<Int, PartCut>

enum class MarkField { START, END }
enum class MarkError { NEGATIVE, ORDER }

/** The stretch of a file a Part is heard in. [to] null = to the end of the file. */
sealed interface PartWindow {
    data class Ok(val track: Int, val from: Long, val to: Long?) : PartWindow
    data class Missing(val field: MarkField) : PartWindow
}

data class MarkResult(val cuts: PartCuts, val error: MarkError? = null)

/** The file each Part is in: its own mark's, else the previous Part's, else the first file. */
private fun tracksOf(cuts: PartCuts, order: List<Int>): List<Int> {
    val out = mutableListOf<Int>()
    for (p in order) out += cuts[p]?.track ?: out.lastOrNull() ?: 0
    return out
}

private fun inTrack(cuts: PartCuts, order: List<Int>, track: Int): List<Int> {
    val t = tracksOf(cuts, order)
    return order.filterIndexed { i, _ -> t[i] == track }
}

/** Where [part] is heard (web: partWindow). */
fun partWindow(cuts: PartCuts, order: List<Int>, part: Int): PartWindow {
    val i = order.indexOf(part)
    if (i < 0) return PartWindow.Missing(MarkField.START)
    val track = tracksOf(cuts, order)[i]
    val mine = inTrack(cuts, order, track)
    val k = mine.indexOf(part)
    val cut = cuts[part]
    val from = cut?.start ?: if (k == 0) 0L else return PartWindow.Missing(MarkField.START)
    val hasNext = k + 1 < mine.size
    val to: Long? = cut?.end ?: if (hasNext) (cuts[mine[k + 1]]?.start ?: return PartWindow.Missing(MarkField.END)) else null
    if (to != null && to <= from) return PartWindow.Missing(MarkField.END)
    return PartWindow.Ok(track, from, to)
}

private fun inOrder(cuts: PartCuts, order: List<Int>): Boolean {
    for (track in tracksOf(cuts, order).toSet()) {
        var last = -1L
        for (p in inTrack(cuts, order, track)) {
            val c = cuts[p]
            c?.start?.let { if (it < last) return false; last = it }
            c?.end?.let { if (it < last || (c.start != null && it == last)) return false; last = it }
        }
    }
    return true
}

private fun PartCut.with(f: MarkField, v: Long?): PartCut = if (f == MarkField.START) copy(start = v) else copy(end = v)
private fun PartCut.of(f: MarkField): Long? = if (f == MarkField.START) start else end

/** Sets the start or the end of [part] to [ms] in file [track]; with [link] the neighbouring side moves with it (web: setMark). */
fun setMark(cuts: PartCuts, order: List<Int>, part: Int, field: MarkField, ms: Long, track: Int = 0, link: Boolean = true): MarkResult {
    if (ms < 0) return MarkResult(cuts, MarkError.NEGATIVE)
    val next = cuts.toMutableMap()
    fun put(p: Int, f: MarkField, v: Long?, t: Int) { next[p] = (next[p] ?: PartCut(t)).copy(track = t).with(f, v) }
    val old = cuts[part]?.of(field)
    put(part, field, ms, track)
    if (link) {
        val mine = inTrack(next, order, track)
        val k = mine.indexOf(part)
        val other = if (field == MarkField.END) mine.getOrNull(k + 1) else mine.getOrNull(k - 1)
        val otherField = if (field == MarkField.END) MarkField.START else MarkField.END
        if (other != null) {
            val v = next[other]?.of(otherField)
            if (v == null || v == old) put(other, otherField, ms, track)
        }
    }
    return if (inOrder(next, order)) MarkResult(next) else MarkResult(cuts, MarkError.ORDER)
}

/** Removes the start or the end of [part]; an emptied mark is dropped. */
fun clearMark(cuts: PartCuts, part: Int, field: MarkField): PartCuts {
    val c = cuts[part] ?: return cuts
    if (c.of(field) == null) return cuts
    val rest = c.with(field, null)
    return if (rest.start == null && rest.end == null) cuts - part else cuts + (part to rest)
}

private val CLOCK = Regex("^\\s*(?:(\\d+):)?(?:(\\d+):)?(\\d+)(?:[.,](\\d{1,3}))?\\s*$")

/** "21:34", "1:02:03", "94" (seconds), "21:34.5" → ms; null when it is not a time (web: parseClock). */
fun parseClock(text: String): Long? {
    val m = CLOCK.matchEntire(text) ?: return null
    val parts = listOf(m.groupValues[1], m.groupValues[2], m.groupValues[3]).filter { it.isNotEmpty() }.map { it.toLong() }
    val frac = m.groupValues[4].takeIf { it.isNotEmpty() }?.padEnd(3, '0')?.toLong() ?: 0L
    val sec = when (parts.size) {
        1 -> parts[0]
        else -> {
            if (parts.drop(1).any { it >= 60 }) return null
            if (parts.size == 2) parts[0] * 60 + parts[1] else parts[0] * 3600 + parts[1] * 60 + parts[2]
        }
    }
    return sec * 1000 + frac
}

/** "21:34" (an hour or more: "1:02:03"); tenths of a second only when there are some (web: formatClock). */
fun formatClock(ms: Long): String {
    val total = maxOf(0L, ms)
    val s = total / 1000
    val tenth = Math.round((total % 1000) / 100.0).toInt()
    val h = s / 3600
    val mm = (s % 3600) / 60
    val ss = s % 60
    val base = if (h > 0) "$h:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}" else "$mm:${ss.toString().padStart(2, '0')}"
    return if (tenth in 1..9) "$base.$tenth" else base
}

/** Does this Listening set need marks to be done a Part at a time: one file holds more than one Part (web: needsPartMarks). */
fun needsPartMarks(trackCount: Int, questions: List<SetQuestion>): Boolean {
    if (trackCount == 0) return false
    val lc = questions.filter { it.part != null && it.part!! <= 4 }
    if (lc.isEmpty() || lc.any { it.track != null }) return false
    val parts = lc.map { it.part }.toSet()
    return parts.size >= 2 && trackCount < parts.size
}

/** The Listening Parts of a set in order, as the marks refer to them. */
fun markParts(questions: List<SetQuestion>): List<Int> = questions.mapNotNull { it.part }.filter { it <= 4 }.distinct().sorted()

fun PartCut.toJson(): org.json.JSONObject = org.json.JSONObject().put("track", track).apply { start?.let { put("start", it) }; end?.let { put("end", it) } }

fun Map<Int, PartCut>.toJson(): org.json.JSONObject = org.json.JSONObject().apply { toSortedMap().forEach { (k, c) -> put(k.toString(), c.toJson()) } }

/** One Part's cut as `state` has it; null when it is not one (web: readCut). */
fun cutFromJson(x: org.json.JSONObject): PartCut? {
    fun int(k: String): Long? = (x.opt(k) as? Number)?.toDouble()?.takeIf { it.isFinite() && it == Math.floor(it) }?.toLong()
    val track = int("track")?.takeIf { it >= 0 } ?: return null
    var start: Long? = null
    var end: Long? = null
    if (x.has("start")) start = int("start")?.takeIf { it >= 0 } ?: return null
    if (x.has("end")) end = int("end")?.takeIf { it >= 0 } ?: return null
    return PartCut(track.toInt(), start, end)
}
