package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FsrsVectorsTest {
    @Test
    fun `every scheduling scenario matches ts-fsrs answer by answer`() {
        val scenarios = JSONArray(vectors("fsrs.json")).objects()
        assertTrue(scenarios.size >= 8)
        for (s in scenarios) {
            val fsrs = Fsrs(retention = s.getDouble("retention"))
            val start = s.getLong("start")
            var card = Card(id = "n1.recognize", noteId = "n1", deckId = "d1", template = "recognize", due = start, createdAt = start, updatedAt = start)
            for ((i, step) in s.getJSONArray("steps").objects().withIndex()) {
                card = fsrs.next(card, step.getLong("at"), step.getInt("rating"))
                val e = step.getJSONObject("expect")
                val where = "${s.getString("name")} step $i"
                assertEquals(e.getInt("state"), card.state, "$where state")
                assertEquals(e.getLong("due"), card.due, "$where due")
                assertEquals(e.getDouble("stability"), card.stability, 1e-7, "$where stability")
                assertEquals(e.getDouble("difficulty"), card.difficulty, 1e-7, "$where difficulty")
                assertEquals(e.getDouble("scheduledDays"), card.scheduledDays, 0.0, "$where scheduledDays")
                assertEquals(e.getInt("learningSteps"), card.learningSteps, "$where learningSteps")
                assertEquals(e.getInt("reps"), card.reps, "$where reps")
                assertEquals(e.getInt("lapses"), card.lapses, "$where lapses")
                assertEquals(e.getLong("lastReview"), card.lastReview, "$where lastReview")
            }
        }
    }

    @Test
    fun `interval labels`() {
        assertEquals("<1p", Fsrs.formatInterval(30_000))
        assertEquals("10p", Fsrs.formatInterval(10 * 60_000L))
        assertEquals("3g", Fsrs.formatInterval(3 * 3_600_000L))
        assertEquals("3ng", Fsrs.formatInterval(3 * 86_400_000L))
        assertEquals("3th", Fsrs.formatInterval(90 * 86_400_000L))
    }
}

class TemplateVectorsTest {
    @Test
    fun `templates render the same blocks as the web app`() {
        val root = JSONObject(vectors("templates.json"))
        val layouts = root.getJSONArray("layouts").objects().map(::layoutFromJson)
        for ((n, c) in root.getJSONArray("cases").objects().withIndex()) {
            val note = noteFromJson(c.getJSONObject("note"))
            val layout = layouts[c.getInt("layoutIndex")]
            val per = c.getJSONObject("templates")
            for (id in listOf("recognize", "recall", "cloze")) {
                val e = per.getJSONObject(id)
                val t = template("vocab", id)!!
                val where = "case $n template $id"
                assertEquals(e.getBoolean("applies"), t.applies(note), "$where applies")
                if (!e.getBoolean("applies")) continue
                assertEquals(e.getString("mode"), t.mode.name.lowercase(), "$where mode")
                assertEquals(JSONArray(e.getJSONArray("front").objects().map { it.canon() }).toString(), JSONArray(t.front(note, layout).map { it.toJson().canon() }).toString(), "$where front")
                assertEquals(JSONArray(e.getJSONArray("back").objects().map { it.canon() }).toString(), JSONArray(t.back(note, layout).map { it.toJson().canon() }).toString(), "$where back")
                if (!e.isNull("expected")) assertEquals(e.getJSONArray("expected").strings(), t.expected(note), "$where expected")
                assertEquals(if (e.isNull("speakFront")) null else e.getString("speakFront"), t.speakFront(note), "$where speakFront")
                assertEquals(if (e.isNull("speakBack")) null else e.getString("speakBack"), t.speakBack(note), "$where speakBack")
            }
            val all = mapOf("vocab" to listOf("recognize", "recall", "cloze"))
            assertEquals(c.getJSONArray("wanted").strings(), wantedTemplates(note, all), "case $n wanted")
            assertEquals(c.getJSONArray("wantedDefault").strings(), wantedTemplates(note, Prefs().templates), "case $n wantedDefault")
        }
    }

    @Test
    fun `cloze and typed-answer checks match`() {
        val root = JSONObject(vectors("templates.json"))
        for (c in root.getJSONArray("clozes").objects()) {
            val r = clozeSentence(c.getString("sentence"), c.getString("word"))
            if (c.isNull("result")) assertNull(r, c.toString())
            else {
                assertEquals(c.getJSONObject("result").getString("text"), r?.text, c.toString())
                assertEquals(c.getJSONObject("result").getString("answer"), r?.answer, c.toString())
            }
        }
        for (c in root.getJSONArray("typed").objects()) {
            val exp = c.getJSONArray("expected").strings()
            assertEquals(c.getString("normalized"), normalizeAnswer(c.getString("typed")), c.toString())
            assertEquals(c.getString("verdict").uppercase(), checkTyped(c.getString("typed"), exp).name, c.toString())
        }
    }
}

class MorphyVectorsTest {
    @Test
    fun `base forms match`() {
        for (c in JSONArray(vectors("morphy.json")).objects()) {
            assertEquals(c.getJSONArray("forms").strings(), baseForms(c.getString("word")), c.getString("word"))
        }
    }
}

class QueueVectorsTest {
    @Test
    fun `queues and session order match the web app`() {
        for (s in JSONArray(vectors("queue.json")).objects()) {
            val inp = s.getJSONObject("input")
            val p = inp.getJSONObject("prefs")
            val prefs = Prefs(newPerDay = p.getInt("newPerDay"), maxReviewsPerDay = p.getInt("maxReviewsPerDay"), dayStartHour = p.getInt("dayStartHour"))
            val cards = s.getJSONArray("cards").objects().map(::cardFromJson)
            val today = if (inp.isNull("today")) null else Daily(id = "x", newCards = inp.getJSONObject("today").getLong("newCards"))
            val now = inp.getLong("now")
            val q = buildQueue(
                QueueInput(
                    cards = cards, eligible = { it.id != "ineligible" }, today = today, prefs = prefs, now = now,
                    deckId = if (inp.isNull("deckId")) null else inp.getString("deckId"), buried = inp.getJSONArray("buried").strings().toSet(),
                    learnAheadMs = inp.getLong("learnAheadMs"), zone = ZoneOffset.UTC,
                ),
            )
            val name = s.getString("name")
            assertEquals(s.getJSONArray("learning").strings(), q.learning.map { it.id }, "$name learning")
            assertEquals(s.getJSONArray("review").strings(), q.review.map { it.id }, "$name review")
            assertEquals(s.getJSONArray("newCards").strings(), q.newCards.map { it.id }, "$name new")
            val c = s.getJSONObject("counts")
            assertEquals(Counts(c.getInt("new"), c.getInt("learning"), c.getInt("review")), q.counts, "$name counts")

            val order = ArrayList<String>()
            var sess = SessionState()
            var rest = q
            repeat(20) {
                val next = pickNext(rest, sess, now) ?: return@repeat
                if (order.size > it) return@repeat
                order += next.id
                sess = SessionState(sess.shown + 1, sess.shownNew + if (next.state == CardState.NEW) 1 else 0)
                rest = Queue(rest.learning.filter { x -> x.id != next.id }, rest.review.filter { x -> x.id != next.id }, rest.newCards.filter { x -> x.id != next.id }, rest.counts)
            }
            assertEquals(s.getJSONArray("order").strings(), order, "$name order")
        }
    }
}
