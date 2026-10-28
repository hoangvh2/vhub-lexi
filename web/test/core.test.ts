import { describe, expect, it } from "vitest";
import { CardState, dayId, nextDayStart, normalizePrefs, DEFAULT_PREFS, type Card, type Note } from "@shared/model.ts";
import { checkTyped, clozeSentence, suggestedRating, template, wantedTemplates } from "@shared/notetypes.ts";
import { answer, formatInterval, makeScheduler, newCard, preview } from "../src/lib/scheduler.ts";
import { buildQueue, pickNext } from "../src/lib/queue.ts";
import { cardCounts, forecast, heatmap, level, retention, streak } from "../src/lib/stats.ts";

const T0 = new Date(2026, 0, 15, 10, 0, 0).getTime();
const DAY = 86_400_000;

const note = (over: Partial<Note["fields"]> = {}): Note => ({
  id: "n1", type: "vocab", deckId: "d1", createdAt: T0, updatedAt: T0,
  fields: { word: "resilient", ipa: "rɪˈzɪljənt", pos: "adjective", vi: "kiên cường", en: "able to recover quickly", examples: ["Children are often more resilient than adults."], ...over },
});

describe("scheduler (FSRS)", () => {
  const s = makeScheduler(0.9);
  it("new card: Again/Hard stay in learning, Good/Easy progress, intervals ordered", () => {
    const c = newCard("n1", "d1", "recognize", T0);
    const p = preview(s, c, T0);
    expect(p[1].card.state).toBe(CardState.Learning);
    expect(p[3].card.due).toBeGreaterThan(p[1].card.due);
    expect(p[4].card.due).toBeGreaterThan(p[3].card.due);
    expect(p[4].card.state).toBe(CardState.Review);
    expect(p[3].label).toMatch(/^\d+p$/);
  });
  it("review card: intervals grow with Good and shrink on lapse", () => {
    let c = newCard("n1", "d1", "recognize", T0);
    let now = T0;
    c = answer(s, c, 4, now); // Easy graduates straight to review
    expect(c.state).toBe(CardState.Review);
    const first = c.scheduledDays;
    now = c.due;
    const good = answer(s, c, 3, now);
    expect(good.scheduledDays).toBeGreaterThan(first);
    const lapse = answer(s, good, 1, good.due);
    expect(lapse.state).toBe(CardState.Relearning);
    expect(lapse.lapses).toBe(1);
    expect(lapse.stability).toBeLessThan(good.stability);
  });
  it("higher desired retention gives shorter intervals", () => {
    const c = answer(makeScheduler(0.9), newCard("n", "d", "recognize", T0), 4, T0);
    const hi = answer(makeScheduler(0.97), newCard("n", "d", "recognize", T0), 4, T0);
    expect(hi.scheduledDays).toBeLessThanOrEqual(c.scheduledDays);
  });
  it("formats intervals", () => {
    expect(formatInterval(30_000)).toBe("<1p");
    expect(formatInterval(10 * 60_000)).toBe("10p");
    expect(formatInterval(3 * 3_600_000)).toBe("3g");
    expect(formatInterval(3 * DAY)).toBe("3ng");
    expect(formatInterval(90 * DAY)).toBe("3th");
  });
});

describe("study day", () => {
  it("rolls over at the configured hour", () => {
    const late = new Date(2026, 0, 15, 2, 0).getTime(); // 02:00 still belongs to Jan 14
    expect(dayId(late, 4)).toBe("2026-01-14");
    expect(dayId(new Date(2026, 0, 15, 5, 0).getTime(), 4)).toBe("2026-01-15");
    expect(nextDayStart(new Date(2026, 0, 15, 10, 0).getTime(), 4)).toBe(new Date(2026, 0, 16, 4, 0).getTime());
    expect(nextDayStart(late, 4)).toBe(new Date(2026, 0, 15, 4, 0).getTime());
  });
});

