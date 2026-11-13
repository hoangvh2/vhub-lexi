package com.vh.lexi.core

/**
 * "Từ hay quên": words marked as often forgotten (meaning, pronunciation or both) and the active practice drawn from
 * them. Port of shared/drill.ts (vectors: shared/vectors/drill.json). Practice writes no review log and never touches
 * FSRS state; the only stored thing is the mark on the note (fields forgot/forgotAt).
 */
enum class ForgotKind(val key: String, val label: String) {
    MEANING("meaning", "Quên nghĩa"),
    SOUND("sound", "Quên phát âm"),
}

/** The marks on a note, in a fixed order (meaning, then sound); unknown values are ignored. */
fun forgotOf(n: Note): List<ForgotKind> = ForgotKind.entries.filter { it.key in n.forgot }

/** The note with [kind] marked or cleared; clearing the last mark removes both fields. */
fun withForgot(n: Note, kind: ForgotKind, on: Boolean, now: Long): Note {
    val cur = forgotOf(n)
    val next = ForgotKind.entries.filter { if (it == kind) on else it in cur }
    if (next.isEmpty()) return n.copy(forgot = emptyList(), forgotAt = null, updatedAt = now)
    val at = if (on && kind !in cur) now else (n.forgotAt ?: now)
    return n.copy(forgot = next.map { it.key }, forgotAt = at, updatedAt = now)
}

/** Marked vocab notes, most recently marked first. */
fun forgotNotes(notes: List<Note>): List<Note> =
    notes.filter { it.type == "vocab" && it.fields["word"].str().isNotEmpty() && forgotOf(it).isNotEmpty() }
        .sortedWith(compareByDescending<Note> { it.forgotAt ?: 0L }.thenBy { it.id })

/** The meaning shown on a choice: the first sense of vi (up to the first ';'), at most 80 characters. */
fun shortMeaning(n: Note): String {
    val first = n.fields["vi"].str().split(";")[0].trim()
    return if (first.length > 80) first.substring(0, 79).trimEnd() + "…" else first
}

enum class DrillMode(val key: String) { MEANING("meaning"), RECALL("recall"), LISTEN("listen"), SAY("say") }

/** One exercise; [options] = 4 note ids (the answer among them) for [DrillMode.MEANING]. */
data class DrillItem(val noteId: Id, val mode: DrillMode, val options: List<Id>? = null)

const val DRILL_ROUND = 20
const val RETRY_GAP = 3

private fun drillFnv(s: String): Long {
    var h = 2166136261L.toInt()
    for (c in s) h = (h xor c.code) * 16777619
    return h.toLong() and 0xFFFFFFFFL
}

private fun bySeed(seed: String): Comparator<String> = Comparator { a, b ->
    val d = drillFnv(seed + a).compareTo(drillFnv(seed + b))
    if (d != 0) d else a.compareTo(b)
}

/** Three wrong meanings for [n] from [pool] (no shared phrase, same part of speech first), in an order fixed by [seed]. */
fun meaningOptions(n: Note, pool: List<Note>, seed: String): List<Id>? {
    val own = meaningPhrases(n.fields["vi"].str()).toSet()
    val pos = n.fields["pos"].str()
    val seen = hashSetOf(shortMeaning(n))
    val byId = pool.associateBy { it.id }
    val order = bySeed(seed + n.id)
    fun samePos(id: Id) = if (pos.isNotEmpty() && byId.getValue(id).fields["pos"].str() == pos) 1 else 0
    val others = pool.filter { o -> o.id != n.id && o.type == "vocab" && shortMeaning(o).isNotEmpty() && meaningPhrases(o.fields["vi"].str()).none { it in own } }
        .map { it.id }
        .sortedWith { a, b -> val d = samePos(b) - samePos(a); if (d != 0) d else order.compare(a, b) }
    val picked = ArrayList<Id>()
    for (id in others) {
        val m = shortMeaning(byId.getValue(id))
        if (!seen.add(m)) continue
        picked += id
        if (picked.size == 3) break
    }
    if (picked.size < 3) return null
    return (listOf(n.id) + picked).sortedWith(bySeed(seed + ":" + n.id))
}

/** One practice round, in layers (every word's first exercise, then every word's second…), each layer seeded. */
fun drillRound(marked: List<Note>, pool: List<Note>, seed: String): List<DrillItem> {
    val layers = ArrayList<MutableList<DrillItem>>()
    for (n in marked.take(DRILL_ROUND)) {
        val kinds = forgotOf(n)
        val meaning = ArrayList<DrillItem>()
        val sound = ArrayList<DrillItem>()
        if (ForgotKind.MEANING in kinds && shortMeaning(n).isNotEmpty()) {
            meaningOptions(n, pool, seed)?.let { meaning += DrillItem(n.id, DrillMode.MEANING, it) }
            meaning += DrillItem(n.id, DrillMode.RECALL)
        }
        if (ForgotKind.SOUND in kinds) { sound += DrillItem(n.id, DrillMode.SAY); sound += DrillItem(n.id, DrillMode.LISTEN) }
        val items = ArrayList<DrillItem>()
        for (i in 0 until maxOf(meaning.size, sound.size)) {
            meaning.getOrNull(i)?.let { items += it }
            sound.getOrNull(i)?.let { items += it }
        }
        items.forEachIndexed { i, it -> if (layers.size <= i) layers.add(ArrayList()); layers[i].add(it) }
    }
    val order = bySeed(seed)
    val out = ArrayList<DrillItem>()
    for (layer in layers) {
        val l = layer.sortedWith { a, b -> order.compare("${a.noteId}/${a.mode.key}", "${b.noteId}/${b.mode.key}") }.toMutableList()
        if (out.isNotEmpty() && l.size > 1 && l[0].noteId == out.last().noteId) { val t = l[0]; l[0] = l[1]; l[1] = t }
        out += l
    }
    return out
}

/** The queue after answering its head: removed when right, moved [RETRY_GAP] places back when wrong. */
fun afterAnswer(queue: List<DrillItem>, right: Boolean): List<DrillItem> {
    if (queue.isEmpty()) return queue
    val head = queue[0]
    val rest = queue.drop(1)
    if (right) return rest
    val at = minOf(RETRY_GAP, rest.size)
    return rest.take(at) + head + rest.drop(at)
}
