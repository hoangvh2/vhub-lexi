/**
 * Cross-platform contract. The Android app re-implements FSRS scheduling, queueing, templates, cloze and
 * morphology in Kotlin; its unit tests replay these vectors, produced here by the reference (TypeScript) code.
 * A change in behaviour fails this test until the vectors are regenerated and the Kotlin port is updated:
 *   UPDATE_VECTORS=1 npx vitest run test/vectors.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, normalizePrefs, type Card, type Daily, type Note, type Rating } from "@shared/model.ts";
import { IRREGULAR } from "@shared/irregular.ts";
import { baseForms } from "@shared/morphy.ts";
import { type Block, checkTyped, clozeSentence, findExact, findWord, normalizeAnswer, noteView, parsePatternItem, patternOptions, phrasesOf, studyNote, template, wantedTemplates } from "@shared/notetypes.ts";
import { planSeed, seedIdRange, slugVi, type SeedPack } from "@shared/seed.ts";
import { answerHint, confusables, hintNote, letterCount, matchConfusable, meaningPhrases, suggestedRatingWith, typingTarget } from "@shared/confusables.ts";
import { buildQueue, pickNext } from "../src/lib/queue.ts";
import { answer, makeScheduler, newCard } from "../src/lib/scheduler.ts";
import { aiFieldsOf, draftsFrom, grammarFields, problems, type ExtractedQuestion } from "../src/lib/import.ts";
import { analyze, sentenceAround } from "../src/lib/readcheck.ts";
import { testTag } from "../src/lib/practice.ts";
import { flashWords, lettersShown, nextRung, otherPhrase, rungHint, type Rung } from "@shared/ladder.ts";
import { hintCue, hintDependent, hintGateMs, maskHint, maxRating, meaningTerms, rotateExamples } from "@shared/hints.ts";

const T0 = Date.UTC(2026, 0, 15, 8, 30, 0);
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function cardOut(c: Card) {
  return { state: c.state, due: c.due, stability: c.stability, difficulty: c.difficulty, scheduledDays: c.scheduledDays, learningSteps: c.learningSteps, reps: c.reps, lapses: c.lapses, lastReview: c.lastReview ?? null };
}

/** Fitted by the optimizer on a simulated history (see optimizer.test.ts), already inside ts-fsrs' clip ranges. */
const OPTIMIZED_W = [0.0376, 0.2291, 0.4086, 1.4697, 6.5213, 0.722, 2.9, 0.001, 1.7588, 0.2643, 0.6813, 1.411, 0.0748, 0.1829, 1.5497, 0.6014, 1.8729, 0.5472, 0.0013, 0.0476, 0.1058];

