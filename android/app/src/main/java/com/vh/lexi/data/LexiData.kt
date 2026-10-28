package com.vh.lexi.data

import androidx.room.withTransaction
import com.vh.lexi.cloud.CloudSync
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Daily
import com.vh.lexi.core.DailyDelta
import com.vh.lexi.core.Deck
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.Fsrs
import com.vh.lexi.core.Id
import com.vh.lexi.core.Note
import com.vh.lexi.core.Prefs
import com.vh.lexi.core.ReviewLog
import com.vh.lexi.core.apply
import com.vh.lexi.core.dayId
import com.vh.lexi.core.noteType
import com.vh.lexi.core.reviewId
import com.vh.lexi.core.wantedTemplates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class Reviewed(val prev: Card, val next: Card, val logId: Id, val delta: DailyDelta)

typealias SyncState = com.vh.lexi.core.SyncState

/**
 * The app's data: Room is what every screen reads; Firestore (when signed in) is kept in step by [CloudSync].
 * Writes go to Room first, then to the cloud (queued by Firestore while offline).
 */
class LexiData(private val db: LexiDb, private val scope: CoroutineScope) {
    private val dao = db.docs()

    /** Set while a signed-in account is syncing. */
    @Volatile
    var cloud: CloudSync? = null

    private fun <T> observe(col: String, decode: (Doc) -> T): StateFlow<List<T>?> =
        dao.observe(col).map { rows -> rows.map { decode(parseDoc(it.json)) } }.flowOn(Dispatchers.Default).stateIn(scope, SharingStarted.Eagerly, null)

    private val decksN = observe(Col.DECKS, ::deckFromDoc)
    private val notesN = observe(Col.NOTES, ::noteFromDoc)
    private val cardsN = observe(Col.CARDS, ::cardFromDoc)
    private val dailyN = observe(Col.DAILY, ::dailyFromDoc)

    val decks: StateFlow<List<Deck>> = decksN.map { it.orEmpty() }.stateIn(scope, SharingStarted.Eagerly, emptyList())
    val notes: StateFlow<List<Note>> = notesN.map { it.orEmpty() }.stateIn(scope, SharingStarted.Eagerly, emptyList())
    val cards: StateFlow<List<Card>> = cardsN.map { it.orEmpty() }.stateIn(scope, SharingStarted.Eagerly, emptyList())
    val daily: StateFlow<List<Daily>> = dailyN.map { it.orEmpty() }.stateIn(scope, SharingStarted.Eagerly, emptyList())
    val loaded: StateFlow<Boolean> =
        combine(decksN, notesN, cardsN) { a, b, c -> a != null && b != null && c != null }.stateIn(scope, SharingStarted.Eagerly, false)
    val prefs: StateFlow<Prefs> = dao.observe(Col.SETTINGS)
        .map { rows -> prefsFromDoc(rows.firstOrNull { it.id == Col.PREFS_ID }?.let { parseDoc(it.json) }) }
        .flowOn(Dispatchers.Default).stateIn(scope, SharingStarted.Eagerly, Prefs())

    private fun newId() = UUID.randomUUID().toString().replace("-", "").take(20)

    private suspend fun put(col: String, doc: Doc, id: String = doc["id"] as String) {
        dao.upsert(listOf(DocRow(col, id, doc.toJsonString())))
        cloud?.set(col, id, doc)
    }

    private suspend fun putAll(col: String, docs: List<Doc>) {
        if (docs.isEmpty()) return
        dao.upsert(docs.map { DocRow(col, it["id"] as String, it.toJsonString()) })
        cloud?.setAll(col, docs)
    }

    private suspend fun remove(col: String, ids: List<String>) {
        if (ids.isEmpty()) return
        ids.chunked(500).forEach { dao.delete(col, it) }
        cloud?.delete(col, ids)
    }

    // ---------------------------------------------------------------- decks

    suspend fun ensureDeck(): Id {
        val list = decks.value
        val want = prefs.value.defaultDeckId
        if (want != null && list.any { it.id == want }) return want
        list.firstOrNull()?.let { return it.id }
        return createDeck("Mặc định").id
    }

    suspend fun createDeck(name: String, now: Long = System.currentTimeMillis()): Deck {
        val d = Deck(newId(), name.trim().take(60).ifEmpty { "Mặc định" }, null, now, now)
        put(Col.DECKS, d.toDoc())
        return d
    }

    suspend fun renameDeck(d: Deck, name: String) {
        put(Col.DECKS, d.copy(name = name.trim().take(60).ifEmpty { d.name }, updatedAt = System.currentTimeMillis()).toDoc())
    }

