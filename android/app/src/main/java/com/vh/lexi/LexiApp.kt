package com.vh.lexi

import android.app.Application
import com.vh.lexi.cloud.Cloud
import com.vh.lexi.core.Dictionary
import com.vh.lexi.core.ShardSource
import com.vh.lexi.data.LexiData
import com.vh.lexi.data.LexiDb
import com.vh.lexi.util.Speech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

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
