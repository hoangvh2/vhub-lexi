package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * "Bộ đề" (port of web/src/lib/testset.ts and layoutText of web/src/lib/pdf.ts): a whole Reading or Listening test the
 * learner imported from a PDF (and, for Listening, its audio files), kept on this device only, taken inside Lexi.
 * Pure helpers: finding the answer key in the PDF text, cutting the pages into pieces the `extract-questions` function
 * can read in one call, merging what it returns, and scoring an attempt. Replayed against shared/vectors/testset.json.
 */

/** JavaScript's `\s`, which (unlike Java's) also matches no-break and other Unicode spaces that PDF text often holds. */
private const val WS_CHARS = "\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"
private const val WS = "[$WS_CHARS]"
private val TRIM = Regex("^$WS+|$WS+$")
private val TRIM_END = Regex("$WS+$")
private val ANY_WS = Regex(WS)
private val WS_RUN = Regex("$WS+")

/** `String.prototype.trim`. */
internal fun jsTrim(s: String): String = s.replace(TRIM, "")

/** One page as the PDF reader read it: its text (empty for a scanned page) and whether it has to be sent as a picture. */
data class PdfPage(val n: Int, val text: String, val scanned: Boolean)

/** Text per call: well under the function's 12 000, so the transcription plus JSON stays inside its output budget. */
const val CHUNK_CHARS = 5000

/** Scanned pages per call: one page of Part 7 transcribed is about 3–4k output tokens of the function's 8k. */
const val CHUNK_IMAGES = 2

/** Below this many characters a page is treated as a picture (a scan, or a page whose text layer is empty). */
const val SCANNED_BELOW = 40

/** A page read from the PDF: a scan when its text layer has fewer than SCANNED_BELOW characters (pdf.ts readPages). */
fun pdfPage(n: Int, text: String): PdfPage = PdfPage(n, text, text.replace(ANY_WS, "").length < SCANNED_BELOW)

/** Quota units per call (functions/src/config.ts extractTextCost / extractImageCost). */
const val COST_TEXT = 2
const val COST_IMAGES = 3

/** AI quota per day (functions/src/config.ts dailyEnrich, shared by every AI call): a choice that costs more cannot finish today. */
const val DAILY_QUOTA = 300

fun cost(chunks: List<Chunk>): Int = chunks.sumOf { if (it is Chunk.Text) COST_TEXT else COST_IMAGES }

// "101. (A)", "101 A", "101-B", "101) C", "1. D": a number then one letter that stands alone.
private val KEY_RE = Regex("(?<![\\d.])([1-9]\\d{0,2})$WS*[.):\\-–]?$WS*\\(?([A-D])\\)?(?![A-Za-z])")
private val KEY_TITLE = Regex("(?iu)answer$WS*key|đáp$WS*án")

/** Every "number → letter" pair in [text], numbers 1–200. A later pair for the same number wins (insertion order kept). */
fun keyPairs(text: String): LinkedHashMap<Int, String> {
    val m = LinkedHashMap<Int, String>()
    for (x in KEY_RE.findAll(text)) {
        val n = x.groupValues[1].toInt()
        if (n in 1..200) m[n] = x.groupValues[2]
    }
    return m
}

/**
 * A page that is an answer key: titled so near its top ("Answer key", "Đáp án") with a few pairs, or at least 10 pairs
 * that are most of what is on it (a question page has "(A) word" options too, but those carry no number).
 */
fun isKeyPage(text: String): Boolean {
    val pairs = KEY_RE.findAll(text).toList()
    val titled = KEY_TITLE.containsMatchIn(text.take(200))
    if (pairs.size < (if (titled) 3 else 10)) return false
    val covered = pairs.sumOf { it.value.replace(ANY_WS, "").length }
    val rest = text.replace(ANY_WS, "").length
    // A title alone is not enough: a Vietnamese question page may say "Chọn đáp án đúng" at its top.
    return covered.toDouble() / maxOf(1, rest) >= (if (titled) 0.25 else 0.45)
}

private val RANGE_SEP = Regex("$WS*(?:[-–—]|đến|to)$WS*")
private val RANGE_SPLIT = Regex("[,;$WS_CHARS]+")
private val RANGE_ITEM = Regex("^(\\d{1,5})(-(\\d{1,5})?)?$")

/**
 * Pages typed as "45-60, 290-292" (also "45–60", "45 đến 60", spaces or ";" between) → sorted page numbers within
 * 1..numPages. Empty → every page. Null when something is not a page or a range, or a range runs backwards.
 */
