package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Built-in study material loaded into the learner's account (port of shared/seed.ts): an add-only migration keyed by
 * fixed document ids. Nothing the server already holds is written again, and the loaded version is recorded in
 * settings/seeds so notes the learner deleted stay deleted. shared/vectors/seed.json pins [planSeed].
 */
data class SeedNote(val id: Id, val since: Int, val type: String, val fields: Map<String, FieldValue>, val tags: List<String>)

data class SeedPack(val id: String, val version: Int, val prefix: String, val deckId: Id, val deckName: String, val createdAt: Long, val notes: List<SeedNote>)

/** What the server holds of a pack: the version already loaded (0 = never) and its documents still there. */
data class SeedState(val applied: Int, val noteIds: Set<Id>, val deckExists: Boolean)

data class SeedPlan(val deck: Deck?, val notes: List<Note>, val version: Int)

const val SEEDS_DOC = "seeds"

/** Ids of the pack's documents lie in [first, second): "seed-gt-" until "seed-gt.". */
fun seedIdRange(prefix: String): Pair<String, String> = prefix to prefix.dropLast(1) + (prefix.last() + 1)

fun planSeed(pack: SeedPack, state: SeedState): SeedPlan? {
    if (state.applied >= pack.version) return null
    val notes = pack.notes.mapIndexedNotNull { i, s ->
        if (s.since <= state.applied || s.id in state.noteIds) null
        else (pack.createdAt + i).let { at -> Note(id = s.id, type = s.type, deckId = pack.deckId, fields = s.fields, tags = s.tags, createdAt = at, updatedAt = at) }
    }
    val deck = if (notes.isNotEmpty() && !state.deckExists) Deck(pack.deckId, pack.deckName, null, pack.createdAt, pack.createdAt) else null
    return SeedPlan(deck, notes, pack.version)
}

/** Reads a pack as tools/seed/build.ts writes it (shared/seed/grammar-toeic.json, an app asset). */
fun seedPackFromJson(text: String): SeedPack {
    val o = JSONObject(text)
    val deck = o.getJSONObject("deck")
    val arr = o.getJSONArray("notes")
    val notes = List(arr.length()) { i ->
        val n = arr.getJSONObject(i)
        val f = n.getJSONObject("fields")
        val fields = f.keys().asSequence().associateWith { k ->
            when (val v = f.get(k)) {
                is JSONArray -> FieldValue.Items(List(v.length()) { v.getString(it) })
                else -> FieldValue.Text(v.toString())
            }
        }
        val tags = n.optJSONArray("tags")?.let { t -> List(t.length()) { t.getString(it) } } ?: emptyList()
        SeedNote(n.getString("id"), n.getInt("since"), n.getString("type"), fields, tags)
    }
    return SeedPack(o.getString("id"), o.getInt("version"), o.getString("prefix"), deck.getString("id"), deck.getString("name"), o.getLong("createdAt"), notes)
}
