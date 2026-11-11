import { describe, expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, dayId, nextDayStart, type Card, type Daily } from "@shared/model.ts";
import { newCard } from "../src/lib/scheduler.ts";
import { paceOf, ratingMix, recallNow, simulate, wordStatus, rng } from "../src/lib/roadmap.ts";
import { heatLevelFixed, overdueCount, weekCompare } from "../src/lib/stats.ts";
import { roadmapScenario } from "./roadmap-vectors.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 15, 8, 30, 0);

const card = (id: string, note: string, tpl: string, over: Partial<Card> = {}): Card => ({ ...newCard(note, "d", tpl, T0), id, ...over });

describe("wordStatus", () => {
  it("counts words, not cards", () => {
    const cards = [
      card("a.r", "a", "recognize"), card("a.c", "a", "cloze"), // unseen
      card("b.r", "b", "recognize", { state: CardState.Learning }), card("b.c", "b", "cloze"), // learning
      card("c.r", "c", "recognize", { state: CardState.Review, scheduledDays: 30 }), card("c.c", "c", "cloze"), // young: cloze still new
      card("d.r", "d", "recognize", { state: CardState.Review, scheduledDays: 30 }), card("d.c", "d", "cloze", { state: CardState.Review, scheduledDays: 25 }), // mature
      card("e.r", "e", "recognize", { state: CardState.Review, scheduledDays: 30 }), card("e.c", "e", "cloze", { state: CardState.Review, scheduledDays: 9 }), // young
      card("f.r", "f", "recognize", { suspended: true }), // ignored
    ];
    expect(wordStatus(cards)).toEqual({ total: 5, unseen: 1, learning: 1, young: 2, mature: 1 });
  });
});

describe("recallNow", () => {
  it("is 1 right after a review and falls with time", () => {
    const c = card("a.r", "a", "recognize", { state: CardState.Review, stability: 10, scheduledDays: 10, lastReview: T0, due: T0 + 10 * DAY });
    expect(recallNow([c], T0).recalled).toBeCloseTo(1, 6);
    const at10 = recallNow([c], T0 + 10 * DAY).recalled;
    expect(at10).toBeCloseTo(0.9, 3); // stability = days until recall drops to 90%
    expect(recallNow([c], T0 + 40 * DAY).recalled).toBeLessThan(at10);
    expect(recallNow([card("n.r", "n", "recognize")], T0)).toEqual({ started: 0, recalled: 0 });
  });
});

describe("paceOf and ratingMix", () => {
  const day = (k: number, over: Partial<Daily>): Daily => ({ id: dayId(T0 - k * DAY, 4), newCards: 0, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: 0, ...over });
  it("averages over the days that exist, rest days included", () => {
    const daily = [day(1, { newCards: 10, reviews: 5 }), day(2, { newCards: 12, reviews: 9 }), day(4, { newCards: 5, reviews: 1 })];
    const p = paceOf(daily, T0, 4);
    expect(p.observedDays).toBe(4); // day 4 is the first with study; days 1..4
    expect(p.perDay).toBeCloseTo(27 / 4, 9);
    expect(p.activeDays).toBe(3);
    expect(paceOf([], T0, 4)).toEqual({ perDay: 0, observedDays: 0, activeDays: 0 });
  });
  it("blends the observed ratings with a prior and sums to 1", () => {
    const m = ratingMix([day(1, { again: 100, good: 100 })], T0, 4);
    expect(m.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(m[0]).toBeGreaterThan(0.3);
    ratingMix([], T0, 4).forEach((v, i) => expect(v).toBeCloseTo([0.12, 0.08, 0.7, 0.1][i], 12));
  });
});

describe("stats additions", () => {
  it("overdue counts cards due before today, not new or suspended", () => {
    const start = nextDayStart(T0, 4) - DAY;
    const cs = [
      card("1", "1", "r", { state: CardState.Review, due: start - 1 }),
      card("2", "2", "r", { state: CardState.Review, due: start + 5 }),
      card("3", "3", "r", { state: CardState.Review, due: start - 9, suspended: true }),
      card("4", "4", "r", { due: start - 9 }),
    ];
    expect(overdueCount(cs, T0, 4)).toBe(1);
  });
  it("fixed heat levels", () => {
    expect([0, 1, 29, 30, 59, 60, 89, 90, 500].map(heatLevelFixed)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
  it("compares this week with the same weekdays of last week", () => {
    // T0 is a Thursday: dow = 3, days = 4.
    const daily: Daily[] = [];
    for (let k = 0; k < 14; k++) daily.push({ id: dayId(T0 - k * DAY, 4), newCards: k, reviews: 10, again: 1, hard: 0, good: 8, easy: 1, ms: 1000, updatedAt: 0 });
    const w = weekCompare(daily, T0, 4);
    expect(w.days).toBe(4);
    expect(w.now).toEqual([13, 12, 11, 10, null, null, null]);
    expect(w.prev).toEqual([20, 19, 18, 17, 16, 15, 14]);
    expect(w.thisWeek).toEqual({ answers: 46, ms: 4000, activeDays: 4, retention: 0.9 });
    expect(w.lastWeek).toEqual({ answers: 74, ms: 4000, activeDays: 4, retention: 0.9 });
  });
});

describe("simulate", () => {
  it("is deterministic and finishes a small library", () => {
    const s = roadmapScenario("small");
    const a = simulate(s);
    const b = simulate(s);
    expect(a).toEqual(b);
    expect(a!.introDay).not.toBeNull();
    expect(a!.unseen[0]).toBe(wordStatus(s.cards).unseen);
    expect(a!.unseen.at(-1)).toBe(0);
    expect(a!.mature.at(-1)).toBeGreaterThan(a!.mature[0]);
  });
  it("a faster pace never finishes the new words later", () => {
    const slow = simulate({ ...roadmapScenario("small"), pace: 2 })!;
    const fast = simulate({ ...roadmapScenario("small"), pace: 8 })!;
    expect(fast.introDay!).toBeLessThanOrEqual(slow.introDay!);
  });
  it("returns null without words and respects the horizon", () => {
    expect(simulate({ ...roadmapScenario("small"), cards: [] })).toBeNull();
    expect(simulate({ ...roadmapScenario("small"), pace: 0.01, horizonDays: 30 })!.introDay).toBeNull();
  });
  it("draws the same numbers for the same seed", () => {
    const r = rng(42);
    expect([r(), r(), r()]).toEqual([...(() => { const q = rng(42); return [q(), q(), q()]; })()]);
  });
});

void DEFAULT_PREFS;
