package com.vh.lexi.core

/**
 * Candidate base forms of an inflected English word (port of shared/morphy.ts): WordNet's morphy
 * suffix rules plus consonant doubling. The caller checks each candidate against the dictionary.
 */
private val SUFFIX_RULES = listOf(
    "ses" to "s", "xes" to "x", "zes" to "z", "ches" to "ch", "shes" to "sh", "men" to "man", "ies" to "y",
    "s" to "", "es" to "e", "es" to "", "ed" to "e", "ed" to "", "ing" to "e", "ing" to "",
    "er" to "", "est" to "", "er" to "e", "est" to "e",
)
private val DOUBLED = Regex("([b-df-hj-np-tv-z])\\1$")

fun baseForms(raw: String, exceptions: Map<String, String> = IRREGULAR): List<String> {
    val w = raw.trim().lowercase()
    if (w.isEmpty()) return emptyList()
    val out = ArrayList<String>()
    fun add(c: String) {
        if (c.length >= 2 && c != w && c !in out) out += c
    }
    exceptions[w]?.let { add(it) }
    for ((suffix, repl) in SUFFIX_RULES) {
        if (w.length > suffix.length + 1 && w.endsWith(suffix)) {
            val stem = w.dropLast(suffix.length) + repl
            add(stem)
            if (repl.isEmpty() && suffix in setOf("ing", "ed", "er", "est") && DOUBLED.containsMatchIn(stem)) add(stem.dropLast(1))
        }
    }
    return out
}
