/**
 * Inputs and TypeScript outputs of the Bộ đề helpers (testset.ts, pdf.ts layoutText, audio.ts), replayed by the
 * Kotlin port (android/core TestSetVectorsTest). Written to shared/vectors/testset.json by vectors.test.ts.
 */
import type { Extracted, ExtractedQuestion, Letter } from "../src/lib/import.ts";
import { layoutText, type TextItem } from "../src/lib/pdf.ts";
import { findGaps, frameLevels, mmss, placeQuestions, questionSpans } from "../src/lib/audio.ts";
import {
  chunkPages, findKey, findPhotoPages, formatPages, photoNumbers, photoSlots, grade, isKeyPage, keyNote, keyPairs, lcPartOfNumber, lettersOf, listenQuestions, mergeExtracted, numbersIn,
  parseNumberRange, parsePageRange, partOfNumber, reflow, resultFields, sortTracks, summary, wrongDrafts, type LcLayout, type PdfPage,
} from "../src/lib/testset.ts";

const opts = (a: string, b: string, c: string, d: string) => ({ A: a, B: b, C: c, D: d });
const q = (o: Partial<ExtractedQuestion>): ExtractedQuestion => ({
  number: 101, part: 5, kind: "fill", stem: "The new printer is _____ faster than the old one.", options: opts("much", "very", "many", "most"),
  correct: "A", result: "unknown", passage: null, topic: "Khác", rule: "much + so sánh hơn.", translation: "Máy in mới nhanh hơn nhiều.", flags: [], ...o,
});

const keyTexts = [
  "ANSWER KEY\n101 (A) 102 (B) 103-C 104) D 105. A 106 B",
  "Chọn đáp án đúng\n101. The new printer is _____ faster than the one we used.\n(A) much (B) very (C) many (D) most",
  "1A 2C 3B 4A 5C 32D 33B 34A 35 C 36 D 37 A",
  "Đáp án\n1.A 2.B 3.C",
  "Page 12.5 A note about 201 B and 0 C, 99Apples",
  "Answer Key 101 A 102 B 103 C",
  "ĐÁP ÁN 7 – C 8 – A 9 – B",
];

const longPage = Array.from({ length: 40 }, (_, k) => `${131 + (k % 16)}. Question ${k} asks about the memo and its schedule for the quarterly staff meeting in the main hall.\n(A) one (B) two (C) three (D) four`).join("\n");
const pageSets: Array<{ pages: PdfPage[]; skip: number[] }> = [
  {
    pages: [
      { n: 1, text: "PART 5\n101. The printer is _____ faster.\n(A) much (B) very", scanned: false },
      { n: 2, text: "102. Despite the _____ rain.\n(A) heavy (B) heavily", scanned: false },
      { n: 3, text: "", scanned: true },
      { n: 4, text: "", scanned: true },
      { n: 5, text: "", scanned: true },
      { n: 6, text: "   ", scanned: false },
      { n: 7, text: "ANSWER KEY 101 A 102 B", scanned: false },
    ],
    skip: [7],
  },
  { pages: [{ n: 1, text: longPage, scanned: false }, { n: 2, text: "147. What is the notice about?\n(A) A sale", scanned: false }], skip: [] },
  { pages: [{ n: 9, text: "x".repeat(6200), scanned: false }], skip: [] },
];