fun parsePageRange(text: String, numPages: Int): List<Int>? {
    val t = jsTrim(text).lowercase().replace(RANGE_SEP, "-")
    if (t.isEmpty()) return (1..numPages).toList()
    val out = sortedSetOf<Int>()
    for (s in t.split(RANGE_SPLIT).filter { it.isNotEmpty() }) {
        val m = RANGE_ITEM.find(s) ?: return null
        val a = m.groupValues[1].toInt()
        val b = when {
            m.groups[3] != null -> m.groupValues[3].toInt()
            m.groups[2] != null -> numPages
            else -> a
        }
        if (a < 1 || b < a || a > numPages) return null
        for (n in a..minOf(b, numPages)) out += n
    }
    return if (out.isEmpty()) null else out.toList()
}

/** Selected pages written back short: [1,2,3,7,9,10] → "1-3, 7, 9-10". */
fun formatPages(pages: List<Int>): String {
    val out = mutableListOf<String>()
    var i = 0
    while (i < pages.size) {
        var j = i
        while (j + 1 < pages.size && pages[j + 1] == pages[j] + 1) j++
        out += if (j > i) "${pages[i]}-${pages[j]}" else pages[i].toString()
        i = j + 1
    }
    return out.joinToString(", ")
}

data class FoundKey(val key: LinkedHashMap<Int, String>, val keyPages: List<Int>)

/** The answer key of the PDF: the pairs found on its key pages. */
fun findKey(pages: List<PdfPage>): FoundKey {
    val key = LinkedHashMap<Int, String>()
    val keyPages = mutableListOf<Int>()
    for (p in pages) {
        if (p.scanned || !isKeyPage(p.text)) continue
        keyPages += p.n
        key.putAll(keyPairs(p.text))
    }
    return FoundKey(key, keyPages)
}

private val NUMBER_AT_LINE = Regex("(?:^|\\n)$WS*(\\d{1,3})$WS*[.)]$WS")

/** Question numbers printed at the start of a line ("147." / "147)"), so a piece only carries its own answers. */
fun numbersIn(text: String): List<Int> = NUMBER_AT_LINE.findAll(text).map { it.groupValues[1].toInt() }.filter { it in 1..200 }.toList()

/** What one function call reads: text, or a few scanned pages ([pages] are page numbers to render). */
sealed class Chunk {
    abstract val pages: List<Int>
    data class Text(override val pages: List<Int>, val text: String) : Chunk()
    data class Images(override val pages: List<Int>) : Chunk()
}

private val QUESTION_START = Regex("\\n(?=$WS*\\d{1,3}[.)]$WS)")
private val BLANK_LINE = Regex("\\n$WS*\\n")

private fun lastIndex(s: String, re: Regex): Int = re.findAll(s).lastOrNull()?.range?.first ?: -1

/** Splits a page longer than [max] at the start of a question ("131."), else at a blank line, else hard. */
private fun splitLong(text: String, max: Int): List<String> {
    val out = mutableListOf<String>()
    var rest = text
    while (rest.length > max) {
        val head = rest.substring(0, max)
        val q = lastIndex(head, QUESTION_START)
        val blank = lastIndex(head, BLANK_LINE)
        val cut = if (q > max * 0.4) q else if (blank > max * 0.4) blank else max
        out += jsTrim(rest.substring(0, cut))
        rest = rest.substring(cut)
    }
    if (jsTrim(rest).isNotEmpty()) out += jsTrim(rest)
    return out
}

/**
 * The pages to read, cut into calls: consecutive text pages are joined up to CHUNK_CHARS (a page is never split unless it
 * alone is longer), scanned pages go CHUNK_IMAGES at a time. Pages in [skip] (key pages) and empty pages are left out.
 */
fun chunkPages(pages: List<PdfPage>, skip: Set<Int>): List<Chunk> {
    val out = mutableListOf<Chunk>()
    var textPages: MutableList<Int>? = null
    var text = StringBuilder()
    var imgs = mutableListOf<Int>()
    fun flushText() {
        val t = textPages
        if (t != null && jsTrim(text.toString()).isNotEmpty()) out += Chunk.Text(t.toList(), jsTrim(text.toString()))
        textPages = null
        text = StringBuilder()
    }
    fun flushImgs() {
        if (imgs.isNotEmpty()) out += Chunk.Images(imgs.toList())
        imgs = mutableListOf()
    }
    for (p in pages) {
        if (p.n in skip) continue
        if (p.scanned) {
            flushText()
            imgs += p.n
            if (imgs.size >= CHUNK_IMAGES) flushImgs()
            continue
        }
        flushImgs()
        if (jsTrim(p.text).isEmpty()) continue
        for (part in if (p.text.length > CHUNK_CHARS) splitLong(p.text, CHUNK_CHARS) else listOf(p.text)) {
            if (textPages != null && text.length + part.length + 2 > CHUNK_CHARS) flushText()
            val tp = textPages ?: mutableListOf<Int>().also { textPages = it }
            if (p.n !in tp) tp += p.n
            if (text.isNotEmpty()) text.append("\n\n")
            text.append(part)
        }
    }
    flushText()
    flushImgs()
    return out
}

