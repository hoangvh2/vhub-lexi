package com.vh.lexi.ui

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.vh.lexi.core.SetTrack
import java.io.File

/**
 * The audio of a Listening Bộ đề (web: usePlayer in TestSets.tsx): one MediaPlayer for the set. [play] with `chain` plays
 * the next file when one ends (a test whose Part is split over files); [playRange] plays one stretch and stops, a question
 * heard again. State is Compose state, refreshed by [tick] while the screen shows it. Main thread only.
 */
class ListenPlayer(private val tracks: List<SetTrack>, private val fileOf: (String) -> File, private val onError: (String) -> Unit) {
    var track by mutableStateOf<Int?>(null)
        private set
    var playing by mutableStateOf(false)
        private set
    var atMs by mutableIntStateOf(0)
        private set
    var durationMs by mutableIntStateOf(0)
        private set

    private var mp: MediaPlayer? = null
    private var loaded: Int? = null
    private var chain = false
    private var stopAt: Int? = null

    private fun load(i: Int): MediaPlayer? {
        if (loaded == i) return mp
        mp?.release()
        mp = null
        loaded = null
        val f = fileOf(tracks[i].key)
        if (!f.exists()) {
            onError("Không thấy file nghe “${tracks[i].name}” trên máy này")
            return null
        }
        return try {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setDataSource(f.path)
                prepare()
                setOnCompletionListener {
                    playing = false
                    atMs = durationMs
                    if (chain && i + 1 < tracks.size) play(i + 1, chain = true)
                }
            }.also {
                mp = it
                loaded = i
                atMs = 0
                durationMs = it.duration.coerceAtLeast(0)
            }
        } catch (_: Exception) {
            onError("Không phát được “${tracks[i].name}”")
            null
        }
    }

    fun play(i: Int, chain: Boolean = false) = start(i, chain, null, null)

    /** Plays [fromMs]..[toMs] of track [i], then pauses. */
    fun playRange(i: Int, fromMs: Long, toMs: Long) = start(i, false, fromMs.toInt(), toMs.toInt())

    private fun start(i: Int, keepGoing: Boolean, from: Int?, to: Int?) {
        if (i !in tracks.indices) return
        val p = load(i) ?: return
        chain = keepGoing
        stopAt = to
        if (from != null) p.seekTo(from) else if (atMs >= durationMs && durationMs > 0 && !p.isPlaying) p.seekTo(0)
        track = i
        p.start()
        playing = true
    }

    fun toggle() {
        val p = mp
        when {
            track == null || p == null -> play(0, chain = true)
            p.isPlaying -> pause()
            else -> { p.start(); playing = true }
        }
    }

    fun pause() {
        mp?.takeIf { it.isPlaying }?.pause()
        playing = false
    }

    /** Called about 4 times a second: the position shown, and the end of a stretch being heard again. */
    fun tick() {
        val p = mp ?: return
        atMs = runCatching { p.currentPosition }.getOrDefault(atMs)
        val end = stopAt
        if (end != null && atMs >= end && p.isPlaying) {
            stopAt = null
            pause()
        }
        if (playing && !p.isPlaying) playing = false
    }

    fun release() {
        mp?.release()
        mp = null
        loaded = null
        playing = false
    }
}
