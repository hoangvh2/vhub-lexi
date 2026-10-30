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
    /** An example sentence; [at] = start until end (exclusive) of the studied word in it, [vi] = its translation. */
    data class Example(val text: String, val at: Pair<Int, Int>? = null, val vi: String? = null) : Block
    /** The learner's memory tip ("truyện chêm"), shown in its own box. */
    data class Memo(val text: String) : Block
    /** Secondary text, collapsed under [label] until the learner opens it. */
    data class Fold(val label: String, val text: String) : Block
    /** A large play button that reads [text] aloud (listening cards). */
    data class Listen(val text: String) : Block
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

data class FieldDef(val key: String, val label: String, val kind: String, val required: Boolean = false, val maxLength: Int, val placeholder: String? = null)

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
    val (start, end) = findWord(sentence, word) ?: return null
    return Cloze(sentence.substring(0, start) + "_____" + sentence.substring(end), sentence.substring(start, end))
}

/** Where [word] (or an inflection of its first word) occurs in [sentence]: start until end (exclusive), or null. */
fun findWord(sentence: String, word: String): Pair<Int, Int>? {
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
    return m.range.first to m.range.last + 1
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

/** The first example that contains the word: its index (to find its translation), the sentence and the blanked version. */
private data class Found(val index: Int, val sentence: String, val cloze: Cloze)

private fun firstExampleWith(n: Note): Found? {
    val word = n.f("word").str()
    for ((i, ex) in n.f("examples").items().withIndex()) clozeSentence(ex, word)?.let { return Found(i, ex, it) }
    return null
}

private fun meaningLine(n: Note) = n.f("vi").str().ifEmpty { n.f("en").str() }

/** Translation of example [i]; translations are kept in the same order as the examples. */
private fun exampleVi(n: Note, i: Int) = n.f("examplesVi").items().getOrNull(i) ?: ""

private fun exampleBlock(n: Note, sentence: String, i: Int) =
    Block.Example(sentence, findWord(sentence, n.f("word").str()), exampleVi(n, i).ifEmpty { null })

private const val EN_LABEL = "Định nghĩa Anh-Anh"

/**
 * The answer side, in the order that makes a word click fastest for a Vietnamese learner: the Vietnamese meaning,
 * then examples (word highlighted, with their translation), the memory tip, and the English definition folded away.
 */
private fun detailBlocks(n: Note, l: CardLayout, skipExamples: Boolean = false, skipVi: Boolean = false, skipEn: Boolean = false): List<Block> = buildList {
    val vi = if (skipVi) "" else n.f("vi").str()
    val en = if (skipEn) "" else n.f("en").str()
    if (l.showVi && vi.isNotEmpty()) add(Block.Text(vi, "strong"))
    if (l.showExamples && !skipExamples) n.f("examples").items().forEachIndexed { i, e -> add(exampleBlock(n, e, i)) }
    if (l.showMnemonic && n.f("mnemonic").str().isNotEmpty()) add(Block.Memo(n.f("mnemonic").str()))
    if (l.showEn && en.isNotEmpty()) add(if ((l.showVi && vi.isNotEmpty()) || skipVi) Block.Fold(EN_LABEL, en) else Block.Text(en, "strong"))
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
        if (vi.isNotEmpty() && en.isNotEmpty() && layout.showEn) add(Block.Fold(EN_LABEL, en))
    }
    // The front stays on screen above the back once revealed; its badge is not repeated.
    override fun back(note: Note, layout: CardLayout) = buildList<Block> {
        addAll(wordHeader(note, layout, skipPos = true))
        if (layout.showExamples) note.f("examples").items().forEachIndexed { i, e -> add(exampleBlock(note, e, i)) }
    }
    override fun expected(note: Note) = listOf(note.f("word").str())
    override fun speakBack(note: Note) = note.f("word").str()
}

/** Typed answers for cards that blank the word out of an example (the inflected form or the base word). */
private fun clozeExpected(note: Note): List<String> {
    val c = firstExampleWith(note)
    return if (c != null) listOf(c.cloze.answer, note.f("word").str()) else listOf(note.f("word").str())
}