function fsrsVectors() {
  // Each scenario: a retention, then a list of [minutes after the start, rating]. Cards start New at T0.
  const scenarios: Array<{ name: string; retention: number; steps: Array<[number, Rating]>; startMemory?: { stability: number; difficulty: number }; w?: number[] }> = [
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
    // A new card that carries a stale memory state (what the first Anki importer stored) schedules like a clean one.
    { name: "new-with-stale-memory", retention: 0.9, startMemory: { stability: 0, difficulty: 1 }, steps: [[0, 3], [10, 3], [2 * 1440, 3]] },
    // Parameters an optimizer run produced (Prefs.fsrsWeights): every formula must read w, not the defaults.
    { name: "optimized-weights", retention: 0.9, w: OPTIMIZED_W, steps: [[0, 1], [3, 3], [15, 3], [2 * 1440, 2], [6 * 1440, 3], [20 * 1440, 1], [20 * 1440 + 12, 3], [26 * 1440, 4], [70 * 1440, 3]] },
    { name: "optimized-weights-easy", retention: 0.85, w: OPTIMIZED_W, steps: [[0, 4], [4 * 1440, 3], [4 * 1440 + 30, 3], [40 * 1440, 4]] },
  ];
  return scenarios.map((s) => {
    const sched = makeScheduler(s.retention, s.w);
    let c = { ...newCard("n1", "d1", "recognize", T0), ...s.startMemory };
    const out = s.steps.map(([min, rating]) => {
      c = answer(sched, c, rating, T0 + min * MIN);
      return { at: T0 + min * MIN, rating, expect: cardOut(c) };
    });
    return { name: s.name, retention: s.retention, start: T0, ...(s.startMemory ? { startMemory: s.startMemory } : {}), ...(s.w ? { w: s.w } : {}), steps: out };
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
    // The sentence uses an inflected form: the hint must still describe "sail" (4 letters), not "sailed".
    sampleNote({ word: "sail", pos: "verb", vi: "đi thuyền", en: "", ipa: "", mnemonic: "", examples: ["We sailed the Atlantic"] }),
    // Short phrases, one per meaning: the cloze card turns them by review count; every answer side lists them.
    sampleNote({
      word: "accommodate", pos: "verb", ipa: "", mnemonic: "", en: "",
      vi: "(chứa) chứa được; (dịch vụ) đáp ứng; (công việc) tạo điều kiện",
      phrases: ["accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu", "She accommodates new staff | tạo điều kiện cho nhân viên mới"],
      examples: ["The hotel can accommodate a large group of tourists."], examplesVi: ["Khách sạn có thể chứa một đoàn du khách lớn."],
    }),
    // A phrase with no meaning, one that lacks the word (ignored), and no translation for the full example.
    sampleNote({ word: "charge", pos: "noun", ipa: "", mnemonic: "", en: "", vi: "phí", phrases: ["a delivery charge", "welcome to our shop | chào mừng", "in charge of sales | phụ trách bán hàng"], examples: ["There is no charge for delivery."], examplesVi: [] }),
    // Phrases but no example sentence at all: recognize and recall work, cloze and listen do not apply.
    sampleNote({ word: "lend", pos: "verb", ipa: "", mnemonic: "", en: "", vi: "cho vay", phrases: ["lend me a pen | cho tôi mượn cây bút"], examples: [] }),
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
  // What one fill-in-the-blank card shows, by review count (studyNote): the phrase it asks, its accepted forms, the answer side.
  const study = notes.flatMap((n) =>
    [0, 1, 2, 3, 7].map((reps) => {
      const v = studyNote(n, "cloze", reps);
      const t = template("vocab", "cloze")!;
      return {
        note: n, reps, phrases: phrasesOf(n), examples: v.fields.examples ?? [], examplesVi: v.fields.examplesVi ?? [],
        applies: t.applies(v), ...(t.applies(v) ? { front: t.front(v, layouts[0]), back: t.back(v, layouts[0]), expected: t.expected!(v), speakBack: t.speak?.back?.(v) ?? null } : {}),
      };
    }),
  );
  const clozes = [
    ["She is running fast.", "run"], ["They studied hard.", "study"], ["Please look after the kids.", "look after"], ["Nothing here.", "resilient"],
    ["Children are often more resilient than adults.", "resilient"], ["He put it away, putting it back later.", "put"], ["Cats are cute.", "cat"], ["The bigger one.", "big"],
    ["Prices keep rising.", "rise"], ["An apple a day.", "apple"], ["It is what it is.", "is"], ["We sailed the Atlantic", "sail"], ["Two cafés here.", "café"], ["Một naïve idea.", "naïve"],
  ].map(([s, w]) => ({ sentence: s, word: w, result: clozeSentence(s, w), at: findWord(s, w) }));
  const typed = [
    ["Resilient", ["resilient"]], ["  resilient ", ["resilient"]], ["resiliant", ["resilient"]], ["cat", ["cut"]], ["", ["x"]], ["look  after", ["look after"]],
    ["Café", ["cafe"]], ["it's", ["its"]], ["resilient!", ["resilient"]], ["procrastinatee", ["procrastinate"]], ["abc", ["abd"]],
  ].map(([t, e]) => ({ typed: t, expected: e, verdict: checkTyped(t as string, e as string[]), normalized: normalizeAnswer(t as string) }));
  // Grammar notes (TOEIC Part 5): the 'fill' template, and which note types make no card at all.
  const g = (id: string, fields: Record<string, string>): Note => ({ id, type: "grammar", deckId: "d1", createdAt: T0, updatedAt: T0, fields });
  const grammarNotes: Note[] = [
    g("g1", { sentence: "Should you need any help, please call us.", answer: "Should", topic: "Đảo ngữ", translation: "Nếu cần giúp, hãy gọi chúng tôi.", rule: "Should + S + V = If + S + should + V" }),
    g("g2", { sentence: "The completion of the report was delayed.", answer: "completion" }),
    g("g3", { sentence: "The completion of the report was delayed.", answer: "complete" }),
    g("g4", { sentence: "She has worked here since 2019.", answer: "has worked", topic: "Thì và bị động", rule: "Since + mốc thời gian đi với thì hiện tại hoàn thành" }),
    g("g5", { sentence: "Call us.", answer: "" }),
  ];
  const grammar = grammarNotes.map((n) => {
    const t = template("grammar", "fill")!;
    return {
      note: n,
      applies: t.applies(n),
      ...(t.applies(n) ? { mode: t.mode, front: t.front(n, layouts[0]), back: t.back(n, layouts[0]), expected: t.expected!(n), speakBack: t.speak?.back?.(n) ?? null } : {}),
      wanted: wantedTemplates(n, undefined),
      exact: findExact(String(n.fields.sentence), String(n.fields.answer)),
    };
  });
  const testNote: Note = { id: "t1", type: "test", deckId: "d1", createdAt: T0, updatedAt: T0, fields: { name: "Test 1", p5: "20/30" } };
  const noCards = { type: testNote.type, wanted: wantedTemplates(testNote, undefined) };
  return { layouts, cases, study, clozes, typed, grammar, noCards };
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
  // The typing hint follows the word being learned, whatever form the sentence uses (sail / sailed).
  const targets = [
    ["sail"], ["sail", "sailed"], ["sail", "Sailed"], ["sail", "sails"], ["run", "running"], ["make", "made"], ["complete", "completion"], ["look after", "looked after"],
    ["look after", "look"], ["well-being", "well-being"], ["it's", "it's"], ["café", "cafés"], ["happy", "happily"], ["box", "boxes"], [],
  ].map((e) => { const t = typingTarget(e); return { expected: e, word: t.word, ending: t.ending, note: hintNote(t), letters: letterCount(t.word), hint: answerHint(t.word, 1) }; });
  const ratings = (["correct", "close", "wrong"] as const).flatMap((verdict) =>
    [[0, false], [1, false], [0, true], [2, true]].map(([extraHints, retried]) => ({ verdict, extraHints, retried, rating: suggestedRatingWith(verdict, { extraHints: extraHints as number, retried: retried as boolean }) })),
  );
  return { notes, phrases, lists, typed, hints, targets, ratings };
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
  const today: Daily = { id: "x", newCards: 1, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: 0 };
  const scenarios = [
    { name: "default", prefs: { ...DEFAULT_PREFS, newPerDay: 3, dayStartHour: 4 }, today: undefined, deckId: null, buried: [] as string[], learnAheadMs: 0 },
    { name: "limits-and-today", prefs: { ...DEFAULT_PREFS, newPerDay: 3, maxReviewsPerDay: 2, dayStartHour: 4 }, today, deckId: null, buried: [], learnAheadMs: 0 },
    { name: "learn-ahead-and-buried", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: ["n2", "n5"], learnAheadMs: 20 * MIN },
    { name: "deck-filter", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: "d2", buried: [], learnAheadMs: 0 },
    { name: "tag-filter", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0, noteIds: ["n1", "n4", "n7", "n9", "n11"] },
    { name: "review-ahead", prefs: { ...DEFAULT_PREFS, newPerDay: 0, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0, reviewAheadDays: 1 },
  ] as Array<{ name: string; prefs: typeof DEFAULT_PREFS; today?: Daily; deckId: string | null; buried: string[]; learnAheadMs: number; extra?: Card[]; only?: boolean; weights?: Record<string, number>; meanings?: Record<string, string[]>; noteIds?: string[]; reviewAheadDays?: number }>;
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
  // A word is typed only once recognised: typing cards wait while recognize is new/learning/relearning or was answered
  // today; recognize in Review since an earlier day, suspended, or missing lets them through.
  scenarios.push({
    name: "typing-waits-for-recognize", prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0, only: true,
    extra: [
      mk("t1.recognize", "t1", { state: CardState.Learning, due: T0 + 2 * HOUR, lastReview: T0 - 2 * DAY, createdAt: T0 - 9 * DAY }), mk("t1.cloze", "t1", { template: "cloze", createdAt: T0 - 9 * DAY }),
      mk("t2.recognize", "t2", { state: CardState.Review, due: T0 + 2 * DAY, scheduledDays: 2, lastReview: T0 - 10 * MIN, createdAt: T0 - 8 * DAY }), mk("t2.recall", "t2", { template: "recall", createdAt: T0 - 8 * DAY }),
      mk("t3.recognize", "t3", { state: CardState.Review, due: T0 + 2 * DAY, scheduledDays: 3, lastReview: T0 - DAY, createdAt: T0 - 7 * DAY }), mk("t3.listen", "t3", { template: "listen", createdAt: T0 - 7 * DAY }), mk("t3.recall", "t3", { template: "recall", createdAt: T0 - 7 * DAY }),
      mk("t4.recognize", "t4", { state: CardState.Relearning, due: T0 + 2 * HOUR, lastReview: T0 - 2 * DAY, createdAt: T0 - 6 * DAY }), mk("t4.recall", "t4", { template: "recall", createdAt: T0 - 6 * DAY }),
      mk("t5.recognize", "t5", { suspended: true, createdAt: T0 - 5 * DAY }), mk("t5.cloze", "t5", { template: "cloze", createdAt: T0 - 5 * DAY }),
      mk("t6.cloze", "t6", { template: "cloze", createdAt: T0 - 4 * DAY }),
      mk("t7.cloze", "t7", { template: "cloze", createdAt: T0 - 3 * DAY }), mk("t7.recognize", "t7", { createdAt: T0 - 3 * DAY }),
    ],
  });
  // The daily new quota counts words: typing cards of recognised words come on top of it (one per word), recognize cards use it.
  scenarios.push({
    name: "quota-counts-words", prefs: { ...DEFAULT_PREFS, newPerDay: 1, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 0, only: true,
    extra: [
      mk("q1.recognize", "q1", { state: CardState.Review, due: T0 + 4 * DAY, scheduledDays: 4, lastReview: T0 - 2 * DAY, createdAt: T0 - 9 * DAY }), mk("q1.listen", "q1", { template: "listen", createdAt: T0 - 9 * DAY }), mk("q1.cloze", "q1", { template: "cloze", createdAt: T0 - 9 * DAY }),
      mk("q2.recognize", "q2", { createdAt: T0 - 5 * DAY }), mk("q2.cloze", "q2", { template: "cloze", createdAt: T0 - 5 * DAY }),
      mk("q3.recognize", "q3", { createdAt: T0 - 4 * DAY }),
      mk("q4.cloze", "q4", { template: "cloze", createdAt: T0 - 3 * DAY }), mk("q5.cloze", "q5", { template: "cloze", createdAt: T0 - 2 * DAY }),
    ],
  });
  // A word answered today keeps its review cards for tomorrow (also under review ahead); learning steps still come back.
  scenarios.push({
    name: "answered-today", prefs: { ...DEFAULT_PREFS, newPerDay: 0, dayStartHour: 4 }, today: undefined, deckId: null, buried: [], learnAheadMs: 20 * MIN, reviewAheadDays: 30,
    extra: [
      mk("h1.recognize", "h1", { state: CardState.Review, due: T0 + 27 * DAY, lastReview: T0 - 10 * MIN, createdAt: T0 - 60 * DAY }),
      mk("h1.cloze", "h1", { template: "cloze", state: CardState.Review, due: T0 - HOUR, lastReview: T0 - 5 * DAY, createdAt: T0 - 60 * DAY }),
      mk("h2.recognize", "h2", { state: CardState.Review, due: T0 + 3 * DAY, lastReview: T0 - 5 * HOUR, createdAt: T0 - 60 * DAY }),
      mk("h2.cloze", "h2", { template: "cloze", state: CardState.Review, due: T0 - 2 * HOUR, lastReview: T0 - 5 * DAY, createdAt: T0 - 60 * DAY }),
      mk("h3.recognize", "h3", { state: CardState.Relearning, due: T0 + 5 * MIN, lastReview: T0 - 5 * MIN, createdAt: T0 - 60 * DAY }),
      mk("h3.cloze", "h3", { template: "cloze", state: CardState.Review, due: T0 - 3 * HOUR, lastReview: T0 - 5 * DAY, createdAt: T0 - 60 * DAY }),
    ],
  });
  // Daily new words shared between decks by weight (Deck.newWeight): four decks, 50/25/15/10, ten words a day.
  const deckCards = (deck: string, n: number, base: number) =>
    Array.from({ length: n }, (_, k) => mk(`${deck}${k}`, `${deck}-n${k}`, { deckId: deck, createdAt: T0 + base + k }));
  const fourDecks = [...deckCards("dA", 12, 100), ...deckCards("dB", 12, 50), ...deckCards("dC", 12, 20), ...deckCards("dD", 12, 1)];
  const week = { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 };
  const blank = { today: undefined, deckId: null, buried: [] as string[], learnAheadMs: 0, only: true };
  scenarios.push({ name: "weights-four-decks", prefs: week, ...blank, weights: { dA: 50, dB: 25, dC: 15, dD: 10 }, extra: fourDecks });
  scenarios.push({ name: "weights-equal-by-default", prefs: week, ...blank, extra: fourDecks });
  // B has one word, C is paused: B gives back its share, nothing goes to C.
  scenarios.push({ name: "weights-short-and-paused", prefs: week, ...blank, weights: { dA: 50, dB: 25, dC: 0, dD: 25 }, extra: [...deckCards("dA", 12, 100), ...deckCards("dB", 1, 50), ...deckCards("dC", 12, 20), ...deckCards("dD", 12, 1)] });
  // Half way through the day: A and B already gave their share, so only C and D are left to fill.
  scenarios.push({
    name: "weights-midday", prefs: week, ...blank, weights: { dA: 50, dB: 25, dC: 15, dD: 10 }, extra: fourDecks,
    today: { ...today, newCards: 7, newByDeck: { dA: 5, dB: 2 } },
  });
  // Weights changed during the day: A is already past its new share, the rest is trimmed to what is left.
  scenarios.push({
    name: "weights-changed-midday", prefs: week, ...blank, weights: { dA: 10, dB: 40, dC: 40, dD: 10 }, extra: fourDecks,
    today: { ...today, newCards: 6, newByDeck: { dA: 6 } },
  });
  // Few words a day, many decks: each deck above 0% still gets one.
  scenarios.push({ name: "weights-at-least-one", prefs: { ...week, newPerDay: 4 }, ...blank, weights: { dA: 70, dB: 20, dC: 6, dD: 4 }, extra: fourDecks });
  // A near-synonym of an earlier pick holds a word back, so the gap is filled from the other decks.
  scenarios.push({
    name: "weights-synonym-gap", prefs: { ...week, newPerDay: 4 }, ...blank, weights: { dA: 50, dB: 50 }, extra: [...deckCards("dA", 5, 100), ...deckCards("dB", 2, 50)],
    meanings: { "dA-n0": ["thuyết phục"], "dB-n0": ["thuyết phục"], "dB-n1": ["thuyết phục"] },
  });
  return scenarios.map((s) => {
    const all = [...(s.only ? [] : cards), ...(s.extra ?? [])];
    const meanings = s.meanings ? new Map(Object.entries(s.meanings)) : undefined;
    const weights = s.weights ? new Map(Object.entries(s.weights)) : undefined;
    const q = buildQueue({ cards: all, eligible, today: s.today, prefs: s.prefs, now: T0, deckId: s.deckId, buried: new Set(s.buried), learnAheadMs: s.learnAheadMs, meanings, deckWeights: weights, noteIds: s.noteIds ? new Set(s.noteIds) : undefined, reviewAheadDays: s.reviewAheadDays });
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
    return { name: s.name, input: { prefs: normalizePrefs(s.prefs), today: s.today ?? null, deckId: s.deckId, buried: s.buried, learnAheadMs: s.learnAheadMs, now: T0, meanings: s.meanings ?? null, deckWeights: s.weights ?? null, noteIds: s.noteIds ?? null, reviewAheadDays: s.reviewAheadDays ?? 0 }, counts: q.counts, learning: q.learning.map((c) => c.id), review: q.review.map((c) => c.id), newCards: q.newCards.map((c) => c.id), freeNew: q.freeNew.map((c) => c.id), order, cards: all };
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

function importVectors() {
  const opts = (a: string, b: string, c: string, d: string) => ({ A: a, B: b, C: c, D: d });
  const q = (o: Partial<ExtractedQuestion>): ExtractedQuestion => ({
    number: 132, part: 6, kind: "fill", stem: "Many fans are already _____ that it will be a sequel.", options: opts("requesting", "analyzing", "confirming", "speculating"),
    correct: "D", result: "wrong", passage: 1, topic: "Khác", rule: "speculating that: đoán rằng.", translation: "Nhiều người hâm mộ đã suy đoán.", flags: [], ...o,
  });
  const cases: Array<{ name: string; existing: string[]; questions: ExtractedQuestion[] }> = [
    { name: "missed question passes every check", existing: [], questions: [q({})] },
    { name: "answered right is not preselected", existing: [], questions: [q({ result: "right" })] },
    { name: "no result is preselected", existing: [], questions: [q({ result: "unknown" })] },
    { name: "no answer blocks", existing: [], questions: [q({ correct: null, rule: "", translation: "" })] },
    { name: "answer option empty is dropped", existing: [], questions: [q({ correct: "B", options: opts("a", "", "c", "d") })] },
    { name: "no blank blocks", existing: [], questions: [q({ stem: "Many fans are already speculating." })] },
    { name: "blank inside a word blocks", existing: [], questions: [q({ stem: "Fans re_____ to the news.", options: opts("act", "acts", "acted", "acting"), correct: "A" })] },
    { name: "duplicate is flagged and not preselected", existing: ["many fans are already speculating that it will be a sequel."], questions: [q({})] },
    { name: "unsure and few options are flagged", existing: [], questions: [q({ flags: ["unsure", "few-options"] })] },
    { name: "phrase answer and capital start", existing: [], questions: [q({ number: 101, part: 5, stem: "_____ you need any help, please call us.", options: opts("Should", "Because", "Despite", "Unless"), correct: "A", topic: "Đảo ngữ" })] },
    { name: "multi-word answer", existing: [], questions: [q({ stem: "A preview of the game _____ a presentation will be streamed.", options: opts("how", "as well as", "but", "even though"), correct: "B", topic: "Giới từ / liên từ" })] },
    { name: "insert and reading questions are skipped", existing: [], questions: [q({}), q({ kind: "insert", stem: "Which sentence fits?" }), q({ kind: "reading", stem: "What is the email about?" })] },
    { name: "missing optional fields", existing: [], questions: [{ kind: "fill", stem: "Please _____ us.", options: opts("call", "calls", "called", "calling"), correct: "A" } as unknown as ExtractedQuestion] },
  ];
  return cases.map((c) => {
    const { drafts, skipped } = draftsFrom({ passages: [], questions: c.questions }, new Set(c.existing));
    return {
      ...c, skipped,
      drafts: drafts.map((d) => ({ number: d.number, include: d.include, correct: d.correct, fields: grammarFields(d), problems: problems(d, new Set(c.existing)), aiFields: aiFieldsOf(d) })),
    };
  });
}

function readcheckVectors() {
  const index = { merger: "deck", invoice: "known", agenda: "deck", approve: "known", game: "known" } as const;
  const texts: Array<{ name: string; text: string; ignored?: string[] }> = [
    { name: "email with names, a heading and abbreviations", text: "Dear Ms. Tran,\nThe merger with Acme Corp. was postponed until the invoice is approved. Please review the agenda.\nThe NASA team won't attend." },
    { name: "part 6 passage with blanks", text: "OSAKA (14 October) - Maruya Interactive revealed this morning that it will unveil its newest video game later this week. A preview of the game _____ a presentation from the design team will be streamed on the company's Web site on Thursday at 3:00 P.M. Japan Standard Time." },
    { name: "heading lines and lists", text: "BOOKKEEPING FUNDAMENTALS\nOctober 1, 7 P.M.\nKingsley County Library System, Ashwood Branch\n- Set up a simple record-keeping system that works for you\n- Record your daily income and expenses accurately\n1. Prepare basic financial statements" },
    { name: "known words and ignored", text: "She approved the invoices; the merger is postponed. Postponing is not a good idea.", ignored: ["postponed"] },
    { name: "contractions and plurals", text: "They don't know the company's plans, and we can't reveal what we've seen, children's books aren't ready." },
    { name: "empty and numbers only", text: "12345 ... ?!" },
  ];
  const around = [
    { text: "First sentence. The merger was postponed. Last one.", at: 20, max: 300 },
    { text: "Line one\nThe agenda is long and tedious without end", at: 14, max: 300 },
    { text: "x ".repeat(200) + "merger " + "y ".repeat(200), at: 400, max: 60 },
  ];
  return {
    index,
    analyses: texts.map((t) => {
      const a = analyze(t.text, new Map(Object.entries(index)) as Map<string, "known" | "deck">, new Set(t.ignored ?? []));
      return { name: t.name, text: t.text, ignored: t.ignored ?? [], counted: a.counted, covered: a.covered, coverage: a.coverage === null ? null : Math.round(a.coverage * 1e9) / 1e9, pending: a.pending, unknown: a.unknown.map((u) => [u.key, u.count, u.first.start]), tokens: a.tokens.map((k) => [k.start, k.key, k.kind]) };
    }),
    around: around.map((x) => ({ ...x, expect: sentenceAround(x.text, x.at, x.max) })),
  };
}

function hintVectors() {
  const vocab = (fields: Record<string, string>): Note => ({ id: "n", type: "vocab", deckId: "d", fields, createdAt: 0, updatedAt: 0 });
  const protect = { word: "protect", vi: "bảo vệ, sự bảo vệ, che chở" };
  const demo = { word: "demonstrate", vi: "(cốt lõi) cho thấy rõ; (công việc) trình diễn, hướng dẫn cách dùng; (chung) chứng minh" };
  const masks: Array<{ fields: Record<string, string>; template: string; text: string }> = [
    { fields: protect, template: "recognize", text: 'Đọc như "pờ-rô tếch": thủ môn Tếch lao ra Bảo vệ khung thành.' },
    { fields: protect, template: "recognize", text: "Khác prevent; protect A from B, che chở ai đó. Sự bảo vệ." },
    { fields: protect, template: "recognize", text: "bảo vệt và bảo  vệ" },
    { fields: protect, template: "recall", text: "protect A from B; protected, protecting. Che chở." },
    { fields: protect, template: "cloze", text: "Protects!" },
    { fields: demo, template: "recognize", text: "Anh sales trình diễn máy in, chứng minh nó chạy êm. Cho thấy rõ!" },
    { fields: demo, template: "listen", text: "She demonstrated it; demonstration is a noun." },
    { fields: protect, template: "recognize", text: "" },
    { fields: protect, template: "recognize", text: "Thủ môn lao ra." },
  ];
  const cues = [
    'Đọc như "con vịt": Cố thuyết phục một con vịt biết nói tiếng Anh.',
    "rely (dựa vào) + able (được): dựa vào được, tức đáng tin cậy.",
    "Một hai ba bốn năm sáu bảy tám chín",
    "Ngắn gọn",
    "Khác prevent. Dùng protect A from B.",
    "Dòng một\nDòng hai",
    "   ",
    "Ab: cd",
  ];
  const L = (t: number, rating: number, hint?: number) => ({ reviewedAt: t, rating, ...(hint === undefined ? {} : { hint }) });
  const logs = [
    [L(1, 3, 1), L(2, 3, 2), L(3, 2, 1)],
    [L(1, 3, 1), L(2, 3, 2), L(3, 2)],
    [L(1, 3, 1), L(2, 3, 1), L(3, 3, 1), L(4, 2, 0), L(5, 1, 0), L(6, 2, 0), L(7, 1, 0), L(8, 2, 0)],
    [L(1, 3, 1), L(2, 3, 1), L(3, 3, 1), L(4, 3), L(5, 4)],
    [L(1, 3, 1), L(2, 3, 1), L(3, 3, 1), L(4, 3), L(5, 2)],
    [L(5, 3, 1), L(1, 3, 1), L(3, 3, 1)],
    [L(1, 3), L(2, 1)],
    [],
  ];
  const ex = (t: string): Block => ({ k: "example", text: t });
  // Short phrases (kind "phrase") keep their place; only the full example sentences turn.
  const ph = (t: string): Block => ({ k: "example", text: t, phrase: true });
  const rot: Block[] = [{ k: "text", text: "nghĩa" }, ph("P1"), ph("P2"), ex("A"), { k: "memo", text: "m" }, ex("B"), ex("C")];
  const acc = ["accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu", "accommodate new staff | tạo điều kiện cho nhân viên mới"];
  const single = ["a reliable supplier | nhà cung cấp đáng tin"];
  const withPhrases = (word: string, phrases: string[]): Note => ({ ...vocab({ word }), fields: { word, phrases } });
  const accNote = withPhrases("accommodate", acc);
  const singleNote = withPhrases("reliable", single);
  return {
    gate: [[0, 0], [1, 0.4], [3, 30], [2, 5], [2, 20.99], [2, 21]].map(([state, stability]) => ({ state, stability, expect: hintGateMs({ state, stability }) })),
    maxRating: [0, 1, 2, 3].map((l) => maxRating(l as 0 | 1 | 2 | 3)),
    terms: [protect.vi, demo.vi, "có; là, ở", "Hợp Đồng / bản cam kết\nthỏa thuận", ""].map((vi) => ({ vi, expect: meaningTerms(vi) })),
    masks: masks.map((m) => ({ ...m, expect: maskHint(m.text, vocab(m.fields), m.template) })),
    cues: cues.map((t) => [t, hintCue(t)]),
    dependent: logs.map((l) => ({ logs: l, expect: hintDependent(l) })),
    rotate: [0, 1, 2, 3, 4, -1].map((reps) => ({ reps, expect: rotateExamples(rot, reps).map((b) => (b as { text: string }).text) })),
    rotateBlocks: rot.map((b) => (b as { text: string }).text),
    rotateKinds: rot.map((b) => (b.k === "example" && b.phrase ? "phrase" : b.k)),
    ladder: {
      rungHint: [0, 1, 2, 3, 4].map((r) => rungHint(r as Rung)),
      next: [0, 1, 2, 3, 4].flatMap((r) => [true, false].map((has) => ({ rung: r, has, expect: nextRung(r as Rung, has) }))),
      letters: [[0, 6], [1999, 6], [2000, 6], [5000, 6], [60000, 6], [-5, 6], [4000, 2], [0, 1]].map(([ms, n]) => ({ ms, n, expect: lettersShown(ms, n) })),
      otherWord: "accommodate",
      otherPhrases: acc,
      other: [0, 1, 2, 3, -1].map((reps) => ({ reps, expect: otherPhrase(accNote, reps) })),
      singleWord: "reliable",
      singlePhrases: single,
      otherNone: otherPhrase(singleNote, 0),
      flash: [
        ["accommodate", ["accomplish", "accommodate", "acknowledge", "accompany", "account"], "a"],
        ["accommodate", ["accomplish", "accomplish", "ACCOMMODATE"], "a"],
        ["accommodate", ["accomplish"], "a"],
        ["accommodate", ["accomplish", "accompany"], "b"],
        ["look after", ["take care", "look up", "go over", "x"], "seed"],
        ["café", ["cafe", "caffè", "coffee"], "é"],
      ].map(([word, pool, seed]) => ({ word, pool, seed, expect: flashWords(word as string, pool as string[], seed as string) })),
    },
  };
}

/** Grammar patterns: how a sentence line is read, what each card shows by review count, which cards a note makes. */
function patternVectors() {
  const lines = [
    "Please call us as soon as your taxi [arrives]. | will arrive / arrived / arriving | Hãy gọi ngay khi taxi đến.",
    "[Despite] the rain, the show went on. | Although / although / Despite / | Dù mưa, buổi diễn vẫn tiếp tục.",
    "The   report was [ prepared ]  by Ms. Lee.",
    "No brackets here | a / b",
    "Two [answers] in [one] line | x",
    "[] empty | a",
    "Meaning with | bar | inside | it",
    "Ends with the [answer]",
    "A Vietnamese [câu] works too | cau / Câu | một câu",
  ];
  const items = lines.map((line) => {
    const it = parsePatternItem(line);
    return { line, item: it, options: it ? patternOptions(it) : null };
  });
  const p = (id: string, fields: Record<string, string | string[]>): Note => ({ id, type: "pattern", deckId: "d1", createdAt: T0, updatedAt: T0, fields });
  const full = {
    title: "Hiện tại đơn sau liên từ thời gian", topic: "Thì động từ", ask: "Sau until / as soon as, động từ chia thì gì?", signals: "until · as soon as",
    rule: "Mệnh đề thời gian dùng hiện tại đơn.", formula: "S + will V … until + S + V(s)", tip: "Không có will sau until.",
    why: ["will + V: không dùng sau liên từ thời gian", "Quá khứ: câu nói về tương lai"],
    items: [lines[0], "We will wait until the manager [returns]. | will return / returned | Chúng tôi sẽ đợi.", "bad line", "Call me when the parts [arrive]."],
  };
  const notes: Note[] = [
    p("p1", full),
    p("p2", { title: "Chỉ có câu", rule: "Quy tắc", items: ["Call me when the parts [arrive]."] }),
    p("p3", { title: "Không câu dùng được", rule: "Quy tắc", ask: "Hỏi gì?", items: ["no brackets"] }),
    p("p4", { title: "Không có quy tắc", ask: "Hỏi gì?", items: [lines[1]] }),
  ];
  const layout = DEFAULT_PREFS.layout;
  const cases = notes.flatMap((n) =>
    ["fill", "rule", "spot"].flatMap((tid) =>
      [0, 1, 2, 5].map((reps) => {
        const t = template("pattern", tid)!;
        const v = studyNote(n, tid, reps);
        return {
          note: n, template: tid, reps, items: v.fields.items ?? [], applies: t.applies(v),
          ...(t.applies(v) ? { mode: t.mode, front: t.front(v, layout), back: t.back(v, layout), expected: t.expected ? t.expected(v) : [], speakBack: t.speak?.back?.(v) ?? null } : {}),
        };
      }),
    ),
  );
  const wanted = notes.map((n) => ({ noteId: n.id, wanted: wantedTemplates(n, undefined), wantedDefault: wantedTemplates(n, DEFAULT_PREFS.templates) }));
  const labels = ["Liên từ & giới từ", "Hòa hợp chủ – vị", "Đại từ", "To V / V-ing", "  Đảo ngữ!! "].map((l) => [l, slugVi(l)]);
  return { items, cases, wanted, labels };
}

/** The library's view of a whole note ("Xem"), open and covered. */
function viewVectors() {
  const p = (id: string, type: string, fields: Record<string, string | string[]>): Note => ({ id, type, deckId: "d1", createdAt: T0, updatedAt: T0, fields });
  const notes: Note[] = [
    sampleNote({ notes: "Hay nhầm với resistant", examplesVi: ["Trẻ em thường kiên cường hơn người lớn."] }),
    sampleNote({ vi: "", examples: [], mnemonic: "", ipa: "", pos: "" }),
    sampleNote({ vi: "", en: "", examples: [], mnemonic: "" }),
    sampleNote({
      word: "accommodate", pos: "verb", ipa: "", mnemonic: "", en: "", vi: "(chứa) chứa được; (dịch vụ) đáp ứng",
      phrases: ["accommodate 200 guests | chứa được 200 khách", "no word here | x"], examples: ["The hotel can accommodate a large group."], examplesVi: ["Khách sạn chứa được một đoàn lớn."],
    }),
    p("p1", "pattern", {
      title: "Hiện tại đơn sau liên từ thời gian", topic: "Thì động từ", ask: "Sau until, động từ chia thì gì?", signals: "until · as soon as",
      rule: "Mệnh đề thời gian dùng hiện tại đơn.", formula: "S + will V … until + S + V(s)", tip: "Không có will sau until.",
      why: ["will + V: không dùng sau liên từ thời gian", "Quá khứ: câu nói về tương lai"],
      items: ["We will wait until the manager [returns]. | will return / returned | Chúng tôi sẽ đợi.", "bad line", "Call me when the parts [arrive]."],
    }),
    p("p2", "pattern", { title: "Chỉ có quy tắc", rule: "Quy tắc", items: [] }),
    p("g1", "grammar", { sentence: "The report was prepared by Ms. Lee.", answer: "prepared", topic: "Bị động", translation: "Báo cáo do bà Lee soạn.", rule: "be + V3" }),
    p("g2", "grammar", { sentence: "No match here.", answer: "missing" }),
    p("t1", "test", { name: "Test 1" }),
  ];
  return notes.map((n) => ({ note: n, open: noteView(n), covered: noteView(n, true) }));
}

/** Seed packs: which documents a load writes given what the server already holds. */
function seedVectors() {
  const fields = { title: "T", rule: "R", items: ["A [b] c. | d / e | f"] };
  const pack: SeedPack = {
    id: "grammar-toeic", version: 2, prefix: "seed-gt-", deck: { id: "seed-gt", name: "Ngữ pháp TOEIC" }, createdAt: T0,
    notes: [
      { id: "seed-gt-a", since: 1, type: "pattern", fields, tags: ["ngu-phap-toeic"] },
      { id: "seed-gt-b", since: 1, type: "pattern", fields, tags: [] },
      { id: "seed-gt-c", since: 2, type: "pattern", fields, tags: ["np-x"] },
    ],
  };
  const states = [
    { applied: 0, noteIds: [], deckExists: false },
    { applied: 0, noteIds: ["seed-gt-a"], deckExists: true },
    { applied: 1, noteIds: [], deckExists: false },
    { applied: 1, noteIds: ["seed-gt-c"], deckExists: false },
    { applied: 2, noteIds: [], deckExists: false },
    { applied: 3, noteIds: [], deckExists: true },
    { applied: 0, noteIds: ["seed-gt-a", "seed-gt-b", "seed-gt-c"], deckExists: false },
  ];
  const plans = states.map((st) => ({ state: st, plan: planSeed(pack, { ...st, noteIds: new Set(st.noteIds) }) }));
  return { pack, plans, ranges: ["seed-gt-", "x-", "ab"].map((pr) => [pr, seedIdRange(pr)]) };
}

it("cross-platform vectors are up to date", () => {
  const dir = join(__dirname, "../../shared/vectors");
  const files: Array<[string, string]> = [
    ["fsrs.json", JSON.stringify(fsrsVectors(), null, 1)],
    ["templates.json", JSON.stringify(templateVectors(), null, 1)],
    ["morphy.json", JSON.stringify(morphyVectors(), null, 1)],
    ["confusables.json", JSON.stringify(confusableVectors(), null, 1)],
    ["queue.json", JSON.stringify(queueVectors(), null, 1)],
    ["import.json", JSON.stringify(importVectors(), null, 1)],
    ["readcheck.json", JSON.stringify(readcheckVectors(), null, 1)],
    ["hints.json", JSON.stringify(hintVectors(), null, 1)],
    ["patterns.json", JSON.stringify(patternVectors(), null, 1)],
    ["seed.json", JSON.stringify(seedVectors(), null, 1)],
    ["views.json", JSON.stringify(viewVectors(), null, 1)],
    ["testtag.json", JSON.stringify(["Test 1 TOEIC NEW 2026", "Đề ETS 2026 — Test #2", "   ", "Kiểm tra giữa kỳ: Ôn tập rất dài của năm học 2026 lần thứ ba", "ĐĐ ñandú", "a--b"].map((n) => [n, testTag(n)]), null, 1)],
    [join("../../android/core/src/main/kotlin/com/vh/lexi/core/Irregular.kt"), irregularKotlin()],
  ];
  for (const [name, text] of files) {
    const path = join(dir, name);
    if (process.env.UPDATE_VECTORS || !existsSync(path)) writeFileSync(path, text + (text.endsWith("\n") ? "" : "\n"));
    // A Windows checkout with core.autocrlf turns LF into CRLF; the content is what matters.
    expect(readFileSync(path, "utf8").replace(/\r\n/g, "\n").trim(), name).toBe(text.trim());
  }
});
