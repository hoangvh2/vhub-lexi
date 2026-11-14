package com.vh.lexi.core

import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays shared/vectors/search.json (made by web/test/search-vectors.ts): library search folding and ranking. */
class SearchVectorsTest {
    private val v = JSONObject(vectors("search.json"))
    private val notes = v.getJSONArray("notes").objects().map(::noteFromJson)

    @Test
    fun folding() {
        val a = v.getJSONArray("fold")
        for (i in 0 until a.length()) {
            val pair = a.getJSONArray(i)
            assertEquals(pair.getString(1), foldSearch(pair.getString(0)), pair.getString(0))
        }
    }

    @Test
    fun ranking() {
        for (c in v.getJSONArray("queries").objects()) {
            val q = c.getString("q")
            // Newest first, as the library lists by default, then ranked (stable sort).
            val hits = notes.mapNotNull { n -> searchHit(n, q)?.let { n to it } }.sortedByDescending { it.first.createdAt }.sortedBy { it.second }
            assertEquals(c.getJSONArray("order").strings(), hits.map { it.first.id }, "order for '$q'")
            assertEquals(c.getJSONArray("ranks").let { a -> List(a.length()) { a.getInt(it) } }, hits.map { it.second.rank }, "ranks for '$q'")
            assertEquals(c.getJSONArray("lens").let { a -> List(a.length()) { a.getInt(it) } }, hits.map { it.second.len }, "lens for '$q'")
        }
    }
}
