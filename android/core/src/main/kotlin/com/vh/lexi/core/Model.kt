package com.vh.lexi.core

import java.time.Instant
import java.time.ZoneId

/**
 * Data model shared with the web app (shared/model.ts). Every record is stored and synced as a plain
 * document (Map<String, Any?>) so Room, Firestore and the web app see exactly the same fields.
 * Times are epoch milliseconds; integers are Long, memory values are Double.
 */
typealias Id = String

object CardState {
    const val NEW = 0
    const val LEARNING = 1
    const val REVIEW = 2
    const val RELEARNING = 3
}

/** A note field is either text or a list of texts (examples). */
sealed interface FieldValue {
    data class Text(val value: String) : FieldValue
    data class Items(val value: List<String>) : FieldValue
}

fun FieldValue?.str(): String = (this as? FieldValue.Text)?.value?.trim() ?: ""
fun FieldValue?.items(): List<String> = (this as? FieldValue.Items)?.value?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList()

data class Deck(val id: Id, val name: String, val newPerDay: Int? = null, val createdAt: Long, val updatedAt: Long)

data class Note(
    val id: Id,
    val type: String,
    val deckId: Id,
    val fields: Map<String, FieldValue>,
    val aiFields: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val createdAt: Long,
    val updatedAt: Long,
)

data class Card(
    val id: Id, // "${noteId}.${template}"
    val noteId: Id,
    val deckId: Id,
    val template: String,
    val state: Int = CardState.NEW,
    val due: Long,
    val stability: Double = 0.0,
    val difficulty: Double = 0.0,
    val scheduledDays: Double = 0.0,
    val learningSteps: Int = 0,
    val reps: Int = 0,
    val lapses: Int = 0,
    val lastReview: Long? = null,
    val suspended: Boolean = false,
    val createdAt: Long,
    val updatedAt: Long,
)

data class ReviewLog(
    val id: Id, // "${cardId}@${reviewedAt}"
    val cardId: Id,
    val noteId: Id,
    val deckId: Id,
    val rating: Int,
    val state: Int,
    val stability: Double,
    val difficulty: Double,
    val scheduledDays: Double,
    val reviewedAt: Long,
    val durationMs: Long,
    val device: String = "android",
)

/** Counters for one study day (id = yyyy-MM-dd). On the server they are updated with atomic increments. */
data class Daily(
    val id: String,
    val newCards: Long = 0,
    val reviews: Long = 0,
    val again: Long = 0,
    val hard: Long = 0,
    val good: Long = 0,
    val easy: Long = 0,
    val ms: Long = 0,
    val updatedAt: Long = 0,
)

/** What one answer adds to a [Daily]. */
data class DailyDelta(val id: String, val newCards: Int, val reviews: Int, val rating: Int, val ms: Long)

fun Daily.apply(d: DailyDelta, sign: Int, now: Long): Daily {
    fun add(v: Long, n: Long) = maxOf(0L, v + sign * n)
    return copy(
        newCards = add(newCards, d.newCards.toLong()),
        reviews = add(reviews, d.reviews.toLong()),
        again = if (d.rating == 1) add(again, 1) else again,
        hard = if (d.rating == 2) add(hard, 1) else hard,
        good = if (d.rating == 3) add(good, 1) else good,
        easy = if (d.rating == 4) add(easy, 1) else easy,
        ms = add(ms, d.ms),
        updatedAt = now,
    )
}

data class CardLayout(
    val showIpa: Boolean = true,
    val showPos: Boolean = true,
    val showEn: Boolean = true,
    val showVi: Boolean = true,
    val showExamples: Boolean = true,
    val showMnemonic: Boolean = true,
)

data class Prefs(
    val desiredRetention: Double = 0.9,
    val newPerDay: Int = 15,
    val maxReviewsPerDay: Int = 200,
    val templates: Map<String, List<String>> = mapOf("vocab" to listOf("recognize", "cloze")),
    val layout: CardLayout = CardLayout(),
    val autoSpeak: String = "off", // off | front | back
    val theme: String = "system", // system | light | dark
    val accent: String = "teal",
    val aiEnabled: Boolean = true,
    val dayStartHour: Int = 4,
    val defaultDeckId: Id? = null,
    /** FSRS-6 parameters fitted on the web (Settings → optimize), 21 numbers already clipped; null = defaults. */
    val fsrsWeights: List<Double>? = null,
    val fsrsOptimizedAt: Long = 0,
    val fsrsOptimizedReviews: Long = 0,
    val updatedAt: Long = 0,
) {
    /** The scheduler for these settings. */
    fun fsrs(): Fsrs = Fsrs(desiredRetention, fsrsWeights?.toDoubleArray() ?: Fsrs.DEFAULT_W)
}

/** Length of an FSRS-6 parameter vector. */
const val FSRS_PARAMS = 21

/** Prefs.fsrsWeights as stored: exactly 21 finite numbers, or null (normalizePrefs in shared/model.ts). */
fun fsrsWeightsOrNull(raw: Any?): List<Double>? =
    (raw as? List<*>)?.map { (it as? Number)?.toDouble() }
        ?.takeIf { w -> w.size == FSRS_PARAMS && w.all { it != null && it.isFinite() } }?.map { it!! }

fun cardId(noteId: Id, template: String) = "$noteId.$template"
fun reviewId(cardId: Id, at: Long) = "$cardId@$at"

/** Study-day id (yyyy-MM-dd) with the day starting at [dayStartHour] local time. */
fun dayId(ms: Long, dayStartHour: Int = 4, zone: ZoneId = ZoneId.systemDefault()): String =
    Instant.ofEpochMilli(ms - dayStartHour * 3_600_000L).atZone(zone).toLocalDate().toString()

/** Epoch ms of the next study-day boundary after [ms]. */
fun nextDayStart(ms: Long, dayStartHour: Int = 4, zone: ZoneId = ZoneId.systemDefault()): Long =
    Instant.ofEpochMilli(ms - dayStartHour * 3_600_000L).atZone(zone).toLocalDate().plusDays(1)
        .atTime(dayStartHour, 0).atZone(zone).toInstant().toEpochMilli()
