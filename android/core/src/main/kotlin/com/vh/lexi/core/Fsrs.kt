package com.vh.lexi.core

import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * FSRS-6 scheduler, a port of ts-fsrs 5.x `BasicScheduler` (short-term learning steps on, fuzz off).
 * The web app uses ts-fsrs; shared/vectors/fsrs.json (produced by it) pins this port, answer by answer.
 */
class Fsrs(
    private val retention: Double = 0.9,
    private val w: DoubleArray = DEFAULT_W,
    private val learningSteps: List<Int> = listOf(1, 10), // minutes
    private val relearningSteps: List<Int> = listOf(10),
    private val maxInterval: Int = 36_500,
) {
    private val decay = -w[20]
    private val factor = roundTo(exp((1.0 / decay) * ln(0.9)) - 1, 8)
    private val intervalModifier = roundTo((retention.pow(1.0 / decay) - 1) / factor, 8)

    fun forgettingCurve(elapsedDays: Double, stability: Double): Double =
        roundTo((1 + factor * elapsedDays / stability).pow(decay), 8)

    private fun initStability(g: Int) = max(w[g - 1], 0.1)
    private fun initDifficulty(g: Int) = roundTo(w[4] - exp((g - 1) * w[5]) + 1, 8)

    private fun nextInterval(s: Double): Int =
        min(max(1.0, jsRound(s * intervalModifier)), maxInterval.toDouble()).toInt()

    private fun linearDamping(deltaD: Double, oldD: Double) = roundTo(deltaD * (10 - oldD) / 9, 8)
    private fun meanReversion(init: Double, current: Double) = roundTo(w[7] * init + (1 - w[7]) * current, 8)

    private fun nextDifficulty(d: Double, g: Int): Double {
        val deltaD = -w[6] * (g - 3)
        val nextD = d + linearDamping(deltaD, d)
        return clamp(meanReversion(initDifficulty(4), nextD), 1.0, 10.0)
    }

    private fun nextRecallStability(d: Double, s: Double, r: Double, g: Int): Double {
        val hardPenalty = if (g == 2) w[15] else 1.0
        val easyBound = if (g == 4) w[16] else 1.0
        return roundTo(
            clamp(
                s * (1 + exp(w[8]) * (11 - d) * s.pow(-w[9]) * (exp((1 - r) * w[10]) - 1) * hardPenalty * easyBound),
                S_MIN, S_MAX,
            ),
            8,
        )
    }

    private fun nextForgetStability(d: Double, s: Double, r: Double): Double =
        roundTo(clamp(w[11] * d.pow(-w[12]) * ((s + 1).pow(w[13]) - 1) * exp((1 - r) * w[14]), S_MIN, S_MAX), 8)

    private fun nextShortTermStability(s: Double, g: Int): Double {
        val sinc = s.pow(-w[19]) * exp(w[17] * (g - 3 + w[18]))
        val masked = if (g >= 2) max(sinc, 1.0) else sinc
        return roundTo(clamp(s * masked, S_MIN, S_MAX), 8)
    }

    private data class Memory(val difficulty: Double, val stability: Double)

    private fun nextMemory(d: Double, s: Double, t: Int, g: Int, rOverride: Double?): Memory {
        if (d == 0.0 && s == 0.0) return Memory(clamp(initDifficulty(g), 1.0, 10.0), initStability(g))
        val r = rOverride ?: forgettingCurve(t.toDouble(), s)
        val newS = when {
            t == 0 -> nextShortTermStability(s, g)
            g == 1 -> {
                val afterFail = nextForgetStability(d, s, r)
                val sMin = s / exp(w[17] * w[18])
                clamp(roundTo(sMin, 8), S_MIN, afterFail)
            }
            else -> nextRecallStability(d, s, r, g)
        }
        return Memory(nextDifficulty(d, g), newS)
    }

    private class Step(val minutes: Int, val nextStep: Int)

    /** ts-fsrs BasicLearningStepsStrategy: minutes to wait and the next step index for [g], or null (= graduate). */
    private fun stepFor(state: Int, curStep: Int, g: Int): Step? {
        val steps = if (state == CardState.RELEARNING || state == CardState.REVIEW) relearningSteps else learningSteps
        if (steps.isEmpty() || curStep >= steps.size) return null
        val first = steps[0]
        if (state == CardState.REVIEW) return if (g == 1) Step(steps[max(0, curStep)], 0) else null
        return when (g) {
            1 -> Step(first, 0)
            2 -> Step(if (steps.size == 1) jsRound(first * 1.5).toInt() else jsRound((first + steps[1]) / 2.0).toInt(), curStep)
            3 -> steps.getOrNull(curStep + 1)?.takeIf { it != 0 }?.let { Step(it, curStep + 1) }
            else -> null
        }
    }

    private fun applySteps(base: Card, current: Card, now: Long, g: Int, toState: Int, elapsedDays: Int): Card {
        val info = stepFor(current.state, current.learningSteps, g)
        val minutes = max(0, info?.minutes ?: 0)
        val nextStep = max(0, info?.nextStep ?: 0)
        return when {
            minutes in 1 until 1440 -> base.copy(
                learningSteps = nextStep, scheduledDays = 0.0, state = toState, due = now + minutes * 60_000L,
            )
            minutes >= 1440 -> base.copy(
                state = CardState.REVIEW, learningSteps = nextStep, due = now + minutes * 60_000L,
                scheduledDays = floor(minutes / 1440.0),
            )
            else -> {
                val interval = nextInterval(base.stability)
                base.copy(state = CardState.REVIEW, learningSteps = 0, scheduledDays = interval.toDouble(), due = now + interval * DAY_MS)
            }
        }
    }

    /** The card after answering with [rating] (1 Again … 4 Easy) at [now]. */
    fun next(card: Card, now: Long, rating: Int): Card {
        require(rating in 1..4) { "rating must be 1..4" }
        val elapsed = if (card.state != CardState.NEW && card.lastReview != null) dateDiffInDays(card.lastReview, now) else 0
        val current = card.copy(lastReview = now, reps = card.reps + 1)
        fun memory(g: Int, r: Double? = null): Card {
            val m = nextMemory(current.difficulty, current.stability, elapsed, g, r)
            return current.copy(difficulty = m.difficulty, stability = m.stability, updatedAt = now)
        }
        return when (card.state) {
            CardState.NEW -> applySteps(memory(rating), current, now, rating, CardState.LEARNING, elapsed)
            CardState.LEARNING, CardState.RELEARNING -> applySteps(memory(rating), current, now, rating, card.state, elapsed)
            else -> {
                val r = forgettingCurve(elapsed.toDouble(), current.stability)
                val hard = memory(2, r)
                val good = memory(3, r)
                val easy = memory(4, r)
                var hardI = nextInterval(hard.stability)
                var goodI = nextInterval(good.stability)
                hardI = min(hardI, goodI)
                goodI = max(goodI, hardI + 1)
                val easyI = max(nextInterval(easy.stability), goodI + 1)
                fun review(c: Card, i: Int) = c.copy(state = CardState.REVIEW, learningSteps = 0, scheduledDays = i.toDouble(), due = now + i * DAY_MS)
                when (rating) {
                    1 -> applySteps(memory(1, r), current, now, 1, CardState.RELEARNING, elapsed).let { it.copy(lapses = it.lapses + 1) }
                    2 -> review(hard, hardI)
                    3 -> review(good, goodI)
                    else -> review(easy, easyI)
                }
            }
        }
    }

    companion object {
        const val S_MIN = 1e-3
        const val S_MAX = 36_500.0
        const val DAY_MS = 86_400_000L
        val DEFAULT_W = doubleArrayOf(
            0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 1e-3, 1.8722, 0.1666, 0.796,
            1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
        )

        /** JavaScript Math.round: halves round up. */
        fun jsRound(x: Double) = floor(x + 0.5)
        fun roundTo(x: Double, decimals: Int): Double {
            val f = 10.0.pow(decimals)
            return jsRound(x * f) / f
        }
        private fun clamp(v: Double, lo: Double, hi: Double) = min(max(v, lo), hi)

        /** Calendar-day difference in UTC, as ts-fsrs computes elapsed days. */
        fun dateDiffInDays(lastMs: Long, nowMs: Long): Int {
            val a = Instant.ofEpochMilli(lastMs).atZone(ZoneOffset.UTC).toLocalDate().toEpochDay()
            val b = Instant.ofEpochMilli(nowMs).atZone(ZoneOffset.UTC).toLocalDate().toEpochDay()
            return (b - a).toInt()
        }

        /** Human interval ("10p", "3ng", "2.5th"), the same labels as the web app. */
        fun formatInterval(ms: Long): String {
            if (ms < 60_000) return "<1p"
            val m = jsRound(ms / 60_000.0).toLong()
            if (m < 60) return "${m}p"
            val h = jsRound(m / 60.0).toLong()
            if (h < 24) return "${h}g"
            val d = jsRound(h / 24.0).toLong()
            if (d < 30) return "${d}ng"
            val mo = d / 30.4375
            fun trim(x: Double) = (jsRound(x * 10) / 10).toString().removeSuffix(".0")
            if (mo < 12) return trim(mo) + "th"
            return trim(d / 365.25) + "năm"
        }
    }
}
