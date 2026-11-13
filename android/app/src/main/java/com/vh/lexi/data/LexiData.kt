package com.vh.lexi.data

import androidx.room.withTransaction
import com.vh.lexi.cloud.CloudSync
import com.vh.lexi.core.Card
import com.vh.lexi.core.CardState
import com.vh.lexi.core.Daily
import com.vh.lexi.core.DailyDelta
import com.vh.lexi.core.Deck
import com.vh.lexi.core.isFreeNew
import com.vh.lexi.core.liveRecognize
import com.vh.lexi.ui.eligibility
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.ForgotKind
import com.vh.lexi.core.forgotOf
import com.vh.lexi.core.withForgot
import com.vh.lexi.core.HintLog
import com.vh.lexi.core.Id
import com.vh.lexi.core.Note
import com.vh.lexi.core.MovePlan
import com.vh.lexi.core.Prefs
import com.vh.lexi.core.SEEDS_DOC
import com.vh.lexi.core.SeedPlan
import com.vh.lexi.core.ReviewLog
import com.vh.lexi.core.apply
import com.vh.lexi.core.dayId
import com.vh.lexi.core.hintLog
import com.vh.lexi.core.noteType
import com.vh.lexi.core.batches
import com.vh.lexi.core.planMove
import com.vh.lexi.core.reviewId
import com.vh.lexi.core.reviewIdRange
import com.vh.lexi.core.wantedTemplates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.util.TreeMap
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

    /**
     * One collection held in memory, in id order like the table, and updated by the writes themselves.
     *
     * It used to be a Room Flow per collection. Room invalidates by table and every collection lives in the one `docs`
     * table, so each write (a rating writes a card, a review log and the day's counters; the server's echo writes them
     * again) re-read and re-parsed every row of decks, notes and cards: ~2,000 JSON documents two or three times per
     * rating, which kept the phone busy for seconds after each answer (StudyLatencyTest). Now a write re-parses only
     * the rows it wrote.
     */
    private class Live<T>(private val decode: (Doc) -> T) {
        private val byId = TreeMap<String, T>()
        private var loaded = false
        /** Writes made before the first load finished, replayed on top of it (it may or may not contain them). */
        private val early = ArrayList<Pair<List<DocRow>, List<String>>>()
        val state = MutableStateFlow<List<T>?>(null)

        @Synchronized fun load(rows: List<DocRow>) {
            byId.clear()
            for (r in rows) byId[r.id] = decode(parseDoc(r.json))
            loaded = true
            for ((up, rm) in early) apply(up, rm)
            early.clear()
            state.value = ArrayList(byId.values)
        }

        @Synchronized fun changed(upserts: List<DocRow>, removes: List<String>) {
            if (upserts.isEmpty() && removes.isEmpty()) return
            if (!loaded) { early += upserts to removes; return }
            apply(upserts, removes)
            state.value = ArrayList(byId.values)
        }

        private fun apply(upserts: List<DocRow>, removes: List<String>) {
            for (r in upserts) byId[r.id] = decode(parseDoc(r.json))
            for (id in removes) byId.remove(id)
        }
    }

    private val live: Map<String, Live<*>> = mapOf(
        Col.DECKS to Live(::deckFromDoc), Col.NOTES to Live(::noteFromDoc), Col.CARDS to Live(::cardFromDoc), Col.DAILY to Live(::dailyFromDoc),
    )

    @Suppress("UNCHECKED_CAST")
    private fun <T> liveState(col: String) = (live.getValue(col) as Live<T>).state

    private val decksN: StateFlow<List<Deck>?> = liveState<Deck>(Col.DECKS)
    private val notesN: StateFlow<List<Note>?> = liveState<Note>(Col.NOTES)
    private val cardsN: StateFlow<List<Card>?> = liveState<Card>(Col.CARDS)
    private val dailyN: StateFlow<List<Daily>?> = liveState<Daily>(Col.DAILY)

    init {
        scope.launch(Dispatchers.Default) { for ((col, l) in live) l.load(dao.all(col)) }
    }

    /** Every write to Room goes through here, so the in-memory collections follow it (rows grouped by collection). */
    private suspend fun write(upserts: List<DocRow>, removes: List<Pair<String, List<String>>> = emptyList()) {
        if (upserts.isNotEmpty()) dao.upsert(upserts)
        for ((col, ids) in removes) ids.chunked(500).forEach { dao.delete(col, it) }
        val upBy = upserts.groupBy { it.col }
        val rmBy = removes.groupBy({ it.first }, { it.second }).mapValues { (_, v) -> v.flatten() }
        for (col in upBy.keys + rmBy.keys) live[col]?.changed(upBy[col].orEmpty(), rmBy[col].orEmpty())
    }

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
        write(listOf(DocRow(col, id, doc.toJsonString())))
        cloud?.set(col, id, doc)
    }

    private suspend fun putAll(col: String, docs: List<Doc>) {
        if (docs.isEmpty()) return
        write(docs.map { DocRow(col, it["id"] as String, it.toJsonString()) })
        cloud?.setAll(col, docs)
    }

    private suspend fun remove(col: String, ids: List<String>) {
        if (ids.isEmpty()) return
        write(emptyList(), listOf(col to ids))
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

    /** Saves each deck's share of the daily new words ([Deck.newWeight]); null removes it, which means an equal share. */
    suspend fun setDeckWeights(weights: Map<Id, Int?>) {
        val now = System.currentTimeMillis()
        for (d in decks.value) {
            if (!weights.containsKey(d.id)) continue
            val w = weights[d.id]?.coerceIn(0, 100)
            if (w != d.newWeight) put(Col.DECKS, d.copy(newWeight = w, updatedAt = now).toDoc())
        }
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

    suspend fun addNote(type: String, fields: Map<String, FieldValue>, deckId: Id? = null, aiFields: List<String> = emptyList(), now: Long = System.currentTimeMillis(), tags: List<String> = emptyList()): Note {
        requireNotNull(noteType(type)) { "Unknown note type $type" }
        val note = Note(newId(), type, deckId ?: ensureDeck(), cleanFields(type, fields), aiFields, tags, now, now)
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

    /**
     * Moves the chosen notes and their cards to [deckId]: Room in one transaction, Firestore in batches of at most
     * 500 writes with each note beside its cards, no reads. Returns how many notes moved (those already there are skipped).
     */
    suspend fun moveNotes(noteIds: Set<Id>, deckId: Id, now: Long = System.currentTimeMillis()): Int {
        val plan = planMove(notes.value, cards.value, noteIds, deckId, now)
        if (plan.notes.isEmpty()) return 0
        db.withTransaction {
            write(plan.notes.map { DocRow(Col.NOTES, it.id, it.toDoc().toJsonString()) } + plan.cards.map { DocRow(Col.CARDS, it.id, it.toDoc().toJsonString()) })
        }
        cloud?.setGroups(plan.batches().map { g -> g.notes.map { it.toDoc() } to g.cards.map { it.toDoc() } })
        return plan.notes.size
    }

    /**
     * Marks a word "hay quên" (meaning or sound) or clears the mark: one write of the note, nothing else. Cards, FSRS
     * state and the review log are not touched (core Drill.kt).
     */
    suspend fun setForgot(note: Note, kind: ForgotKind, on: Boolean) {
        val latest = notes.value.firstOrNull { it.id == note.id } ?: note
        if ((kind in forgotOf(latest)) == on) return
        put(Col.NOTES, withForgot(latest, kind, on, System.currentTimeMillis()).toDoc())
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

    suspend fun review(card: Card, rating: Int, durationMs: Long, now: Long = System.currentTimeMillis(), hint: Int = 0): Reviewed {
        val p = prefs.value
        val next = p.fsrs().next(card, now, rating)
        val dur = durationMs.coerceIn(0, 10 * 60_000L)
        val log = ReviewLog(
            id = reviewId(card.id, now), cardId = card.id, noteId = card.noteId, deckId = card.deckId, rating = rating, state = card.state,
            stability = next.stability, difficulty = next.difficulty, scheduledDays = next.scheduledDays, reviewedAt = now, durationMs = dur,
            hint = hint.coerceIn(0, 3),
        )
        // The daily quota counts words: a typing card of a recognised word is answered as a review, not a new word.
        val counted = card.state == CardState.NEW && !isFreeNew(card, liveRecognize(cards.value, eligibility(notes.value.associateBy { it.id })))
        val delta = DailyDelta(dayId(now, p.dayStartHour), if (counted) 1 else 0, if (counted) 0 else 1, rating, dur, if (counted) card.deckId else null)
        db.withTransaction {
            val day = (dao.get(Col.DAILY, delta.id)?.let { dailyFromDoc(parseDoc(it.json)) } ?: Daily(delta.id)).apply(delta, 1, now)
            write(listOf(DocRow(Col.CARDS, next.id, next.toDoc().toJsonString()), DocRow(Col.REVIEWS, log.id, log.toDoc().toJsonString()), DocRow(Col.DAILY, day.id, day.toDoc().toJsonString())))
        }
        cloud?.commitReview(next, log, delta)
        return Reviewed(card, next, log.id, delta)
    }

    /**
     * Past answers of one note, for the "leans on hints" check: a primary-key range read ([reviewIdRange]). Reading the
     * whole reviews table instead (~20,000 rows with an Anki history) ran on every new study card.
     */
    suspend fun hintLogsOfNote(noteId: Id): List<HintLog> =
        reviewIdRange(noteId).let { (from, to) -> dao.range(Col.REVIEWS, from, to) }.map { reviewFromDoc(parseDoc(it.json)) }
            .filter { it.noteId == noteId }.map { it.hintLog() }

    suspend fun undo(r: Reviewed) {
        val now = System.currentTimeMillis()
        db.withTransaction {
            val day = (dao.get(Col.DAILY, r.delta.id)?.let { dailyFromDoc(parseDoc(it.json)) } ?: Daily(r.delta.id)).apply(r.delta, -1, now)
            write(listOf(DocRow(Col.CARDS, r.prev.id, r.prev.toDoc().toJsonString()), DocRow(Col.DAILY, day.id, day.toDoc().toJsonString())), listOf(Col.REVIEWS to listOf(r.logId)))
        }
        cloud?.undoReview(r.prev, r.logId, r.delta)
    }

    // ---------------------------------------------------------------- built-in packs (shared/seed.ts)

    /**
     * Writes a planned pack load: the deck if missing, then each note with the cards the learner's templates want,
     * skipping every note and card id in [skipNotes] / [skipCards] (what the server already has) and anything already
     * on this phone. Room in one transaction, Firestore in atomic batches of a note and its cards. Returns notes written.
     */
    suspend fun writeSeed(plan: SeedPlan, skipNotes: Set<Id>, skipCards: Set<Id>): Int {
        val haveNotes = notes.value.map { it.id }.toSet()
        val haveCards = cards.value.map { it.id }.toSet()
        val fresh = plan.notes.filter { it.id !in skipNotes && it.id !in haveNotes }
        val newCards = fresh.flatMap { n ->
            wantedTemplates(n, prefs.value.templates).map { newCard(n, it, n.createdAt) }.filter { it.id !in skipCards && it.id !in haveCards }
        }
        val deck = plan.deck?.takeIf { d -> decks.value.none { it.id == d.id } }
        if (fresh.isEmpty() && deck == null) return 0
        db.withTransaction {
            write(
                listOfNotNull(deck?.let { DocRow(Col.DECKS, it.id, it.toDoc().toJsonString()) }) +
                    fresh.map { DocRow(Col.NOTES, it.id, it.toDoc().toJsonString()) } + newCards.map { DocRow(Col.CARDS, it.id, it.toDoc().toJsonString()) },
            )
        }
        deck?.let { cloud?.set(Col.DECKS, it.id, it.toDoc()) }
        cloud?.setGroups(MovePlan(fresh, newCards).batches().map { g -> g.notes.map { it.toDoc() } to g.cards.map { it.toDoc() } })
        return fresh.size
    }

    /** Version of a pack loaded on this phone when there is no account (Room row settings/seeds). */
    suspend fun localSeedVersion(packId: String): Int =
        dao.all(Col.SETTINGS).firstOrNull { it.id == SEEDS_DOC }?.let { (parseDoc(it.json)[packId] as? Number)?.toInt() } ?: 0

    suspend fun markLocalSeed(packId: String, version: Int) {
        val row = dao.all(Col.SETTINGS).firstOrNull { it.id == SEEDS_DOC }?.let { parseDoc(it.json) } ?: emptyMap()
        write(listOf(DocRow(Col.SETTINGS, SEEDS_DOC, (row + (packId to version.toLong())).toJsonString())))
    }

    // ---------------------------------------------------------------- sync support

    /** Changes that came from the server: written to Room only (no echo back). */
    suspend fun applyRemote(col: String, upserts: List<Doc>, removes: List<String>) {
        db.withTransaction {
            write(upserts.map { DocRow(col, (it["id"] as? String) ?: Col.PREFS_ID, it.toJsonString()) }, if (removes.isEmpty()) emptyList() else listOf(col to removes))
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
