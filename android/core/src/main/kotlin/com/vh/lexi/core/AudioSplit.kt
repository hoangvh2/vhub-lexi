package com.vh.lexi.core

/**
 * Finding each question inside a long Listening file, on the device (port of web/src/lib/audio.ts): the file is decoded
 * at a low rate, its loudness measured every 50 ms, and the answer pauses (the silence after each question, 5 s in
 * Part 1–2 and 8 s in Part 3–4 of a real test) mark where one question ends. Pure functions over the samples; the app
 * decodes the file. Replayed against shared/vectors/testset.json.
 */
object AudioSplit {
    const val FRAME_MS = 50

    /** Below this level (dBFS) a frame is silence: well above a studio recording's noise floor, below speech. */
    const val SILENCE_DB = -40.0

    /** An answer pause is at least this long; the gaps between the options of one question are about 1 s. */
    const val ANSWER_PAUSE_MS = 2500L

    /** Loudness of each frame in dBFS (-100 for digital silence). */
    fun frameLevels(samples: FloatArray, rate: Int, frameMs: Int = FRAME_MS): FloatArray {
        val size = maxOf(1L, Math.round(rate.toDouble() * frameMs / 1000)).toInt()
        val out = FloatArray((samples.size + size - 1) / size)
        for (f in out.indices) {
            var sum = 0.0
            val end = minOf(samples.size, (f + 1) * size)
            for (i in f * size until end) sum += samples[i].toDouble() * samples[i]
            val rms = Math.sqrt(sum / maxOf(1, end - f * size))
            out[f] = if (rms > 1e-5) (20 * Math.log10(rms)).toFloat() else -100f
        }
        return out
    }

    /**
     * [frameLevels] fed piece by piece, as a decoder hands out its buffers: a 45-minute file never has to sit in memory
     * as one array. Gives the same levels as [frameLevels] over the whole file.
     */
    class Meter(rate: Int, frameMs: Int = FRAME_MS) {
        private val size = maxOf(1L, Math.round(rate.toDouble() * frameMs / 1000)).toInt()
        private var levels = FloatArray(1024)
        private var frames = 0
        private var sum = 0.0
        private var inFrame = 0
        var samples = 0L
            private set

        fun add(x: Float) {
            sum += x.toDouble() * x
            samples++
            if (++inFrame == size) flush()
        }

        private fun flush() {
            val rms = Math.sqrt(sum / maxOf(1, inFrame))
            if (frames == levels.size) levels = levels.copyOf(levels.size * 2)
            levels[frames++] = if (rms > 1e-5) (20 * Math.log10(rms)).toFloat() else -100f
            sum = 0.0
            inFrame = 0
        }

        fun finish(): FloatArray {
            if (inFrame > 0) flush()
            return levels.copyOf(frames)
        }
    }

    /** Silent stretches of at least [minMs], as start to end in ms; one that runs to the end of the file is kept. */
    fun findGaps(levels: FloatArray, frameMs: Int = FRAME_MS, minMs: Int = 600, silenceDb: Double = SILENCE_DB): List<Pair<Long, Long>> {
        val gaps = mutableListOf<Pair<Long, Long>>()
        var start = -1
        for (f in 0..levels.size) {
            val quiet = f < levels.size && levels[f] < silenceDb
            if (quiet && start < 0) start = f
            if (!quiet && start >= 0) {
                if ((f - start).toLong() * frameMs >= minMs) gaps += start.toLong() * frameMs to f.toLong() * frameMs
                start = -1
            }
        }
        return gaps
    }

    /**
     * Where each of [count] questions is in a file of [durationMs]: question k ends where its answer pause begins. The
     * answer pauses are the [count] longest gaps of at least ANSWER_PAUSE_MS; a set of pauses of uneven length means the
     * count is wrong. The first question starts after the last long gap before its pause (the end of the directions),
     * else at 0. Null when the file does not hold that many answer pauses: then the learner replays the whole file.
     */
    fun questionSpans(gaps: List<Pair<Long, Long>>, durationMs: Long, count: Int): List<Pair<Long, Long>>? {
        if (count < 1) return emptyList()
        val long = gaps.filter { (a, b) -> b - a >= ANSWER_PAUSE_MS }
        if (long.size < count) return null
        val pauses = long.sortedByDescending { (a, b) -> b - a }.take(count).sortedBy { it.first }
        // The exam gives every question of a part the same pause; one much shorter than the rest is something else.
        val lens = pauses.map { (a, b) -> b - a }.sorted()
        if (lens[0] < 0.75 * lens[lens.size / 2]) return null
        val before = long.filter { (_, b) -> b <= pauses[0].first }
        val spans = mutableListOf<Pair<Long, Long>>()
        var from = before.lastOrNull()?.second ?: 0L
        for ((a, b) in pauses) {
            spans += from to minOf(a + 300, durationMs)
            from = b
        }
        return spans
    }

