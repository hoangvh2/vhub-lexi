package com.vh.lexi.core

import java.text.Normalizer

/**
 * Words a learner can mix up with the one under review, found in the learner's own notes
 * (port of shared/confusables.ts; shared/vectors/confusables.json pins the behaviour).
 *
 * Two notes are confusable when their Vietnamese meanings share a phrase (convince, persuade: "thuyết phục"),
 * or when the words share a long prefix (persuade, persuasion).
 */
data class Confusable(
    val noteId: String,
    val word: String,
    val pos: String,
    val vi: String,
    val en: String,
    /** "meaning": a Vietnamese meaning phrase in common; "spelling": a long common prefix. */
    val reason: String,
)

// Nominalisers and adverb markers that turn one meaning into another part of speech: "sự thuyết phục" ~ "thuyết phục".
private val VI_PREFIXES = listOf("một cách ", "sự ", "việc ", "cuộc ", "tính ")
private val PARENS = Regex("\\([^)]*\\)")
private val PUNCT = Regex("[.…!?\"“”]")
private val SPACES = Regex("\\s+")

/** The distinct meaning phrases of a Vietnamese meaning line: split on ; , /, without parentheses or nominalisers. */
fun meaningPhrases(vi: String): List<String> {
    val out = mutableListOf<String>()
    val text = PARENS.replace(Normalizer.normalize(vi, Normalizer.Form.NFC).lowercase(), " ")
    for (raw in text.split(';', ',', '/')) {
        var p = SPACES.replace(PUNCT.replace(raw, " "), " ").trim()
        for (pre in VI_PREFIXES) {
            if (p.startsWith(pre) && p.length > pre.length + 1) {
                p = p.substring(pre.length).trim()
                break
            }
        }
        if (p.length >= 2 && p !in out) out.add(p)
    }
    return out
}

private fun commonPrefix(a: String, b: String): Int {
    var i = 0
    while (i < a.length && i < b.length && a[i] == b[i]) i++
    return i
}

/** persuade/persuasion, important/importance: single words sharing all but their last two or three letters. */
private fun similarSpelling(a: String, b: String): Boolean {
    if (' ' in a || ' ' in b) return false
    return commonPrefix(a, b) >= maxOf(5, minOf(a.length, b.length) - 2)
}

/**
 * Notes of the same type whose word can be mistaken for [note]'s word, most likely first:
 * shared meaning phrases (more shared first), then similar spelling, then alphabetical.
 */
fun confusables(note: Note, notes: List<Note>): List<Confusable> {
    val word = normalizeAnswer(note.fields["word"].str())
    if (word.isEmpty()) return emptyList()
    val mine = meaningPhrases(note.fields["vi"].str())
    val found = mutableListOf<Pair<Confusable, Int>>()
    val seen = mutableSetOf<String>()
    for (o in notes) {
        if (o.id == note.id || o.type != note.type) continue
        val w = normalizeAnswer(o.fields["word"].str())
        if (w.isEmpty() || w == word || w in seen) continue
        val theirs = meaningPhrases(o.fields["vi"].str())
        val shared = mine.count { it in theirs }
        val reason = if (shared > 0) "meaning" else if (similarSpelling(word, w)) "spelling" else null
        if (reason == null) continue
        seen.add(w)
        found.add(Confusable(o.id, o.fields["word"].str(), o.fields["pos"].str(), o.fields["vi"].str(), o.fields["en"].str(), reason) to shared)
    }
    return found.sortedWith(compareByDescending<Pair<Confusable, Int>> { it.second }.thenBy { it.first.word }).map { it.first }
}

/** The confusable word the learner typed (also as an inflected form: "persuaded" -> persuade), or null. */
fun matchConfusable(typed: String, list: List<Confusable>): Confusable? {
    val t = normalizeAnswer(typed)
    if (t.isEmpty()) return null
    val forms = listOf(t) + baseForms(t)
    return list.firstOrNull { normalizeAnswer(it.word) in forms }
}

/** Letters in an answer (spaces, hyphens and apostrophes are not letters). */
fun letterCount(answer: String): Int = answer.trim().codePoints().filter { Character.isLetter(it) }.count().toInt()

/**
 * The answer with only its first [shown] letters visible: answerHint("look after", 1) = "l___ _____".
 * Never shows every letter: at most all but the last.
 */
fun answerHint(answer: String, shown: Int): String {
    val a = answer.trim()
    val limit = maxOf(0, minOf(shown, letterCount(a) - 1))
    var n = 0
    val out = StringBuilder()
    a.codePoints().forEach { cp ->
        if (Character.isLetter(cp)) {
            if (n < limit) out.appendCodePoint(cp) else out.append('_')
            n++
        } else out.appendCodePoint(cp)
    }
    return out.toString()
}

/**
 * Suggested rating for a typed answer, given how much help the learner needed: extra hint letters beyond the
 * first, or a second try after typing a confusable word, cap a correct answer at "Hard".
 */
fun suggestedRatingWith(v: Verdict, extraHints: Int, retried: Boolean): Int {
    val r = suggestedRating(v)
    return if (r == 3 && (extraHints > 0 || retried)) 2 else r
}