/** The answers the model should copy for the questions in a piece: only theirs for text, the whole key ([numbers] null) for pictures. */
fun keyNote(key: Map<Int, String>, numbers: List<Int>?): String {
    val ns = (numbers?.filter { it in key } ?: key.keys.toList()).toSortedSet()
    if (ns.isEmpty()) return ""
    return "\n\nAnswer key (data, from the same test): " + ns.joinToString(", ") { "$it (${key[it]})" }
}

// ------------------------------------------------------------------ the stored set

/** Listening, several questions per file: where this one is (ms), found from the answer pauses (AudioSplit.kt). */
data class Clip(val track: Int, val from: Long, val to: Long)

data class SetQuestion(
    /** Position in the set, from 0: the id of the question inside it. */
    val i: Int,
    val number: Int?,
    val part: Int?,
    /** fill / insert / reading, or "listen": a Part 1–2 question with nothing printed but its number. */
    val kind: String,
    val stem: String,
    val options: Map<String, String>,
    val correct: String?,
    /** Index into the set's passages, or null. */
    val passage: Int?,
    val topic: String,
    val rule: String,
    val translation: String,
    val flags: List<String>,
    /** Letters to choose from when the options are not printed (Part 1: 4, Part 2: 3). */
    val choices: Int? = null,
    /** Listening, one audio file per question: the index into the set's tracks. */
    val track: Int? = null,
    val clip: Clip? = null,
)

data class SetPassage(val label: String, val text: String, val truncated: Boolean)

/** An attempt in progress or finished. [answers] are by question position. */
data class Attempt(
    val startedAt: Long,
    /** Time spent with the test open, so leaving the screen pauses the clock. */
    val elapsedMs: Long,
    val answers: Map<Int, String>,
    val finishedAt: Long? = null,
    /** The "test" note the result was saved as, once it is. */
    val resultNoteId: String? = null,
)

/** An audio file of a Listening set; its bytes are in the device store under [key]. */
data class SetTrack(val key: String, val name: String, val bytes: Long)

/** A page kept as a picture (Part 1 photos), stored under [key]. */
data class SetPicture(val part: Int?, val page: Int, val key: String)

data class SetSource(val fileName: String, val pages: Int, val range: String? = null)

data class TestSet(
    val id: String,
    val name: String,
    val createdAt: Long,
    val updatedAt: Long,
    /** "rc" or "lc". */
    val section: String,
    val source: SetSource,
    val passages: List<SetPassage>,
    val questions: List<SetQuestion>,
    val tracks: List<SetTrack> = emptyList(),
    val pictures: List<SetPicture> = emptyList(),
    val attempt: Attempt? = null,
)

/** Question numbers of the Listening parts printed with nothing but their number (Part 1, Part 2). */
data class LcLayout(val p1: IntRange?, val p2: IntRange?)

val LC_LAYOUT = LcLayout(1..6, 7..31)

data class SetPartInfo(val key: String, val part: Int, val label: String, val total: Int)

val LC_PARTS = listOf(SetPartInfo("p1", 1, "Part 1", 6), SetPartInfo("p2", 2, "Part 2", 25), SetPartInfo("p3", 3, "Part 3", 39), SetPartInfo("p4", 4, "Part 4", 30))
val RC_PARTS = listOf(SetPartInfo("p5", 5, "Part 5", 30), SetPartInfo("p6", 6, "Part 6", 16), SetPartInfo("p7", 7, "Part 7", 54))

/** Listening part of a TOEIC question number (1–6, 7–31, 32–70, 71–100), with the learner's own Part 1–2 ranges. */
fun lcPartOfNumber(n: Int?, layout: LcLayout = LC_LAYOUT): Int? = when {
    n == null -> null
    layout.p1 != null && n in layout.p1 -> 1
    layout.p2 != null && n in layout.p2 -> 2
    n in 32..70 -> 3
    n in 71..100 -> 4
    else -> null
}

/** What [parseNumberRange] made of the text. */
sealed class NumberRange {
    data class Of(val range: IntRange) : NumberRange()
    /** Empty: no such part in this set. */
    data object None : NumberRange()
    data object Invalid : NumberRange()
}

