package com.vh.lexi.core

/**
 * "Từ lạ trong đoạn đọc": which words of a pasted passage the learner does not have yet (port of web/src/lib/readcheck.ts,
 * replayed against shared/vectors/readcheck.json). A word counts as covered when it is a very common word, is in the
 * deck and has been learned, or the learner says they know it. The common-word list is a hand-written set of everyday
 * English, not a corpus list: it says "you surely know this", not "this is frequent in TOEIC".
 */
private val COMMON_TEXT = """
a an the this that these those my your his her its our their me him us them i you he she it we they who whom whose which what where when why how
am is are was were be been being do does did done doing have has had having will would shall should can could may might must ought let
and or but so if then than because as while although though unless until since after before once whether either neither nor both not no yes
of in on at by for with about against between into through during without within along across behind beyond near up down out off over under again
to from upon around among toward towards per via like than
all any each every some many much more most few less least other another such only own same very too quite rather just even still also ever never always often
sometimes usually already yet now then here there today tomorrow yesterday soon later again away back well far
one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million first second third last next
go goes went gone going get gets got getting make makes made making take takes took taken taking come comes came coming see sees saw seen seeing
know knew known say says said give gave given find found tell told work works worked working call called try tried ask asked need needed feel felt
become became leave left put mean meant keep kept begin began begun seem seemed help helped show showed shown hear heard play played run ran move moved
live lived believe bring brought happen happened write wrote written sit stand stood lose lost pay paid meet met include included continue set learn
change changed lead led understand watch follow stop create speak spoke read allow add spend grow open walk win offer remember love consider appear buy bought
wait serve send sent expect build stay fall cut reach remain use used using want wanted look looked think thought turn turned start started
good new old long great little big high small large young important different same right bad able free sure real best better full special easy clear
late early hard major local whole short available possible human public next sure low
time year years people way ways day days man men thing things woman women life child children world school state family student group country problem hand
part place case week weeks company system program question number night point home water room mother father area money story fact month months lot
study book eye job word business issue side kind head house service friend power hour hours game line end member law car city community name team minute
minutes idea body information parent face level office door health person art war history party result morning reason girl guy moment air teacher
education name page note list day week plan plans please thank thanks sorry hello dear
don doesn didn isn aren wasn weren won wouldn couldn shouldn haven hasn hadn cannot ll ve re
mr mrs ms dr
monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december
dollar dollars percent
"""
private val COMMON: Set<String> = COMMON_TEXT.split(Regex("\\s+")).filter { it.isNotEmpty() }.toSet()

enum class Kind { COMMON, KNOWN, DECK, IGNORED, UNKNOWN, SKIP }

data class Tok(val start: Int, val end: Int, val raw: String, val key: String, val kind: Kind)
data class UnknownWord(val key: String, val count: Int, val first: Tok)
data class Analysis(val tokens: List<Tok>, val counted: Int, val covered: Int, val coverage: Double?, val unknown: List<UnknownWord>, val pending: Int)

/** Single-word vocab notes by word: "known" once a card of the note has been through review, else "deck". */
fun buildIndex(notes: List<Note>, cards: List<Card>): Map<String, String> {
    val reviewed = cards.filter { it.state == CardState.REVIEW }.map { it.noteId }.toSet()
    val out = HashMap<String, String>()
    for (n in notes) {
        if (n.type != "vocab") continue
        val w = n.fields["word"].str().lowercase()
        if (w.isEmpty() || w.any { it.isWhitespace() }) continue
        if (out[w] != "known") out[w] = if (n.id in reviewed) "known" else "deck"
    }
    return out
}

private val WORD = Regex("[A-Za-z]+(?:['\u2019][A-Za-z]+)?")

/** Lower-case key: "Company's" -> "company", "don't" -> "do". */
fun keyOf(raw: String): String {
    val lower = raw.lowercase().replace('\u2019', '\'')
    if (lower.endsWith("n't")) return if (lower == "can't") "can" else if (lower == "won't") "will" else lower.dropLast(3)
    return lower.replace(Regex("'(?:s|re|ve|ll|d|m)$"), "")
}

private fun forms(key: String): List<String> = listOf(key) + baseForms(key, IRREGULAR)

