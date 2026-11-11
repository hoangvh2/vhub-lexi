import { describe, expect, it } from "vitest";
import type { Daily } from "@shared/model.ts";
import { dayId } from "@shared/model.ts";
import { dm, effortOf, minutes, span, weekdayOf } from "../src/lib/roadmapView.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 15, 8, 30, 0); // Thursday

describe("roadmapView", () => {
  it("labels study days with date and weekday", () => {
    const start = Date.UTC(2026, 0, 15, 4, 0, 0);
    expect(dm(start, 0)).toBe("15/01");
    expect(dm(start, 17)).toBe("01/02");
    expect(weekdayOf(start, 0)).toBe("T5");
    expect(weekdayOf(start, 3)).toBe("CN");
  });
  it("says spans in days, weeks and months", () => {
    expect([3, 13, 14, 56, 61, 240].map(span)).toEqual(["3 ngày", "13 ngày", "2 tuần", "8 tuần", "2 tháng", "8 tháng"]);
  });
  it("derives seconds per card and a usual day from the learner's days", () => {
    const day = (k: number, answers: number, ms: number): Daily => ({ id: dayId(T0 - k * DAY, 4), newCards: 0, reviews: answers, again: 0, hard: 0, good: answers, easy: 0, ms, updatedAt: 0 });
    const e = effortOf([day(1, 40, 320_000), day(2, 60, 480_000), day(3, 100, 800_000), day(45, 500, 1)], T0, 4);
    expect(e.secPerCard).toBeCloseTo(8, 9);
    expect(e.usual).toBe(60); // median of 40, 60, 100; the 45-day-old day is out of the window
    expect(effortOf([], T0, 4)).toEqual({ secPerCard: null, usual: null });
    expect(minutes(30, 8)).toBe(4);
    expect(minutes(30, null)).toBeNull();
  });
});
