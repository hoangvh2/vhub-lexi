package com.vh.lexi.core

import java.text.Normalizer
import java.time.Instant

/** Tag that ties cards to the test they came from: "Test 1 TOEIC NEW 2026" -> "de-test-1-toeic-new-2026". Port of testTag in web/src/lib/practice.ts. */
fun testTag(name: String): String {
    val slug = Normalizer.normalize(name, Normalizer.Form.NFD)
        .replace(Regex("[̀-ͯ]"), "")
        .replace(Regex("[đĐ]"), "d")
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .replace(Regex("^-+|-+$"), "")
        .take(28)
        .replace(Regex("-+$"), "")
    return "de-${slug.ifEmpty { "khac" }}"
}

/** Name of the most recent test result (by date, then by creation), or null. Results are entered on the web app and sync here. */
fun latestTestName(notes: List<Note>): String? =
    notes.filter { it.type == "test" && it.fields["name"].str().isNotEmpty() }
        .maxWithOrNull(compareBy<Note>({ it.fields["date"].str().ifEmpty { Instant.ofEpochMilli(it.createdAt).toString().take(10) } }, { it.createdAt }))
        ?.fields?.get("name").str().ifEmpty { null }
