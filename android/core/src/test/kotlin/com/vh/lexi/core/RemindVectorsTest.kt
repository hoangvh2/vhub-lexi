package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays shared/vectors/remind.json (made by web/test/remind-vectors.ts): the "Từ hay quên" reminder schedule. */
class RemindVectorsTest {
    private val v = JSONObject(vectors("remind.json"))
    private val notes = JSONObject(vectors("drill.json")).getJSONArray("notes").objects().map { o ->
        noteFromJson(o).copy(forgot = o.optJSONArray("forgot")?.strings() ?: emptyList(), forgotAt = o.optLongOrNull("forgotAt"))
    }

    private fun settings(o: JSONObject?): RemindSettings =
        if (o == null) cleanSettings(null, null, null, null)
        else cleanSettings(o.opt("on"), o.opt("perDay").takeIf { it is Number }, o.opt("start").takeIf { it is Number }, o.opt("end").takeIf { it is Number })

    private fun state(o: JSONObject): RemindState {
        val w = o.getJSONObject("words")
        return RemindState(w.keys().asSequence().associateWith { k -> w.getJSONObject(k).let { RemindWord(it.getInt("level"), it.getLong("next")) } }, o.getLong("lastSlot"))
    }

    private fun stateJson(s: RemindState): String {
        val w = JSONObject()
        for ((k, x) in s.words.toSortedMap()) w.put(k, JSONObject().put("level", x.level).put("next", x.next))
        return JSONObject().put("words", w).put("lastSlot", s.lastSlot).toString()
    }

    /** Same JSON compared as text with sorted keys. */
    private fun canon(o: JSONObject): String {
        val w = o.getJSONObject("words")
        return stateJson(state(JSONObject().put("words", w).put("lastSlot", o.getLong("lastSlot"))))
    }

    private fun longOrNull(o: JSONObject, k: String): Long? = if (o.isNull(k)) null else o.getLong(k)

    @Test
    fun settingsAndSlots() {
        for (c in v.getJSONArray("cleanSettings").objects()) {
            val got = settings(if (c.isNull("in")) null else c.getJSONObject("in"))
            val o = c.getJSONObject("out")
            assertEquals(RemindSettings(o.getBoolean("on"), o.getInt("perDay"), o.getInt("start"), o.getInt("end")), got, c.opt("in").toString())
        }
        for (c in v.getJSONArray("slotMinutes").objects()) {
            val expected = c.getJSONArray("out").let { a -> List(a.length()) { a.getInt(it) } }
            assertEquals(expected, slotMinutes(settings(c.getJSONObject("in"))))
        }
        val on = RemindSettings(true, 3, 480, 1290)
        for (c in v.getJSONArray("nextSlot").objects()) {
            val tz = c.getInt("tz"); val now = c.getLong("now")
            assertEquals(longOrNull(c, "out"), nextSlot(now, on, tz), "next $tz $now")
            assertEquals(longOrNull(c, "off"), nextSlot(now, on.copy(on = false), tz))
        }
        for (c in v.getJSONArray("dueSlot").objects()) {
            assertEquals(longOrNull(c, "out"), dueSlot(c.getLong("now"), on, c.getInt("tz"), c.getLong("lastSlot")), c.toString())
        }
    }

    @Test
    fun wordsAndState() {
        val t0 = v.getLong("t0")
        val h = 3_600_000L
        for (c in v.getJSONArray("pickWord").objects()) {
            assertEquals(if (c.isNull("out")) null else c.getString("out"), pickWord(notes, state(c.getJSONObject("state")), c.getLong("now"))?.id)
        }
        val st1 = afterShown(RemindState(), "n03", t0 + 3 * h, t0 + 3 * h)
        val st2 = afterShown(afterShown(st1, "n03", t0 + 30 * h, t0 + 30 * h), "n05", t0 + 31 * h, t0 + 31 * h)
        var st5 = RemindState()
        for (i in 0 until 6) st5 = afterShown(st5, "n01", t0 + i * 40 * 24 * h, t0 + i * 40 * 24 * h)
        val a = v.getJSONObject("afterShown")
        assertEquals(canon(a.getJSONObject("st1")), stateJson(st1))
        assertEquals(canon(a.getJSONObject("st2")), stateJson(st2))
        assertEquals(canon(a.getJSONObject("st5")), stateJson(st5))
        assertEquals(canon(v.getJSONObject("afterNotYet")), stateJson(afterNotYet(st5, "n01", t0 + 300 * 24 * h)))
        val sd = v.getJSONArray("suggestDone")
        listOf(st1, st2, st5).forEachIndexed { i, st ->
            val row = sd.getJSONArray(i)
            listOf("n01", "n03", "n05").forEachIndexed { j, id -> assertEquals(row.getBoolean(j), suggestDone(st, id), "$i $id") }
        }
        val pruneIn = RemindState(st2.words + mapOf("gone" to RemindWord(2, 5), "n02" to RemindWord(1, 9)), 77)
        assertEquals(canon(v.getJSONObject("prune")), stateJson(pruneState(pruneIn, notes)))
    }

    @Test
    fun messagesAndRestore() {
        for (c in v.getJSONArray("message").objects()) {
            val n = notes.first { it.id == c.getString("id") }
            for ((key, st) in listOf("plain" to RemindState(), "suggest" to RemindState(mapOf(n.id to RemindWord(5, 0))))) {
                val e = c.getJSONObject(key)
                assertEquals(RemindMessage(e.getString("title"), e.getString("prompt"), e.getString("answer")), remindMessage(n, st), "${n.id} $key")
            }
        }
        val r = v.getJSONArray("restore").objects()
        val got = listOf(
            restoreForgot(notes[0], emptyList(), null, 3000),
            restoreForgot(restoreForgot(notes[4], emptyList(), null, 3000), listOf(ForgotKind.MEANING, ForgotKind.SOUND), 700, 3100),
            restoreForgot(notes[1], listOf(ForgotKind.SOUND), null, 3200),
        )
        for ((e, n) in r.zip(got)) {
            assertEquals(e.optJSONArray("forgot")?.strings() ?: emptyList(), n.forgot, n.id)
            assertEquals(e.optLongOrNull("forgotAt"), n.forgotAt, n.id)
            assertEquals(e.getLong("updatedAt"), n.updatedAt)
        }
    }

    @Test
    fun simulatedMonths() {
        for (c in v.getJSONArray("simulate").objects()) {
            val s = settings(c.getJSONObject("settings"))
            val tz = c.getInt("tz")
            val notYet = c.getJSONArray("notYet").strings().toSet()
            val t0 = v.getLong("t0")
            val end = t0 + c.getInt("days") * 24 * 3_600_000L
            var st = RemindState()
            var now = t0
            val shows = JSONArray()
            while (true) {
                val t = nextSlot(now, s, tz) ?: break
                if (t > end) break
                now = t + 7 * 60_000L
                val slot = dueSlot(now, s, tz, st.lastSlot) ?: continue
                val n = pickWord(notes, st, now)
                if (n == null) { st = slotHandled(st, slot); shows.put(JSONArray().put(slot).put(JSONObject.NULL)); continue }
                st = afterShown(st, n.id, now, slot)
                if (n.id in notYet) st = afterNotYet(st, n.id, now + 60_000)
                shows.put(JSONArray().put(slot).put(n.id))
            }
            assertEquals(c.getJSONArray("shows").toString(), shows.toString(), "tz $tz")
            assertEquals(canon(c.getJSONObject("state")), stateJson(st))
        }
    }
}