private object ClozeTemplate : TemplateDef {
    override val id = "cloze"
    override val label = "Điền vào chỗ trống"
    override val description = "Câu ví dụ che mất từ; gợi ý bằng bản dịch của câu (nếu có) hoặc nghĩa của từ."
    override val mode = AnswerMode.TYPE
    override fun applies(note: Note) = note.f("word").str().isNotEmpty() && firstExampleWith(note) != null
    override fun front(note: Note, layout: CardLayout) = buildList<Block> {
        val c = firstExampleWith(note)
        c?.let { add(Block.Quote(it.cloze.text)) }
        // The sentence's own translation points at exactly one word, which a bare meaning shared with synonyms does not.
        val tr = c?.let { exampleVi(note, it.index) } ?: ""
        if (tr.isNotEmpty()) add(Block.Text(tr))
        else {
            val hint = note.f("vi").str().ifEmpty { note.f("en").str() }
            if (hint.isNotEmpty()) add(Block.Text(hint, "muted"))
        }
        if (layout.showPos && note.f("pos").str().isNotEmpty()) add(Block.Badge(note.f("pos").str()))
    }
    // The front (blanked sentence, hint, badge) stays on screen above the back once revealed, so the
    // back adds only the word and what the hint lacked.
    override fun back(note: Note, layout: CardLayout) = buildList<Block> {
        val c = firstExampleWith(note)
        val usedTr = c != null && exampleVi(note, c.index).isNotEmpty()
        val usedVi = !usedTr && note.f("vi").str().isNotEmpty()
        val usedEn = !usedTr && !usedVi
        addAll(wordHeader(note, layout, skipPos = true))
        addAll(detailBlocks(note, layout, skipExamples = true, skipVi = usedVi, skipEn = usedEn))
    }
    override fun expected(note: Note) = clozeExpected(note)
    override fun speakBack(note: Note) = firstExampleWith(note)?.sentence
}

private object ListenTemplate : TemplateDef {
    override val id = "listen"
    override val label = "Nghe và gõ từ"
    override val description = "Nghe câu ví dụ, gõ từ còn thiếu. Luyện tai cho phần Nghe của TOEIC."
    override val mode = AnswerMode.TYPE
    override fun applies(note: Note) = note.f("word").str().isNotEmpty() && firstExampleWith(note) != null
    override fun front(note: Note, layout: CardLayout): List<Block> {
        val c = firstExampleWith(note)!!
        return listOf(Block.Listen(c.sentence), Block.Quote(c.cloze.text))
    }
    // After the answer: the word, the whole sentence with the word highlighted and translated, then the details.
    override fun back(note: Note, layout: CardLayout): List<Block> {
        val c = firstExampleWith(note)!!
        return wordHeader(note, layout) + exampleBlock(note, c.sentence, c.index) + detailBlocks(note, layout, skipExamples = true)
    }
    override fun expected(note: Note) = clozeExpected(note)
    override fun speakFront(note: Note) = firstExampleWith(note)?.sentence
    override fun speakBack(note: Note) = note.f("word").str()
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
        FieldDef("examplesVi", "Dịch ví dụ", "list", maxLength = 300, placeholder = "Mỗi dòng dịch một ví dụ, cùng thứ tự"),
        FieldDef("mnemonic", "Mẹo nhớ", "longtext", maxLength = 300),
    )
    override val templates: List<TemplateDef> = listOf(Recognize, Recall, ClozeTemplate, ListenTemplate)
    override fun title(note: Note) = note.f("word").str()
    override fun subtitle(note: Note) = note.f("vi").str().ifEmpty { note.f("en").str() }
    override fun searchText(note: Note) =
        (listOf(note.f("word").str(), note.f("vi").str(), note.f("en").str()) + note.f("examples").items() + note.f("examplesVi").items() + note.tags).joinToString(" ").lowercase()
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
