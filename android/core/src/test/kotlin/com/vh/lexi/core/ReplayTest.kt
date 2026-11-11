package com.vh.lexi.core

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Hearing a question again: the streaming meter the app decodes into, and the stretch each question replays. */
class ReplayTest {
    @Test
    fun meterFedInPiecesMatchesFrameLevels() {
        val r = Random(7)
        for (rate in listOf(8000, 22050, 44100, 48000)) {
            // Speech-like bursts and silence, a length that does not end on a frame.
            val samples = FloatArray(rate * 3 + 123) { i -> if ((i / (rate / 2)) % 2 == 0) (r.nextFloat() - 0.5f) * 0.6f else 0f }
            val m = AudioSplit.Meter(rate)
            var i = 0
            while (i < samples.size) {
                val n = minOf(samples.size - i, r.nextInt(1, 5000))
                for (k in i until i + n) m.add(samples[k])
                i += n
            }
            assertContentEquals(AudioSplit.frameLevels(samples, rate), m.finish(), "rate $rate")
            assertEquals(samples.size.toLong(), m.samples)
        }
        assertContentEquals(FloatArray(0), AudioSplit.Meter(8000).finish())
    }

    private fun sq(i: Int, number: Int?, part: Int?, clip: Clip?) = SetQuestion(
        i = i, number = number, part = part, kind = "listen", stem = "", options = emptyMap(), correct = "A", passage = null,
        topic = "", rule = "", translation = "", flags = emptyList(), clip = clip,
    )

    @Test
    fun partThreeReplaysFromItsConversation() {
        val all = listOf(
            sq(0, 7, 2, Clip(0, 1000, 5000)),
            sq(1, 32, 3, Clip(0, 10_000, 40_000)),
            sq(2, 33, 3, Clip(0, 48_000, 52_000)),
            sq(3, 34, 3, Clip(0, 60_000, 64_000)),
            sq(4, 35, 3, Clip(0, 72_000, 100_000)),
            sq(5, 36, 3, Clip(1, 5_000, 9_000)), // its group head (35) is in another file: its own clip
            sq(6, 8, 2, null),
        )
        assertEquals(Clip(0, 1000, 5000), replayOf(all, all[0]))
        assertEquals(Clip(0, 10_000, 40_000), replayOf(all, all[1]))
        assertEquals(Clip(0, 10_000, 52_000), replayOf(all, all[2]))
        assertEquals(Clip(0, 10_000, 64_000), replayOf(all, all[3]))
        assertEquals(Clip(0, 72_000, 100_000), replayOf(all, all[4]))
        assertEquals(Clip(1, 5_000, 9_000), replayOf(all, all[5]))
        assertNull(replayOf(all, all[6]))
    }

    @Test
    fun nudgeStaysInsideTheClip() {
        assertEquals(Clip(0, 3000, 9000), nudged(Clip(0, 5000, 9000), -2000))
        assertEquals(Clip(0, 0, 9000), nudged(Clip(0, 1000, 9000), -2000))
        assertEquals(Clip(0, 7000, 9000), nudged(Clip(0, 5000, 9000), 2000))
        assertEquals(Clip(0, 8500, 9000), nudged(Clip(0, 8000, 9000), 2000))
    }
}
