package com.vh.lexi.core

/**
 * Fast input for the practice loop (port of web/src/lib/import.ts). The `extract-questions` Cloud Function reads
 * screenshots or pasted text; here its answer becomes review rows and each accepted row a grammar note. The model only
 * proposes: every check below is deterministic and replayed against shared/vectors/import.json.
 */
val LETTERS = listOf("A", "B", "C", "D")

/** The grammar topics a row can carry (same list as GRAMMAR_TOPICS in shared/notetypes.ts). */
val IMPORT_TOPICS = listOf("Dạng từ", "Giới từ / liên từ", "Thì và bị động", "Mệnh đề quan hệ", "Trợ động từ", "Đảo ngữ", "Khác")

data class ExtractedQuestion(
    val number: Int?, val kind: String, val stem: String, val options: Map<String, String>, val correct: String?,
    val result: String, val topic: String, val rule: String, val translation: String, val flags: List<String>,
)

data class ExtractedPassage(val id: Int, val label: String, val text: String, val truncated: Boolean)

data class Extracted(val passages: List<ExtractedPassage>, val questions: List<ExtractedQuestion>)

/** Reads the callable's answer (a map of maps) leniently: a missing or odd field becomes empty, never a crash. */
fun extractedFrom(raw: Map<*, *>): Extracted {
    fun s(v: Any?) = (v as? String)?.trim() ?: ""
    fun num(v: Any?) = (v as? Number)?.toInt()
    val passages = (raw["passages"] as? List<*>)?.mapNotNull { it as? Map<*, *> }?.map {
        ExtractedPassage(num(it["id"]) ?: 0, s(it["label"]), s(it["text"]), it["truncated"] == true)
    } ?: emptyList()
    val questions = (raw["questions"] as? List<*>)?.mapNotNull { it as? Map<*, *> }?.map { q ->
        val o = q["options"] as? Map<*, *>
        ExtractedQuestion(
            number = num(q["number"]), kind = s(q["kind"]), stem = s(q["stem"]),
            options = LETTERS.associateWith { s(o?.get(it)) }, correct = s(q["correct"]).ifEmpty { null },
            result = s(q["result"]).ifEmpty { "unknown" }, topic = s(q["topic"]), rule = s(q["rule"]), translation = s(q["translation"]),
            flags = (q["flags"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
        )
    } ?: emptyList()
    return Extracted(passages, questions)
}

data class ImportDraft(
    val key: String, val number: Int?, val stem: String, val options: Map<String, String>, val correct: String?, val result: String,
    val topic: String, val rule: String, val translation: String, val flags: List<String>, val include: Boolean, val edited: List<String> = emptyList(),
)

data class Problems(val block: List<String>, val warn: List<String>)

fun ImportDraft.answer(): String = correct?.let { options[it] } ?: ""

/** The sentence with the blank (first run of two or more underscores) replaced by [answer]. Port of completeSentence. */
fun completeSentence(sentence: String, answer: String): String {
    val s = sentence.trim()
    val a = answer.trim()
    return if (a.isNotEmpty() && Regex("_{2,}").containsMatchIn(s)) Regex("_{2,}").replaceFirst(s, Regex.escapeReplacement(a)) else s
}

fun ImportDraft.problems(existing: Set<String>): Problems {
    val block = mutableListOf<String>()
    val warn = mutableListOf<String>()
    val answer = answer()
    val full = completeSentence(stem, answer)
    if (answer.isEmpty()) block += "no-answer"
    else if (!Regex("_{2,}").containsMatchIn(stem)) block += "no-blank"
    else if (findExact(full, answer) == null) block += "not-found"
    if (full.lowercase() in existing) warn += "duplicate"
    if ("unsure" in flags) warn += "unsure"
    if ("few-options" in flags) warn += "few-options"
    if (result == "right") warn += "right"
    return Problems(block, warn)
}

val PROBLEM_TEXT = mapOf(
    "no-answer" to "Chưa có đáp án đúng: chọn một đáp án bên dưới",
    "no-blank" to "Câu không có chỗ trống (_____)",
    "not-found" to "Đáp án không khớp chỗ trống",
    "duplicate" to "Câu này đã có thẻ",
    "unsure" to "AI không chắc khi đọc câu này, hãy đối chiếu với đề",
    "few-options" to "Thiếu đáp án (ảnh có thể bị cắt)",
    "right" to "Bạn đã làm đúng câu này",
)

/** The fields of the grammar note a row becomes. */
fun ImportDraft.grammarFields(): Map<String, String> {
    val a = answer().trim()
    return mapOf("sentence" to completeSentence(stem, a), "answer" to a, "topic" to topic, "translation" to translation.trim(), "rule" to rule.trim())
}

/** Which of topic, rule and translation the AI wrote and the learner did not touch: they get the "AI" label. */
fun ImportDraft.aiFields(): List<String> =
    listOf("topic" to topic, "rule" to rule, "translation" to translation).filter { (k, v) -> v.isNotBlank() && k !in edited }.map { it.first }

/** Selected by default: a question the learner missed (or has no result for) that passes every check. */
fun ImportDraft.recommended(existing: Set<String>): Boolean {
    val p = problems(existing)
    return p.block.isEmpty() && "duplicate" !in p.warn && "unsure" !in p.warn && result != "right"
}

/** Rows ready for review, and how many questions (comprehension, sentence insertion) do not become grammar rows. */
fun draftsFrom(r: Extracted, existing: Set<String>): Pair<List<ImportDraft>, Int> {
    var skipped = 0
    val out = mutableListOf<ImportDraft>()
    for ((i, q) in r.questions.withIndex()) {
        if (q.kind != "fill") { skipped++; continue }
        val correct = q.correct?.takeIf { it in LETTERS && !q.options[it].isNullOrBlank() }
        val d = ImportDraft(
            key = "q$i", number = q.number, stem = q.stem.trim(), options = LETTERS.associateWith { q.options[it]?.trim() ?: "" }, correct = correct,
            result = q.result, topic = q.topic, rule = q.rule, translation = q.translation, flags = q.flags, include = false,
        )
        out += d.copy(include = d.recommended(existing))
    }
    return out to skipped
}

/** Lower-cased sentences of the grammar notes already saved, to flag duplicates. */
fun existingSentences(notes: List<Note>): Set<String> =
    notes.filter { it.type == "grammar" }.map { it.fields["sentence"].str().lowercase() }.toSet()