const pp = (n: number, text: string, scanned = false): PdfPage => ({ n, text, scanned });
const lcDirections = "LISTENING TEST In the Listening test, you will be asked to demonstrate how well you understand spoken English.\nPART 1\nDirections: For each question in this part, you will hear four statements about a picture in your test book.";
const photoPageSets: PdfPage[][] = [
  [pp(1, "Lexi Practice Test 3"), pp(2, lcDirections), pp(3, "1.\n2."), pp(4, "3.\n4."), pp(5, "5.\n6."), pp(6, "PART 2\n7. Mark your answer on your answer sheet."), pp(7, "ANSWER KEY 1 A 2 B 3 C 4 D 5 A 6 B 7 C")],
  [pp(2, lcDirections), pp(3, "", true), pp(4, "", true), pp(5, "PART 2")],
  [pp(1, "PART 1\n1."), pp(2, "2. PART 2 7. Mark your answer"), pp(3, "")],
  [pp(1, "Part I 1."), pp(2, "32. Where are the speakers? ".repeat(40))],
  [pp(1, "Part 10 Part II and part in it")],
  [pp(1, "Contents\nPart 1 .... 4\nPart 2 .... 9\nPart 3 .... 14"), pp(2, "")],
  [pp(1, "", true), pp(2, "", true)],
  [pp(1, "Unit 1 PART 1 1."), pp(2, "PART 2"), pp(9, "Unit 2 PART 1 1."), pp(10, "PART 2")],
  Array.from({ length: 9 }, (_, k) => pp(k + 1, k ? `${k}.` : "PART 1")),
  [pp(3, "PART 1 1."), pp(7, "2.")],
  [pp(1, "PART\u00a01\u2003photos"), pp(2, "x".repeat(601)), pp(3, "")],
  [pp(1, "y".repeat(1501) + " PART 1")],
];

const results: Array<{ name: string; results: Extracted[]; key: Array<[number, Letter]>; lc?: LcLayout; answers: Record<number, Letter>; existing: string[] }> = [
  {
    name: "two pieces, one question read twice, key overrides",
    results: [
      { passages: [{ id: 1, label: "Email", text: "Dear staff,\nThe meeting moves to Friday.", truncated: false }, { id: 2, label: "Footer", text: "Page 3", truncated: false }], questions: [
        q({}),
        q({ number: 102, stem: "_____ the heavy rain, the concert started on time.", options: opts("Although", "Despite", "Because", "So"), correct: "A" }),
        q({ number: 147, part: 7, kind: "reading", stem: "What is the email about?", options: opts("A move", "A sale", "", ""), correct: "A", passage: 1 }),
      ] },
      { passages: [], questions: [q({ number: 102, stem: "_____ the heavy rain, the concert started on time.", options: opts("Although", "Despite", "", ""), correct: "B", flags: ["no-answer"] }), q({ number: 131, part: 6, kind: "insert", stem: "", options: opts("one", "two", "three", "four"), correct: null, flags: ["no-answer"] })] },
    ],
    key: [[102, "B"], [131, "C"], [147, "D"]],
    answers: { 0: "A", 1: "A", 3: "A" },
    existing: [],
  },
  {
    name: "a book: every exercise numbered from 1",
    results: [
      { passages: [], questions: [q({ number: 1, part: null, stem: "She _____ to work by bus.", options: opts("go", "goes", "going", "gone"), correct: "B" }), q({ number: 2, part: null, stem: "They _____ here since 2010.", options: opts("live", "lived", "have lived", "living"), correct: "C" })] },
      { passages: [], questions: [q({ number: 1, part: null, stem: "The report _____ yesterday.", options: opts("finish", "was finished", "finishing", "finishes"), correct: "B" }), q({ number: 1, part: null, stem: "She _____ to work by bus every day.", options: opts("go", "goes", "going", "gone"), correct: "B", rule: "" })] },
    ],
    key: [],
    answers: { 0: "B", 1: "A" },
    existing: ["the report was finished yesterday."],
  },
  {
    name: "unnumbered, key differs, empty answer option, odd passage",
    results: [
      { passages: [{ id: 3, label: "Notice", text: "Closed Monday.", truncated: true }], questions: [
        q({ number: null, part: null, stem: "Please _____ us at once.", options: opts("call", "calls", "called", "calling"), correct: "A", passage: 9 }),
        q({ number: 105, stem: "The manager _____ the plan.", options: opts("approve", "approved", "", ""), correct: "A" }),
        q({ number: 106, stem: "We are _____ to announce.", options: opts("please", "pleased", "pleasing", "pleasure"), correct: "B", passage: 3 }),
        q({ number: 107, stem: "No letter given.", options: opts("a", "b", "c", "d"), correct: "E" as Letter }),
      ] },
    ],
    key: [[105, "C"], [106, "D"]],
    answers: {},
    existing: [],
  },
  {
    name: "listening: Part 1–2 from numbers, Part 3 from the AI",
    results: [
      { passages: [{ id: 1, label: "Conversation 1", text: "", truncated: false }], questions: [
        q({ number: 3, part: null, kind: "reading", stem: "Mark your answer.", options: opts("", "", "", ""), correct: null }),
        q({ number: 32, part: null, kind: "reading", stem: "Where most likely are the speakers?", options: opts("At a bank", "At a hotel", "At a store", "At a library"), correct: "D", passage: 1 }),
        q({ number: 33, part: null, kind: "reading", stem: "What does the man ask for?", options: opts("A key", "A map", "A form", "A pen"), correct: null }),
        q({ number: 101, part: null, kind: "fill", stem: "Stray _____ page.", options: opts("a", "b", "c", "d"), correct: "A" }),
      ] },
    ],
    key: [[1, "A"], [2, "C"], [3, "B"], [4, "D"], [5, "C"], [32, "D"], [33, "B"]],
    lc: { p1: [1, 2], p2: [3, 5] },
    answers: { 0: "A", 1: "B", 2: "B", 5: "D" },
    existing: [],
  },
];

