import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Note } from "@shared/model.ts";
import { deleteTestSet, loadMedia, loadTestSets, mediaKeys, saveMedia, saveTestSet, testSets } from "../src/data/testsets.ts";
import type { Extracted, ExtractedQuestion } from "../src/lib/import.ts";
import { layoutText, openPdf, readPages, type PdfJs, type TextItem } from "../src/lib/pdf.ts";
import { toResult } from "../src/lib/practice.ts";
import {
  CHUNK_CHARS, CHUNK_IMAGES, attemptOf, canLogScope, partStates, partsOf, scopeName, scopeView, withAttempt, chunkPages, findPhotoPages, lcPartOfNumber, photoNumbers, photoSlots, lettersOf, parseNumberRange, sortTracks, findKey, formatPages, grade, isKeyPage, keyNote, keyPairs, mergeExtracted, numbersIn, parsePageRange, partOfNumber, resultFields, summary, wrongDrafts,
  type PdfPage, type TestSet,
} from "../src/lib/testset.ts";

const fixture = (f: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", f)));
const pages = async (f: string) => readPages(await openPdf(fixture(f), pdfjs as unknown as PdfJs));

const q = (o: Partial<ExtractedQuestion> & { number: number | null }): ExtractedQuestion => ({
  part: null, kind: "fill", stem: "The report is ------- finished.", options: { A: "already", B: "yet", C: "still", D: "ever" },
  correct: null, result: "unknown", passage: null, topic: "", rule: "", translation: "", flags: [], ...o,
});

describe("reading the test PDF", () => {
  it("reads the text PDF in order, two-column Part 5 left column first, and finds the key page", async () => {
    const ps = await pages("reading-test.pdf");
    expect(ps.map((p) => p.scanned)).toEqual([false, false, false]);
    const p1 = ps[0].text;
    // Left column (101–105) before the right one (106–110), and a question's own lines stay together.
    expect(p1.indexOf("105.")).toBeLessThan(p1.indexOf("106."));
    expect(p1).toContain("101. Ms. Tran asked the staff to submit their travel -------\nby Friday.\n(A) receipts");
    expect(ps[1].text).toContain("are asked to ------- (131) in the west lot.");
    const { key, keyPages } = findKey(ps);
    expect(keyPages).toEqual([3]);
    expect(key.size).toBe(17);
    expect([key.get(101), key.get(106), key.get(132), key.get(148)]).toEqual(["A", "C", "B", "C"]);
  });

  it("marks every page of the scanned PDF as a picture and finds no key in it", async () => {
    const ps = await pages("reading-test-scan.pdf");
    expect(ps.map((p) => p.scanned)).toEqual([true, true, true]);
    expect(findKey(ps).key.size).toBe(0);
  });

  it("a question page is not a key page, even with numbers and (A)-(D) options on it", async () => {
    const ps = await pages("reading-test.pdf");
    expect(isKeyPage(ps[0].text)).toBe(false);
    expect(isKeyPage(ps[1].text)).toBe(false);
    expect(isKeyPage("ANSWER KEY\n101 A 102 C 103 B")).toBe(true); // a short key with a heading
  });

  it("keeps a single-column page in line order and leaves full-width lines out of the columns", () => {
    const it = (str: string, x: number, y: number, w = 100): TextItem => ({ str, x, y, w, h: 10 });
    const one = layoutText([it("second", 40, 700, 60), it("first", 40, 720, 60), it("line", 110, 720, 40)], 600);
    expect(one).toBe("first line\nsecond");
    const col = (x: number, s: string) => [1, 2, 3, 4].map((k) => it(`${s}${k}`, x, 740 - k * 20));
    const two = layoutText([it("PART 5 Directions spanning the page", 40, 760, 500), ...col(40, "L"), ...col(320, "R")], 600);
    expect(two).toBe("PART 5 Directions spanning the page\n\nL1\nL2\nL3\nL4\n\nR1\nR2\nR3\nR4");
  });
});

describe("answer key and pieces", () => {
  it("reads the usual key layouts", () => {
    const k = keyPairs("101. (A)  102 B\n103-C 104) D 105: (b)\n1. A 2 (C)");
    expect([...k]).toEqual([[101, "A"], [102, "B"], [103, "C"], [104, "D"], [1, "A"], [2, "C"]]);
    expect(keyPairs("in 2016 a").size).toBe(0);
  });

  it("joins text pages up to the limit, never sends the key page, and sends scans two at a time", () => {
    const page = (n: number, len: number, scanned = false): PdfPage => ({ n, text: scanned ? "" : `${n}0${n}. ${"x".repeat(len)}`, scanned });
    const cs = chunkPages([page(1, 1500), page(2, 1500), page(3, 3000), page(4, 0, true), page(5, 0, true), page(6, 0, true), page(7, 200)], new Set([7]));
    expect(cs.map((c) => [c.kind, c.pages])).toEqual([["text", [1, 2]], ["text", [3]], ["images", [4, 5]], ["images", [6]]]);
    for (const c of cs) if (c.kind === "text") expect(c.text.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(cs.filter((c) => c.kind === "images").every((c) => c.pages.length <= CHUNK_IMAGES)).toBe(true);
  });

  it("splits a page longer than the limit at the start of a question", () => {
    const qs = Array.from({ length: 40 }, (_, i) => `${101 + i}. ${"word ".repeat(30)}\n(A) a (B) b (C) c (D) d`).join("\n");
    const cs = chunkPages([{ n: 1, text: qs, scanned: false }], new Set());
    expect(cs.length).toBeGreaterThan(1);
    for (const c of cs) {
      expect(c.kind === "text" && c.text.length <= CHUNK_CHARS).toBe(true);
      if (c.kind === "text") expect(c.text).toMatch(/^\d{3}\. /);
    }
    expect(cs.flatMap((c) => (c.kind === "text" ? numbersIn(c.text) : []))).toEqual(Array.from({ length: 40 }, (_, i) => 101 + i));
  });

  it("gives a piece only the answers of its own questions", async () => {
    const ps = await pages("reading-test.pdf");
    const { key, keyPages } = findKey(ps);
    const [c] = chunkPages(ps, new Set(keyPages));
    expect(c.kind).toBe("text");
    const note = keyNote(key, numbersIn(c.kind === "text" ? c.text : ""));
    expect(note).toContain("101 (A)");
    expect(note).toContain("149 (B)");
    expect(keyNote(key, [999])).toBe("");
    expect(keyNote(new Map([[5, "B"]]), "all")).toContain("5 (B)");
  });
});

describe("merging what the function read", () => {
  const key = new Map([[101, "A"], [102, "B"], [147, "C"]] as const);

  it("dedupes overlapping pieces, applies the PDF key, takes the part from the number and renumbers passages", () => {
    const a: Extracted = {
      passages: [{ id: 1, label: "Header", text: "page header nobody points at", truncated: false }],
      questions: [q({ number: 102, options: { A: "a", B: "b", C: "", D: "" } }), q({ number: 101, correct: "B", rule: "rule for B", part: 6 })],
    };
    const b: Extracted = {
      passages: [{ id: 1, label: "Notice", text: "Greenway library notice text", truncated: false }],
      questions: [q({ number: 102, correct: "B", options: { A: "a", B: "b", C: "c", D: "d" } }), q({ number: 147, kind: "reading", stem: "Who is it for?", passage: 1, correct: "C", rule: "x" }), q({ number: 148, kind: "reading", stem: "What?", passage: 1 })],
    };
    const m = mergeExtracted([a, b], key);
    expect(m.questions.map((x) => x.number)).toEqual([101, 102, 147, 148]);
    expect(m.questions.map((x) => x.i)).toEqual([0, 1, 2, 3]);
    // 101: the key says A, the model said B: the key wins, the explanation for B is dropped, the row is flagged.
    expect(m.questions[0]).toMatchObject({ correct: "A", part: 5, rule: "" });
    expect(m.questions[0].flags).toContain("key-differs");
    // 102 kept from the reading with four options.
    expect(m.questions[1].options.D).toBe("d");
    expect(m.questions[1].correct).toBe("B");
    // Only the passage a question points at is kept, at index 0.
    expect(m.passages).toEqual([{ label: "Notice", text: "Greenway library notice text", truncated: false }]);
    expect([m.questions[2].passage, m.questions[3].passage]).toEqual([0, 0]);
    expect(m.questions[2]).toMatchObject({ part: 7, correct: "C", rule: "x" });
    expect(m.questions[3].correct).toBeNull();
    expect(summary(m)).toMatchObject({ total: 4, byPart: { p5: 2, p6: 0, p7: 2, other: 0 }, noAnswer: 1, missing: [] });
    // 101, 102 | 147, 148: no gap inside a part. A gap inside one is reported.
    expect(summary({ questions: [101, 103, 147].map((n, i) => ({ ...m.questions[0], i, number: n, part: partOfNumber(n) })) }).missing).toEqual([102]);
  });

  it("a book that numbers each exercise from 1 keeps both questions 1, in the order read; a question read twice is kept once", () => {
    const ex1: Extracted = { passages: [], questions: [q({ number: 1, stem: "The bank has confirmed it will take _____ measures.", part: 5 }), q({ number: 2, stem: "The management decided to lay off _____.", part: 5 })] };
    // The next piece re-reads question 2 across the page break (same stem, more options), then a new exercise starts at 1.
    const ex2: Extracted = {
      passages: [],
      questions: [
        q({ number: 2, stem: "The management decided to lay off _____.", options: { A: "a", B: "b", C: "c", D: "d" }, part: 5 }),
        q({ number: 1, kind: "reading", stem: "What is the purpose of the e-mail?", part: 7 }),
      ],
    };
    const m = mergeExtracted([ex1, ex2], new Map());
    expect(m.questions.map((x) => [x.number, x.stem.slice(0, 12)])).toEqual([[1, "The bank has"], [2, "The manageme"], [1, "What is the "]]);
    expect(m.questions.map((x) => x.part)).toEqual([5, 5, 7]);
    expect(summary(m).missing).toEqual([]);
  });

  it("parts by number follow the TOEIC layout", () => {
    expect([partOfNumber(101), partOfNumber(130), partOfNumber(131), partOfNumber(146), partOfNumber(147), partOfNumber(200), partOfNumber(12), partOfNumber(null)]).toEqual([5, 5, 6, 6, 7, 7, null, null]);
  });

  it("a key letter whose option is empty leaves the question without an answer, flagged", () => {
    const m = mergeExtracted([{ passages: [], questions: [q({ number: 102, options: { A: "a", B: "", C: "c", D: "d" } })] }], key);
    expect(m.questions[0].correct).toBeNull();
    expect(m.questions[0].flags).toContain("answer-empty");
  });
});

describe("taking a set", () => {
  const set: Pick<TestSet, "questions" | "passages"> = mergeExtracted(
    [{
      passages: [{ id: 1, label: "E-mail", text: "Employees are asked to _____ in the west lot.", truncated: false }],
      questions: [
        q({ number: 101, correct: "B", stem: "The report is _____ finished.", rule: "already + V3" }),
        q({ number: 102, correct: "A", stem: "Please call _____ you need help.", options: { A: "if", B: "so", C: "but", D: "or" } }),
        q({ number: 131, correct: "A", stem: "Employees are asked to _____ in the west lot.", options: { A: "park", B: "parks", C: "parked", D: "parking" }, passage: 1 }),
        q({ number: 147, kind: "reading", stem: "Who is it for?", correct: "C", passage: 1 }),
        q({ number: 148, kind: "reading", stem: "Where?", correct: null }),
      ],
    }],
    new Map(),
  );

  it("grades per part, counts blanks as wrong and leaves out questions with no answer", () => {
    const g = grade(set, { 0: "B", 1: "C", 3: "C" });
    expect(g).toMatchObject({ right: 2, total: 4, ungraded: 1, wrong: [1, 2] });
    expect(g.parts).toEqual({ p5: { right: 1, total: 2 }, p6: { right: 0, total: 1 }, p7: { right: 1, total: 1 } });
  });

  it("logs the attempt in the shape of the Kết quả bài form, and a short set is not a full RC", () => {
    const g = grade(set, { 0: "B", 1: "C", 3: "C" });
    const f = resultFields("  Đề PDF 1 ", "2026-11-10", g, 21 * 60_000 + 20_000);
    expect(f).toEqual({ name: "Đề PDF 1", date: "2026-11-10", p5: "1/2", p6: "0/1", p7: "1/1", minutes: "21" });
    const note: Note = { id: "t", type: "test", deckId: "d", fields: f, createdAt: 0, updatedAt: 0 };
    expect(toResult(note)).toMatchObject({ rcRight: 2, rcTotal: 4, fullRc: false });
    const full: Note = { ...note, fields: { name: "x", p5: "20/30", p6: "8/16", p7: "25/54" } };
    expect(toResult(full).fullRc).toBe(true);
  });

  it("turns the missed fill-in questions into review rows and hands over the passages of the missed ones", () => {
    const g = grade(set, { 0: "B", 1: "C" });
    const w = wrongDrafts(set, g, new Set());
    expect(w.drafts.map((d) => d.number)).toEqual([102, 131]);
    expect(w.drafts.every((d) => d.result === "wrong" && d.include)).toBe(true);
    expect(w.skipped).toBe(1); // 147, a reading question
    expect(w.passages.map((p) => p.label)).toEqual(["E-mail"]);
    // A sentence that already has a card is not selected again.
    const again = wrongDrafts(set, g, new Set(["please call if you need help."]));
    expect(again.drafts.find((d) => d.number === 102)?.include).toBe(false);
  });
});

describe("device-only store", () => {
  beforeEach(async () => {
    for (const s of await loadTestSets(true)) await deleteTestSet(s.id);
  });

  it("keeps sets in IndexedDB, newest first, and deletes one", async () => {
    const base = { source: { fileName: "a.pdf", pages: 1 }, passages: [], questions: [], updatedAt: 0 };
    await saveTestSet({ ...base, id: "a", name: "A", createdAt: 1 });
    await saveTestSet({ ...base, id: "b", name: "B", createdAt: 2 });
    expect((await loadTestSets(true)).map((s) => s.id)).toEqual(["b", "a"]);
    await saveTestSet({ ...base, id: "a", name: "A", createdAt: 1, attempt: { startedAt: 5, elapsedMs: 9, answers: { 0: "A" } } });
    expect((await loadTestSets(true)).find((s) => s.id === "a")?.attempt?.answers).toEqual({ 0: "A" });
    await deleteTestSet("b");
    expect(testSets.get().map((s) => s.id)).toEqual(["a"]);
    expect((await loadTestSets(true)).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("key page guard", () => {
  it("a Vietnamese question page titled with 'đáp án' is still a question page", () => {
    const page = "Chọn đáp án đúng cho mỗi câu.\n131. (A) park (B) parks (C) parked (D) parking\n132. (A) The garage was built in 1998. (B) Please allow extra time to reach your desk.\n133. (A) patient (B) patience\nThe east parking garage will be closed for repairs from June 3 to June 14 and employees are asked to park in the west lot.";
    expect(isKeyPage(page)).toBe(false);
  });
});

describe("passage display", () => {
  it("joins wrapped lines, keeps header lines and paragraphs", async () => {
    const { reflow } = await import("../src/lib/testset.ts");
    const t = "To: All staff\nSubject: Parking\n\nThe east parking garage will be closed for repairs from June 3 to June 14. During\nthis time, employees park in the west lot.\n\nThank you.";
    expect(reflow(t)).toBe("To: All staff\nSubject: Parking\n\nThe east parking garage will be closed for repairs from June 3 to June 14. During this time, employees park in the west lot.\n\nThank you.");
  });
});

describe("page range (a big book: read only the chosen pages)", () => {
  it("reads ranges, single pages and open ends; empty means every page", () => {
    expect(parsePageRange("", 5)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePageRange("45-47, 290-292", 300)).toEqual([45, 46, 47, 290, 291, 292]);
    expect(parsePageRange("2–3; 8 10", 12)).toEqual([2, 3, 8, 10]);
    expect(parsePageRange("10 đến 12", 20)).toEqual([10, 11, 12]);
    expect(parsePageRange("298-", 300)).toEqual([298, 299, 300]);
    expect(parsePageRange("3, 1-3", 9)).toEqual([1, 2, 3]);
    expect(parsePageRange("295-400", 300)).toEqual([295, 296, 297, 298, 299, 300]);
  });
  it("refuses what is not a page instead of reading other pages", () => {
    for (const t of ["0-3", "9-3", "abc", "350", "1-2-3", "5,x"]) expect(parsePageRange(t, 300), t).toBeNull();
  });
  it("writes the choice back short", () => {
    expect(formatPages([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
    expect(formatPages([4])).toBe("4");
  });
});

describe("Listening sets (Part 1–4 with the test's audio)", () => {
  it("parts by number follow the TOEIC Listening layout, with the learner's own Part 1–2 ranges", () => {
    expect([1, 6, 7, 31, 32, 70, 71, 100, 101].map((n) => lcPartOfNumber(n))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, null]);
    expect(lcPartOfNumber(5, { p1: null, p2: [1, 10] })).toBe(2);
    expect([parseNumberRange("1-6"), parseNumberRange(" 7 – 31 "), parseNumberRange(""), parseNumberRange("5"), parseNumberRange("6-1"), parseNumberRange("a")]).toEqual([[1, 6], [7, 31], null, [5, 5], undefined, undefined]);
  });

  it("makes Part 1–2 from their numbers with the key, drops the model's reading of them, takes Part 3–4 from the model", () => {
    const key = new Map([[1, "C"], [7, "B"], [8, "D"], [32, "A"]] as const);
    const read: Extracted = {
      passages: [],
      questions: [
        q({ number: 7, stem: "Mark your answer on your answer sheet." }),
        q({ number: 32, kind: "reading", stem: "Where most likely are the speakers?", part: 5 }),
        q({ number: 33, kind: "reading", stem: "What does the woman ask for?" }),
      ],
    };
    const m = mergeExtracted([read], key, { p1: [1, 2], p2: [7, 8] });
    expect(m.questions.map((x) => [x.number, x.part, x.kind])).toEqual([[1, 1, "listen"], [2, 1, "listen"], [7, 2, "listen"], [8, 2, "listen"], [32, 3, "reading"], [33, 3, "reading"]]);
    expect(m.questions.map((x) => x.correct)).toEqual(["C", null, "B", null, "A", null]);
    // Part 2 has three choices: a key letter D for it is no answer.
    expect(m.questions[3].flags).toContain("no-answer");
    expect(lettersOf(m.questions[0])).toEqual(["A", "B", "C", "D"]);
    expect(lettersOf(m.questions[2])).toEqual(["A", "B", "C"]);
    expect(lettersOf(m.questions[4])).toEqual(["A", "B", "C", "D"]);
    expect(summary(m).byPart).toMatchObject({ p1: 2, p2: 2, p3: 2, p4: 0, p5: 0 });
  });

  it("grades Part 1–4 into the LC score of the result note; missed Part 1–2 make no cards", () => {
    const m = mergeExtracted([], new Map([[1, "A"], [2, "B"], [7, "C"]] as const), { p1: [1, 2], p2: [7, 7] });
    const g = grade(m, { 0: "A", 1: "A" });
    expect(g.lc).toEqual({ right: 1, total: 3 });
    expect(g.lcParts).toMatchObject({ p1: { right: 1, total: 2 }, p2: { right: 0, total: 1 }, p3: null });
    expect(g.parts).toEqual({ p5: null, p6: null, p7: null });
    expect(resultFields("Big Step LC", "2026-11-10", g, 65_000)).toEqual({ name: "Big Step LC", date: "2026-11-10", lc: "1/3", minutes: "1" });
    expect(toResult({ id: "n", type: "test", fields: resultFields("x", "2026-11-10", g, 0) } as unknown as Note)?.lc).toEqual({ right: 1, total: 3 });
    const w = wrongDrafts({ ...m, passages: [] }, g, new Set());
    expect(w.drafts).toEqual([]);
    expect(w.skipped).toBe(2);
  });

  it("finds the Part 1 photo pages of a text PDF: the PART 1 page and the near-empty pages after it, up to PART 2", async () => {
    expect(findPhotoPages(await pages("listening-test.pdf"))).toEqual([1]);
    const page = (n: number, text: string, scanned = false): PdfPage => ({ n, text, scanned });
    const directions = "LISTENING TEST In the Listening test, you will be asked to demonstrate how well you understand spoken English.\nPART 1\nDirections: For each question in this part, you will hear four statements about a picture in your test book.";
    const test = [page(1, "Lexi Practice Test 3"), page(2, directions), page(3, "1.\n2."), page(4, "3.\n4."), page(5, "5.\n6."), page(6, "PART 2\n7. Mark your answer on your answer sheet."), page(7, "ANSWER KEY 1 A 2 B 3 C 4 D 5 A 6 B 7 C")];
    expect(findPhotoPages(test)).toEqual([2, 3, 4, 5]);
    // Photos that print no text at all (pdf.ts calls such a page scanned) still belong to the run.
    expect(findPhotoPages([page(2, directions), page(3, "", true), page(4, "", true), page(5, "PART 2")])).toEqual([2, 3, 4]);
    // Part 2 starting on the last photo page ends the run there; a page of questions ends it too.
    expect(findPhotoPages([page(1, "PART 1\n1."), page(2, "2. PART 2 7. Mark your answer"), page(3, "")])).toEqual([1, 2]);
    expect(findPhotoPages([page(1, "Part I 1."), page(2, "32. Where are the speakers? ".repeat(40))])).toEqual([1]);
    // Not a heading: "Part 10", "Part II", "part in"; a contents page names every part; a scanned book has no text.
    expect(findPhotoPages([page(1, "Part 10 Part II and part in it")])).toEqual([]);
    expect(findPhotoPages([page(1, "Contents\nPart 1 .... 4\nPart 2 .... 9\nPart 3 .... 14"), page(2, "")])).toEqual([]);
    expect(findPhotoPages([page(1, "", true), page(2, "", true)])).toEqual([]);
    // A book with a Part 1 in every unit: which one is meant is the learner's to say.
    expect(findPhotoPages([page(1, "Unit 1 PART 1 1."), page(2, "PART 2"), page(9, "Unit 2 PART 1 1."), page(10, "PART 2")])).toEqual([]);
    // Never more than six pages, and the pages must follow one another.
    expect(findPhotoPages(Array.from({ length: 9 }, (_, k) => page(k + 1, k ? `${k}.` : "PART 1")))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(findPhotoPages([page(3, "PART 1 1."), page(7, "2.")])).toEqual([3]);
  });

  it("puts each Part 1 photo page above its own questions: by the numbers printed on it, else spread evenly", () => {
    const six = [1, 2, 3, 4, 5, 6];
    // Text PDF, photo 1 under the directions, two to a page, 6 above Part 2: 1 | 2 3 | 4 5 | 6.
    const pages = ["PART 1 Directions ... statements about a picture\n1.", "2.\n3.", "4.\n5.", "6.\nPART 2\n7. Mark your answer on your answer sheet."];
    const numbered = pages.map((t) => ({ numbers: photoNumbers(t, [1, 6]) }));
    expect(numbered.map((p) => p.numbers)).toEqual([[1], [2, 3], [4, 5], [6]]);
    expect(photoSlots(numbered, six)).toEqual([0, 1, 3, 5]);
    // The directions page with only an example photo goes above question 1 too.
    expect(photoSlots([{}, { numbers: [1, 2] }, { numbers: [3, 4] }, { numbers: [5, 6] }], six)).toEqual([0, 0, 2, 4]);
    // Scans: no numbers, spread evenly (2 + 2 + 2, 3 + 3).
    expect(photoSlots([{}, {}, {}], six)).toEqual([0, 2, 4]);
    expect(photoSlots([{}, {}], six)).toEqual([0, 3]);
    // Never above a question before the page ahead of it.
    expect(photoSlots([{ numbers: [3] }, { numbers: [1] }], [1, 2, 3])).toEqual([2, 2]);
    expect(photoNumbers("1.\n2.", null)).toEqual([]);
  });

  it("plays audio files in the order of the number in their names", () => {
    expect(sortTracks([{ name: "010.mp3" }, { name: "002 - EFIS English.mp3" }, { name: "001 - EFIS English.mp3" }, { name: "intro.mp3" }]).map((f) => f.name))
      .toEqual(["001 - EFIS English.mp3", "002 - EFIS English.mp3", "010.mp3", "intro.mp3"]);
  });

  it("deleting a set removes its audio and pictures from the device, and only its own", async () => {
    await saveMedia([{ key: "s1:a0", blob: new Blob(["mp3"]) }, { key: "s1:p3", blob: new Blob(["jpg"]) }, { key: "s2:a0", blob: new Blob(["other"]) }]);
    await saveTestSet({ id: "s1", name: "LC", createdAt: 1, updatedAt: 0, section: "lc", source: { fileName: "a.pdf", pages: 1 }, passages: [], questions: [], tracks: [{ key: "s1:a0", name: "001.mp3", bytes: 3 }] });
    expect(await mediaKeys("s1")).toEqual(["s1:a0", "s1:p3"]);
    expect(await loadMedia("s1:a0")).not.toBeNull();
    await deleteTestSet("s1");
    expect(await mediaKeys("s1")).toEqual([]);
    expect(await loadMedia("s2:a0")).not.toBeNull();
  });
});

describe("Làm theo Part", () => {
  const mk = (i: number, part: 5 | 6 | 7 | null, correct: "A" | null = "A") => ({
    i, number: i + 1, part, kind: "fill" as const, stem: "s", options: { A: "a", B: "b", C: "c", D: "d" }, correct, passage: null, topic: "", rule: "", translation: "", flags: [],
  });
  const set = { questions: [mk(0, 5), mk(1, 5), mk(2, 6), mk(3, 7), mk(4, null)] };
  const att = (answers: Record<number, "A" | "B" | "C" | "D">, finishedAt?: number) => ({ startedAt: 1, elapsedMs: 5000, answers, ...(finishedAt ? { finishedAt } : {}) });

  it("lists the Parts a set has and shows only one Part's questions", () => {
    expect(partsOf(set)).toEqual([5, 6, 7]);
    expect(scopeView(set, 5).questions.map((x) => x.i)).toEqual([0, 1]);
    expect(scopeView(set, null).questions).toHaveLength(5);
  });

  it("keeps an attempt per Part apart from the whole-set one", () => {
    let s: Pick<TestSet, "questions" | "attempt" | "parts"> = { ...set };
    s = withAttempt(s, 5, att({ 0: "A" }));
    s = withAttempt(s, null, att({ 3: "B" }));
    s = withAttempt(s, 6, att({}));
    expect(Object.keys(s.parts!)).toEqual(["5", "6"]);
    expect(attemptOf(s, 5)!.answers).toEqual({ 0: "A" });
    expect(attemptOf(s, null)!.answers).toEqual({ 3: "B" });
    expect(attemptOf(s, 7)).toBeUndefined();
    // Removing the last Part attempt leaves no empty `parts`.
    s = withAttempt(withAttempt(s, 5, undefined), 6, undefined);
    expect("parts" in s).toBe(false);
    expect(s.attempt).toBeDefined();
  });

  it("says where each Part stands: not started, in progress, submitted with its score", () => {
    const states = partStates({ ...set, parts: { "5": att({ 0: "A", 1: "B", 9: "C" }, 9), "6": att({}), "7": att({ 3: "A" }) } });
    expect(states).toEqual([
      { part: 5, total: 2, answered: 2, state: "done", score: { right: 1, total: 2 } },
      { part: 6, total: 1, answered: 0, state: "new", score: null }, // opened and left with nothing picked
      { part: 7, total: 1, answered: 1, state: "doing", score: null },
    ]);
  });

  it("logs a Part under its own name; Listening Parts have no place in Kết quả bài", () => {
    expect(scopeName("ETS 1", null)).toBe("ETS 1");
    expect(scopeName("ETS 1", 5)).toBe("ETS 1 · Part 5");
    expect([1, 2, 3, 4].map((p) => canLogScope(p as 1))).toEqual([false, false, false, false]);
    expect([null, 5, 6, 7].map((p) => canLogScope(p as 5 | null))).toEqual([true, true, true, true]);
    // Only the Part taken is in the note: no other Part's score is invented.
    const g = grade(scopeView(set, 5), { 0: "A", 1: "A" });
    expect(resultFields(scopeName("ETS 1", 5), "2026-11-14", g, 600_000)).toEqual({ name: "ETS 1 · Part 5", date: "2026-11-14", p5: "2/2", minutes: "10" });
  });
});
