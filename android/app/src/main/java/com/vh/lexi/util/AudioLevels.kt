package com.vh.lexi.util

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import com.vh.lexi.core.AudioSplit
import java.io.File
import java.nio.ByteOrder

/**
 * A Listening file's loudness every 50 ms, for finding its answer pauses (web: decodeLevels in lib/audio.ts). The file is
 * decoded by the phone's own codecs and measured buffer by buffer at its own rate, channels averaged, so a 45-minute file
 * is never held in memory. Call off the main thread.
 */
object AudioLevels {
    class Levels(val levels: FloatArray, val durationMs: Long)

    fun read(file: File): Levels {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(file.path)
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: error("no audio track")
            ex.selectTrack(track)
            val format = ex.getTrackFormat(track)
            val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            try {
                codec.configure(format, null, null, 0)
                codec.start()
                return drain(ex, codec, format)
            } finally {
                runCatching { codec.stop() }
                codec.release()
            }
        } finally {
            ex.release()
        }
    }

    private fun drain(ex: MediaExtractor, codec: MediaCodec, input: MediaFormat): Levels {
        var rate = input.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = input.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var float = false
        var meter: AudioSplit.Meter? = null
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        while (true) {
            if (!inputDone) {
                val i = codec.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    val buf = codec.getInputBuffer(i)!!
                    val n = ex.readSampleData(buf, 0)
                    if (n < 0) {
                        codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                        ex.advance()
                    }
                }
            }
            val o = codec.dequeueOutputBuffer(info, 10_000)
            when {
                o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val f = codec.outputFormat
                    rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    float = f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                }
                o >= 0 -> {
                    val m = meter ?: AudioSplit.Meter(rate).also { meter = it }
                    val buf = codec.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder())
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val ch = maxOf(1, channels)
                    if (float) {
                        val fb = buf.asFloatBuffer()
                        while (fb.remaining() >= ch) { var s = 0f; repeat(ch) { s += fb.get() }; m.add(s / ch) }
                    } else {
                        val sb = buf.asShortBuffer()
                        while (sb.remaining() >= ch) { var s = 0f; repeat(ch) { s += sb.get() / 32768f }; m.add(s / ch) }
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        return Levels(m.finish(), Math.round(m.samples * 1000.0 / rate))
                    }
                }
            }
        }
    }
}
