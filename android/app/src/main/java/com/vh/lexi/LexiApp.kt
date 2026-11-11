package com.vh.lexi

import android.app.Application
import android.net.Uri
import com.vh.lexi.cloud.Cloud
import com.vh.lexi.core.AiBatch
import com.vh.lexi.core.Enriched
import com.vh.lexi.core.Extracted
import com.vh.lexi.core.Dictionary
import com.vh.lexi.core.ShardSource
import com.vh.lexi.data.LexiData
import com.vh.lexi.data.LexiDb
import com.vh.lexi.data.TestSetStore
import com.vh.lexi.util.Speech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow

class LexiApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    lateinit var data: LexiData
        private set
    lateinit var cloud: Cloud
        private set
    lateinit var dictionary: Dictionary
        private set
    lateinit var speech: Speech
        private set

    /** AI fill for a list of words. Lives here, not in a screen, so it keeps running while the learner switches tabs. */
    val aiBatch: AiBatch by lazy {
        AiBatch(
            call = { r ->
                if (r.only == "phrases") Enriched(vi = "", phrases = cloud.enrichPhrases(r.word, r.pos, r.en, r.vi))
                else cloud.enrich(r.word, r.pos, r.en, r.examples)
            },
            getNote = { id -> data.notes.value.firstOrNull { it.id == id } },
            save = { n, fields, ai -> data.updateNote(n, fields = fields, aiFields = ai.toList()) },
        )
    }

    /** Images shared into Lexi from another app (the share sheet): the import screen takes them and empties this. */
    val pendingShare = MutableStateFlow<List<Uri>>(emptyList())

    /** Bộ đề: whole tests imported from PDF, kept on this phone only (never synced). */
    val testSets: TestSetStore by lazy { TestSetStore(filesDir) }

    /** A PDF handed to the Bộ đề screen from outside it (a test, or later the share sheet); the screen takes it and empties this. */
    val pendingPdf = MutableStateFlow<Uri?>(null)

    /** Tests replace the `extract-questions` function with a canned answer (there is no Gemini on the CI emulator). */
    @Volatile var extractOverride: (suspend (images: List<String>, text: String) -> Extracted)? = null

    /** False when the APK was built without the dictionary pack (node tools/dict/build.ts --copy-android). */
    var hasDictionary: Boolean = false
        private set

    override fun onCreate() {
        super.onCreate()
        data = LexiData(LexiDb.open(this), scope)
        cloud = Cloud(this, data, scope)
        speech = Speech(this)
        hasDictionary = try { assets.open("dict/meta.json").close(); true } catch (_: Exception) { false }
        dictionary = Dictionary(ShardSource { key ->
            try {
                assets.open("dict/$key.json").bufferedReader().use { it.readText() }
            } catch (_: Exception) {
                null
            }
        })
    }
}