    /** Deletes a deck with its notes and cards. Callers must have confirmed. */
    suspend fun deleteDeckAndContents(deckId: Id) {
        for (n in notes.value.filter { it.deckId == deckId }) removeNote(n)
        remove(Col.DECKS, listOf(deckId))
    }

    // ---------------------------------------------------------------- notes

    private fun cleanFields(type: String, fields: Map<String, FieldValue>): Map<String, FieldValue> {
        val def = noteType(type) ?: return emptyMap()
        val out = LinkedHashMap<String, FieldValue>()
        for (f in def.fields) {
            val v = fields[f.key]
            if (f.kind == "list") {
                val l = ((v as? FieldValue.Items)?.value ?: emptyList()).map { it.trim().take(f.maxLength) }.filter { it.isNotEmpty() }.take(8)
                if (l.isNotEmpty()) out[f.key] = FieldValue.Items(l)
            } else {
                val s = ((v as? FieldValue.Text)?.value ?: "").trim().take(f.maxLength)
                if (s.isNotEmpty()) out[f.key] = FieldValue.Text(s)
            }
        }
        return out
    }

    private fun missingCards(note: Note, existing: List<Card>, now: Long): List<Card> {
        val have = existing.filter { it.noteId == note.id }.map { it.template }.toSet()
        return wantedTemplates(note, prefs.value.templates).filter { it !in have }.map { newCard(note, it, now) }
    }

    private fun newCard(note: Note, template: String, now: Long) =
        Card(id = com.vh.lexi.core.cardId(note.id, template), noteId = note.id, deckId = note.deckId, template = template, due = now, createdAt = now, updatedAt = now)

    suspend fun addNote(type: String, fields: Map<String, FieldValue>, deckId: Id? = null, aiFields: List<String> = emptyList(), now: Long = System.currentTimeMillis()): Note {
        requireNotNull(noteType(type)) { "Unknown note type $type" }
        val note = Note(newId(), type, deckId ?: ensureDeck(), cleanFields(type, fields), aiFields, emptyList(), now, now)
        db.withTransaction { putNote(note, missingCards(note, emptyList(), now)) }
        return note
    }

    private suspend fun putNote(note: Note, newCards: List<Card>) {
        put(Col.NOTES, note.toDoc())
        putAll(Col.CARDS, newCards.map { it.toDoc() })
    }

    suspend fun updateNote(note: Note, fields: Map<String, FieldValue>? = null, deckId: Id? = null, aiFields: List<String>? = null, tags: List<String>? = null) {
        val now = System.currentTimeMillis()
        val next = note.copy(
            deckId = deckId ?: note.deckId,
            fields = fields?.let { cleanFields(note.type, it) } ?: note.fields,
            aiFields = aiFields ?: note.aiFields,
            tags = tags ?: note.tags,
            updatedAt = now,
        )
        val existing = cards.value.filter { it.noteId == note.id }
        val fresh = missingCards(next, existing, now)
        val wanted = wantedTemplates(next, prefs.value.templates).toSet()
        val stale = existing.filter { it.template !in wanted && it.state == CardState.NEW }.map { it.id }
        val moved = if (next.deckId != note.deckId) existing.map { it.copy(deckId = next.deckId, updatedAt = now) } else emptyList()
        db.withTransaction {
            putNote(next, fresh)
            putAll(Col.CARDS, moved.filter { it.id !in stale }.map { it.toDoc() })
            remove(Col.CARDS, stale)
        }
    }

    suspend fun removeNote(note: Note) {
        val ids = cards.value.filter { it.noteId == note.id }.map { it.id }
        db.withTransaction {
            remove(Col.NOTES, listOf(note.id))
            remove(Col.CARDS, ids)
        }
    }

    suspend fun setSuspended(card: Card, suspended: Boolean) {
        put(Col.CARDS, card.copy(suspended = suspended, updatedAt = System.currentTimeMillis()).toDoc())
    }

    /** Applies new preferences and creates/removes cards when the chosen templates changed. */
    suspend fun savePrefs(p: Prefs) {
        val now = System.currentTimeMillis()
        val saved = p.copy(updatedAt = now)
        put(Col.SETTINGS, saved.toDoc(), Col.PREFS_ID)
        val create = ArrayList<Card>()
        val drop = ArrayList<Id>()
        val all = cards.value
        for (n in notes.value) {
            val wanted = wantedTemplates(n, saved.templates).toSet()
            val have = all.filter { it.noteId == n.id }
            wanted.filter { t -> have.none { it.template == t } }.forEach { create += newCard(n, it, now) }
            have.filter { it.template !in wanted && it.state == CardState.NEW }.forEach { drop += it.id }
        }
        putAll(Col.CARDS, create.map { it.toDoc() })
        remove(Col.CARDS, drop)
    }

