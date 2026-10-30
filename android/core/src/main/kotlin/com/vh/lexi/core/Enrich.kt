package com.vh.lexi.core

/** What the `enrich` Cloud Function returns (functions/src/enrich.ts). Older deployments send only vi/en/examples/mnemonic. */
data class Enriched(
    val vi: String,
    val en: String? = null,
    val examples: List<String> = emptyList(),
    val examplesVi: List<String> = emptyList(),
    val existingVi: List<String> = emptyList(),
    val mnemonic: String? = null,
)

data class Merged(val fields: Map<String, FieldValue>, val aiFields: Set<String>)

private const val MAX_EXAMPLES = 8

/**
 * Port of web/src/lib/enrich.ts `mergeEnrich`: folds an AI answer into a vocab note's fields without losing what the
 * learner wrote. vi and mnemonic are filled when empty or AI-written before (vi also when [overwriteVi]); en only when
 * empty; new sentences are added (at most 8) and existing ones get the translations they lack. Saving drops empty
 * lines, so translated sentences move in front of untranslated ones: a translation after a missing one would slide
 * onto the wrong sentence.
 */
fun mergeEnrich(fields: Map<String, FieldValue>, aiFields: Set<String>, r: Enriched, overwriteVi: Boolean = false): Merged {
    val next = fields.toMutableMap()
    val ai = aiFields.toMutableSet()
    val vi = r.vi.trim()
    if (vi.isNotEmpty() && (fields["vi"].str().isEmpty() || "vi" in ai || overwriteVi)) { next["vi"] = FieldValue.Text(vi); ai += "vi" }
    val en = r.en?.trim().orEmpty()
    if (en.isNotEmpty() && fields["en"].str().isEmpty()) { next["en"] = FieldValue.Text(en); ai += "en" }
    val mn = r.mnemonic?.trim().orEmpty()
    if (mn.isNotEmpty() && (fields["mnemonic"].str().isEmpty() || "mnemonic" in ai)) { next["mnemonic"] = FieldValue.Text(mn); ai += "mnemonic" }

    val existing = fields["examples"].items()
    val oldVi = fields["examplesVi"].items()
    val pairs = existing.mapIndexed { i, ex -> ex to (oldVi.getOrNull(i) ?: r.existingVi.getOrNull(i)?.trim().orEmpty()) }.toMutableList()
    val filled = existing.indices.any { i -> oldVi.getOrNull(i) == null && pairs[i].second.isNotEmpty() }
    val seen = existing.map { it.lowercase() }.toMutableSet()
    var added = false
    for ((j, ex) in r.examples.withIndex()) {
        val e = ex.trim()
        if (e.isEmpty() || e.lowercase() in seen || pairs.size >= MAX_EXAMPLES) continue
        seen += e.lowercase()
        pairs += e to r.examplesVi.getOrNull(j)?.trim().orEmpty()
        added = true
    }
    // Translated sentences go first (stable otherwise), so one untranslated sentence does not hide every translation after it.
    val ordered = pairs.filter { it.second.isNotEmpty() } + pairs.filter { it.second.isEmpty() }
    if (ordered.map { it.first } != existing) next["examples"] = FieldValue.Items(ordered.map { it.first })
    if (added) ai += "examples"
    val aligned = ordered.filter { it.second.isNotEmpty() }.map { it.second }
    if (aligned.size > oldVi.size && (filled || added)) { next["examplesVi"] = FieldValue.Items(aligned); ai += "examplesVi" }
    return Merged(next, ai)
}