private val NUMBER_RANGE = Regex("(?iu)^(\\d{1,3})$WS*(?:[-–—]|đến|to)$WS*(\\d{1,3})$")
private val ONE_NUMBER = Regex("^(\\d{1,3})$")

/** "1-6" → 1..6; "" → None (no such part in this set); anything else → Invalid. */
fun parseNumberRange(text: String): NumberRange {
    val t = jsTrim(text)
    if (t.isEmpty()) return NumberRange.None
    val m = NUMBER_RANGE.find(t) ?: ONE_NUMBER.find(t) ?: return NumberRange.Invalid
    val a = m.groupValues[1].toInt()
    val b = if (m.groupValues.size > 2) m.groupValues[2].toInt() else a
    return if (a >= 1 && b >= a && b <= 200) NumberRange.Of(a..b) else NumberRange.Invalid
}

private val EMPTY_OPTIONS = LETTERS.associateWith { "" }

/** The Part 1–2 questions of a Listening set: one per number, nothing printed, the answer from the key. */
fun listenQuestions(layout: LcLayout, key: Map<Int, String>): List<SetQuestion> {
    val out = mutableListOf<SetQuestion>()
    for ((part, r, choices) in listOf(Triple(1, layout.p1, 4), Triple(2, layout.p2, 3))) {
        if (r == null) continue
        for (n in r) {
            val k = key[n]
            val correct = k?.takeIf { LETTERS.indexOf(it) in 0 until choices }
            out += SetQuestion(
                i = 0, number = n, part = part, kind = "listen", stem = "", options = EMPTY_OPTIONS, correct = correct, passage = null,
                topic = "", rule = "", translation = "", flags = if (correct != null) emptyList() else listOf("no-answer"), choices = choices,
            )
        }
    }
    return out
}

private val EXTENSION = Regex("(?i)\\.[a-z0-9]+$")
private val DIGITS = Regex("\\d+")

/** Audio files in play order: by the first number in the name ("002 - x.mp3" before "010.mp3"), then by name. */
fun <T> sortTracks(files: List<T>, name: (T) -> String): List<T> {
    fun num(n: String): Double = DIGITS.find(n.replace(EXTENSION, ""))?.value?.toDouble() ?: Double.POSITIVE_INFINITY
    val collator = java.text.Collator.getInstance(java.util.Locale.ROOT)
    return files.sortedWith { a, b -> num(name(a)).compareTo(num(name(b))).takeIf { it != 0 } ?: collator.compare(name(a), name(b)) }
}

/** The letters a question can be answered with: its printed options, or its [SetQuestion.choices] when nothing is printed. */
fun lettersOf(options: Map<String, String>, choices: Int?): List<String> {
    val printed = LETTERS.filter { !options[it].isNullOrEmpty() }
    return printed.ifEmpty { LETTERS.take(choices ?: 4) }
}

fun SetQuestion.letters(): List<String> = lettersOf(options, choices)

/** Reading part of a TOEIC question number (101–130 Part 5, 131–146 Part 6, 147–200 Part 7). */
fun partOfNumber(n: Int?): Int? = when (n) {
    null -> null
    in 101..130 -> 5
    in 131..146 -> 6
    in 147..200 -> 7
    else -> null
}

private val NON_ALNUM = Regex("[^a-z0-9]+")
private fun stemWords(s: String) = s.lowercase().replace(NON_ALNUM, "")
private fun sameStem(a: String, b: String): Boolean {
    val x = stemWords(a)
    val y = stemWords(b)
    return x.isEmpty() || y.isEmpty() || x.startsWith(y.take(40)) || y.startsWith(x.take(40))
}

private fun filled(o: Map<String, String>) = LETTERS.count { !o[it].isNullOrEmpty() }

data class MergedSet(val passages: List<SetPassage>, val questions: List<SetQuestion>)

/**
 * All pieces' answers as one set, in question-number order: a question seen in two pieces is kept once (the reading with
 * more options wins), passages are renumbered, the PDF's own answer key overrides what the model read, and the part comes
 * from the number when the test is numbered the TOEIC way.
 */