describe("queue", () => {
  const mk = (id: string, noteId: string, over: Partial<Card> = {}): Card => ({ ...newCard(noteId, "d1", "recognize", T0), id, ...over });
  const all = () => true;
  const base = { eligible: all, today: undefined, prefs: DEFAULT_PREFS, now: T0, deckId: null, buried: new Set<string>() };

  it("caps new cards by the daily limit minus what was already introduced", () => {
    const cards = Array.from({ length: 30 }, (_, i) => mk(`c${i}`, `n${i}`, { createdAt: T0 + i }));
    expect(buildQueue({ ...base, cards }).counts.new).toBe(15);
    const today = { id: "x", newCards: 10, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: 0 };
    expect(buildQueue({ ...base, cards, today }).counts.new).toBe(5);
  });
  it("shows one new card per note and buries siblings", () => {
    const cards = [mk("a", "n1"), mk("b", "n1", { template: "cloze" }), mk("c", "n2")];
    expect(buildQueue({ ...base, cards }).newCards.map((c) => c.id)).toEqual(["a", "c"]);
    expect(buildQueue({ ...base, cards, buried: new Set(["n1"]) }).newCards.map((c) => c.id)).toEqual(["c"]);
  });
  it("includes reviews due before the next day boundary (most overdue first); learning cards only when due or within learn-ahead", () => {
    const rev = (id: string, due: number) => mk(id, id, { state: CardState.Review, due });
    const cards = [
      rev("late", T0 + 3 * 3_600_000), // 13:00 today
      rev("tomorrow", T0 + 20 * 3_600_000), // 06:00 tomorrow: after the 04:00 boundary
      rev("over", T0 - 2 * DAY),
      mk("learnSoon", "ls", { state: CardState.Learning, due: T0 + 10 * 60_000 }),
      mk("learnLater", "ll", { state: CardState.Learning, due: T0 + 40 * 60_000 }),
    ];
    const q = buildQueue({ ...base, cards });
    expect(q.review.map((c) => c.id)).toEqual(["over", "late"]);
    expect(q.learning).toEqual([]); // nothing in learning is due yet
    const ahead = buildQueue({ ...base, cards, learnAheadMs: 20 * 60_000 });
    expect(ahead.learning.map((c) => c.id)).toEqual(["learnSoon"]);
  });
  it("skips suspended, ineligible and other-deck cards", () => {
    const cards = [mk("s", "n1", { suspended: true }), mk("x", "n2"), mk("o", "n3", { deckId: "d2" })];
    const q = buildQueue({ ...base, cards, eligible: (c) => c.id !== "x", deckId: "d1" });
    expect(q.counts.new).toBe(0);
  });
  it("pickNext: due learning first, then spreads new cards among reviews", () => {
    const reviews = Array.from({ length: 6 }, (_, i) => mk(`r${i}`, `r${i}`, { state: CardState.Review, due: T0 - DAY }));
    const news = Array.from({ length: 2 }, (_, i) => mk(`n${i}`, `nn${i}`));
    const q = buildQueue({ ...base, cards: [...reviews, ...news] });
    const seq: string[] = [];
    const sess = { shown: 0, shownNew: 0 };
    const q2 = { ...q };
    for (let i = 0; i < 8; i++) {
      const c = pickNext(q2, sess, T0)!;
      seq.push(c.id);
      sess.shown++;
      if (c.state === CardState.New) {
        sess.shownNew++;
        q2.newCards = q2.newCards.filter((x) => x.id !== c.id);
      } else q2.review = q2.review.filter((x) => x.id !== c.id);
    }
    expect(seq.filter((x) => x.startsWith("n")).length).toBe(2);
    expect(seq.indexOf("n0")).toBeGreaterThan(0); // not all news at the start
    const learn = mk("L", "L", { state: CardState.Learning, due: T0 - 1000 });
    expect(pickNext({ ...q, learning: [learn] }, { shown: 0, shownNew: 0 }, T0)!.id).toBe("L");
  });
});

