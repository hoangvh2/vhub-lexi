package com.vh.lexi.core

/**
 * The recall ladder on typing cards (port of shared/ladder.ts): help that still makes the learner type the word.
 * 0 nothing extra, 1 a phrase for another meaning (best rating Good), 2 letters appear one by one (Hard),
 * 3 four words flash (Hard), 4 the answer flashes for 0.6 s (Again). shared/vectors/hints.json pins every function.
 */
const val LADDER_TOP = 4
const val LETTER_STEP_MS = 2000L
const val FLASH_WORDS_MS = 1500L
const val FLASH_ANSWER_MS = 600L

/** The ReviewLog.hint value of a rung: 1 and 2 are the old cue/whole levels, 3 = the answer was flashed. */
fun rungHint(rung: Int): Int = when (rung) { 0 -> 0; 1 -> 1; 4 -> 3; else -> 2 }

/** The rung one press leads to; rung 1 is skipped when the word has no second phrase. null = at the top. */
fun nextRung(rung: Int, hasOtherPhrase: Boolean): Int? = when {
    rung >= LADDER_TOP -> null
    rung == 0 -> if (hasOtherPhrase) 1 else 2
    else -> rung + 1
}

/** How many letters show after [elapsedMs] on rung 2 (the first is free; never all of them). */
fun lettersShown(elapsedMs: Long, letters: Int): Int {
    val n = 1 + (maxOf(0L, elapsedMs) / LETTER_STEP_MS).toInt()
    return maxOf(1, minOf(n, letters - 1))
}

data class OtherPhrase(val segs: List<Seg>, val vi: String)

/** The phrase for rung 1: the one the card is not using (studyNote shows phrase reps % n), word blanked. */
fun otherPhrase(note: Note, reps: Int): OtherPhrase? {
    val ps = phrasesOf(note)
    if (ps.size < 2) return null
    val p = ps[Math.floorMod(reps + 1, ps.size)]
    return OtherPhrase(maskHint(p.text, note, "cloze"), p.vi)
}

private fun fnv(s: String): Long {
    var h = 2166136261L.toInt()
    for (c in s) h = (h xor c.code) * 16777619
    return h.toLong() and 0xFFFFFFFFL
}

/** Rung 3: the word among three others, in an order fixed by [seed]. null when fewer than 2 other words. */
fun flashWords(word: String, pool: List<String>, seed: String): List<String>? {
    val w = word.trim().lowercase()
    val others = ArrayList<String>()
    for (c in pool) {
        val t = c.trim()
        if (t.isNotEmpty() && t.lowercase() != w && others.none { it.lowercase() == t.lowercase() }) others += t
        if (others.size == 3) break
    }
    if (others.size < 2) return null
    return (listOf(word.trim()) + others).sortedWith { a, b ->
        val d = fnv(seed + a) - fnv(seed + b)
        if (d != 0L) d.compareTo(0L) else a.compareTo(b)
    }
}