fun mergeExtracted(results: List<Extracted>, key: Map<Int, String>, lc: LcLayout? = null): MergedSet {
    val passages = mutableListOf<SetPassage>()
    val byKey = HashMap<String, SetQuestion>()
    val order = mutableListOf<String>()
    // Listening: Part 1–2 are made from their numbers (the model has nothing to read there); a reading of one is dropped.
    if (lc != null) for (q in listenQuestions(lc, key)) {
        byKey["#${q.number}"] = q
        order += "#${q.number}"
    }
    for (r in results) {
        val local = HashMap<Int, Int>()
        for (p in r.passages) {
            local[p.id] = passages.size
            passages += SetPassage(jsTrim(p.label), jsTrim(p.text), p.truncated)
        }
        for (q in r.questions) {
            val number = q.number
            val lcPart = if (lc != null) lcPartOfNumber(number, lc) else null
            if (lcPart == 1 || lcPart == 2) continue
            val options = LETTERS.associateWith { jsTrim(q.options[it] ?: "") }
            val fromKey = number?.let { key[it] }
            val read = q.correct?.takeIf { it in LETTERS && !options[it].isNullOrEmpty() }
            val correct = if (fromKey != null) fromKey.takeIf { !options[it].isNullOrEmpty() } else read
            val flags = q.flags.filter { !(correct != null && (it == "no-answer" || it == "answer-empty")) }.toMutableList()
            if (fromKey != null && read != null && fromKey != read) flags += "key-differs"
            if (fromKey != null && options[fromKey].isNullOrEmpty()) flags += "answer-empty"
            val agrees = correct != null && correct == read
            val item = SetQuestion(
                i = 0, number = number, part = if (lc != null) lcPart else partOfNumber(number) ?: q.part, kind = q.kind, stem = jsTrim(q.stem),
                options = options, correct = correct, passage = q.passage?.let { local[it] },
                topic = jsTrim(q.topic),
                // An explanation written for another letter than the key's is wrong: drop it.
                rule = if (agrees) jsTrim(q.rule) else "", translation = if (agrees) jsTrim(q.translation) else "", flags = flags,
            )
            // The same number is the same question only when the stems agree: a book numbers each exercise from 1 again.
            var k = if (number != null) "#$number" else "${q.kind}|${item.stem.lowercase()}"
            var d = 1
            while (number != null && byKey.containsKey(k) && !sameStem(byKey.getValue(k).stem, item.stem)) k = "#$number~${d++}"
            val prev = byKey[k]
            if (prev == null) {
                byKey[k] = item
                order += k
            } else if (filled(item.options) > filled(prev.options) || (item.passage != null && prev.passage == null)) byKey[k] = item
        }
    }
    val qs = order.map { byKey.getValue(it) }
    // Numbered questions in number order; unnumbered ones, or a book's exercises that each start at 1, keep reading order.
    val unique = qs.map { it.number }.toSet().size == qs.size
    val sorted = if (unique && qs.all { it.number != null }) qs.sortedBy { it.number!! } else qs
    // Drop passages no question points at (a header or a page footer the model took for one).
    val used = sorted.mapNotNull { it.passage }.toSortedSet().toList()
    val remap = used.withIndex().associate { (i, p) -> p to i }
    return MergedSet(used.map { passages[it] }, sorted.mapIndexed { i, q -> q.copy(i = i, passage = q.passage?.let { remap.getValue(it) }) })
}

data class SetSummary(val total: Int, val byPart: Map<String, Int>, val noAnswer: Int, val missing: List<Int>)

/** What a set holds, for the list and the import summary. */
fun summary(questions: List<SetQuestion>): SetSummary {
    val byPart = linkedMapOf("p1" to 0, "p2" to 0, "p3" to 0, "p4" to 0, "p5" to 0, "p6" to 0, "p7" to 0, "other" to 0)
    for (q in questions) byPart.merge(if (q.part != null) "p${q.part}" else "other", 1, Int::plus)
    val noAnswer = questions.count { it.correct == null }
    val s = questions.mapNotNull { it.number }.toSet()
    // Gaps inside one part's numbered run (e.g. 101…110 without 104): something the reading missed.
    val groups = LinkedHashMap<String, MutableList<Int>>()
    for (q in questions) if (q.number != null) groups.getOrPut(q.part.toString()) { mutableListOf() } += q.number
    val missing = mutableListOf<Int>()
    for (ns in groups.values) for (n in ns.min()..ns.max()) if (n !in s) missing += n
    missing.sort()
    return SetSummary(questions.size, byPart, noAnswer, missing)
}

// ------------------------------------------------------------------ taking it

data class Score(val right: Int, val total: Int) {
    override fun toString() = "$right/$total"
}

data class Graded(
    /** p5, p6, p7: null when the set has none of that part. */
    val parts: Map<String, Score?>,
    /** p1…p4. */
    val lcParts: Map<String, Score?>,
    /** Part 1–4 together: the "LC" of the Kết quả bài form. */
    val lc: Score?,
    /** Questions with no answer to grade against: not counted. */
    val ungraded: Int,
    val right: Int,
    val total: Int,
    /** Positions answered wrong or left blank. */
    val wrong: List<Int>,
)

