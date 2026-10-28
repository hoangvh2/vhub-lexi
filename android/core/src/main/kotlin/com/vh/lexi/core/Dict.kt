package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Offline dictionary pack reader. The pack is built by tools/dict (CMUdict + WordNet) and bundled in the
 * APK assets: `dict/meta.json`, `dict/<xx>.json` (entries whose word starts with the two letters xx, "_" otherwise).
 */
data class DictSense(val def: String, val examples: List<String>)
data class DictPos(val pos: String, val senses: List<DictSense>) // pos: n v a r
data class DictEntry(val word: String, val ipa: String, val rank: Int, val pos: List<DictPos>)
data class Lookup(val entry: DictEntry, val inflectedFrom: String? = null)

val POS_NAMES = mapOf("n" to "noun", "v" to "verb", "a" to "adjective", "r" to "adverb")

fun interface ShardSource {
    /** Contents of "<key>.json" in the pack, or null when absent. */
    fun read(key: String): String?
}

fun shardKey(word: String) = if (Regex("^[a-z]{2}").containsMatchIn(word)) word.substring(0, 2) else "_"

fun normalizeWord(s: String): String =
    s.lowercase().replace('’', '\'').replace('‘', '\'')
        .replace(Regex("^[^a-z]+|[^a-z]+$"), "")
        .replace(Regex("\\s+"), " ").trim()

class Dictionary(private val source: ShardSource) {
    private val cache = HashMap<String, List<DictEntry>>()

    private fun shard(key: String): List<DictEntry> = synchronized(cache) {
        cache.getOrPut(key) {
            val text = source.read(key) ?: return@getOrPut emptyList()
            val arr = JSONObject(text).getJSONArray("e")
            List(arr.length()) { decode(arr.getJSONArray(it)) }
        }
    }

    private fun decode(r: JSONArray): DictEntry {
        val pos = r.getJSONArray(3)
        return DictEntry(
            word = r.getString(0), ipa = r.getString(1), rank = r.getInt(2),
            pos = List(pos.length()) { i ->
                val p = pos.getJSONArray(i)
                val senses = p.getJSONArray(1)
                DictPos(p.getString(0), List(senses.length()) { k ->
                    val s = senses.getJSONArray(k)
                    DictSense(s.getString(0), if (s.length() > 1) s.getJSONArray(1).let { ex -> List(ex.length()) { ex.getString(it) } } else emptyList())
                })
            },
        )
    }

    private fun exact(word: String): DictEntry? {
        val list = shard(shardKey(word))
        var lo = 0
        var hi = list.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val c = list[mid].word.compareTo(word)
            if (c == 0) return list[mid]
            if (c < 0) lo = mid + 1 else hi = mid - 1
        }
        return null
    }

    fun lookup(raw: String): Lookup? {
        val w = normalizeWord(raw)
        if (w.isEmpty()) return null
        exact(w)?.let { return Lookup(it) }
        for (c in baseForms(w)) exact(c)?.let { return Lookup(it, inflectedFrom = w) }
        return null
    }

    /** Words starting with [raw] (at least 2 letters), most common first. */
    fun suggest(raw: String, n: Int = 8): List<DictEntry> {
        val p = normalizeWord(raw)
        if (p.length < 2) return emptyList()
        val list = shard(shardKey(p))
        var lo = 0
        var hi = list.size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (list[mid].word < p) lo = mid + 1 else hi = mid
        }
        val found = ArrayList<DictEntry>()
        var i = lo
        while (i < list.size && list[i].word.startsWith(p) && found.size < 400) found += list[i++]
        return found.sortedWith(
            compareBy<DictEntry> { it.word.contains(' ') }.thenByDescending { it.rank }.thenBy { it.word.length }.thenBy { it.word },
        ).take(n)
    }
}
