/** Sharing the daily new words between decks by weight (queue.ts shareOut / dailyShares). */
import { describe, expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, type Daily } from "@shared/model.ts";
import { applyDelta } from "../src/data/local.ts";
import { buildQueue, dailyShares, deckWeights, shareOut, type NewShare } from "../src/lib/queue.ts";
import { newCard } from "../src/lib/scheduler.ts";

const share = (id: string, weight: number, cap = 99): NewShare => ({ id, weight, cap });
const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe("shareOut", () => {
  it("splits ten words 50/25/15/10 into 5/3/1/1 (largest remainder, heavier deck first on ties)", () => {
    expect(obj(shareOut(10, [share("A", 50), share("B", 25), share("C", 15), share("D", 10)]))).toEqual({ A: 5, B: 3, C: 1, D: 1 });
  });
  it("gives a deck that has too few words only what it has and hands the rest back", () => {
    expect(obj(shareOut(10, [share("A", 50), share("B", 50, 2)]))).toEqual({ A: 8, B: 2 });
  });
  it("never gives a paused deck anything, and stops when every deck is out of words", () => {
    expect(obj(shareOut(10, [share("A", 1), share("B", 0)]))).toEqual({ A: 10, B: 0 });
    expect(obj(shareOut(10, [share("A", 1, 3), share("B", 1, 2)]))).toEqual({ A: 3, B: 2 });
  });
  it("is stable for any input order", () => {
    const items = [share("C", 15), share("A", 50), share("D", 10), share("B", 25)];
    expect(obj(shareOut(7, items))).toEqual(obj(shareOut(7, [...items].reverse())));
  });
  it("always adds up, respects caps and ignores paused decks (random inputs)", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    for (let t = 0; t < 500; t++) {
      const items = Array.from({ length: 1 + rnd(5) }, (_, k) => share(`d${k}`, rnd(4) === 0 ? 0 : 1 + rnd(100), rnd(6) === 0 ? 0 : rnd(15)));
      const total = rnd(30);
      const out = shareOut(total, items);
      const usable = items.filter((x) => x.weight > 0).reduce((n, x) => n + x.cap, 0);
      expect([...out.values()].reduce((n, v) => n + v, 0)).toBe(Math.min(total, usable));
      for (const x of items) {
        expect(out.get(x.id)).toBeLessThanOrEqual(x.cap);
        if (x.weight === 0) expect(out.get(x.id)).toBe(0);
      }
    }
  });
});

describe("dailyShares", () => {
  it("lets every deck above 0% have at least one word when there are enough words", () => {
    expect(obj(dailyShares(4, [share("A", 70), share("B", 20), share("C", 6), share("D", 4)]))).toEqual({ A: 1, B: 1, C: 1, D: 1 });
    expect(obj(shareOut(4, [share("A", 70), share("B", 20), share("C", 6), share("D", 4)]))).toEqual({ A: 3, B: 1, C: 0, D: 0 });
  });
  it("leaves the shares alone when there are fewer words than decks", () => {
    expect(obj(dailyShares(2, [share("A", 70), share("B", 20), share("C", 10)]))).toEqual({ A: 2, B: 0, C: 0 });
  });
});