/** Scores an attempt per part; a blank counts as wrong, a question without a known answer is not counted. */
fun grade(questions: List<SetQuestion>, answers: Map<Int, String>): Graded {
    val parts = linkedMapOf<String, Score?>("p5" to null, "p6" to null, "p7" to null)
    val lcParts = linkedMapOf<String, Score?>("p1" to null, "p2" to null, "p3" to null, "p4" to null)
    var lc: Score? = null
    val wrong = mutableListOf<Int>()
    var ungraded = 0
    var right = 0
    var total = 0
    fun add(s: Score?, ok: Boolean) = Score((s?.right ?: 0) + if (ok) 1 else 0, (s?.total ?: 0) + 1)
    for (q in questions) {
        if (q.correct == null) {
            ungraded++
            continue
        }
        total++
        val ok = answers[q.i] == q.correct
        if (ok) right++ else wrong += q.i
        val part = q.part ?: continue
        if (part >= 5) parts["p$part"] = add(parts["p$part"], ok)
        else {
            lcParts["p$part"] = add(lcParts["p$part"], ok)
            lc = add(lc, ok)
        }
    }
    return Graded(parts, lcParts, lc, ungraded, right, total, wrong)
}

/** Fields of the "test" note an attempt is logged as (same shape the "Kết quả bài" form writes). */
fun resultFields(name: String, date: String, g: Graded, elapsedMs: Long): Map<String, String> {
    val f = linkedMapOf("name" to jsTrim(name).take(80).ifEmpty { "Bộ đề" }, "date" to date)
    for (p in RC_PARTS) g.parts[p.key]?.let { f[p.key] = it.toString() }
    g.lc?.let { f["lc"] = it.toString() }
    val min = Math.round(elapsedMs / 60_000.0)
    if (min > 0) f["minutes"] = minOf(999L, min).toString()
    return f
}

data class WrongDrafts(val drafts: List<ImportDraft>, val skipped: Int, val passages: List<ExtractedPassage>)

/**
 * The wrong fill-in questions of an attempt as review rows for grammar cards (the same rows "Nhập nhanh" shows), marked
 * "wrong" so they are selected unless a check fails. Other kinds are counted as skipped.
 */
fun wrongDrafts(set: TestSet, g: Graded, existing: Set<String>): WrongDrafts = wrongDrafts(set.questions, set.passages, g, existing)

fun wrongDrafts(questions: List<SetQuestion>, passages: List<SetPassage>, g: Graded, existing: Set<String>): WrongDrafts {
    val wrong = g.wrong.toSet()
    val qs = questions.filter { it.i in wrong }
    // Part 1–2 have nothing printed to make a card from: counted with the other kinds that are skipped.
    val printed = qs.filter { it.kind != "listen" }
    val extracted = Extracted(emptyList(), printed.map {
        ExtractedQuestion(
            number = it.number, kind = it.kind, stem = it.stem, options = it.options, correct = it.correct, result = "wrong",
            topic = it.topic, rule = it.rule, translation = it.translation, flags = it.flags,
            part = it.part?.takeIf { p -> p >= 5 }, passage = it.passage,
        )
    })
    val (drafts, skipped) = draftsFrom(extracted, existing)
    // Passages that hold a missed question: the place to look for the words that were missing.
    val ps = qs.mapNotNull { it.passage }.toSortedSet()
    return WrongDrafts(drafts, skipped + (qs.size - printed.size), ps.map { ExtractedPassage(it + 1, passages[it].label, passages[it].text, passages[it].truncated) })
}

private val BULLET = Regex("^$WS*[-•*]$WS")

/**
 * A passage as printed has hard line breaks every ~90 characters; on a phone they leave ragged half-lines. Joins wrapped
 * lines into paragraphs, keeps short lines (headers like "To: All staff", titles) and blank lines as they are.
 */
fun reflow(text: String): String {
    val lines = text.replace("\r", "").split("\n")
    val out = StringBuilder()
    for (k in lines.indices) {
        val line = lines[k].replace(TRIM_END, "")
        val next = lines.getOrNull(k + 1)
        out.append(line)
        if (next == null) break
        val wrapped = line.length >= 45 && !line.endsWith(":") && jsTrim(next).isNotEmpty() && !BULLET.containsMatchIn(next)
        out.append(if (wrapped) " " else "\n")
    }
    return out.toString()
}

// ------------------------------------------------------------------ PDF text in reading order (pdf.ts layoutText)

/** One run of text on a page, in PDF units with y growing upwards. */
data class TextItem(val str: String, val x: Double, val y: Double, val w: Double, val h: Double)

