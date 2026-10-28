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
import { checkTyped, clozeSentence, normalizeAnswer, template, wantedTemplates } from "@shared/notetypes.ts";
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
  ];
  const cases = [];
  for (const n of notes) {
    for (const [li, layout] of layouts.entries()) {
      const per: Record<string, unknown> = {};
      for (const id of ["recognize", "recall", "cloze"]) {
        const t = template("vocab", id)!;
        per[id] = t.applies(n)
          ? { applies: true, mode: t.mode, front: t.front(n, layout), back: t.back(n, layout), expected: t.expected ? t.expected(n) : null, speakFront: t.speak?.front?.(n) ?? null, speakBack: t.speak?.back?.(n) ?? null }
          : { applies: false };
      }
      cases.push({ note: n, layoutIndex: li, templates: per, wanted: wantedTemplates(n, { vocab: ["recognize", "recall", "cloze"] }), wantedDefault: wantedTemplates(n, DEFAULT_PREFS.templates) });
    }
  }
  const clozes = [
    ["She is running fast.", "run"], ["They studied hard.", "study"], ["Please look after the kids.", "look after"], ["Nothing here.", "resilient"],
    ["Children are often more resilient than adults.", "resilient"], ["He put it away, putting it back later.", "put"], ["Cats are cute.", "cat"], ["The bigger one.", "big"],
    ["Prices keep rising.", "rise"], ["An apple a day.", "apple"], ["It is what it is.", "is"],
  ].map(([s, w]) => ({ sentence: s, word: w, result: clozeSentence(s, w) }));
  const typed = [
    ["Resilient", ["resilient"]], ["  resilient ", ["resilient"]], ["resiliant", ["resilient"]], ["cat", ["cut"]], ["", ["x"]], ["look  after", ["look after"]],
    ["Café", ["cafe"]], ["it's", ["its"]], ["resilient!", ["resilient"]], ["procrastinatee", ["procrastinate"]], ["abc", ["abd"]],
  ].map(([t, e]) => ({ typed: t, expected: e, verdict: checkTyped(t as string, e as string[]), normalized: normalizeAnswer(t as string) }));
  return { layouts, cases, clozes, typed };
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
  ];
  return scenarios.map((s) => {
    const q = buildQueue({ cards, eligible, today: s.today, prefs: s.prefs, now: T0, deckId: s.deckId, buried: new Set(s.buried), learnAheadMs: s.learnAheadMs });
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
    return { name: s.name, input: { prefs: normalizePrefs(s.prefs), today: s.today ?? null, deckId: s.deckId, buried: s.buried, learnAheadMs: s.learnAheadMs, now: T0 }, counts: q.counts, learning: q.learning.map((c) => c.id), review: q.review.map((c) => c.id), newCards: q.newCards.map((c) => c.id), order };
  }).map((v) => ({ ...v, cards }));
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
    ["queue.json", JSON.stringify(queueVectors(), null, 1)],
    [join("../../android/core/src/main/kotlin/com/vh/lexi/core/Irregular.kt"), irregularKotlin()],
  ];
  for (const [name, text] of files) {
    const path = join(dir, name);
    if (process.env.UPDATE_VECTORS || !existsSync(path)) writeFileSync(path, text + (text.endsWith("\n") ? "" : "\n"));
    expect(readFileSync(path, "utf8").trim(), name).toBe(text.trim());
  }
});
