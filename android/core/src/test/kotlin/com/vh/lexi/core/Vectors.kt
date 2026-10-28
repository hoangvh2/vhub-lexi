package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject

/** Loads a reference vector file produced by the TypeScript implementation. */
fun vectors(name: String): String =
    object {}.javaClass.getResourceAsStream("/$name")?.bufferedReader()?.readText() ?: error("missing vector file $name")

fun JSONArray.objects(): List<JSONObject> = List(length()) { getJSONObject(it) }
fun JSONArray.strings(): List<String> = List(length()) { getString(it) }

fun JSONObject.optLongOrNull(k: String): Long? = if (has(k) && !isNull(k)) getLong(k) else null

fun cardFromJson(o: JSONObject) = Card(
    id = o.getString("id"), noteId = o.getString("noteId"), deckId = o.getString("deckId"), template = o.getString("template"),
    state = o.getInt("state"), due = o.getLong("due"), stability = o.getDouble("stability"), difficulty = o.getDouble("difficulty"),
    scheduledDays = o.getDouble("scheduledDays"), learningSteps = o.getInt("learningSteps"), reps = o.getInt("reps"), lapses = o.getInt("lapses"),
    lastReview = o.optLongOrNull("lastReview"), suspended = o.optBoolean("suspended", false), createdAt = o.getLong("createdAt"), updatedAt = o.getLong("updatedAt"),
)

fun noteFromJson(o: JSONObject): Note {
    val f = o.getJSONObject("fields")
    val fields = f.keys().asSequence().associateWith { k ->
        val v = f.get(k)
        if (v is JSONArray) FieldValue.Items(v.strings()) else FieldValue.Text(v as String)
    }
    return Note(
        id = o.getString("id"), type = o.getString("type"), deckId = o.getString("deckId"), fields = fields,
        createdAt = o.getLong("createdAt"), updatedAt = o.getLong("updatedAt"),
    )
}

fun layoutFromJson(o: JSONObject) = CardLayout(
    o.getBoolean("showIpa"), o.getBoolean("showPos"), o.getBoolean("showEn"), o.getBoolean("showVi"), o.getBoolean("showExamples"), o.getBoolean("showMnemonic"),
)

/** Same JSON shape the TypeScript templates produce. */
fun Block.toJson(): JSONObject = when (this) {
    is Block.Title -> JSONObject().put("k", "title").put("text", text)
    is Block.Ipa -> JSONObject().put("k", "ipa").put("text", text)
    is Block.Speak -> JSONObject().put("k", "speak").put("text", text)
    is Block.Badge -> JSONObject().put("k", "badge").put("text", text)
    is Block.Text -> JSONObject().put("k", "text").put("text", text).also { if (tone != null) it.put("tone", tone) }
    is Block.Quote -> JSONObject().put("k", "quote").put("text", text)
}

/** Order-insensitive JSON comparison without relying on org.json's similar() number quirks. */
fun JSONObject.canon(): String = keySet().sorted().joinToString(",", "{", "}") { k ->
    val v = get(k)
    "\"$k\":" + when (v) {
        is JSONObject -> v.canon()
        is JSONArray -> v.objectsOrScalars()
        else -> JSONObject.quote(v.toString())
    }
}

private fun JSONArray.objectsOrScalars(): String = (0 until length()).joinToString(",", "[", "]") { i ->
    when (val v = get(i)) {
        is JSONObject -> v.canon()
        is JSONArray -> v.objectsOrScalars()
        else -> JSONObject.quote(v.toString())
    }
}