/**
 * Text items → lines in reading order. A page is two columns when most items sit wholly on one side of the middle and a
 * good share sit on the right; then the full-width lines above the columns come first, the left column, the right column,
 * then full-width lines below.
 */
fun layoutText(items: List<TextItem>, pageWidth: Double): String {
    val words = items.filter { jsTrim(it.str).isNotEmpty() }
    if (words.isEmpty()) return ""
    val mid = pageWidth / 2
    fun side(i: TextItem) = if (i.x + i.w <= mid + 2) 'L' else if (i.x >= mid - 2) 'R' else 'X'
    val l = words.count { side(it) == 'L' }
    val r = words.count { side(it) == 'R' }
    val x = words.count { side(it) == 'X' }
    val twoCol = r >= words.size * 0.2 && l >= words.size * 0.2 && x <= words.size * 0.12
    if (!twoCol) return lines(words)
    val colItems = words.filter { side(it) != 'X' }
    val top = colItems.maxOf { it.y }
    val bottom = colItems.minOf { it.y }
    val above = words.filter { side(it) == 'X' && it.y > top }
    val below = words.filter { side(it) == 'X' && it.y < bottom }
    val inside = words.filter { side(it) == 'X' && it.y <= top && it.y >= bottom }
    return listOf(
        lines(above),
        lines(words.filter { side(it) == 'L' } + inside.filter { it.x < mid }),
        lines(words.filter { side(it) == 'R' } + inside.filter { it.x >= mid }),
        lines(below),
    ).filter { it.isNotEmpty() }.joinToString("\n\n")
}

private val THREE_NEWLINES = Regex("\\n{3,}")

/** Items → text lines top to bottom: same baseline (within half a line) = same line; a tall gap = a blank line. */
private fun lines(items: List<TextItem>): String {
    if (items.isEmpty()) return ""
    val sorted = items.sortedWith(compareByDescending<TextItem> { it.y }.thenBy { it.x })
    val rows = mutableListOf<MutableList<TextItem>>()
    for (it in sorted) {
        val row = rows.lastOrNull()
        val tol = maxOf(2.0, (if (it.h != 0.0) it.h else 10.0) * 0.5)
        if (row != null && Math.abs(row[0].y - it.y) <= tol) row += it else rows += mutableListOf(it)
    }
    val out = mutableListOf<String>()
    var prevY: Double? = null
    var prevH = 10.0
    for (row in rows) {
        val first = row[0]
        val inLine = row.sortedBy { it.x }
        val line = StringBuilder()
        var end = Double.NEGATIVE_INFINITY
        for (it in inLine) {
            val gap = it.x - end
            if (line.isNotEmpty() && gap > 1 && !line.endsWith(" ") && !it.str.startsWith(" ")) line.append(' ')
            line.append(it.str)
            end = it.x + it.w
        }
        val y = first.y
        if (prevY != null && prevY - y > prevH * 2.2) out += ""
        out += jsTrim(line.toString().replace(WS_RUN, " "))
        prevY = y
        prevH = maxOf(6.0, if (first.h != 0.0) first.h else 10.0)
    }
    return jsTrim(out.joinToString("\n").replace(THREE_NEWLINES, "\n\n"))
}

// ------------------------------------------------------------------ stored as JSON on the device (same shape as the web)

private fun JSONObject.strOr(k: String, d: String = "") = if (has(k) && !isNull(k)) optString(k, d) else d
private fun JSONObject.intOrNull(k: String): Int? = if (has(k) && !isNull(k)) getInt(k) else null
private fun JSONObject.longOrNull(k: String): Long? = if (has(k) && !isNull(k)) getLong(k) else null
private fun JSONArray.objs(): List<JSONObject> = List(length()) { getJSONObject(it) }

fun SetQuestion.toJson(): JSONObject = JSONObject()
    .put("i", i).put("number", number ?: JSONObject.NULL).put("part", part ?: JSONObject.NULL).put("kind", kind).put("stem", stem)
    .put("options", JSONObject().apply { LETTERS.forEach { put(it, options[it] ?: "") } }).put("correct", correct ?: JSONObject.NULL)
    .put("passage", passage ?: JSONObject.NULL).put("topic", topic).put("rule", rule).put("translation", translation).put("flags", JSONArray(flags))
    .apply {
        choices?.let { put("choices", it) }
        track?.let { put("track", it) }
        clip?.let { put("clip", JSONObject().put("track", it.track).put("from", it.from).put("to", it.to)) }
    }

