package com.vh.lexi.util

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Text-to-speech with the phone's own voices: free, and offline when the voice is installed.
 * Open so instrumented tests can record what is spoken (LexiApp.speech is replaceable).
 */
open class Speech(context: Context) {
    private var ready = false
    private var tts: TextToSpeech? = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            ready = true
        }
    }

    open fun speak(text: String) = say(text, 0.92f)

    /** Slower, for listening cards. */
    open fun speakSlow(text: String) = say(text, 0.7f)

    private fun say(text: String, rate: Float) {
        if (!ready || text.isBlank()) return
        tts?.setSpeechRate(rate)
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lexi")
    }

    open fun stop() {
        tts?.stop()
    }

    fun shutdown() {
        tts?.shutdown()
        tts = null
    }
}
