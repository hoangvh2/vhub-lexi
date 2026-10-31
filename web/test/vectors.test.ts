/**
 * Cross-platform contract. The Android app re-implements FSRS scheduling, queueing, templates, cloze and
 * morphology in Kotlin; its unit tests replay these vectors, produced here by the reference (TypeScript) code.
 * A change in behaviour fails this test until the vectors are regenerated and the Kotlin port is updated:
 *   UPDATE_VECTORS=1 npx vitest run test/vectors.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, normalizePrefs, type Card, type Note, type Rating } from "@shared/model.ts";
import { IRREGULAR } from "@shared/irregular.ts";
import { baseForms } from "@shared/morphy.ts";
import { checkTyped, clozeSentence, findWord, normalizeAnswer, template, wantedTemplates } from "@shared/notetypes.ts";
import { answerHint, confusables, letterCount, matchConfusable, meaningPhrases, suggestedRatingWith } from "@shared/confusables.ts";
import { buildQueue, pickNext } from "../src/lib/queue.ts";
import { answer, makeScheduler, newCard } from "../src/lib/scheduler.ts";

const T0 = Date.UTC(2026, 0, 15, 8, 30, 0);
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function cardOut(c: Card) {
  return { state: c.state, due: c.due, stability: c.stability, difficulty: c.difficulty, scheduledDays: c.scheduledDays, learningSteps: c.learningSteps, reps: c.reps, lapses: c.lapses, lastReview: c.lastReview ?? null };
}

function fsrsVectors() {
  // Each scenario: a retention, then a list of [minutes after the start, rating]. Cards start New at T0.
  const scenarios: Array<{ name: string; retention: number; steps: Array<[number, Rating]> }> = [
    { name: "new-good-good-then-reviews", retention: 0.9, steps: [[0, 3], [10, 3], [25 * 60, 3], [4 * 1440, 3], [12 * 1440, 3], [30 * 1440, 3], [80 * 1440, 3]] },
    { name: "new-easy", retention: 0.9, steps: [[0, 4], [5 * 1440, 4], [30 * 1440, 4]] },
    { name: "new-again-hard-good", retention: 0.9, steps: [[0, 1], [1, 2], [8, 3], [20, 3], [2 * 1440, 3]] },
    { name: "lapse-and-relearn", retention: 0.9, steps: [[0, 3], [10, 3], [3 * 1440, 3], [10 * 1440, 1], [10 * 1440 + 10, 3], [10 * 1440 + 20, 2], [14 * 1440, 3], [30 * 1440, 1], [30 * 1440 + 15, 4]] },
    { name: "hard-ladder", retention: 0.9, steps: [[0, 2], [6, 2], [12, 3], [2 * 1440, 2], [5 * 1440, 2], [9 * 1440, 2]] },
    { name: "same-day-reviews", retention: 0.9, steps: [[0, 4], [30, 3], [90, 4], [200, 3]] },
    { name: "late-reviews", retention: 0.9, steps: [[0, 3], [10, 3], [60 * 1440, 3], [200 * 1440, 3], [900 * 1440, 4]] },
    { name: "retention-0.85", retention: 0.85, steps: [[0, 3], [10, 3], [2 * 1440, 3], [8 * 1440, 3], [25 * 1440, 3]] },
    { name: "retention-0.95", retention: 0.95, steps: [[0, 3], [10, 3], [2 * 1440, 3], [8 * 1440, 3], [25 * 1440, 3]] },
    { name: "dst-like-gaps", retention: 0.9, steps: [[0, 3], [10, 3], [23 * 60 + 50, 3], [48 * 60 + 5, 3], [97 * 60, 3]] },
  ];
  return scenarios.map((s) => {
    const sched = makeScheduler(s.retention);
    let c = newCard("n1", "d1", "recognize", T0);
    const out = s.steps.map(([min, rating]) => {
      c = answer(sched, c, rating, T0 + min * MIN);
      return { at: T0 + min * MIN, rating, expect: cardOut(c) };
    });
    return { name: s.name, retention: s.retention, start: T0, steps: out };
  });
}

const sampleNote = (over: Record<string, unknown> = {}): Note => ({
  id: "n1", type: "vocab", deckId: "d1", createdAt: T0, updatedAt: T0,
  fields: { word: "resilient", ipa: "rɪˈzɪljənt", pos: "adjective", vi: "kiên cường", en: "able to recover quickly", examples: ["Children are often more resilient than adults.", "The team stayed resilient."], mnemonic: "re-silient: springs back", ...over } as Note["fields"],
});

function templateVectors() {
  const layouts = [DEFAULT_PREFS.layout, { ...DEFAULT_PREFS.layout, showEn: false, showExamples: false, showIpa: false }];
  const notes: Note[] = [
    sampleNote(),
    sampleNote({ examples: [], mnemonic: "" }),
    sampleNote({ vi: "", examples: ["She is running fast."], word: "run", pos: "verb" }),
    sampleNote({ vi: "", en: "", examples: ["Please look after the kids."], word: "look after", pos: "" }),
    sampleNote({ vi: "", en: "", examples: [] }),
    // Translated examples: the cloze hint becomes the sentence's translation; the second example has none.
    sampleNote({ examplesVi: ["Trẻ em thường kiên cường hơn người lớn."], examples: ["Kids are tough.", "Children are often more resilient than adults."] }),
    sampleNote({ examplesVi: ["Cô ấy chạy nhanh.", "Họ chạy mỗi sáng."], vi: "chạy", en: "", word: "run", pos: "verb", examples: ["She is running fast.", "They run every morning."], mnemonic: "" }),
    sampleNote({ vi: "", examplesVi: ["Nhóm vẫn kiên cường."] }),
  ];
  const cases = [];
  for (const n of notes) {
    for (const [li, layout] of layouts.entries()) {
      const per: Record<string, unknown> = {};
      for (const id of ["recognize", "recall", "cloze", "listen"]) {
        const t = template("vocab", id)!;
        per[id] = t.applies(n)
          ? { applies: true, mode: t.mode, front: t.front(n, layout), back: t.back(n, layout), expected: t.expected ? t.expected(n) : null, speakFront: t.speak?.front?.(n) ?? null, speakBack: t.speak?.back?.(n) ?? null }
          : { applies: false };
      }
      cases.push({ note: n, layoutIndex: li, templates: per, wanted: wantedTemplates(n, { vocab: ["recognize", "recall", "cloze", "listen"] }), wantedDefault: wantedTemplates(n, DEFAULT_PREFS.templates) });
    }
  }
  const clozes = [
    ["She is running fast.", "run"], ["They studied hard.", "study"], ["Please look after the kids.", "look after"], ["Nothing here.", "resilient"],
    ["Children are often more resilient than adults.", "resilient"], ["He put it away, putting it back later.", "put"], ["Cats are cute.", "cat"], ["The bigger one.", "big"],
    ["Prices keep rising.", "rise"], ["An apple a day.", "apple"], ["It is what it is.", "is"],
  ].map(([s, w]) => ({ sentence: s, word: w, result: clozeSentence(s, w), at: findWord(s, w) }));
  const typed = [
    ["Resilient", ["resilient"]], ["  resilient ", ["resilient"]], ["resiliant", ["resilient"]], ["cat", ["cut"]], ["", ["x"]], ["look  after", ["look after"]],
    ["Café", ["cafe"]], ["it's", ["its"]], ["resilient!", ["resilient"]], ["procrastinatee", ["procrastinate"]], ["abc", ["abd"]],
  ].map(([t, e]) => ({ typed: t, expected: e, verdict: checkTyped(t as string, e as string[]), normalized: normalizeAnswer(t as string) }));
  return { layouts, cases, clozes, typed };
}

function confusableVectors() {
  const v = (id: string, word: string, vi: string, pos = "verb", type = "vocab"): Note => ({
    id, type, deckId: "d1", createdAt: T0, updatedAt: T0, fields: { word, vi, pos, en: `${word}: definition` } as Note["fields"],
  });
  const notes: Note[] = [
    v("n1", "convince", "thuyết phục; làm cho tin, làm cho nghe theo, thuyết phục"),
    v("n2", "persuade", "thuyết phục; làm cho tin; thuyết phục"),
    v("n3", "persuasion", "sự làm cho tin, sự thuyết phục; sự tin, sự tin chắc; tín ngưỡng; giáo phái", "noun"),
    v("n4", "important", "quan trọng; trọng yếu", "adjective"),
    v("n5", "importance", "tầm quan trọng", "noun"),
    v("n6", "significant", "quan trọng; đầy ý nghĩa", "adjective"),
    v("n7", "impose", "áp đặt"),
    v("n8", "Convince", "làm cho tin"),
    v("n9", "persuade", "thuyết phục", "verb", "toeic"),
    v("n10", "look after", "chăm sóc; trông nom"),
    v("n11", "take care of", "chăm sóc"),
    v("n12", "", "thuyết phục"),
    v("n13", "begin", "bắt đầu (đi, làm việc...); khởi đầu"),
    v("n14", "start", "bắt đầu; khởi hành"),
    v("n15", "Bắt", "BẮT ĐẦU"),
  ];
  const phrases = ["thuyết phục; làm cho tin", "sự làm cho tin, sự thuyết phục; sự tin", "bắt đầu (đi, làm việc...); chạy (máy)", "một cách nhanh chóng / mau lẹ", "", "  ;; , ", "Tính kiên nhẫn. “Bền bỉ”!", "x; y; x"]
    .map((vi) => ({ vi, phrases: meaningPhrases(vi) }));
  const lists = notes.map((n) => ({ noteId: n.id, confusables: confusables(n, notes) }));
  const conv = confusables(notes[0], notes);
  const typed = ["persuade", "Persuaded", "persuasions", "persuading", "convince", "resilient", "", "persuasion!"].map((t) => ({ typed: t, match: matchConfusable(t, conv)?.noteId ?? null }));
  const hints = [["convince", 0], ["convince", 1], ["convince", 3], ["convince", 99], ["look after", 1], ["look after", 5], ["well-being", 2], ["it's", 1], ["ox", 1], ["café", 2], ["", 1]]
    .map(([a, n]) => ({ answer: a, shown: n, hint: answerHint(a as string, n as number), letters: letterCount(a as string) }));
  const ratings = (["correct", "close", "wrong"] as const).flatMap((verdict) =>
    [[0, false], [1, false], [0, true], [2, true]].map(([extraHints, retried]) => ({ verdict, extraHints, retried, rating: suggestedRatingWith(verdict, { extraHints: extraHints as number, retried: retried as boolean }) })),
  );
  return { notes, phrases, lists, typed, hints, ratings };
}

function morphyVectors() {
  const words = ["running", "studies", "boxes", "bigger", "loved", "went", "children", "a", "cat", "stopped", "tried", "making", "happier", "geese", "bought", "was", "mice", "caught", "lives", "buses", "wolves", "better", "dogs", "watches", "flies", "hoped", "hopping", "taken", "ran", "Running", "  went "];
  return words.map((w) => ({ word: w, forms: baseForms(w, IRREGULAR) }));
}

function queueVectors() {
  const mk = (id: string, noteId: string, over: Partial<Card> = {}): Card => ({ ...newCard(noteId, "d1", "recognize", T0), id, ...over });
  const cards: Card[] = [
    mk("new1", "n1", { createdAt: T0 + 1 }), mk("new1b", "n1", { template: "cloze", createdAt: T0 + 2 }), mk("new2", "n2", { createdAt: T0 + 3 }), mk("new3", "n3", { createdAt: T0 + 4 }),
    mk("rev-over", "n4", { state: CardState.Review, due: T0 - 2 * DAY, createdAt: T0 - 9 * DAY }),
    mk("rev-now", "n5", { state: CardState.Review, due: T0 - 1, createdAt: T0 - 9 * DAY }),
    mk("rev-later-today", "n6", { state: CardState.Review, due: T0 + 3 * HOUR, createdAt: T0 - 9 * DAY }),
    mk("rev-tomorrow", "n7", { state: CardState.Review, due: T0 + 30 * HOUR, createdAt: T0 - 9 * DAY }),
    mk("learn-due", "n8", { state: CardState.Learning, due: T0 - MIN, createdAt: T0 - 9 * DAY }),
    mk("learn-soon", "n9", { state: CardState.Learning, due: T0 + 10 * MIN, createdAt: T0 - 9 * DAY }),
    mk("relearn-later", "n10", { state: CardState.Relearning, due: T0 + 50 * MIN, createdAt: T0 - 9 * DAY }),
    mk("suspended", "n11", { suspended: true }),
    mk("other-deck", "n12", { deckId: "d2" }),
    mk("ineligible", "n13"),
  ];
  const eligible = (c: Card) => c.id !== "ineligible";
  const today = { id: "x", newCards: 1, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: 0 };
  const scenarios = [
    { name: "default", prefs: { ...DEFAULT_PREFS, newPerDay: 3, dayStartHour: 4 }, today: undefined, deckId: null, buried: [] as string[], learnAheadMs: 0 },
    { name: "limits-and-today", prefs: { ...DEFAULT_PREFS, newPerDay: 3, maxReviewsPerDay: 2, dayStartHour: 4 }, today, deckId: null, buried: [], learnAheadMs: 0 },
    { name: "learn-ahead-and-buried", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: ["n2", "n5"], learnAheadMs: 20 * MIN },
    { name: "deck-filter", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: "d2", buried: [], learnAheadMs: 0 },
    { name: "tag-filter", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0, noteIds: ["n1", "n4", "n7", "n9", "n11"] },
    { name: "review-ahead", prefs: { ...DEFAULT_PREFS, newPerDay: 0, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0, reviewAheadDays: 1 },
  ] as Array<{ name: string; prefs: typeof DEFAULT_PREFS; today?: typeof today; deckId: string | null; buried: string[]; learnAheadMs: number; extra?: Card[]; meanings?: Record<string, string[]>; noteIds?: string[]; reviewAheadDays?: number }>;
  // Near-synonyms: a new word waits while another word with a shared meaning phrase is new in this queue or still settling.
  const syn = (id: string, noteId: string, at: number, over: Partial<Card> = {}) => mk(id, noteId, { createdAt: T0 + at, ...over });
  scenarios.push({
    name: "near-synonyms", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0,
    extra: [
      syn("syn-persuade", "s1", 10), syn("syn-convince", "s2", 11), syn("syn-assure", "s3", 12), syn("syn-other", "s4", 13),
      syn("settling-rev", "s5", -9 * DAY, { state: CardState.Review, due: T0 + 30 * HOUR, scheduledDays: 2 }), syn("syn-near-settling", "s6", 14),
      syn("settled-rev", "s7", -9 * DAY, { state: CardState.Review, due: T0 + 30 * HOUR, scheduledDays: 10 }), syn("syn-near-settled", "s8", 15),
      syn("own-learning", "s9", -DAY, { state: CardState.Learning, due: T0 + 50 * MIN }), syn("own-new-sibling", "s9", 16, { template: "cloze" }),
      syn("relearn-other-deck", "s10", -9 * DAY, { state: CardState.Relearning, due: T0 + 50 * MIN, deckId: "d2" }), syn("syn-near-relearn", "s11", 17),
    ],
    meanings: {
      s1: ["thuyết phục"], s2: ["thuyết phục", "làm cho tin"], s3: ["làm cho tin", "bảo đảm"], s4: ["giao hàng"],
      s5: ["hoãn lại"], s6: ["hoãn lại"], s7: ["hủy bỏ"], s8: ["hủy bỏ"], s9: ["trì hoãn"], s10: ["đàm phán"], s11: ["đàm phán", "thương lượng"],
    },
  });
  // A new note's cards made at the same moment: the word is introduced with "recognize", never with a typing card.
  scenarios.push({
    name: "intro-order", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0,
    extra: [
      mk("o1.cloze", "o1", { template: "cloze", createdAt: T0 + 20 }), mk("o1.recognize", "o1", { createdAt: T0 + 20 }),
      mk("o2.listen", "o2", { template: "listen", createdAt: T0 + 21 }), mk("o2.recall", "o2", { template: "recall", createdAt: T0 + 21 }),
      mk("o3.cloze", "o3", { template: "cloze", createdAt: T0 + 22 }), mk("o3.custom", "o3", { template: "custom", createdAt: T0 + 22 }),
    ],
  });
  return scenarios.map((s) => {
    const all = [...cards, ...(s.extra ?? [])];
    const meanings = s.meanings ? new Map(Object.entries(s.meanings)) : undefined;
    const q = buildQueue({ cards: all, eligible, today: s.today, prefs: s.prefs, now: T0, deckId: s.deckId, buried: new Set(s.buried), learnAheadMs: s.learnAheadMs, meanings, noteIds: s.noteIds ? new Set(s.noteIds) : undefined, reviewAheadDays: s.reviewAheadDays });
    // Walk the session the way the UI does: pick, drop the picked card from its list, repeat.
    const order: string[] = [];
    const sess = { shown: 0, shownNew: 0 };
    const rest = { ...q, learning: [...q.learning], review: [...q.review], newCards: [...q.newCards] };
    for (let i = 0; i < 20; i++) {
      const c = pickNext(rest, sess, T0 + 24 * HOUR * 0); // learning cards not yet due are returned last
      if (!c) break;
      order.push(c.id);
      sess.shown++;
      if (c.state === CardState.New) sess.shownNew++;
      for (const list of [rest.learning, rest.review, rest.newCards]) {
        const k = list.findIndex((x) => x.id === c.id);
        if (k >= 0) list.splice(k, 1);
      }
    }
    return { name: s.name, input: { prefs: normalizePrefs(s.prefs), today: s.today ?? null, deckId: s.deckId, buried: s.buried, learnAheadMs: s.learnAheadMs, now: T0, meanings: s.meanings ?? null, noteIds: s.noteIds ?? null, reviewAheadDays: s.reviewAheadDays ?? 0 }, counts: q.counts, learning: q.learning.map((c) => c.id), review: q.review.map((c) => c.id), newCards: q.newCards.map((c) => c.id), order, cards: all };
  });
}

function irregularKotlin(): string {
  const entries = Object.entries(IRREGULAR).sort(([a], [b]) => (a < b ? -1 : 1));
  const body = entries.map(([k, v]) => `    "${k}" to "${v}",`).join("\n");
  return `package com.vh.lexi.core

// GENERATED by web/test/vectors.test.ts from shared/irregular.ts. Do not edit by hand.
val IRREGULAR: Map<String, String> = mapOf(
${body}
)
`;
}

it("cross-platform vectors are up to date", () => {
  const dir = join(__dirname, "../../shared/vectors");
  const files: Array<[string, string]> = [
    ["fsrs.json", JSON.stringify(fsrsVectors(), null, 1)],
    ["templates.json", JSON.stringify(templateVectors(), null, 1)],
    ["morphy.json", JSON.stringify(morphyVectors(), null, 1)],
    ["confusables.json", JSON.stringify(confusableVectors(), null, 1)],
    ["queue.json", JSON.stringify(queueVectors(), null, 1)],
    [join("../../android/core/src/main/kotlin/com/vh/lexi/core/Irregular.kt"), irregularKotlin()],
  ];
  for (const [name, text] of files) {
    const path = join(dir, name);
    if (process.env.UPDATE_VECTORS || !existsSync(path)) writeFileSync(path, text + (text.endsWith("\n") ? "" : "\n"));
    // A Windows checkout with core.autocrlf turns LF into CRLF; the content is what matters.
    expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim(), name).toBe(text.trim());
  }
});
