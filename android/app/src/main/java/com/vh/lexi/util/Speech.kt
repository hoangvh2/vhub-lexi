package com.vh.lexi.util

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Text-to-speech with the phone's own voices: free, and offline when the voice is installed. */
class Speech(context: Context) {
    private var ready = false
    private var tts: TextToSpeech? = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
            tts?.language = Locale.US
            ready = true
        }
    }

    fun speak(text: String) = say(text, 0.92f)

    /** Slower, for listening cards. */
    fun speakSlow(text: String) = say(text, 0.7f)

    private fun say(text: String, rate: Float) {
        if (!ready || text.isBlank()) return
        tts?.setSpeechRate(rate)
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lexi")
    }

    fun stop() {
        tts?.stop()
    }

    fun shutdown() {
        tts?.shutdown()
        tts = null
    }
}