    // ---------------------------------------------------------------- reviewing

    suspend fun review(card: Card, rating: Int, durationMs: Long, now: Long = System.currentTimeMillis()): Reviewed {
        val p = prefs.value
        val next = Fsrs(p.desiredRetention).next(card, now, rating)
        val dur = durationMs.coerceIn(0, 10 * 60_000L)
        val log = ReviewLog(
            id = reviewId(card.id, now), cardId = card.id, noteId = card.noteId, deckId = card.deckId, rating = rating, state = card.state,
            stability = next.stability, difficulty = next.difficulty, scheduledDays = next.scheduledDays, reviewedAt = now, durationMs = dur,
        )
        val wasNew = card.state == CardState.NEW
        val delta = DailyDelta(dayId(now, p.dayStartHour), if (wasNew) 1 else 0, if (wasNew) 0 else 1, rating, dur)
        db.withTransaction {
            val day = (dao.get(Col.DAILY, delta.id)?.let { dailyFromDoc(parseDoc(it.json)) } ?: Daily(delta.id)).apply(delta, 1, now)
            dao.upsert(listOf(DocRow(Col.CARDS, next.id, next.toDoc().toJsonString()), DocRow(Col.REVIEWS, log.id, log.toDoc().toJsonString()), DocRow(Col.DAILY, day.id, day.toDoc().toJsonString())))
        }
        cloud?.commitReview(next, log, delta)
        return Reviewed(card, next, log.id, delta)
    }

    suspend fun undo(r: Reviewed) {
        val now = System.currentTimeMillis()
        db.withTransaction {
            val day = (dao.get(Col.DAILY, r.delta.id)?.let { dailyFromDoc(parseDoc(it.json)) } ?: Daily(r.delta.id)).apply(r.delta, -1, now)
            dao.upsert(listOf(DocRow(Col.CARDS, r.prev.id, r.prev.toDoc().toJsonString()), DocRow(Col.DAILY, day.id, day.toDoc().toJsonString())))
            dao.delete(Col.REVIEWS, listOf(r.logId))
        }
        cloud?.undoReview(r.prev, r.logId, r.delta)
    }

    // ---------------------------------------------------------------- sync support

    /** Changes that came from the server: written to Room only (no echo back). */
    suspend fun applyRemote(col: String, upserts: List<Doc>, removes: List<String>) {
        db.withTransaction {
            if (upserts.isNotEmpty()) dao.upsert(upserts.map { DocRow(col, (it["id"] as? String) ?: Col.PREFS_ID, it.toJsonString()) })
            removes.chunked(500).forEach { dao.delete(col, it) }
        }
    }

    suspend fun localDocs(col: String): Map<String, Doc> = dao.all(col).associate { it.id to parseDoc(it.json) }

    // ---------------------------------------------------------------- backup

    suspend fun exportJson(): String {
        suspend fun arr(col: String) = JSONArray(dao.all(col).map { JSONObject(it.json) })
        val prefsDoc = dao.get(Col.SETTINGS, Col.PREFS_ID)
        return JSONObject()
            .put("app", "vhub-lexi").put("version", 1).put("exportedAt", System.currentTimeMillis())
            .put("decks", arr(Col.DECKS)).put("notes", arr(Col.NOTES)).put("cards", arr(Col.CARDS))
            .put("reviews", arr(Col.REVIEWS)).put("daily", arr(Col.DAILY))
            .put("prefs", prefsDoc?.let { JSONObject(it.json) } ?: JSONObject.NULL)
            .toString()
    }

    /** Merges a backup written by the web or Android app. Returns (notes, cards) or null when the file is not a backup. */
    suspend fun importJson(text: String): Pair<Int, Int>? {
        val root = try { JSONObject(text) } catch (_: Exception) { return null }
        if (root.optString("app") != "vhub-lexi" || root.optInt("version") != 1) return null
        fun docs(k: String): List<Doc> = root.optJSONArray(k)?.let { a -> List(a.length()) { parseDoc(a.getJSONObject(it).toString()) } } ?: emptyList()
        db.withTransaction {
            putAll(Col.DECKS, docs("decks")); putAll(Col.NOTES, docs("notes")); putAll(Col.CARDS, docs("cards"))
            putAll(Col.REVIEWS, docs("reviews")); putAll(Col.DAILY, docs("daily"))
            root.optJSONObject("prefs")?.let { put(Col.SETTINGS, parseDoc(it.toString()), Col.PREFS_ID) }
        }
        return docs("notes").size to docs("cards").size
    }
}