describe("buildQueue shares the new words between decks", () => {
  const T0 = Date.UTC(2026, 0, 15, 8, 30);
  const mk = (deck: string, n: number) => Array.from({ length: n }, (_, k) => ({ ...newCard(`${deck}${k}`, deck, "recognize", T0), id: `${deck}${k}`, createdAt: T0 + k }));
  const cards = [...mk("A", 20), ...mk("B", 20)];
  const base = { cards, today: undefined, eligible: () => true, now: T0, buried: new Set<string>(), prefs: { ...DEFAULT_PREFS, newPerDay: 10, dayStartHour: 4 } };
  const decksOf = (q: { newCards: Array<{ deckId: string }> }) => q.newCards.reduce<Record<string, number>>((m, c) => ((m[c.deckId] = (m[c.deckId] ?? 0) + 1), m), {});

  it("follows Deck.newWeight, and equal shares when none is set", () => {
    expect(decksOf(buildQueue({ ...base, deckWeights: deckWeights([{ id: "A", newWeight: 80 }, { id: "B", newWeight: 20 }]) }))).toEqual({ A: 8, B: 2 });
    expect(decksOf(buildQueue({ ...base, deckWeights: deckWeights([{ id: "A" }, { id: "B" }]) }))).toEqual({ A: 5, B: 5 });
  });
  it("keeps each deck in its own order and mixes the decks", () => {
    const q = buildQueue({ ...base, deckWeights: deckWeights([{ id: "A", newWeight: 50 }, { id: "B", newWeight: 50 }]) });
    expect(q.newCards.map((c) => c.id).slice(0, 4)).toEqual(["A0", "B0", "A1", "B1"]);
  });
  it("never goes over the daily total, counting what each deck already gave today", () => {
    const today: Daily = { id: "x", newCards: 6, newByDeck: { A: 6 }, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: 0 };
    const q = buildQueue({ ...base, today, deckWeights: deckWeights([{ id: "A", newWeight: 50 }, { id: "B", newWeight: 50 }]) });
    expect(q.counts.new).toBe(4);
    expect(decksOf(q)).toEqual({ B: 4 }); // A is already past its half of ten
  });
  it("studying one deck takes all that is left from it", () => {
    expect(decksOf(buildQueue({ ...base, deckId: "B", deckWeights: deckWeights([{ id: "A", newWeight: 90 }, { id: "B", newWeight: 10 }]) }))).toEqual({ B: 10 });
  });
  it("a paused deck is not touched while the others still have words", () => {
    expect(decksOf(buildQueue({ ...base, deckWeights: deckWeights([{ id: "A", newWeight: 0 }, { id: "B", newWeight: 5 }]) }))).toEqual({ B: 10 });
  });
  it("review and learning cards do not count against any deck", () => {
    const withReview = [...cards, { ...newCard("R", "A", "recognize", T0), id: "R", state: CardState.Review, due: T0 - 1 }];
    expect(buildQueue({ ...base, cards: withReview }).counts.review).toBe(1);
  });
});

describe("Daily.newByDeck", () => {
  it("is counted per deck and undone per deck, and never goes below zero", () => {
    const d = { id: "2026-01-15", newCards: 1 as const, reviews: 0 as const, rating: 3 as const, ms: 10 };
    let day = applyDelta(undefined, { ...d, deckId: "A" }, 1, 1);
    day = applyDelta(day, { ...d, deckId: "B" }, 1, 2);
    day = applyDelta(day, { ...d, deckId: "A" }, 1, 3);
    expect(day.newByDeck).toEqual({ A: 2, B: 1 });
    day = applyDelta(day, { ...d, deckId: "A" }, -1, 4);
    expect(day.newByDeck).toEqual({ A: 1, B: 1 });
    expect(applyDelta(undefined, { ...d, deckId: "A" }, -1, 5).newByDeck).toEqual({ A: 0 });
  });
  it("a review of an old card leaves it alone", () => {
    const day = applyDelta(undefined, { id: "2026-01-15", newCards: 0, reviews: 1, rating: 3, ms: 10 }, 1, 1);
    expect(day.newByDeck).toBeUndefined();
  });
});

import { percents, rankWeights, setPercent, shareMode } from "../src/lib/deckshare.ts";

describe("deckshare helpers (settings screen)", () => {
  it("percents add up to 100", () => {
    expect(percents([50, 25, 15, 10])).toEqual([50, 25, 15, 10]);
    expect(percents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percents([0, 0])).toEqual([0, 0]);
  });
  it("rank weights: 1, 1/2, 1/3 ... (four decks 48/24/16/12)", () => {
    expect(rankWeights(4)).toEqual([48, 24, 16, 12]);
    expect(rankWeights(1)).toEqual([100]);
  });
  it("setPercent keeps the total at 100 and scales the others", () => {
    expect(setPercent([50, 25, 15, 10], 0, 70)).toEqual([70, 15, 9, 6]);
    expect(setPercent([50, 25, 15, 10], 3, 0)).toEqual([55, 28, 17, 0]);
    expect(setPercent([100, 0, 0], 0, 40)).toEqual([40, 30, 30]); // the others had nothing: split equally
    for (const w of [[1, 1, 1, 1], [48, 24, 16, 12], [90, 5, 5]]) for (let i = 0; i < w.length; i++) for (const p of [0, 1, 33, 50, 99, 100]) expect(setPercent(w, i, p).reduce((n, x) => n + x, 0)).toBe(100);
  });
  it("tells equal, by-priority and custom apart", () => {
    expect(shareMode([1, 1, 1])).toBe("equal");
    expect(shareMode([48, 12, 24, 16])).toBe("rank");
    expect(shareMode([50, 25, 15, 10])).toBe("custom");
  });
});
