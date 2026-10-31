package com.vh.lexi.data

import com.vh.lexi.core.Card
import com.vh.lexi.core.CardLayout
import com.vh.lexi.core.Daily
import com.vh.lexi.core.Deck
import com.vh.lexi.core.fsrsWeightsOrNull
import com.vh.lexi.core.FieldValue
import com.vh.lexi.core.Note
import com.vh.lexi.core.Prefs
import com.vh.lexi.core.ReviewLog
import org.json.JSONArray
import org.json.JSONObject

/**
 * Every record is stored (Room) and synced (Firestore) as the same plain document, field for field the
 * layout shared/model.ts and firestore.rules.tmpl define. Integers are Long, memory values Double.
 */
typealias Doc = Map<String, Any?>

object Col {
    const val DECKS = "decks"
    const val NOTES = "notes"
    const val CARDS = "cards"
    const val REVIEWS = "reviews"
    const val DAILY = "daily"
    const val SETTINGS = "settings"
    const val PREFS_ID = "prefs"
    val SYNCED = listOf(DECKS, NOTES, CARDS, DAILY)
}

private fun Doc.s(k: String) = this[k] as? String
private fun Doc.l(k: String) = (this[k] as? Number)?.toLong()
private fun Doc.d(k: String) = (this[k] as? Number)?.toDouble()
private fun Doc.b(k: String) = this[k] as? Boolean
private fun Doc.strings(k: String): List<String> = (this[k] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

fun Deck.toDoc(): Doc = buildMap {
    put("id", id); put("name", name)
    newPerDay?.let { put("newPerDay", it.toLong()) }
    put("createdAt", createdAt); put("updatedAt", updatedAt)
}

fun deckFromDoc(d: Doc) = Deck(
    id = d.s("id") ?: "", name = d.s("name") ?: "", newPerDay = d.l("newPerDay")?.toInt(),
    createdAt = d.l("createdAt") ?: 0, updatedAt = d.l("updatedAt") ?: 0,
)

fun Note.toDoc(): Doc = buildMap {
    put("id", id); put("type", type); put("deckId", deckId)
    put("fields", fields.mapValues { (_, v) -> if (v is FieldValue.Items) v.value else (v as FieldValue.Text).value })
    if (aiFields.isNotEmpty()) put("aiFields", aiFields)
    if (tags.isNotEmpty()) put("tags", tags)
    put("createdAt", createdAt); put("updatedAt", updatedAt)
}

fun noteFromDoc(d: Doc): Note {
    val raw = d["fields"] as? Map<*, *> ?: emptyMap<Any, Any>()
    val fields = raw.entries.mapNotNull { (k, v) ->
        val key = k as? String ?: return@mapNotNull null
        when (v) {
            is String -> key to FieldValue.Text(v)
            is List<*> -> key to FieldValue.Items(v.filterIsInstance<String>())
            else -> null
        }
    }.toMap()
    return Note(
        id = d.s("id") ?: "", type = d.s("type") ?: "vocab", deckId = d.s("deckId") ?: "", fields = fields,
        aiFields = d.strings("aiFields"), tags = d.strings("tags"), createdAt = d.l("createdAt") ?: 0, updatedAt = d.l("updatedAt") ?: 0,
    )
}

fun Card.toDoc(): Doc = buildMap {
    put("id", id); put("noteId", noteId); put("deckId", deckId); put("template", template)
    put("state", state.toLong()); put("due", due)
    put("stability", stability); put("difficulty", difficulty); put("scheduledDays", scheduledDays)
    put("learningSteps", learningSteps.toLong()); put("reps", reps.toLong()); put("lapses", lapses.toLong())
    lastReview?.let { put("lastReview", it) }
    if (suspended) put("suspended", true)
    put("createdAt", createdAt); put("updatedAt", updatedAt)
}

fun cardFromDoc(d: Doc) = Card(
    id = d.s("id") ?: "", noteId = d.s("noteId") ?: "", deckId = d.s("deckId") ?: "", template = d.s("template") ?: "",
    state = d.l("state")?.toInt() ?: 0, due = d.l("due") ?: 0, stability = d.d("stability") ?: 0.0, difficulty = d.d("difficulty") ?: 0.0,
    scheduledDays = d.d("scheduledDays") ?: 0.0, learningSteps = d.l("learningSteps")?.toInt() ?: 0, reps = d.l("reps")?.toInt() ?: 0,
    lapses = d.l("lapses")?.toInt() ?: 0, lastReview = d.l("lastReview"), suspended = d.b("suspended") ?: false,
    createdAt = d.l("createdAt") ?: 0, updatedAt = d.l("updatedAt") ?: 0,
)

fun ReviewLog.toDoc(): Doc = mapOf(
    "id" to id, "cardId" to cardId, "noteId" to noteId, "deckId" to deckId, "rating" to rating.toLong(), "state" to state.toLong(),
    "stability" to stability, "difficulty" to difficulty, "scheduledDays" to scheduledDays, "reviewedAt" to reviewedAt,
    "durationMs" to durationMs, "device" to device,
)

fun reviewFromDoc(d: Doc) = ReviewLog(
    id = d.s("id") ?: "", cardId = d.s("cardId") ?: "", noteId = d.s("noteId") ?: "", deckId = d.s("deckId") ?: "",
    rating = d.l("rating")?.toInt() ?: 3, state = d.l("state")?.toInt() ?: 0, stability = d.d("stability") ?: 0.0, difficulty = d.d("difficulty") ?: 0.0,
    scheduledDays = d.d("scheduledDays") ?: 0.0, reviewedAt = d.l("reviewedAt") ?: 0, durationMs = d.l("durationMs") ?: 0, device = d.s("device") ?: "android",
)

fun Daily.toDoc(): Doc = mapOf(
    "id" to id, "newCards" to newCards, "reviews" to reviews, "again" to again, "hard" to hard, "good" to good, "easy" to easy, "ms" to ms, "updatedAt" to updatedAt,
)

fun dailyFromDoc(d: Doc) = Daily(
    id = d.s("id") ?: "", newCards = d.l("newCards") ?: 0, reviews = d.l("reviews") ?: 0, again = d.l("again") ?: 0, hard = d.l("hard") ?: 0,
    good = d.l("good") ?: 0, easy = d.l("easy") ?: 0, ms = d.l("ms") ?: 0, updatedAt = d.l("updatedAt") ?: 0,
)

fun Prefs.toDoc(): Doc = buildMap {
    put("desiredRetention", desiredRetention); put("newPerDay", newPerDay.toLong()); put("maxReviewsPerDay", maxReviewsPerDay.toLong())
    put("templates", templates)
    put("layout", mapOf("showIpa" to layout.showIpa, "showPos" to layout.showPos, "showEn" to layout.showEn, "showVi" to layout.showVi, "showExamples" to layout.showExamples, "showMnemonic" to layout.showMnemonic))
    put("autoSpeak", autoSpeak); put("theme", theme); put("accent", accent); put("aiEnabled", aiEnabled); put("dayStartHour", dayStartHour.toLong())
    defaultDeckId?.let { put("defaultDeckId", it) }
    fsrsWeights?.let { put("fsrsWeights", it); put("fsrsOptimizedAt", fsrsOptimizedAt); put("fsrsOptimizedReviews", fsrsOptimizedReviews) }
    put("updatedAt", updatedAt)
}

/** Fills defaults and clamps, like normalizePrefs() in shared/model.ts. */
fun prefsFromDoc(d: Doc?): Prefs {
    val base = Prefs()
    if (d == null) return base
    val layout = d["layout"] as? Map<*, *>
    fun flag(k: String, def: Boolean) = layout?.get(k) as? Boolean ?: def
    val templates = (d["templates"] as? Map<*, *>)?.entries?.mapNotNull { (k, v) ->
        (k as? String)?.let { key -> key to ((v as? List<*>)?.filterIsInstance<String>() ?: return@mapNotNull null) }
    }?.toMap()
    val weights = fsrsWeightsOrNull(d["fsrsWeights"])
    return Prefs(
        desiredRetention = (d.d("desiredRetention") ?: base.desiredRetention).coerceIn(0.7, 0.99),
        newPerDay = (d.l("newPerDay")?.toInt() ?: base.newPerDay).coerceIn(0, 200),
        maxReviewsPerDay = (d.l("maxReviewsPerDay")?.toInt() ?: base.maxReviewsPerDay).coerceIn(0, 9999),
        templates = base.templates + (templates ?: emptyMap()),
        layout = CardLayout(
            flag("showIpa", true), flag("showPos", true), flag("showEn", true), flag("showVi", true), flag("showExamples", true), flag("showMnemonic", true),
        ),
        autoSpeak = d.s("autoSpeak")?.takeIf { it == "front" || it == "back" } ?: "off",
        theme = d.s("theme")?.takeIf { it == "light" || it == "dark" } ?: "system",
        accent = d.s("accent")?.takeIf { it in setOf("blue", "orange", "violet") } ?: "teal",
        aiEnabled = d.b("aiEnabled") ?: true,
        dayStartHour = (d.l("dayStartHour")?.toInt() ?: base.dayStartHour).coerceIn(0, 23),
        defaultDeckId = d.s("defaultDeckId"),
        fsrsWeights = weights,
        fsrsOptimizedAt = if (weights != null) d.l("fsrsOptimizedAt") ?: 0 else 0,
        fsrsOptimizedReviews = if (weights != null) d.l("fsrsOptimizedReviews") ?: 0 else 0,
        updatedAt = d.l("updatedAt") ?: 0,
    )
}

// ---- Doc <-> JSON text (Room stores the document as JSON)

fun Doc.toJsonString(): String = JSONObject(this).toString()

fun parseDoc(json: String): Doc = jsonObjectToDoc(JSONObject(json))

private fun jsonObjectToDoc(o: JSONObject): Doc = buildMap {
    for (k in o.keys()) put(k, fromJson(o.get(k)))
}

private fun fromJson(v: Any?): Any? = when (v) {
    null, JSONObject.NULL -> null
    is JSONObject -> jsonObjectToDoc(v)
    is JSONArray -> List(v.length()) { fromJson(v.get(it)) }
    is Int -> v.toLong()
    else -> v
}
