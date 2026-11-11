/**
 * Inputs and TypeScript outputs of the roadmap statistics (lib/roadmap.ts, lib/stats.ts), replayed by the Kotlin port
 * (android/core RoadmapTest). Written to shared/vectors/roadmap.json by vectors.test.ts.
 */
import { CardState, dayId, nextDayStart, type Card, type Daily } from "@shared/model.ts";
import { answer, makeScheduler, newCard } from "../src/lib/scheduler.ts";
import { paceOf, ratingMix, recallNow, simulate, wordStatus, type SimInput } from "../src/lib/roadmap.ts";
import { heatLevelFixed, overdueCount, weekCompare } from "../src/lib/stats.ts";

const T0 = Date.UTC(2026, 0, 15, 8, 30, 0); // a Thursday
const DAY = 86_400_000;
const MIN = 60_000;
const OPTIMIZED_W = [0.0376, 0.2291, 0.4086, 1.4697, 6.5213, 0.722, 2.9, 0.001, 1.7588, 0.2643, 0.6813, 1.411, 0.0748, 0.1829, 1.5497, 0.6014, 1.8729, 0.5472, 0.0013, 0.0476, 0.1058];

/** 40 words (recognize + cloze): 14 in some stage of learning, the rest unseen; one suspended word and a lone-card word. */
function smallLibrary(): Card[] {
  const sched = makeScheduler(0.9);
  const out: Card[] = [];
  for (let i = 0; i < 40; i++) {
    const id = `w${String(i).padStart(2, "0")}`;
    const created = T0 - 60 * DAY + i * 1000;
    const r = { ...newCard(id, "d1", "recognize", created), createdAt: created };
    const c = { ...newCard(id, "d1", "cloze", created), createdAt: created };
    let rc = r;
    let cc = c;
    if (i < 14) {
      // Started 26 - 2i days ago: Good, Good, then reviews at growing gaps (the odd Again), all before T0.
      const start = T0 - (26 - 2 * i) * DAY;
      const plan: Array<[number, 1 | 2 | 3 | 4]> = [[0, 3], [10 * MIN, 3], [2 * DAY, i % 5 === 0 ? 1 : 3], [2 * DAY + 10 * MIN, 3], [7 * DAY, 3], [20 * DAY, 4]];
      for (const [dt, g] of plan) if (start + dt < T0) rc = answer(sched, rc, g, start + dt);
      if (i < 9) for (const [dt, g] of plan.slice(0, 4)) if (start + 3 * DAY + dt < T0) cc = answer(sched, cc, g, start + 3 * DAY + dt);
    }
    out.push(rc, cc);
  }
  out[78] = { ...out[78], suspended: true }; // w39 recognize suspended
  out.push({ ...newCard("solo", "d1", "recognize", T0 - 70 * DAY), createdAt: T0 - 70 * DAY }); // a word with a single card
  return out;
}

export function roadmapScenario(name: "small"): SimInput {
  void name;
  const daily = smallDaily();
  return {
    cards: smallLibrary(),
    now: T0,
    todayEnd: nextDayStart(T0, 4),
    pace: paceOf(daily, T0, 4).perDay,
    maxReviewsPerDay: 200,
    desiredRetention: 0.9,
    mix: ratingMix(daily, T0, 4),
    doneToday: { newWords: 0, reviews: 0 },
    runs: 12,
    horizonDays: 240,
  };
}

export function smallDaily(): Daily[] {
  const out: Daily[] = [];
  for (let k = 0; k < 20; k++) {
    if (k % 4 === 3) continue; // rest days
    out.push({ id: dayId(T0 - k * DAY, 4), newCards: 2 + (k % 3), reviews: 10 + k, again: 2, hard: 1, good: 8 + (k % 4), easy: 1, ms: 60_000 + k * 1000, updatedAt: T0 });
  }
  return out;
}

export function roadmapVectors() {
  const small = roadmapScenario("small");
  const sims: Array<[string, SimInput]> = [
    ["small", small],
    ["slow-pace", { ...small, pace: 2.5 }],
    ["review-cap-and-done-today", { ...small, pace: 4, maxReviewsPerDay: 6, doneToday: { newWords: 1, reviews: 2 } }],
    ["optimized-weights", { ...small, pace: 5, desiredRetention: 0.85, w: OPTIMIZED_W, mix: [0.2, 0.1, 0.6, 0.1] }],
    ["short-horizon", { ...small, pace: 1, horizonDays: 40, runs: 5 }],
  ];
  const daily = smallDaily();
  const recallAt = [T0, T0 + 3 * DAY, T0 + 40 * DAY];
  const library = small.cards;
  const overdueCards = library.map((c, i) => (i % 7 === 0 && c.state !== CardState.New ? { ...c, due: T0 - 2 * DAY } : c));
  return {
    /** Every case below uses this card list (the simulations as SimInput.cards). */
    library,
    simulate: sims.map(([name, input]) => {
      const { cards: _c, ...rest } = input;
      return { name, input: rest, out: simulate(input) };
    }),
    status: wordStatus(library),
    recall: [undefined, OPTIMIZED_W].flatMap((w) => recallAt.map((now) => ({ now, ...(w ? { w } : {}), out: recallNow(library, now, w) }))),
    pace: { daily, cases: [[T0, 4, 14], [T0, 4, 5], [T0 - 3 * DAY, 4, 14], [T0 + 40 * DAY, 4, 14]].map(([now, h, days]) => ({ now, dayStartHour: h, days, out: paceOf(daily, now, h, days) })) },
    mix: { daily, out: ratingMix(daily, T0, 4), empty: ratingMix([], T0, 4) },
    overdue: { cards: overdueCards, now: T0, out: overdueCount(overdueCards, T0, 4) },
    heat: [0, 1, 29, 30, 59, 60, 89, 90, 500].map((n) => [n, heatLevelFixed(n)]),
    week: [T0, T0 + DAY, T0 + 4 * DAY, T0 + 7 * DAY].map((now) => ({ now, dayStartHour: 4, out: weekCompare(daily, now, 4) })),
  };
}
