import { describe, expect, it } from "vitest";
import { CardState, type Card, type Note } from "@shared/model.ts";
import { NOTE_TYPES, clozeSentence, findExact, template, wantedTemplates } from "@shared/notetypes.ts";
import { completeSentence, notesByTestTag, parseScore, testResults, testTag, topCause, wrongTotal } from "../src/lib/practice.ts";
import { analyze, buildIndex, sentenceAround } from "../src/lib/readcheck.ts";

const note = (id: string, type: string, fields: Note["fields"], tags?: string[]): Note => ({ id, type, deckId: "d", fields, ...(tags ? { tags } : {}), createdAt: 1, updatedAt: 1 });
const card = (noteId: string, state: CardState): Card => ({ id: `${noteId}.recognize`, noteId, deckId: "d", template: "recognize", state, due: 0, stability: 1, difficulty: 5, scheduledDays: 1, learningSteps: 0, reps: 1, lapses: 0, createdAt: 1, updatedAt: 1 });

describe("grammar note type", () => {
  const g = note("g1", "grammar", { sentence: "Should you need help, call us.", answer: "Should", topic: "Đảo ngữ", translation: "Nếu cần giúp, hãy gọi.", rule: "Should + S + V = If you should need" });
  it("blanks the whole answer, never a longer word that starts like it", () => {
    expect(findExact("The completion of the report was late. We complete it.", "complete")).toEqual([42, 50]);
    expect(findExact("The completion was late.", "complete")).toBeNull();
    // The vocabulary cloze would have matched the inflection; grammar must not.
    expect(clozeSentence("The completion was late.", "complete")).not.toBeNull();
  });
  it("makes one typed 'fill' card, front keeps the answer hidden, back explains", () => {
    expect(wantedTemplates(g, undefined)).toEqual(["fill"]);
    const t = template("grammar", "fill")!;
    const front = t.front(g, { showIpa: true, showPos: true, showEn: true, showVi: true, showExamples: true, showMnemonic: true });
    expect(front).toEqual([{ k: "quote", text: "_____ you need help, call us." }, { k: "badge", text: "Đảo ngữ" }]);
    expect(JSON.stringify(front)).not.toContain("Should you");
    const back = t.back(g, { showIpa: true, showPos: true, showEn: true, showVi: true, showExamples: true, showMnemonic: true });
    expect(back[0]).toEqual({ k: "title", text: "Should" });
    expect(back[1]).toMatchObject({ k: "example", text: "Should you need help, call us.", at: [0, 6], vi: "Nếu cần giúp, hãy gọi." });
    expect(back[2]).toEqual({ k: "text", text: "Quy tắc: Should + S + V = If you should need" });
    expect(t.expected!(g)).toEqual(["Should"]);
  });
  it("makes no card when the answer is not in the sentence", () => {
    expect(wantedTemplates(note("g2", "grammar", { sentence: "Call us.", answer: "Should" }), undefined)).toEqual([]);
  });
  it("completeSentence fills a ___ blank from the answer", () => {
    expect(completeSentence("___ you need help, call us.", "Should")).toBe("Should you need help, call us.");
    expect(completeSentence("Call us.", "x")).toBe("Call us.");
  });
});

describe("test results", () => {
  const t = note("t1", "test", { name: "Test 1 TOEIC NEW 2026", date: "2026-10-31", p5: "20/30", p6: "8/16", p7: "25/54", minutes: "57", v: "10", g: "8", p: "6", t: "0" });
  it("makes no cards and is not material", () => {
    expect(wantedTemplates(t, undefined)).toEqual([]);
    expect(NOTE_TYPES.test.templates).toEqual([]);
  });
  it("reads scores, totals and causes", () => {
    const [r] = testResults([t, note("w", "vocab", { word: "x" })]);
    expect(r).toMatchObject({ name: "Test 1 TOEIC NEW 2026", date: "2026-10-31", rcRight: 53, rcTotal: 100, fullRc: true, minutes: 57, tag: "de-test-1-toeic-new-2026" });
    expect(r.causes).toEqual({ v: 10, g: 8, p: 6, t: 0 });
    expect(topCause(r)).toBe("v");
    expect(wrongTotal(r)).toBe(24);
  });
  it("sorts oldest first and survives missing or malformed fields", () => {
    const a = note("a", "test", { name: "B", date: "2026-11-14", p5: "27/30" });
    const b = note("b", "test", { name: "A", date: "2026-10-31", p5: "abc", p6: "9/8" });
    const rs = testResults([a, b]);
    expect(rs.map((r) => r.name)).toEqual(["A", "B"]);
    expect(rs[0]).toMatchObject({ rcRight: 0, rcTotal: 0, fullRc: false });
    expect(rs[1]).toMatchObject({ rcRight: 27, rcTotal: 30, fullRc: false });
    expect(topCause(rs[0])).toBeNull();
  });
  it("parseScore and testTag", () => {
    expect(parseScore(" 20 / 30 ")).toEqual({ right: 20, total: 30 });
    expect(parseScore("31/30")).toBeNull();
    expect(parseScore("20")).toBeNull();
    expect(testTag("Đề ETS 2026 — Test #2")).toBe("de-de-ets-2026-test-2");
    expect(testTag("")).toBe("de-khac");
  });
  it("counts the words and sentences that came from each test", () => {
    const m = notesByTestTag([note("1", "vocab", { word: "a" }, ["de-x"]), note("2", "grammar", { sentence: "s", answer: "s" }, ["de-x", "ngu-phap"]), note("3", "vocab", { word: "b" }, ["lesson-1"])]);
    expect([...m.entries()]).toEqual([["de-x", { vocab: 1, grammar: 1 }]]);
  });
});

