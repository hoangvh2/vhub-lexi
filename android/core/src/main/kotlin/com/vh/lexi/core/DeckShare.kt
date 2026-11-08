package com.vh.lexi.core

/**
 * Pure helpers for the "new words by deck" settings (port of web/src/lib/deckshare.ts). Weights are whole numbers kept
 * relative to each other; the screen shows them as percentages that add up to 100.
 */
enum class ShareMode { EQUAL, RANK, CUSTOM }

/** [total] split into whole numbers in proportion to [weights] (largest remainder); all zeros when every weight is 0. */
private fun apportion(total: Int, weights: List<Int>): List<Int> {
    val sum = weights.sumOf { it.toLong() }
    if (sum <= 0) return weights.map { 0 }
    val q = weights.map { (it.toLong() * total / sum).toInt() }.toMutableList()
    val r = weights.map { it.toLong() * total % sum }
    var left = total - q.sum()
    for (i in weights.indices.sortedWith(compareByDescending<Int> { r[it] }.thenByDescending { weights[it] }.thenBy { it })) {
        if (left <= 0) break
        q[i]++
        left--
    }
    return q
}

/** Whole percentages of [weights] that add up to 100; all zeros when every weight is 0. */
fun percents(weights: List<Int>): List<Int> = apportion(100, weights)

/** Weights for "by priority": the first deck counts 1, the second 1/2, the third 1/3 ... (4 decks: 48/24/16/12). */
fun rankWeights(n: Int): List<Int> = percents(List(n) { Math.round(1_000_000.0 / (it + 1)).toInt() })

/** Put deck [i] at [pct] percent; the others share what is left in proportion to what they had (equally if they had nothing). */
fun setPercent(weights: List<Int>, i: Int, pct: Int): List<Int> {
    if (weights.size <= 1) return weights.map { 100 }
    val want = pct.coerceIn(0, 100)
    val others = weights.mapIndexed { k, w -> if (k == i) 0 else w }
    val basis = if (others.any { it > 0 }) others else others.indices.map { k -> if (k == i) 0 else 1 }
    return apportion(100 - want, basis).mapIndexed { k, v -> if (k == i) want else v }
}

/** Which of the three modes the weights are in: all equal, exactly by priority, or anything else. */
fun shareMode(weights: List<Int>): ShareMode {
    if (weights.isEmpty() || weights.all { it == weights[0] }) return ShareMode.EQUAL
    val sorted = weights.sortedDescending()
    return if (percents(sorted) == rankWeights(weights.size)) ShareMode.RANK else ShareMode.CUSTOM
}

/**
 * "TOEIC 600 từ 7 · Từ vựng Part 5 1": today's new words per deck (already learned plus still waiting in [waiting]), biggest
 * first; null when fewer than two decks have any. Same numbers as the chips on the web Today screen.
 */
fun newMixLabel(decks: List<Deck>, doneByDeck: Map<String, Long>, waiting: List<Card>): String? {
    val n = HashMap<String, Int>()
    for ((k, v) in doneByDeck) n[k] = v.toInt()
    for (c in waiting) n[c.deckId] = (n[c.deckId] ?: 0) + 1
    val parts = decks.filter { (n[it.id] ?: 0) > 0 }.sortedWith(compareByDescending<Deck> { n[it.id] ?: 0 }.thenBy { it.createdAt }.thenBy { it.id })
    return if (parts.size < 2) null else parts.joinToString(" · ") { "${it.name} ${n[it.id]}" }
}
