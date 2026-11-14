package com.vh.lexi.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays shared/vectors/testset.json (made by web/test/testset-vectors.ts): Bộ đề helpers, PDF text order, audio split. */
class TestSetVectorsTest {
    private val v = JSONObject(vectors("testset.json"))

    private fun JSONArray.ints(): List<Int> = List(length()) { getInt(it) }
    private fun pairsJson(m: Map<Int, String>) = JSONArray(m.map { (n, l) -> JSONArray().put(n).put(l) })
    private fun page(o: JSONObject) = PdfPage(o.getInt("n"), o.getString("text"), o.getBoolean("scanned"))
    private fun assertJson(expected: Any, actual: Any, what: String) {
        val same = when (expected) {
            is JSONObject -> actual is JSONObject && expected.similar(actual)
            is JSONArray -> actual is JSONArray && expected.similar(actual)
            else -> expected == actual
        }
        assertTrue(same, "$what\nexpected: $expected\nactual:   $actual")
    }
    private fun nullable(o: JSONObject, k: String): Any? = if (o.isNull(k)) null else o.get(k)
    private fun extracted(o: JSONObject): Extracted = extractedFrom(o.toMap())
    private fun score(s: Score?): Any = s?.let { JSONObject().put("right", it.right).put("total", it.total) } ?: JSONObject.NULL
    private fun scores(m: Map<String, Score?>) = JSONObject().apply { m.forEach { (k, s) -> put(k, score(s)) } }

    private fun setOf(o: JSONObject): TestSet = TestSet(
        id = "x", name = "x", createdAt = 1, updatedAt = 1, section = "rc", source = SetSource("f", 1), passages = emptyList(),
        questions = o.getJSONArray("questions").objects().map(::setQuestionFromJson),
        attempt = o.optJSONObject("attempt")?.let(::attemptFromJson),
        parts = o.optJSONObject("parts")?.let { ps -> ps.keys().asSequence().associate { k -> k.toInt() to attemptFromJson(ps.getJSONObject(k)) } } ?: emptyMap(),
    )
    private fun attemptJson(a: Attempt?): Any = a?.toJson() ?: JSONObject.NULL
    private fun partsJson(set: TestSet): Any = if (set.parts.isEmpty()) JSONObject.NULL else JSONObject().apply { set.parts.toSortedMap().forEach { (k, a) -> put(k.toString(), a.toJson()) } }
    private fun other(c: JSONObject, k: String): Pair<Any, Any> = (if (c.getJSONObject(k).has("parts")) c.getJSONObject(k).getJSONObject("parts") else JSONObject.NULL) to
        (if (c.getJSONObject(k).has("attempt")) c.getJSONObject(k).getJSONObject("attempt") else JSONObject.NULL)

    @Test
    fun onePartAtATime() {
        val cases = v.getJSONArray("scopes").objects()
        assertTrue(cases.size >= 5)
        for (c in cases) {
            val set = setOf(c.getJSONObject("set"))
            assertEquals(c.getJSONArray("parts").ints(), partsOf(set.questions), "partsOf")
            val states = c.getJSONArray("states").objects()
            assertEquals(states.size, partStates(set).size)
            for ((e, a) in states.zip(partStates(set))) {
                assertEquals(e.getInt("part"), a.part)
                assertEquals(e.getInt("total"), a.total)
                assertEquals(e.getInt("answered"), a.answered, "answered of part ${a.part}")
                assertEquals(e.getString("state"), a.state, "state of part ${a.part}")
                assertJson(e.get("score"), score(a.score), "score of part ${a.part}")
            }
            for (sc in c.getJSONArray("scopes").objects()) {
                val scope = if (sc.isNull("scope")) null else sc.getInt("scope")
                assertEquals(sc.getJSONArray("view").ints(), scopeQuestions(set.questions, scope).map { it.i }, "view $scope")
                assertJson(sc.get("attempt"), attemptJson(set.attemptOf(scope)), "attemptOf $scope")
            }
            assertEquals(listOf(null, 2, 5).map { scopeName("Test 1", it) }, c.getJSONArray("names").let { a -> List(a.length()) { a.getString(it) } })
            assertEquals(c.getJSONArray("canLog").let { a -> List(a.length()) { a.getBoolean(it) } }, listOf(null, 1, 4, 5, 7).map { canLogScope(it) })
            // Replacing or removing one scope's attempt leaves every other scope as it was.
            fun a(answers: Map<Int, String>, finished: Long? = null) = Attempt(1, 5000, answers, finished)
            for ((key, made) in listOf("set5" to set.withAttempt(5, a(mapOf(1 to "C"), 77)), "set0" to set.withAttempt(null, a(mapOf(2 to "D"))), "drop6" to set.withAttempt(6, null), "drop0" to set.withAttempt(null, null))) {
                val (parts, attempt) = other(c, key)
                assertJson(parts, partsJson(made), "$key parts")
                assertJson(attempt, attemptJson(made.attempt), "$key attempt")
            }
        }
    }

