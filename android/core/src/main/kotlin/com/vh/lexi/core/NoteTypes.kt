package com.vh.lexi.core

import java.text.Normalizer

/**
 * Note-type registry (port of shared/notetypes.ts): the extension point for TOEIC / IELTS material.
 * Add a NoteTypeDef to [NOTE_TYPES]; storage, sync, scheduling, queues and the library already work on any type.
 * shared/vectors/templates.json pins the output of every template.
 */
sealed interface Block {
    data class Title(val text: String) : Block
    data class Ipa(val text: String) : Block
    data class Speak(val text: String) : Block
    data class Badge(val text: String) : Block
    data class Text(val text: String, val tone: String? = null) : Block // tone: strong | muted
    data class Quote(val text: String) : Block
}

/** "flip" = think, reveal, self-rate; "type" = type the answer, then self-rate. */
enum class AnswerMode { FLIP, TYPE }

interface TemplateDef {
    val id: String
    val label: String
    val description: String
    val mode: AnswerMode
    fun applies(note: Note): Boolean
    fun front(note: Note, layout: CardLayout): List<Block>
    fun back(note: Note, layout: CardLayout): List<Block>
    fun expected(note: Note): List<String> = emptyList()
    fun speakFront(note: Note): String? = null
    fun speakBack(note: Note): String? = null
}

data class FieldDef(val key: String, val label: String, val kind: String, val required: Boolean = false, val maxLength: Int)

interface NoteTypeDef {
    val id: String
    val label: String
    val fields: List<FieldDef>
    val templates: List<TemplateDef>
    fun title(note: Note): String
    fun subtitle(note: Note): String
    fun searchText(note: Note): String
}

// ------------------------------------------------------------------ helpers

private val ESCAPE_RE = Regex("[.*+?^\${}()|\\[\\]\\\\]")
private fun escapeRe(s: String) = ESCAPE_RE.replace(s) { "\\" + it.value }

data class Cloze(val text: String, val answer: String)

/** Blanks out [word] (allowing common inflections of its first word) in [sentence]; null when absent. */
fun clozeSentence(sentence: String, word: String): Cloze? {
    val parts = word.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (parts.isEmpty()) return null
    val h = parts[0].lowercase()
    val rest = parts.drop(1)
    val stemLen = if (h.length >= 6) h.length - 2 else if (h.length >= 4) h.length - 1 else h.length
    val stem = h.substring(0, stemLen)
    val last = escapeRe(h.last().toString())
    val headRe = if (h.length >= 4) "${escapeRe(stem)}[a-z]*" else "${escapeRe(h)}$last?(?:s|es|ed|d|ing)?"
    val re = Regex("(?<![A-Za-z])(${(listOf(headRe) + rest.map { escapeRe(it) }).joinToString("\\s+")})(?![A-Za-z])", RegexOption.IGNORE_CASE)
    val m = re.find(sentence) ?: return null
    return Cloze(sentence.substring(0, m.range.first) + "_____" + sentence.substring(m.range.last + 1), m.groupValues[1])
}