    /** "0:09" */
    fun mmss(ms: Long): String = "${ms / 60_000}:${((ms % 60_000) / 1000).toString().padStart(2, '0')}"

    /** What one file holds for splitting: its answer-pause candidates and length. */
    data class TrackLevels(val gaps: List<Pair<Long, Long>>, val durationMs: Long)

    /**
     * Each question's place in the files, by position in [parts] (the questions' parts in test order). One file holds every
     * question; or there is one file per part present. Anything else is ambiguous and gives null for every question, as
     * does a file whose pauses do not match its questions.
     */
    fun placeQuestions(tracks: List<TrackLevels>, parts: List<Int?>): List<Clip?> {
        val out = MutableList<Clip?>(parts.size) { null }
        val groups = if (tracks.size == 1) listOf(parts.indices.toList()) else {
            val order = parts.distinct()
            if (order.size != tracks.size) return out
            order.map { p -> parts.indices.filter { parts[it] == p } }
        }
        groups.forEachIndexed { t, qs ->
            val spans = questionSpans(tracks[t].gaps, tracks[t].durationMs, qs.size) ?: return@forEachIndexed
            qs.forEachIndexed { k, qi -> out[qi] = Clip(t, spans[k].first, spans[k].second) }
        }
        return out
    }

    /** Where a Part is heard in a file (PartWindow.Ok): [to] null = to the end of the file. */
    data class PartSpot(val track: Int, val from: Long, val to: Long?)

    /**
     * Each question's place when the learner has told where each Part is: every Listening Part is split on its own, from the
     * answer pauses inside its window, with its own question count (web: placeQuestionsByPart). A question whose Part has no
     * window, or whose window does not hold that many pauses, gets null.
     */
    fun placeQuestionsByPart(tracks: List<TrackLevels>, parts: List<Int?>, windows: Map<Int, PartSpot>): List<Clip?> {
        val out = MutableList<Clip?>(parts.size) { null }
        for (p in parts.filterNotNull().distinct()) {
            val w = windows[p] ?: continue
            val t = tracks.getOrNull(w.track) ?: continue
            val end = w.to ?: t.durationMs
            val gaps = t.gaps.mapNotNull { (a, b) ->
                val x = maxOf(a, w.from)
                val y = minOf(b, end)
                if (y > x) (x - w.from) to (y - w.from) else null
            }
            val qs = parts.indices.filter { parts[it] == p }
            val spans = questionSpans(gaps, end - w.from, qs.size) ?: continue
            qs.forEachIndexed { k, qi -> out[qi] = Clip(w.track, w.from + spans[k].first, w.from + spans[k].second) }
        }
        return out
    }

    /** The loudest level of each [binMs] of the file: what the waveform strip draws (web: envelope). */
    fun envelope(levels: FloatArray, frameMs: Int = FRAME_MS, binMs: Int = 1000): List<Double> {
        val per = maxOf(1, Math.round(binMs.toDouble() / frameMs).toInt())
        val out = mutableListOf<Double>()
        var i = 0
        while (i < levels.size) {
            var m = -100.0
            for (j in i until minOf(levels.size, i + per)) if (levels[j] > m) m = levels[j].toDouble()
            out += Math.round(m * 10) / 10.0
            i += per
        }
        return out
    }

    /** The ends of the long silences nearest [ms], nearest first: where a mark may be. Only a suggestion to listen to (web: snapCandidates). */
    fun snapCandidates(gaps: List<Pair<Long, Long>>, ms: Long, count: Int = 3, minMs: Long = ANSWER_PAUSE_MS): List<Long> =
        gaps.filter { (a, b) -> b - a >= minMs }.map { it.second }
            .sortedWith(compareBy<Long> { Math.abs(it - ms) }.thenBy { it }).take(count)
}