fun setQuestionFromJson(o: JSONObject): SetQuestion {
    val opts = o.optJSONObject("options")
    val clip = o.optJSONObject("clip")
    return SetQuestion(
        i = o.getInt("i"), number = o.intOrNull("number"), part = o.intOrNull("part"), kind = o.strOr("kind", "fill"), stem = o.strOr("stem"),
        options = LETTERS.associateWith { opts?.strOr(it) ?: "" }, correct = o.strOr("correct").ifEmpty { null }, passage = o.intOrNull("passage"),
        topic = o.strOr("topic"), rule = o.strOr("rule"), translation = o.strOr("translation"),
        flags = o.optJSONArray("flags")?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList(),
        choices = o.intOrNull("choices"), track = o.intOrNull("track"), clip = clip?.let { Clip(it.getInt("track"), it.getLong("from"), it.getLong("to")) },
    )
}

fun TestSet.toJson(): JSONObject = JSONObject()
    .put("id", id).put("name", name).put("createdAt", createdAt).put("updatedAt", updatedAt).put("section", section)
    .put("source", JSONObject().put("fileName", source.fileName).put("pages", source.pages).apply { source.range?.let { put("range", it) } })
    .put("passages", JSONArray(passages.map { JSONObject().put("label", it.label).put("text", it.text).put("truncated", it.truncated) }))
    .put("questions", JSONArray(questions.map { it.toJson() }))
    .put("tracks", JSONArray(tracks.map { JSONObject().put("key", it.key).put("name", it.name).put("bytes", it.bytes) }))
    .put("pictures", JSONArray(pictures.map { JSONObject().put("part", it.part ?: JSONObject.NULL).put("page", it.page).put("key", it.key) }))
    .apply {
        attempt?.let { a ->
            put("attempt", JSONObject().put("startedAt", a.startedAt).put("elapsedMs", a.elapsedMs)
                .put("answers", JSONObject().apply { a.answers.forEach { (k, v) -> put(k.toString(), v) } })
                .apply { a.finishedAt?.let { put("finishedAt", it) }; a.resultNoteId?.let { put("resultNoteId", it) } })
        }
    }

fun testSetFromJson(o: JSONObject): TestSet {
    val src = o.getJSONObject("source")
    val a = o.optJSONObject("attempt")
    return TestSet(
        id = o.getString("id"), name = o.strOr("name"), createdAt = o.getLong("createdAt"), updatedAt = o.getLong("updatedAt"),
        section = o.strOr("section", "rc").ifEmpty { "rc" },
        source = SetSource(src.strOr("fileName"), src.optInt("pages"), src.strOr("range").ifEmpty { null }),
        passages = o.optJSONArray("passages")?.objs()?.map { SetPassage(it.strOr("label"), it.strOr("text"), it.optBoolean("truncated")) } ?: emptyList(),
        questions = o.optJSONArray("questions")?.objs()?.map(::setQuestionFromJson) ?: emptyList(),
        tracks = o.optJSONArray("tracks")?.objs()?.map { SetTrack(it.getString("key"), it.strOr("name"), it.optLong("bytes")) } ?: emptyList(),
        pictures = o.optJSONArray("pictures")?.objs()?.map { SetPicture(it.intOrNull("part"), it.getInt("page"), it.getString("key")) } ?: emptyList(),
        attempt = a?.let {
            val ans = it.optJSONObject("answers")
            Attempt(
                startedAt = it.getLong("startedAt"), elapsedMs = it.optLong("elapsedMs"),
                answers = ans?.keys()?.asSequence()?.associate { k -> k.toInt() to ans.getString(k) } ?: emptyMap(),
                finishedAt = it.longOrNull("finishedAt"), resultNoteId = it.strOr("resultNoteId").ifEmpty { null },
            )
        },
    )
}

/**
 * The stretch to replay for a question (web: replayOf in TestSets.tsx): its own clip; for Part 3–4, from the start of the
 * first question of its group of three (32–34, 35–37 …), where the conversation or talk is, to the end of its own.
 */
fun replayOf(all: List<SetQuestion>, q: SetQuestion): Clip? {
    val clip = q.clip ?: return null
    val n = q.number
    if ((q.part == 3 || q.part == 4) && n != null) {
        val first = n - (n - 32) % 3 // JS % (truncated), as on the web
        val head = all.firstOrNull { it.number == first && it.clip?.track == clip.track }?.clip
        if (head != null && head.from <= clip.from) return clip.copy(from = head.from)
    }
    return clip
}

/** A clip's start moved by [ms] (the ±2 s nudge), kept inside the file and at least half a second before its end. */
fun nudged(clip: Clip, ms: Long): Clip = clip.copy(from = maxOf(0L, minOf(clip.to - 500, clip.from + ms)))