fun normalizeAnswer(s: String): String =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFKD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
        .replace(Regex("[^a-z0-9' ]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

private fun levenshtein(a: String, b: String): Int {
    var prev = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        val cur = IntArray(b.length + 1)
        cur[0] = i
        for (j in 1..b.length) cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        prev = cur
    }
    return prev[b.length]
}

enum class Verdict { CORRECT, CLOSE, WRONG }

fun checkTyped(typed: String, expected: List<String>): Verdict {
    val t = normalizeAnswer(typed)
    if (t.isEmpty()) return Verdict.WRONG
    var best = Int.MAX_VALUE
    for (e in expected) {
        val n = normalizeAnswer(e)
        if (n == t) return Verdict.CORRECT
        best = minOf(best, levenshtein(t, n))
    }
    return if (best == 1 && t.length >= 5) Verdict.CLOSE else Verdict.WRONG
}

/** Suggested rating for a typed verdict (the learner can still choose another). */
fun suggestedRating(v: Verdict): Int = when (v) { Verdict.CORRECT -> 3; Verdict.CLOSE -> 2; Verdict.WRONG -> 1 }

// ------------------------------------------------------------------ vocab

private fun Note.f(key: String) = fields[key]

private fun firstExampleWith(n: Note): Pair<String, Cloze>? {
    val word = n.f("word").str()
    for (ex in n.f("examples").items()) clozeSentence(ex, word)?.let { return ex to it }
    return null
}

private fun meaningLine(n: Note) = n.f("vi").str().ifEmpty { n.f("en").str() }

private fun detailBlocks(n: Note, l: CardLayout, skipExamples: Boolean = false, skipVi: Boolean = false, skipEn: Boolean = false): List<Block> = buildList {
    val vi = if (skipVi) "" else n.f("vi").str()
    val en = if (skipEn) "" else n.f("en").str()
    if (l.showVi && vi.isNotEmpty()) add(Block.Text(vi, "strong"))
    if (l.showEn && en.isNotEmpty()) add(Block.Text(en, "muted"))
    if (l.showExamples && !skipExamples) n.f("examples").items().forEach { add(Block.Quote(it)) }
    if (l.showMnemonic && n.f("mnemonic").str().isNotEmpty()) add(Block.Text(n.f("mnemonic").str(), "muted"))
}

private fun wordHeader(n: Note, l: CardLayout, skipPos: Boolean = false): List<Block> = buildList {
    add(Block.Title(n.f("word").str()))
    if (l.showPos && !skipPos && n.f("pos").str().isNotEmpty()) add(Block.Badge(n.f("pos").str()))
    if (l.showIpa && n.f("ipa").str().isNotEmpty()) add(Block.Ipa(n.f("ipa").str()))
    add(Block.Speak(n.f("word").str()))
}

private object Recognize : TemplateDef {
    override val id = "recognize"
    override val label = "Nhận biết (Anh → nghĩa)"
    override val description = "Thấy từ tiếng Anh, nhớ nghĩa."
    override val mode = AnswerMode.FLIP
    override fun applies(note: Note) = note.f("word").str().isNotEmpty() && meaningLine(note).isNotEmpty()
    override fun front(note: Note, layout: CardLayout) = buildList<Block> {
        add(Block.Title(note.f("word").str()))
        if (layout.showIpa && note.f("ipa").str().isNotEmpty()) add(Block.Ipa(note.f("ipa").str()))
        add(Block.Speak(note.f("word").str()))
    }
    override fun back(note: Note, layout: CardLayout) = buildList<Block> {
        if (layout.showPos && note.f("pos").str().isNotEmpty()) add(Block.Badge(note.f("pos").str()))
        addAll(detailBlocks(note, layout))
    }
    override fun speakFront(note: Note) = note.f("word").str()
}

private object Recall : TemplateDef {
    override val id = "recall"
    override val label = "Nhớ lại (nghĩa → gõ từ)"
    override val description = "Thấy nghĩa, tự gõ lại từ tiếng Anh. Nhớ chủ động nên bền hơn."
    override val mode = AnswerMode.TYPE
    override fun applies(note: Note) = note.f("word").str().isNotEmpty() && meaningLine(note).isNotEmpty()
    override fun front(note: Note, layout: CardLayout) = buildList<Block> {
        if (layout.showPos && note.f("pos").str().isNotEmpty()) add(Block.Badge(note.f("pos").str()))
        val vi = note.f("vi").str()
        val en = note.f("en").str()
        if (vi.isNotEmpty()) add(Block.Text(vi, "strong")) else if (en.isNotEmpty()) add(Block.Text(en, "strong"))
        if (vi.isNotEmpty() && en.isNotEmpty() && layout.showEn) add(Block.Text(en, "muted"))
    }
    // The front stays on screen above the back once revealed; its badge is not repeated.
    override fun back(note: Note, layout: CardLayout) = buildList<Block> {
        addAll(wordHeader(note, layout, skipPos = true))
        if (layout.showExamples) note.f("examples").items().forEach { add(Block.Quote(it)) }
    }
    override fun expected(note: Note) = listOf(note.f("word").str())
    override fun speakBack(note: Note) = note.f("word").str()
}

private object ClozeTemplate : TemplateDef {
    override val id = "cloze"
    override val label = "Điền vào chỗ trống"
    override val description = "Câu ví dụ che mất từ; cần có ví dụ chứa từ đó."
    override val mode = AnswerMode.TYPE
    override fun applies(note: Note) = note.f("word").str().isNotEmpty() && firstExampleWith(note) != null
    override fun front(note: Note, layout: CardLayout) = buildList<Block> {
        firstExampleWith(note)?.let { add(Block.Quote(it.second.text)) }
        val hint = note.f("vi").str().ifEmpty { note.f("en").str() }
        if (hint.isNotEmpty()) add(Block.Text(hint, "muted"))
        if (layout.showPos && note.f("pos").str().isNotEmpty()) add(Block.Badge(note.f("pos").str()))
    }
    // The front (blanked sentence, hint, badge) stays on screen above the back once revealed, so the
    // back adds only the word and what the hint lacked.
    override fun back(note: Note, layout: CardLayout) = buildList<Block> {
        val usedVi = note.f("vi").str().isNotEmpty()
        addAll(wordHeader(note, layout, skipPos = true))
        addAll(detailBlocks(note, layout, skipExamples = true, skipVi = usedVi, skipEn = !usedVi))
    }
    override fun expected(note: Note): List<String> {
        val c = firstExampleWith(note)
        return if (c != null) listOf(c.second.answer, note.f("word").str()) else listOf(note.f("word").str())
    }
    override fun speakBack(note: Note) = firstExampleWith(note)?.first
}

object Vocab : NoteTypeDef {
    override val id = "vocab"
    override val label = "Từ vựng"
    override val fields = listOf(
        FieldDef("word", "Từ", "text", required = true, maxLength = 80),
        FieldDef("ipa", "Phiên âm IPA", "text", maxLength = 80),
        FieldDef("pos", "Loại từ", "text", maxLength = 30),
        FieldDef("vi", "Nghĩa tiếng Việt", "text", maxLength = 300),
        FieldDef("en", "Định nghĩa tiếng Anh", "longtext", maxLength = 400),
        FieldDef("examples", "Ví dụ", "list", maxLength = 300),
        FieldDef("mnemonic", "Mẹo nhớ", "longtext", maxLength = 300),
    )
    override val templates: List<TemplateDef> = listOf(Recognize, Recall, ClozeTemplate)
    override fun title(note: Note) = note.f("word").str()
    override fun subtitle(note: Note) = note.f("vi").str().ifEmpty { note.f("en").str() }
    override fun searchText(note: Note) =
        (listOf(note.f("word").str(), note.f("vi").str(), note.f("en").str()) + note.f("examples").items() + note.tags).joinToString(" ").lowercase()
}

val NOTE_TYPES: Map<String, NoteTypeDef> = mapOf(Vocab.id to Vocab)

fun noteType(id: String): NoteTypeDef? = NOTE_TYPES[id]
fun template(typeId: String, templateId: String): TemplateDef? = NOTE_TYPES[typeId]?.templates?.firstOrNull { it.id == templateId }

/** Templates that should exist for [note] given the learner's choices and the note's content. */
fun wantedTemplates(note: Note, chosen: Map<String, List<String>>?): List<String> {
    val def = NOTE_TYPES[note.type] ?: return emptyList()
    val ids = chosen?.get(note.type) ?: def.templates.map { it.id }
    return def.templates.filter { it.id in ids && it.applies(note) }.map { it.id }
}