    @Test
    fun answerKeys() {
        for (c in v.getJSONArray("keys").objects()) {
            val text = c.getString("text")
            assertJson(c.getJSONArray("pairs"), pairsJson(keyPairs(text)), "keyPairs $text")
            assertEquals(c.getBoolean("isKey"), isKeyPage(text), "isKeyPage $text")
        }
        val f = v.getJSONObject("findKey")
        val r = findKey(f.getJSONArray("pages").objects().map(::page))
        assertJson(f.getJSONArray("key"), pairsJson(r.key), "findKey")
        assertEquals(f.getJSONArray("keyPages").ints(), r.keyPages)
    }

    @Test
    fun photoPages() {
        val cases = v.getJSONArray("photoPages").objects()
        assertTrue(cases.size >= 10)
        for (c in v.getJSONArray("photoSlots").objects()) {
            val pics = c.getJSONArray("pictures").objects().map { it.optJSONArray("numbers")?.ints() ?: emptyList() }
            assertEquals(c.getJSONArray("out").ints(), photoSlots(pics, c.getJSONArray("part1").ints()), c.toString())
        }
        for (c in v.getJSONArray("photoNumbers").objects()) {
            val r = if (c.isNull("p1")) null else c.getJSONArray("p1").let { it.getInt(0)..it.getInt(1) }
            assertEquals(c.getJSONArray("out").ints(), photoNumbers(c.getString("text"), r), c.toString())
        }
        for (c in cases) assertEquals(c.getJSONArray("out").ints(), findPhotoPages(c.getJSONArray("pages").objects().map(::page)), c.getJSONArray("pages").toString())
    }

    @Test
    fun pagesAndChunks() {
        for (c in v.getJSONArray("pageRanges").objects()) {
            val out = parsePageRange(c.getString("text"), c.getInt("numPages"))
            assertEquals(if (c.isNull("out")) null else c.getJSONArray("out").ints(), out, "parsePageRange '${c.getString("text")}'")
        }
        for (c in v.getJSONArray("formatPages").objects()) assertEquals(c.getString("out"), formatPages(c.getJSONArray("pages").ints()))
        for (c in v.getJSONArray("numbersIn").objects()) assertEquals(c.getJSONArray("out").ints(), numbersIn(c.getString("text")), c.getString("text"))
        for (c in v.getJSONArray("chunks").objects()) {
            val out = chunkPages(c.getJSONArray("pages").objects().map(::page), c.getJSONArray("skip").ints().toSet())
            val json = JSONArray(out.map {
                when (it) {
                    is Chunk.Text -> JSONObject().put("kind", "text").put("pages", JSONArray(it.pages)).put("text", it.text)
                    is Chunk.Images -> JSONObject().put("kind", "images").put("pages", JSONArray(it.pages))
                }
            })
            assertJson(c.getJSONArray("out"), json, "chunkPages")
        }
        for (c in v.getJSONArray("keyNotes").objects()) {
            val key = LinkedHashMap<Int, String>()
            c.getJSONArray("key").let { a -> for (k in 0 until a.length()) key[a.getJSONArray(k).getInt(0)] = a.getJSONArray(k).getString(1) }
            val numbers = c.get("numbers").let { if (it is JSONArray) it.ints() else null }
            assertEquals(c.getString("out"), keyNote(key, numbers))
        }
    }

