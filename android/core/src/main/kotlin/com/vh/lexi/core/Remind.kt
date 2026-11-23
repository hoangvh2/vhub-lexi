package com.vh.lexi.core

import kotlin.math.floor

/**
 * Reminders for "Từ hay quên": a notification now and then that shows one marked word, until "Đã nhớ" clears the mark.
 * Port of shared/remind.ts (vectors: shared/vectors/remind.json). The schedule is kept on the device only; the only
 * synced write is clearing the mark on the note.
 */
data class RemindSettings(val on: Boolean = false, val perDay: Int = 3, val start: Int = 8 * 60, val end: Int = 21 * 60 + 30)

val REMIND_DEFAULT = RemindSettings()
const val REMIND_MAX_PER_DAY = 6
const val REMIND_GRACE = 2 * 3_600_000L
const val REMIND_SUGGEST = 5
const val REMIND_MAX_LEVEL = 4

private const val R_MIN = 60_000L
private const val R_DAY = 86_400_000L
private const val R_SLACK = 2 * 3_600_000L

data class RemindWord(val level: Int, val next: Long)

data class RemindState(val words: Map<String, RemindWord> = emptyMap(), val lastSlot: Long = 0)

/** Settings with every value in range; a window shorter than 30 minutes falls back to the default window. */
fun cleanSettings(on: Any?, perDay: Any?, start: Any?, end: Any?): RemindSettings {
    fun int(v: Any?, d: Int): Int = (v as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { Math.round(it).toInt() } ?: d
    val p = int(perDay, REMIND_DEFAULT.perDay).coerceIn(1, REMIND_MAX_PER_DAY)
    var s = int(start, REMIND_DEFAULT.start).coerceIn(0, 1439)
    var e = int(end, REMIND_DEFAULT.end).coerceIn(0, 1440)
    if (e - s < 30) { s = REMIND_DEFAULT.start; e = REMIND_DEFAULT.end }
    return RemindSettings(on == true, p, s, e)
}

fun cleanSettings(s: RemindSettings): RemindSettings = cleanSettings(s.on, s.perDay, s.start, s.end)

/** The slot times of a day, in minutes after midnight, spread evenly over the window. */
fun slotMinutes(s: RemindSettings): List<Int> {
    val c = cleanSettings(s)
    return List(c.perDay) { i -> c.start + floor((c.end - c.start).toDouble() * (2 * i + 1) / (2 * c.perDay)).toInt() }
}

private fun slotAt(now: Long, tz: Int, dayOffset: Int, minute: Int): Long {
    val localDay = Math.floorDiv(now + tz * R_MIN, R_DAY)
    return (localDay + dayOffset) * R_DAY + minute * R_MIN - tz * R_MIN
}

/** The first slot strictly after [now], or null when reminders are off. [tz] = minutes east of UTC. */
fun nextSlot(now: Long, s: RemindSettings, tz: Int): Long? {
    if (!s.on) return null
    val mins = slotMinutes(s)
    for (d in 0..1) for (m in mins) { val t = slotAt(now, tz, d, m); if (t > now) return t }
    return null
}

/** The latest slot at or before [now], if newer than [lastSlot] and at most [REMIND_GRACE] old. */
fun dueSlot(now: Long, s: RemindSettings, tz: Int, lastSlot: Long): Long? {
    if (!s.on) return null
    val mins = slotMinutes(s)
    for (d in 0 downTo -1) for (i in mins.indices.reversed()) {
        val t = slotAt(now, tz, d, mins[i])
        if (t > now) continue
        return if (t > lastSlot && now - t <= REMIND_GRACE) t else null
    }
    return null
}

/** The state without words that are no longer marked. */
fun pruneState(st: RemindState, notes: List<Note>): RemindState {
    val marked = forgotNotes(notes).map { it.id }.toSet()
    return RemindState(st.words.filterKeys { it in marked }.toSortedMap(), st.lastSlot)
}

/** The word to show at [now] (waiting longest, both kinds first, then most recently marked), or null. */
fun pickWord(notes: List<Note>, st: RemindState, now: Long): Note? {
    fun since(n: Note) = st.words[n.id]?.next ?: n.forgotAt ?: 0L
    return forgotNotes(notes).filter { (st.words[it.id]?.next ?: 0L) <= now }
        .sortedWith(compareBy<Note> { since(it) }.thenByDescending { forgotOf(it).size }.thenByDescending { it.forgotAt ?: 0L }.thenBy { it.id })
        .firstOrNull()
}

fun afterShown(st: RemindState, id: String, now: Long, slot: Long): RemindState {
    val level = st.words[id]?.level ?: 0
    val gap = (1L shl minOf(level, REMIND_MAX_LEVEL)) * R_DAY - R_SLACK
    return RemindState(st.words + (id to RemindWord(level + 1, now + gap)), maxOf(st.lastSlot, slot))
}

fun slotHandled(st: RemindState, slot: Long): RemindState = st.copy(lastSlot = maxOf(st.lastSlot, slot))

fun afterNotYet(st: RemindState, id: String, now: Long): RemindState =
    st.copy(words = st.words + (id to RemindWord(0, now + R_DAY - R_SLACK)))

fun suggestDone(st: RemindState, id: String): Boolean = (st.words[id]?.level ?: 0) >= REMIND_SUGGEST

data class RemindMessage(val title: String, val prompt: String, val answer: String)

private val REMIND_PROMPT = mapOf(
    "meaning" to "Bạn còn nhớ nghĩa của từ này?",
    "sound" to "Bạn còn nhớ cách đọc từ này?",
    "meaning,sound" to "Nghĩa và cách đọc của từ này là gì?",
)

fun remindMessage(n: Note, st: RemindState): RemindMessage {
    val word = n.fields["word"].str()
    val ipa = n.fields["ipa"].str()
    var prompt = REMIND_PROMPT[forgotOf(n).joinToString(",") { it.key }] ?: REMIND_PROMPT.getValue("meaning")
    if (suggestDone(st, n.id)) prompt += " Đã thuộc rồi thì bấm Đã nhớ."
    return RemindMessage(if (ipa.isNotEmpty()) "$word $ipa" else word, prompt, shortMeaning(n).ifEmpty { "Chưa có nghĩa" })
}

/** "Đã nhớ" (kinds empty) and its undo (the old kinds and mark time back). */
fun restoreForgot(n: Note, kinds: List<ForgotKind>, at: Long?, now: Long): Note =
    if (kinds.isEmpty()) n.copy(forgot = emptyList(), forgotAt = null, updatedAt = now)
    else n.copy(forgot = kinds.map { it.key }, forgotAt = at ?: now, updatedAt = now)

