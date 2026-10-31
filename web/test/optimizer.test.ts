// @vitest-environment node
import { createRequire } from "node:module";
import { clipParameters, default_w } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { CardState, type Rating } from "@shared/model.ts";
import { fit, revlogCsv, type Answer, type OptimizerBinding } from "../src/lib/optimizer.ts";
import { answer, makeScheduler, newCard } from "../src/lib/scheduler.ts";

// The Node build of the same WASI module the Worker loads in the browser.
const binding = createRequire(import.meta.url)("@open-spaced-repetition/binding-wasm32-wasip1") as OptimizerBinding;

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 6, 2); // 09:00 in Hanoi

/**
 * A learner who forgets faster than FSRS's defaults assume: recall after t days is exp(-t / s), and s grows 2.5x per
 * success. Deterministic (seeded), so the fitted parameters are the same on every run.
 */
function simulate(cards: number, seed = 7): Answer[] {
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: Answer[] = [];
  for (let c = 0; c < cards; c++) {
    const cardId = `n${c}.recognize`;
    let t = T0 + Math.floor(rnd() * 120) * DAY + Math.floor(rnd() * 10) * 3_600_000;
    out.push({ cardId, reviewedAt: t, rating: 3, state: CardState.New });
    t += 10 * 60_000;
    out.push({ cardId, reviewedAt: t, rating: 3, state: CardState.Learning });
    let s = 2 + rnd() * 3;
    let ivl = 1;
    let state: CardState = CardState.Review;
    for (let k = 0; k < 7; k++) {
      t += ivl * DAY;
      const ok = rnd() < Math.exp(-ivl / s);
      out.push({ cardId, reviewedAt: t, rating: ok ? 3 : 1, state });
      if (ok) (s *= 2.5), (ivl = Math.max(1, Math.round(s * 0.1))), (state = CardState.Review);
      else (s = Math.max(1, s * 0.3)), (ivl = 1), (state = CardState.Relearning);
    }
  }
  return out;
}

const opts = { dayStartHour: 4, timeZone: "Asia/Ho_Chi_Minh" };

describe("revlogCsv", () => {
  it("numbers cards, orders each card's answers by time and carries only numbers", () => {
    const csv = new TextDecoder().decode(
      revlogCsv([
        { cardId: "b.cloze", reviewedAt: 2000, rating: 3, state: CardState.Review },
        { cardId: "a.recognize", reviewedAt: 5000, rating: 1, state: CardState.Review },
        { cardId: "b.cloze", reviewedAt: 1000, rating: 3, state: CardState.New },
        { cardId: "a.recognize", reviewedAt: 4000, rating: 4, state: CardState.New },
        { cardId: "a.recognize", reviewedAt: 4500, rating: 0 as Rating, state: CardState.Review }, // not an answer
      ]),
    );
    expect(csv.split("\n")).toEqual([
      "card_id,review_time,review_rating,review_state,review_duration",
      "0,4000,4,0,0",
      "0,5000,1,2,0",
      "1,1000,3,0,0",
      "1,2000,3,2,0",
    ]);
  });
});

describe("fit", () => {
  const history = simulate(1500);

  it("fits parameters that predict the learner's history better than the defaults", async () => {
    const r = await fit(binding, history, opts);
    expect(r.status).toBe("fitted");
    if (r.status !== "fitted") return;
    expect(r.reviews).toBe(history.length);
    expect(r.w).toHaveLength(21);
    expect(r.w).toEqual(clipParameters(r.w, 1, true)); // stored inside ts-fsrs' ranges, so Kotlin schedules alike
    expect(r.after.rmse).toBeLessThan(r.before.rmse * 0.8);
    expect(r.after.logLoss).toBeLessThan(r.before.logLoss);
    // This learner forgets fast: first-day stability after "Good" must come out well below the default.
    expect(r.w[2]).toBeLessThan(default_w[2] / 2);
  });

  it("keeps the current parameters when they already fit best", async () => {
    const first = await fit(binding, history, opts);
    if (first.status !== "fitted") throw new Error(first.status);
    const again = await fit(binding, history, { ...opts, current: first.w });
    expect(again.status).toBe("optimal");
  });

  it("reports too little history instead of fitting noise", async () => {
    expect((await fit(binding, simulate(3), opts)).status).toBe("not-enough");
    expect((await fit(binding, [], opts)).status).toBe("not-enough");
  });

  it("the fitted parameters change the schedule", async () => {
    const r = await fit(binding, history, opts);
    if (r.status !== "fitted") throw new Error(r.status);
    const run = (w?: number[]) => {
      let c = newCard("n", "d", "recognize", T0);
      for (const [min, g] of [[0, 3], [10, 3]] as Array<[number, Rating]>) c = answer(makeScheduler(0.9, w), c, g, T0 + min * 60_000);
      return c.scheduledDays;
    };
    expect(run(r.w)).toBeLessThan(run());
  });
});