    @Test
    fun partsRangesTracksLetters() {
        for (k in 0 until v.getJSONArray("parts").length()) {
            val p = v.getJSONArray("parts").getJSONArray(k)
            assertEquals(if (p.isNull(1)) null else p.getInt(1), partOfNumber(if (p.isNull(0)) null else p.getInt(0)), "part ${p.get(0)}")
        }
        for (c in v.getJSONArray("lcParts").objects()) {
            val n = nullable(c, "n") as Int?
            assertEquals(nullable(c, "default"), lcPartOfNumber(n), "lc default $n")
            assertEquals(nullable(c, "custom"), lcPartOfNumber(n, LcLayout(1..2, 3..5)), "lc custom $n")
            assertEquals(nullable(c, "none"), lcPartOfNumber(n, LcLayout(null, null)), "lc none $n")
        }
        for (c in v.getJSONArray("numberRanges").objects()) {
            val expected = when (val o = c.get("out")) {
                JSONObject.NULL -> NumberRange.None
                "invalid" -> NumberRange.Invalid
                else -> (o as JSONArray).let { NumberRange.Of(it.getInt(0)..it.getInt(1)) }
            }
            assertEquals(expected, parseNumberRange(c.getString("text")), "range '${c.getString("text")}'")
        }
        for (c in v.getJSONArray("listen").objects()) {
            val l = c.getJSONObject("layout")
            fun r(k: String) = if (l.isNull(k)) null else l.getJSONArray(k).let { it.getInt(0)..it.getInt(1) }
            val key = c.getJSONArray("key").let { a -> (0 until a.length()).associate { a.getJSONArray(it).getInt(0) to a.getJSONArray(it).getString(1) } }
            val out = listenQuestions(LcLayout(r("p1"), r("p2")), key)
            // TypeScript leaves `i` to the caller.
            assertJson(c.getJSONArray("out"), JSONArray(out.map { it.toJson().apply { remove("i") } }), "listenQuestions")
        }
        for (c in v.getJSONArray("tracks").objects()) assertEquals(c.getJSONArray("out").strings(), sortTracks(c.getJSONArray("names").strings()) { it })
        for (c in v.getJSONArray("letters").objects()) {
            val o = c.getJSONObject("options")
            assertEquals(c.getJSONArray("out").strings(), lettersOf(LETTERS.associateWith { o.getString(it) }, c.optInt("choices").takeIf { c.has("choices") }))
        }
    }

    @Test
    fun mergeGradeAndCards() {
        for (c in v.getJSONArray("merges").objects()) {
            val name = c.getString("name")
            val key = LinkedHashMap<Int, String>()
            c.getJSONArray("key").let { a -> for (k in 0 until a.length()) key[a.getJSONArray(k).getInt(0)] = a.getJSONArray(k).getString(1) }
            val lc = c.optJSONObject("lc")?.let { l -> LcLayout(l.getJSONArray("p1").let { it.getInt(0)..it.getInt(1) }, l.getJSONArray("p2").let { it.getInt(0)..it.getInt(1) }) }
            val set = mergeExtracted(c.getJSONArray("results").objects().map(::extracted), key, lc)
            val expected = c.getJSONObject("set")
            assertJson(expected.getJSONArray("questions"), JSONArray(set.questions.map { it.toJson() }), "$name: questions")
            assertJson(expected.getJSONArray("passages"), JSONArray(set.passages.map { JSONObject().put("label", it.label).put("text", it.text).put("truncated", it.truncated) }), "$name: passages")

            val s = summary(set.questions)
            assertJson(c.getJSONObject("summary"), JSONObject().put("total", s.total).put("byPart", JSONObject(s.byPart)).put("noAnswer", s.noAnswer).put("missing", JSONArray(s.missing)), "$name: summary")

            val a = c.getJSONObject("answers")
            val answers = a.keys().asSequence().associate { it.toInt() to a.getString(it) }
            val g = grade(set.questions, answers)
            val gj = JSONObject().put("parts", scores(g.parts)).put("lcParts", scores(g.lcParts)).put("lc", score(g.lc)).put("ungraded", g.ungraded)
                .put("right", g.right).put("total", g.total).put("wrong", JSONArray(g.wrong))
            assertJson(c.getJSONObject("graded"), gj, "$name: graded")
            assertJson(c.getJSONObject("fields"), JSONObject(resultFields(name, "2026-11-10", g, 30 * 60_000L + 29_999)), "$name: fields")

            val w = wrongDrafts(set.questions, set.passages, g, c.getJSONArray("existing").strings().toSet())
            val wj = JSONObject()
                .put("drafts", JSONArray(w.drafts.map { JSONObject().put("key", it.key).put("number", it.number ?: JSONObject.NULL).put("include", it.include).put("correct", it.correct ?: JSONObject.NULL).put("stem", it.stem) }))
                .put("skipped", w.skipped)
                .put("passages", JSONArray(w.passages.map { JSONObject().put("id", it.id).put("label", it.label).put("text", it.text).put("truncated", it.truncated) }))
            assertJson(c.getJSONObject("wrong"), wj, "$name: wrongDrafts")
        }
        for (c in v.getJSONArray("resultFields").objects()) {
            assertJson(c.getJSONObject("out"), JSONObject(resultFields(c.getString("name"), "2026-01-02", grade(emptyList(), emptyMap()), c.getLong("ms"))), "resultFields")
        }
    }