describe("note types", () => {
  it("builds the cards a note should have from the chosen templates", () => {
    expect(wantedTemplates(note(), { vocab: ["recognize", "recall", "cloze"] })).toEqual(["recognize", "recall", "cloze"]);
    expect(wantedTemplates(note({ examples: [] }), { vocab: ["recognize", "cloze"] })).toEqual(["recognize"]);
    expect(wantedTemplates(note({ vi: "", en: "", examples: [] }), undefined)).toEqual([]);
    expect(wantedTemplates(note({ vi: "", en: "" }), undefined)).toEqual(["cloze"]); // a sentence is enough for a cloze
  });
  it("cloze finds inflected forms and phrases", () => {
    expect(clozeSentence("She is running fast.", "run")).toEqual({ text: "She is _____ fast.", answer: "running" });
    expect(clozeSentence("They studied hard.", "study")?.answer).toBe("studied");
    expect(clozeSentence("Please look after the kids.", "look after")).toEqual({ text: "Please _____ the kids.", answer: "look after" });
    expect(clozeSentence("Nothing here.", "resilient")).toBeNull();
    expect(clozeSentence("Children are often more resilient.", "resilient")?.text).toBe("Children are often more _____.");
  });
  it("typed answers: exact, close (1 typo), wrong", () => {
    expect(checkTyped("  Resilient ", ["resilient"])).toBe("correct");
    expect(checkTyped("resiliant", ["resilient"])).toBe("close");
    expect(checkTyped("cat", ["cut"])).toBe("wrong"); // short words need to be exact
    expect(checkTyped("", ["x"])).toBe("wrong");
    expect(suggestedRating("correct")).toBe(3);
    expect(suggestedRating("close")).toBe(2);
    expect(suggestedRating("wrong")).toBe(1);
  });
  it("renders template blocks according to the layout", () => {
    const n = note();
    const t = template("vocab", "recognize")!;
    const front = t.front(n, DEFAULT_PREFS.layout);
    expect(front.map((b) => b.k)).toEqual(["title", "ipa", "speak"]);
    const back = t.back(n, { ...DEFAULT_PREFS.layout, showEn: false, showExamples: false });
    expect(back.map((b) => b.k)).toEqual(["badge", "text"]);
    const cloze = template("vocab", "cloze")!;
    expect(cloze.front(n, DEFAULT_PREFS.layout)[0]).toEqual({ k: "quote", text: "Children are often more _____ than adults." });
    expect(cloze.expected!(n)).toContain("resilient");
  });
});

describe("prefs", () => {
  it("clamps and fills defaults", () => {
    const p = normalizePrefs({ desiredRetention: 2, newPerDay: -5, theme: "weird" as never });
    expect(p.desiredRetention).toBe(0.99);
    expect(p.newPerDay).toBe(0);
    expect(p.theme).toBe("system");
    expect(p.templates.vocab).toEqual(["recognize", "cloze"]);
  });
});

describe("stats", () => {
  const d = (id: string, n: number, again = 0) => ({ id, newCards: n, reviews: 0, again, hard: 0, good: n - again, easy: 0, ms: 0, updatedAt: 0 });
  it("counts, streak, retention, forecast, heatmap", () => {
    const cards: Card[] = [
      newCard("a", "d", "recognize", T0),
      { ...newCard("b", "d", "recognize", T0), state: CardState.Review, scheduledDays: 30, due: T0 + 2 * DAY },
      { ...newCard("c", "d", "recognize", T0), state: CardState.Review, scheduledDays: 5, due: T0 - DAY },
    ];
    expect(cardCounts(cards)).toMatchObject({ new: 1, mature: 1, young: 1, learning: 0 });
    const fc = forecast(cards, T0, 4, 5);
    expect(fc[0]).toBe(1); // overdue lands in today
    expect(fc.reduce((a, b) => a + b, 0)).toBe(2);
    const days = [dayId(T0, 4), dayId(T0 - DAY, 4), dayId(T0 - 2 * DAY, 4), dayId(T0 - 4 * DAY, 4)];
    const dailies = days.map((id) => d(id, 10, 1));
    expect(streak(dailies, T0, 4)).toBe(3);
    expect(streak([], T0, 4)).toBe(0);
    expect(retention(dailies, T0, 4)).toBeCloseTo(0.9);
    expect(retention([], T0, 4)).toBeNull();
    const heat = heatmap(dailies, T0, 4, 4);
    expect(heat.find((c) => c.id === days[0])!.count).toBe(10);
    expect(level(0, 10)).toBe(0);
    expect(level(10, 10)).toBe(4);
  });
});