describe("unknown words in a passage", () => {
  const notes = [note("n1", "vocab", { word: "invoice" }), note("n2", "vocab", { word: "agenda" }), note("n3", "vocab", { word: "look after" })];
  const cards = [card("n1", CardState.Review), card("n2", CardState.New), card("n3", CardState.Review)];
  const index = buildIndex(notes, cards);
  const text = "Dear Ms. Tran,\nPlease review the attached invoices and the agenda before Friday. Our merger with Acme Corp. was postponed.";
  const a = analyze(text, index);
  const kind = (w: string) => a.tokens.find((t) => t.raw === w)?.kind;
  it("indexes single words by whether they were ever reviewed", () => {
    expect(index.get("invoice")).toBe("known");
    expect(index.get("agenda")).toBe("deck");
    expect(index.has("look after")).toBe(false);
  });
  it("classifies words", () => {
    expect(kind("the")).toBe("common");
    expect(kind("invoices")).toBe("known"); // inflection of a learned word
    expect(kind("agenda")).toBe("deck"); // in the deck, not learned yet
    expect(kind("merger")).toBe("unknown");
    expect(kind("postponed")).toBe("unknown");
    expect(kind("attached")).toBe("unknown");
    expect(kind("Acme")).toBe("skip"); // proper noun
    expect(kind("Corp")).toBe("skip");
    expect(kind("Tran")).toBe("skip");
    expect(kind("Dear")).toBe("common");
    expect(kind("Please")).toBe("common"); // capital at the start of a sentence is not a name
  });
  it("keeps coverage honest: unlearned deck words are not covered, 'I know it' words are", () => {
    expect(a.unknown.map((u) => u.key).sort()).toEqual(["attached", "merger", "postponed", "review"].sort());
    expect(a.pending).toBe(1); // "agenda": in the deck, not learned yet
    expect(a.coverage).toBeCloseTo(a.covered / a.counted, 5);
    const b = analyze(text, index, new Set(["merger", "postponed"]));
    expect(b.covered).toBe(a.covered + 2);
    expect(b.unknown.map((u) => u.key)).not.toContain("merger");
  });
  it("does not treat a capitalised heading as names", () => {
    const h = analyze("Annual Staff Meeting\nThe meeting starts at noon.", new Map());
    expect(h.tokens.find((t) => t.raw === "Annual")!.kind).toBe("unknown");
    expect(h.tokens.find((t) => t.raw === "Staff")!.kind).toBe("unknown");
  });
  it("contractions map to their base word", () => {
    const c = analyze("We don't know. The company's plan can't wait.", new Map());
    expect(c.tokens.filter((t) => t.kind === "unknown").map((t) => t.key)).toEqual([]);
  });
  it("returns null coverage for text without words", () => {
    expect(analyze("12 345 !!", new Map()).coverage).toBeNull();
  });
  it("finds the sentence a word is in", () => {
    const at = text.indexOf("merger");
    expect(sentenceAround(text, at)).toBe("Our merger with Acme Corp.");
    expect(sentenceAround("x ".repeat(400) + "merger " + "y ".repeat(400), 800).length).toBeLessThanOrEqual(300);
  });
});

describe("capital after a time abbreviation", () => {
  it("does not take a name after P.M. / a.m. for the start of a sentence", () => {
    const a = analyze("It starts at 3:00 P.M. Japan Standard Time on Thursday.", new Map());
    expect(a.tokens.find((t) => t.raw === "Japan")?.kind).toBe("skip");
  });
});
