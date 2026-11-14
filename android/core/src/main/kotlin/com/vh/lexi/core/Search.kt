package com.vh.lexi.core

import java.text.Normalizer

/*
 * Library search: which notes match a query, and how well. Port of shared/search.ts (vectors: shared/vectors/search.json).
 *
 * Matching ignores case, Vietnamese tone marks and đ ("xac dinh" finds "xác định"), and repeated spaces. A note's rank:
 *   0 its headword is the query ("determine")      1 the headword starts with it ("determined")
 *   2 the headword contains it ("predetermine")     3 its meaning does (vi / en, grammar translation, pattern topic)
 *   4 anything else the note holds (examples, phrases, notes, tags)
 * Lower ranks come first; within ranks 1-2 shorter headwords first; then the list's own order (newest, A-Z, due).
 */

private val MARKS = Regex("\\p{M}+")
private val SPACES = Regex("(?U)\\s+")

fun foldSearch(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(MARKS, "").replace('đ', 'd').replace('Đ', 'd').lowercase().replace(SPACES, " ").trim()

/** The meaning part of a note, by note type. */
private fun meaningOf(n: Note): String = when (n.type) {
    "vocab" -> listOf(n.fields["vi"].str(), n.fields["en"].str()).joinToString(" ")
    "grammar" -> n.fields["translation"].str()
    "pattern" -> (listOf(n.fields["topic"].str()) + n.fields["why"].items()).joinToString(" ")
    else -> ""
}

/** [len]: headword length for ranks 1-2 (shorter first), else 0. */
data class SearchHit(val rank: Int, val len: Int) : Comparable<SearchHit> {
    override fun compareTo(other: SearchHit): Int = compareValuesBy(this, other, { it.rank }, { it.len })
}

/** How [note] matches [query], or null when it does not. An empty query matches everything. */
fun searchHit(note: Note, query: String): SearchHit? {
    val q = foldSearch(query)
    if (q.isEmpty()) return SearchHit(0, 0)
    val def = noteType(note.type) ?: return null
    val head = foldSearch(def.title(note))
    return when {
        head == q -> SearchHit(0, 0)
        head.startsWith(q) -> SearchHit(1, head.length)
        head.contains(q) -> SearchHit(2, head.length)
        foldSearch(meaningOf(note)).contains(q) -> SearchHit(3, 0)
        foldSearch(def.searchText(note)).contains(q) -> SearchHit(4, 0)
        else -> null
    }
}
