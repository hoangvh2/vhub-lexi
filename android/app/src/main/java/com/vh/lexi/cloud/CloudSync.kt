package com.vh.lexi.cloud

import android.util.Log
import com.google.firebase.firestore.DocumentChange
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.WriteBatch
import com.vh.lexi.core.Card
import com.vh.lexi.core.DailyDelta
import com.vh.lexi.core.ReviewLog
import com.vh.lexi.core.SyncStatus
import com.vh.lexi.data.Col
import com.vh.lexi.data.Doc
import com.vh.lexi.data.LexiData
import com.vh.lexi.data.SyncState
import com.vh.lexi.data.toDoc
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Two-way sync between Room (what every screen reads) and users/{uid}/... in Firestore (what the web app reads).
 *
 *  - Saved here: already in Room; this class writes it to Firestore (Firestore queues it while offline).
 *  - Changed elsewhere: the snapshot listener writes it to Room. Our own pending writes are skipped.
 *  - First time the server's list arrives: documents that exist only on this phone are uploaded; for a document
 *    on both sides the cloud copy wins.
 *
 * Writes are never awaited: offline they would not complete until the server acknowledges them.
 */
class CloudSync(
    private val db: FirebaseFirestore,
    private val data: LexiData,
    private val scope: CoroutineScope,
    private val onDenied: () -> Unit,
) {
    private val _state = MutableStateFlow(SyncState.OFF)
    val state: StateFlow<SyncState> = _state

    @Volatile
    private var uid: String? = null
    private val listeners = mutableListOf<ListenerRegistration>()
    private val applying = Mutex()
    private val merged = HashSet<String>()
    private val status = SyncStatus()

    private fun col(name: String) = db.collection("users").document(uid!!).collection(name)

    @Synchronized
    fun start(uid: String) {
        stop()
        this.uid = uid
        merged.clear()
        _state.value = status.start()
        data.cloud = this
        for ((name, limit) in LIMITS) {
            // INCLUDE: the server acknowledging a write, or confirming the cached list, changes only metadata.
            // Without it those snapshots never arrive: the pill stays "Đang đồng bộ…" and local-only docs never upload.
            listeners += col(name).limit(limit).addSnapshotListener(MetadataChanges.INCLUDE) { snap, err ->
                if (err != null) return@addSnapshotListener fail(err)
                if (snap == null) return@addSnapshotListener
                if (name == Col.CARDS) publish { status.onSnapshot(snap.metadata.hasPendingWrites(), snap.metadata.isFromCache, it) }
                val changes = snap.documentChanges.filter { !it.document.metadata.hasPendingWrites() }
                val upserts = changes.filter { it.type != DocumentChange.Type.REMOVED }.map { it.document.data }
                val removes = changes.filter { it.type == DocumentChange.Type.REMOVED }.map { it.document.id }
                val serverIds = snap.documents.map { it.id }.toSet()
                val authoritative = !snap.metadata.isFromCache
                scope.launch { applying.withLock { apply(name, upserts, removes, serverIds, authoritative) } }
            }
        }
        listeners += col(Col.SETTINGS).document(Col.PREFS_ID).addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener fail(err)
            if (snap == null || snap.metadata.hasPendingWrites() || !snap.exists()) return@addSnapshotListener
            val doc = snap.data ?: return@addSnapshotListener
            scope.launch { applying.withLock { data.applyRemote(Col.SETTINGS, listOf(doc), emptyList()) } }
        }
    }

    @Synchronized
    fun stop() {
        listeners.forEach { it.remove() }
        listeners.clear()
        uid = null
        if (data.cloud === this) data.cloud = null
        _state.value = status.stop()
    }

    private suspend fun apply(name: String, upserts: List<Doc>, removes: List<String>, serverIds: Set<String>, authoritative: Boolean) {
        if (uid == null) return
        data.applyRemote(name, upserts, removes)
        // Once the server has really answered, upload what only exists on this phone.
        if (authoritative && merged.add(name)) {
            val localOnly = data.localDocs(name).filterKeys { it !in serverIds }
            if (localOnly.isNotEmpty()) setAll(name, localOnly.values.toList())
        }
    }

    @Synchronized
    private fun publish(update: (now: Long) -> SyncState) {
        if (uid == null) return
        _state.value = update(System.currentTimeMillis())
    }

    private fun fail(e: Exception) {
        Log.w(TAG, "Firestore error", e)
        val denied = (e as? FirebaseFirestoreException)?.code == FirebaseFirestoreException.Code.PERMISSION_DENIED
        publish { status.onError(denied, it) }
        if (denied) onDenied()
        else scope.launch {
            delay(SyncStatus.ERROR_HOLD_MS + 100)
            publish(status::publish)
        }
    }

    // ---------------------------------------------------------------- writes (fire and forget)

    fun set(collection: String, id: String, doc: Doc) {
        if (uid == null) return
        col(collection).document(id).set(doc).addOnFailureListener(::fail)
    }

    fun setAll(collection: String, docs: List<Doc>) {
        if (uid == null) return
        for (chunk in docs.chunked(400)) {
            val b = db.batch()
            for (d in chunk) b.set(col(collection).document(d["id"] as? String ?: Col.PREFS_ID), d)
            b.commit().addOnFailureListener(::fail)
        }
    }

    fun delete(collection: String, ids: List<String>) {
        if (uid == null) return
        for (chunk in ids.chunked(400)) {
            val b = db.batch()
            for (id in chunk) b.delete(col(collection).document(id))
            b.commit().addOnFailureListener(::fail)
        }
    }

    private fun WriteBatch.daily(delta: DailyDelta, sign: Int, now: Long) {
        // Increments, not absolute values: two devices working the same day add up instead of overwriting.
        fun inc(n: Long) = FieldValue.increment(n)
        val ratingField = when (delta.rating) { 1 -> "again"; 2 -> "hard"; 3 -> "good"; else -> "easy" }
        set(
            col(Col.DAILY).document(delta.id),
            mapOf(
                "id" to delta.id, "newCards" to inc(sign * delta.newCards.toLong()), "reviews" to inc(sign * delta.reviews.toLong()),
                ratingField to inc(sign.toLong()), "ms" to inc(sign * delta.ms), "updatedAt" to now,
            ),
            SetOptions.merge(),
        )
    }

    fun commitReview(card: Card, log: ReviewLog, delta: DailyDelta) {
        if (uid == null) return
        val b = db.batch()
        b.set(col(Col.CARDS).document(card.id), card.toDoc())
        b.set(col(Col.REVIEWS).document(log.id), log.toDoc())
        b.daily(delta, 1, card.updatedAt)
        b.commit().addOnFailureListener(::fail)
    }

    fun undoReview(prev: Card, logId: String, delta: DailyDelta) {
        if (uid == null) return
        val b = db.batch()
        b.set(col(Col.CARDS).document(prev.id), prev.toDoc())
        b.delete(col(Col.REVIEWS).document(logId))
        b.daily(delta, -1, System.currentTimeMillis())
        b.commit().addOnFailureListener(::fail)
    }

    companion object {
        private const val TAG = "LexiSync"
        /** Same list caps the Firestore rules allow (firestore.rules.tmpl). */
        private val LIMITS = listOf(Col.DECKS to 200L, Col.NOTES to 5000L, Col.CARDS to 10000L, Col.DAILY to 800L)
    }
}