private val SENTENCE_END = Regex("[.!?:;\\n\u2022*]")
private val SKIP_BEFORE = Regex("[\\s\u00A0\"'\u201C\u2018(\\[\\-\u2013\u2014]")
private val ABBREV = Regex("\\b(?:mr|mrs|ms|dr|prof|inc|corp|ltd|co|st|jr|sr|vs|no|dept|a\\.m|p\\.m)$", RegexOption.IGNORE_CASE)
private val LIST_MARKER = Regex("(?:^|\\n)\\s*[\\w]{1,2}[.)]\\s*$")

private fun startsSentence(text: String, at: Int): Boolean {
    var i = at - 1
    // A word that begins a line begins a sentence (emails, lists, headings).
    while (i >= 0 && SKIP_BEFORE.matches(text[i].toString())) {
        if (text[i] == '\n') return true
        i--
    }
    if (i < 0) return true
    if (text[i] == '.' && ABBREV.containsMatchIn(text.substring(maxOf(0, i - 5), i))) return false
    if (SENTENCE_END.matches(text[i].toString())) return true
    // "1." / "a)" list markers
    return (text[i] in '0'..'9' || text[i] == ')') && LIST_MARKER.containsMatchIn(text.substring(maxOf(0, at - 6), at))
}

/** A line where most words are capitalised is a heading: capitals there say nothing about proper nouns. */
private fun headingLines(text: String): List<IntRange> {
    val out = mutableListOf<IntRange>()
    var pos = 0
    for (line in text.split("\n")) {
        val words = WORD.findAll(line).map { it.value }.toList()
        if (words.size >= 2 && !Regex("[.,;:!?]\\s*$").containsMatchIn(line) && words.count { it[0] in 'A'..'Z' }.toDouble() / words.size >= 0.6) out += pos until pos + line.length
        pos += line.length + 1
    }
    return out
}

fun analyze(text: String, index: Map<String, String>, ignored: Set<String> = emptySet()): Analysis {
    val heads = headingLines(text)
    val tokens = mutableListOf<Tok>()
    for (m in WORD.findAll(text)) {
        val raw = m.value
        val start = m.range.first
        val key = keyOf(raw)
        val inHeading = heads.any { start in it }
        val acronym = raw.length >= 2 && raw == raw.uppercase() && raw.length <= 6 && key !in COMMON
        val proper = raw[0] in 'A'..'Z' && !inHeading && !startsSentence(text, start)
        val kind = if (key.length < 2 && key != "a" && key != "i") Kind.SKIP
        else if (acronym || proper) Kind.SKIP
        else {
            val fs = forms(key)
            val deck = fs.firstNotNullOfOrNull { index[it] }
            when {
                fs.any { it in COMMON } -> Kind.COMMON
                deck == "known" -> Kind.KNOWN
                key in ignored -> Kind.IGNORED
                deck == "deck" -> Kind.DECK
                else -> Kind.UNKNOWN
            }
        }
        tokens += Tok(start, start + raw.length, raw, key, kind)
    }
    val counted = tokens.filter { it.kind != Kind.SKIP }
    // A word in the deck that has not been learned yet is not covered: the learner would still stumble on it.
    val covered = counted.count { it.kind == Kind.COMMON || it.kind == Kind.KNOWN || it.kind == Kind.IGNORED }
    val uniq = LinkedHashMap<String, UnknownWord>()
    val pending = HashSet<String>()
    for (t in counted) {
        if (t.kind == Kind.DECK) pending += t.key
        if (t.kind != Kind.UNKNOWN) continue
        val u = uniq[t.key]
        uniq[t.key] = if (u != null) u.copy(count = u.count + 1) else UnknownWord(t.key, 1, t)
    }
    return Analysis(tokens, counted.size, covered, if (counted.isEmpty()) null else covered.toDouble() / counted.size, uniq.values.toList(), pending.size)
}

/** The sentence of [text] that contains [at], trimmed, at most [max] characters. */
fun sentenceAround(text: String, at: Int, max: Int = 300): String {
    var a = at
    while (a > 0 && text[a - 1] !in ".!?\n") a--
    var b = at
    while (b < text.length && text[b] !in ".!?\n") b++
    if (b < text.length && text[b] in ".!?") b++
    val s = text.substring(a, b).replace(Regex("\\s+"), " ").trim()
    if (s.length <= max) return s
    // Too long: keep a window around the word, on word boundaries.
    val rel = at - a
    val from = maxOf(0, rel - max / 2)
    return s.substring(from, minOf(s.length, from + max)).replace(Regex("^\\S*\\s"), "").replace(Regex("\\s\\S*$"), "").trim()
}
