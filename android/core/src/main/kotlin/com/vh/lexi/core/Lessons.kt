package com.vh.lexi.core

/**
 * Lesson tags as people read them (web/src/lib/lessons.ts). Anki decks and the importer give machine-looking tags
 * ("05-conferences", "lesson-12"); the screens show a number and a title instead ("05", "Conferences").
 */

/** Tags that look like a lesson of a course (numbered or named lesson/unit/chapter), as opposed to topic tags. */
fun isLesson(t: String) = Regex("^(\\d|lesson|bai|unit|chapter)", RegexOption.IGNORE_CASE).containsMatchIn(t)

/** [num] is "05", or null when the tag carries no number. */
data class LessonName(val num: String?, val title: String)

private val LESSON = Regex("^(?:(?:lesson|bai|unit|chapter)[\\s_-]*)?(\\d+)(?:[\\s._-]+(.*))?$", RegexOption.IGNORE_CASE)

fun lessonName(tag: String): LessonName {
    // The importer slugs "Doctor's office" to "doctor-s-office": put the apostrophe back.
    fun words(s: String) = s.replace(Regex("([a-zA-Z])[_-]s(?=[_-]|$)"), "$1's").replace(Regex("[_-]+"), " ").replace(Regex("\\s+"), " ").trim()
    fun cap(s: String) = s.replaceFirstChar { it.uppercase() }
    val m = LESSON.find(tag.trim()) ?: return LessonName(null, cap(words(tag)))
    val n = m.groupValues[1]
    val rest = words(m.groupValues[2])
    return LessonName(n.padStart(2, '0'), if (rest.isNotEmpty()) cap(rest) else "Bài ${n.toInt()}")
}

/** One line for pickers: "05 · Conferences". */
fun lessonTitle(tag: String): String = lessonName(tag).let { if (it.num != null) "${it.num} · ${it.title}" else it.title }