    @Test
    fun reflowAndLayout() {
        for (c in v.getJSONArray("reflow").objects()) assertEquals(c.getString("out"), reflow(c.getString("text")))
        for (c in v.getJSONArray("layouts").objects()) {
            val items = c.getJSONArray("items").objects().map { TextItem(it.getString("str"), it.getDouble("x"), it.getDouble("y"), it.getDouble("w"), it.getDouble("h")) }
            assertEquals(c.getString("out"), layoutText(items, c.getDouble("width")))
        }
    }

    @Test
    fun audioSplit() {
        val a = v.getJSONObject("audio")
        val frame = a.getJSONObject("frame")
        val samples = frame.getJSONArray("samples").let { s -> FloatArray(s.length()) { s.getDouble(it).toFloat() } }
        val levels = AudioSplit.frameLevels(samples, frame.getInt("rate"))
        val expected = frame.getJSONArray("levels")
        assertEquals(expected.length(), levels.size)
        for (k in levels.indices) assertEquals(expected.getDouble(k).toFloat(), levels[k], 1e-4f, "frame $k")

        fun gaps(arr: JSONArray?) = arr?.let { g -> List(g.length()) { g.getJSONArray(it).getLong(0) to g.getJSONArray(it).getLong(1) } }
        for (c in a.getJSONArray("gaps").objects()) {
            val lv = c.getJSONArray("levels").let { l -> FloatArray(l.length()) { l.getDouble(it).toFloat() } }
            assertEquals(gaps(c.getJSONArray("out")), AudioSplit.findGaps(lv, c.getInt("frameMs"), c.getInt("minMs")))
        }
        for (c in a.getJSONArray("spans").objects()) {
            assertEquals(gaps(c.optJSONArray("out")), AudioSplit.questionSpans(gaps(c.getJSONArray("gaps"))!!, c.getLong("durationMs"), c.getInt("count")), "spans $c")
        }
        for (c in a.getJSONArray("place").objects()) {
            val tracks = c.getJSONArray("tracks").objects().map { AudioSplit.TrackLevels(gaps(it.getJSONArray("gaps"))!!, it.getLong("durationMs")) }
            val parts = c.getJSONArray("parts").let { p -> List(p.length()) { if (p.isNull(it)) null else p.getInt(it) } }
            val out = c.getJSONArray("out").let { o -> List(o.length()) { if (o.isNull(it)) null else o.getJSONObject(it).let { x -> Clip(x.getInt("track"), x.getLong("from"), x.getLong("to")) } } }
            assertEquals(out, AudioSplit.placeQuestions(tracks, parts), "place $c")
        }
        for (k in 0 until a.getJSONArray("mmss").length()) {
            val p = a.getJSONArray("mmss").getJSONArray(k)
            assertEquals(p.getString(1), AudioSplit.mmss(p.getLong(0)))
        }
    }

    @Test
    fun storedSetRoundTrips() {
        val c = v.getJSONArray("merges").objects().last()
        val q = c.getJSONObject("set").getJSONArray("questions").objects().map(::setQuestionFromJson)
        val set = TestSet(
            "s1", "Đề 1", 1, 2, "lc", SetSource("a.pdf", 4, "1-3"), listOf(SetPassage("P", "t", false)),
            q.mapIndexed { i, x -> if (i == 0) x.copy(clip = Clip(0, 100, 900), track = 0) else x },
            listOf(SetTrack("s1:a0", "01.mp3", 1234)), listOf(SetPicture(1, 1, "s1:p1")), Attempt(5, 60_000, mapOf(0 to "A", 3 to "C"), 9, "n1"),
        )
        assertEquals(set, testSetFromJson(JSONObject(set.toJson().toString())))
    }
}
