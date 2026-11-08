package com.vh.lexi.data

import android.content.Context
import android.util.Log
import com.vh.lexi.cloud.CloudSync
import com.vh.lexi.core.SeedPack
import com.vh.lexi.core.SeedState
import com.vh.lexi.core.planSeed
import com.vh.lexi.core.seedPackFromJson
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Loads the built-in grammar pack (asset grammar-toeic.json, from shared/seed) into the learner's data. See shared/seed.ts
 * for the safety rules: add-only, fixed ids, never a document the server already has, version recorded in settings/seeds.
 */
class Seeds(private val context: Context, private val data: LexiData) {
    val pack: SeedPack? by lazy {
        try {
            seedPackFromJson(context.assets.open(ASSET).bufferedReader().use { it.readText() })
        } catch (e: Exception) {
            Log.w(TAG, "grammar pack missing from this build", e)
            null
        }
    }

    private val running = Mutex()

    /**
     * Adds what is missing of the pack. [sync] = the running cloud sync (signed in) or null (this phone only).
     * [restore] ignores the recorded version, so notes the learner deleted come back; nothing else is touched either way.
     * Returns how many notes were added, or null when the server could not be asked (nothing was written).
     */
    suspend fun load(sync: CloudSync?, restore: Boolean = false): Int? = running.withLock {
        val pack = pack ?: return 0
        if (sync != null) {
            val server = sync.seedState(pack, ignoreMarker = restore) ?: return null
            val plan = planSeed(pack, server.state) ?: return 0
            val added = data.writeSeed(plan, server.state.noteIds, server.cardIds)
            sync.markSeed(pack.id, plan.version)
            added
        } else {
            val applied = if (restore) 0 else data.localSeedVersion(pack.id)
            val plan = planSeed(pack, SeedState(applied, emptySet(), false)) ?: return 0
            val added = data.writeSeed(plan, emptySet(), emptySet())
            data.markLocalSeed(pack.id, plan.version)
            added
        }
    }

    companion object {
        private const val TAG = "LexiSeeds"
        const val ASSET = "grammar-toeic.json"
    }
}
