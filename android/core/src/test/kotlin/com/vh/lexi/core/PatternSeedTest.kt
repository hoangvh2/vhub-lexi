package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PatternSeedTest {
    private fun blocks(a: JSONArray) = JSONArray(a.objects().map { it.canon() }).toString()
    private fun mine(b: List<Block>) = JSONArray(b.map { it.toJson().canon() }).toString()

    @Test
    fun `pattern sentences are read like the web app`() {
        val root = JSONObject(vectors("patterns.json"))
        for (c in root.getJSONArray("items").objects()) {
            val line = c.getString("line")
            val it = parsePatternItem(line)
            if (c.isNull("item")) {
                assertNull(it, line)
                continue
            }
            val w = c.getJSONObject("item")
            assertEquals(w.getString("sentence"), it!!.sentence, line)
            assertEquals(w.getString("answer"), it.answer, line)
            assertEquals(w.getJSONArray("at").let { a -> a.getInt(0) to a.getInt(1) }, it.at, line)
            assertEquals(w.getString("blanked"), it.blanked, line)
            assertEquals(w.getJSONArray("wrong").strings(), it.wrong, line)
            assertEquals(w.getString("vi"), it.vi, line)
            assertEquals(c.getJSONArray("options").strings(), patternOptions(it), line)
        }
    }

    @Test
    fun `pattern cards render and rotate like the web app`() {
        val root = JSONObject(vectors("patterns.json"))
        val layout = CardLayout()
        for ((i, c) in root.getJSONArray("cases").objects().withIndex()) {
            val note = noteFromJson(c.getJSONObject("note"))
            val tid = c.getString("template")
            val reps = c.getInt("reps")
            val where = "case $i ${note.id} $tid reps $reps"
            val t = template("pattern", tid)!!
            val v = studyNote(note, tid, reps)
            assertEquals(c.getJSONArray("items").strings(), v.fields["items"].items(), "$where items")
            assertEquals(c.getBoolean("applies"), t.applies(v), "$where applies")
            if (!c.getBoolean("applies")) continue
            assertEquals(c.getString("mode"), t.mode.name.lowercase(), "$where mode")
            assertEquals(blocks(c.getJSONArray("front")), mine(t.front(v, layout)), "$where front")
            assertEquals(blocks(c.getJSONArray("back")), mine(t.back(v, layout)), "$where back")
            assertEquals(c.getJSONArray("expected").strings(), t.expected(v), "$where expected")
            assertEquals(if (c.isNull("speakBack")) null else c.getString("speakBack"), t.speakBack(v), "$where speakBack")
        }
        for (w in root.getJSONArray("wanted").objects()) {
            val id = w.getString("noteId")
            val note = root.getJSONArray("cases").objects().first { it.getJSONObject("note").getString("id") == id }.getJSONObject("note").let(::noteFromJson)
            assertEquals(w.getJSONArray("wanted").strings(), wantedTemplates(note, null), "$id wanted")
            assertEquals(w.getJSONArray("wantedDefault").strings(), wantedTemplates(note, Prefs().templates), "$id wantedDefault")
        }
    }

    @Test
    fun `seed plans match the web app`() {
        val root = JSONObject(vectors("seed.json"))
        val pack = seedPackFromJson(root.getJSONObject("pack").toString())
        for ((i, p) in root.getJSONArray("plans").objects().withIndex()) {
            val st = p.getJSONObject("state")
            val plan = planSeed(pack, SeedState(st.getInt("applied"), st.getJSONArray("noteIds").strings().toSet(), st.getBoolean("deckExists")))
            if (p.isNull("plan")) {
                assertNull(plan, "plan $i")
                continue
            }
            val want = p.getJSONObject("plan")
            assertEquals(want.getInt("version"), plan!!.version, "plan $i version")
            if (want.isNull("deck")) assertNull(plan.deck, "plan $i deck")
            else want.getJSONObject("deck").let { d -> assertEquals(Deck(d.getString("id"), d.getString("name"), null, d.getLong("createdAt"), d.getLong("updatedAt")), plan.deck, "plan $i deck") }
            val notes = want.getJSONArray("notes").objects()
            assertEquals(notes.map { it.getString("id") }, plan.notes.map { it.id }, "plan $i ids")
            for ((w, n) in notes.zip(plan.notes)) {
                assertEquals(noteFromJson(w).copy(tags = w.optJSONArray("tags")?.strings() ?: emptyList()), n, "plan $i note ${n.id}")
            }
        }
        for (r in root.getJSONArray("ranges")) {
            val a = r as JSONArray
            assertEquals(a.getJSONArray(1).let { it.getString(0) to it.getString(1) }, seedIdRange(a.getString(0)))
        }
    }

    @Test
    fun `the shipped grammar pack makes cards for every note`() {
        val text = javaClass.getResourceAsStream("/grammar-toeic.json")?.bufferedReader()?.readText() ?: error("missing seed pack")
        val pack = seedPackFromJson(text)
        assertTrue(pack.notes.size >= 50, "pack has ${pack.notes.size} notes")
        val plan = planSeed(pack, SeedState(0, emptySet(), false))!!
        for (n in plan.notes) {
            assertEquals(listOf("fill", "rule"), wantedTemplates(n, Prefs().templates), n.id)
            assertTrue(patternItems(n).size >= 3, n.id)
            assertTrue(template("pattern", "spot")!!.applies(n), n.id)
        }
    }
}