const items = (rows: Array<[string, number, number, number?, number?]>): TextItem[] => rows.map(([str, x, y, w, h]) => ({ str, x, y, w: w ?? str.length * 5, h: h ?? 10 }));
const layouts: Array<{ items: TextItem[]; width: number }> = [
  { items: items([["101.", 50, 700], ["The printer is", 75, 700], ["faster.", 150, 700.5], ["(A) much", 50, 680], ["(B) very", 120, 680], ["102.", 50, 640], ["", 10, 10]]), width: 600 },
  {
    items: items([
      ["READING TEST", 200, 780, 200], ["Part 7", 270, 760, 60],
      ["Left one", 40, 700, 200], ["Left two", 40, 685, 200], ["Left three", 40, 670, 200], ["Left four", 40, 640, 200],
      ["Right one", 320, 700, 200], ["Right two", 320, 685, 200], ["Right three", 320, 670, 200],
      ["Go on to the next page", 200, 40, 200],
    ]),
    width: 600,
  },
  { items: items([["a", 10, 100, 5, 0], ["b", 16, 99, 5, 0], [" c", 22, 99, 5, 0], ["d", 10, 60, 5, 0]]), width: 100 },
];

function audioVectors() {
  const rate = 1000;
  const s = new Float32Array(rate);
  for (let i = 0; i < s.length; i++) s[i] = i < 250 || (i >= 625 && i < 750) ? 0.3 * Math.sin(i / 3) : i < 500 ? 0.0005 * Math.sin(i) : 0;
  const levels = Array.from(frameLevels(s, rate));
  const lv = [-20, -20, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -30, -45, -45, -20, -60, -60];
  const gapCases = [[lv, 50, 300], [lv, 100, 600], [[-50, -50, -50], 50, 100], [[], 50, 600]] as const;
  const g = (a: number, b: number) => [a, b] as [number, number];
  const spanCases: Array<{ gaps: Array<[number, number]>; durationMs: number; count: number }> = [
    { gaps: [g(0, 500), g(3000, 7000), g(9000, 10000), g(12000, 17000), g(20000, 21000), g(24000, 29000)], durationMs: 32000, count: 3 },
    { gaps: [g(3000, 7000), g(12000, 17000), g(24000, 29000)], durationMs: 26000, count: 3 },
    { gaps: [g(3000, 7000), g(12000, 17000)], durationMs: 20000, count: 3 },
    { gaps: [g(1000, 4000), g(8000, 13000), g(16000, 21000)], durationMs: 22000, count: 3 },
    { gaps: [g(1000, 6000), g(8000, 13000), g(16000, 21000), g(22000, 27000)], durationMs: 28000, count: 3 },
    { gaps: [], durationMs: 1000, count: 0 },
  ];
  const tracks = [
    { gaps: [g(3000, 7000), g(12000, 17000), g(24000, 29000)], durationMs: 30000 },
    { gaps: [g(1000, 9000), g(15000, 23000)], durationMs: 24000 },
  ];
  const placeCases: Array<{ tracks: typeof tracks; parts: Array<number | null> }> = [
    { tracks: [tracks[0]], parts: [2, 2, 2] },
    { tracks, parts: [2, 2, 2, 3, 3] },
    { tracks, parts: [2, 2, 2] },
    { tracks, parts: [2, 2, 3, 3, 3] },
    { tracks: [tracks[0]], parts: [null, null] },
  ];
  return {
    frame: { rate, samples: Array.from(s), levels },
    gaps: gapCases.map(([levels, frameMs, minMs]) => ({ levels, frameMs, minMs, out: findGaps(levels, frameMs, minMs) })),
    spans: spanCases.map((c) => ({ ...c, out: questionSpans(c.gaps, c.durationMs, c.count) })),
    place: placeCases.map((c) => ({ ...c, out: placeQuestions(c.tracks, c.parts) })),
    mmss: [0, 999, 9000, 61_500, 600_000, 3_599_999].map((ms) => [ms, mmss(ms)]),
  };
}

export function testsetVectors() {
  return {
    keys: keyTexts.map((text) => ({ text, pairs: [...keyPairs(text)], isKey: isKeyPage(text) })),
    findKey: (() => {
      const pages: PdfPage[] = keyTexts.map((text, k) => ({ n: k + 1, text, scanned: k === 5 }));
      const r = findKey(pages);
      return { pages, key: [...r.key], keyPages: r.keyPages };
    })(),
    pageRanges: ([["45-60, 290", 391], ["", 3], ["2-", 5], ["3 đến 5", 10], ["3 to 4", 10], ["5-3", 10], ["abc", 10], ["0", 10], ["8-20", 10], ["1;3 4", 10], ["11", 10], ["2–4", 10], ["1,,2", 10], ["123456", 10]] as const).map(([text, n]) => ({ text, numPages: n, out: parsePageRange(text, n) })),
    formatPages: [[], [1], [1, 2, 3, 7, 9, 10], [4, 6, 8]].map((p) => ({ pages: p, out: formatPages(p) })),
    numbersIn: ["101. A\n102) B\n 103 . C\n1000. x", "147. What\n(A) 12. thing", "x\n0. y\n201. z\n200. w"].map((text) => ({ text, out: numbersIn(text) })),
    chunks: pageSets.map((c) => ({ ...c, out: chunkPages(c.pages, new Set(c.skip)) })),
    keyNotes: [[[[101, "A"], [102, "B"], [7, "C"]], [102, 7, 7, 300]], [[[101, "A"], [5, "B"]], "all"], [[], "all"]].map(([key, numbers]) => {
      const m = new Map(key as Array<[number, Letter]>);
      return { key, numbers, out: keyNote(m, numbers as number[] | "all") };
    }),
    parts: [null, 1, 100, 101, 130, 131, 146, 147, 200, 201].map((n) => [n, partOfNumber(n)]),
    lcParts: [null, 1, 2, 3, 5, 6, 7, 31, 32, 70, 71, 100, 101].map((n) => ({ n, default: lcPartOfNumber(n), custom: lcPartOfNumber(n, { p1: [1, 2], p2: [3, 5] }), none: lcPartOfNumber(n, { p1: null, p2: null }) })),
    numberRanges: ["1-6", " 7 – 31 ", "3 đến 5", "3 TO 5", "12", "", "6-1", "0-3", "1-201", "a-b", "1-2-3"].map((text) => ({ text, out: parseNumberRange(text) ?? (parseNumberRange(text) === null ? null : "invalid") })),
    listen: [{ p1: [1, 2], p2: [3, 5] }, { p1: null, p2: [7, 8] }].map((layout) => ({ layout, key: [[1, "A"], [2, "D"], [3, "D"], [4, "B"], [7, "C"]], out: listenQuestions(layout as LcLayout, new Map([[1, "A"], [2, "D"], [3, "D"], [4, "B"], [7, "C"]] as Array<[number, Letter]>)) })),
    photoSlots: ([
      [[{}, {}, {}, {}], [1, 2, 3, 4, 5, 6]],
      [[{}, {}, {}], [1, 2, 3, 4, 5, 6]],
      [[{ numbers: [1] }, { numbers: [2, 3] }, { numbers: [4, 5] }, { numbers: [6] }], [1, 2, 3, 4, 5, 6]],
      [[{}, { numbers: [1, 2] }, { numbers: [3, 4] }, { numbers: [5, 6] }], [1, 2, 3, 4, 5, 6]],
      [[{ numbers: [3] }, { numbers: [1] }], [1, 2, 3]],
      [[{ numbers: [9] }, {}], [1, 2]],
      [[{}], []],
      [[], [1]],
      [[{}, {}, {}, {}, {}, {}, {}], [1, 2, 3, 4, 5, 6]],
    ] as Array<[Array<{ numbers?: number[] }>, number[]]>).map(([pictures, part1]) => ({ pictures, part1, out: photoSlots(pictures, part1) })),
    photoNumbers: ([["1.\n2.", [1, 6]], ["LISTENING TEST\nPART 1\n\n1.\n\n2.", [1, 6]], ["6.\nPART 2\n7. Mark your answer", [1, 6]], [" 3)\n4 .\n 5.5 \n12. x", [1, 20]], ["1.\u00a0", null], ["3.\n1.\n3.", [1, 6]]] as Array<[string, [number, number] | null]>).map(([text, p1]) => ({ text, p1, out: photoNumbers(text, p1) })),
    photoPages: photoPageSets.map((pages) => ({ pages, out: findPhotoPages(pages) })),
    tracks: [["010.mp3", "002 - intro.mp3", "Track 1.mp3", "b.mp3", "a.mp3", "mp3.mp3", "track10.MP3", "track9.mp3"]].map((names) => ({ names, out: sortTracks(names.map((name) => ({ name }))).map((t) => t.name) })),
    letters: [{ options: opts("a", "b", "", ""), choices: undefined }, { options: opts("", "", "", ""), choices: 3 }, { options: opts("", "", "", ""), choices: undefined }, { options: opts("a", "", "c", "d"), choices: 3 }].map((o) => ({ ...o, out: lettersOf(o) })),
    merges: results.map((c) => {
      const set = mergeExtracted(c.results, new Map(c.key), c.lc);
      const g = grade(set, c.answers);
      const w = wrongDrafts(set, g, new Set(c.existing));
      return {
        ...c, set, summary: summary(set), graded: g,
        fields: resultFields(c.name, "2026-11-10", g, 30 * 60_000 + 29_999),
        wrong: { drafts: w.drafts.map((d) => ({ key: d.key, number: d.number, include: d.include, correct: d.correct, stem: d.stem })), skipped: w.skipped, passages: w.passages },
      };
    }),
    resultFields: [["  ", 0], ["x".repeat(90), 90_000], ["Test", 30_000], ["Test", 89_999_999]].map(([name, ms]) => ({ name, ms, out: resultFields(name as string, "2026-01-02", grade({ questions: [] }, {}), ms as number) })),
    reflow: ["To: All staff\nFrom: Office\n\nThe quarterly meeting has been moved to the main hall because the\nusual room is being painted this week, so please arrive early.\n- Bring your badge\n• No food\nThanks:", "short\r\nlines\r\n", ""].map((text) => ({ text, out: reflow(text) })),
    layouts: layouts.map((l) => ({ ...l, out: layoutText(l.items, l.width) })),
    audio: audioVectors(),
  };
}
