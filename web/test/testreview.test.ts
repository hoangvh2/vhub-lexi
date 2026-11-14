import { describe, expect, it } from "vitest";
import { dayNumber, dueOf, enqueue, queuedCount, release, review, setCause, toggleFlag } from "../src/lib/testreview.ts";

const q = (i: number, correct: "A" | "B" | null = "B") => ({ i, correct });

describe("Ôn câu sai", () => {
  it("queues wrong, blank and flagged questions for tomorrow, not right or key-less ones", () => {
    let m = toggleFlag({}, 2);
    m = enqueue(m, [q(0), q(1), q(2), q(3, null)], { 0: "A", 2: "B", 3: "A" }, 100);
    expect(Object.keys(m).sort()).toEqual(["0", "1", "2"]);
    expect(m["0"]).toEqual({ box: 0, streak: 0, due: 101 });
    expect(m["2"]).toEqual({ flag: true, box: 0, streak: 0, due: 101 });
    expect(dueOf(m, 100)).toEqual([]);
    expect(dueOf(m, 101)).toEqual([0, 1, 2]);
  });

  it("steps 1 → 3 → 7 days and is learnt after two right in a row from box 2", () => {
    let m = enqueue({}, [q(0)], { 0: "A" }, 0);
    m = review(m, 0, true, 1);
    expect(m["0"]).toEqual({ box: 1, streak: 1, due: 4 });
    m = review(m, 0, true, 4);
    expect(m["0"]).toEqual({ box: 2, streak: 2, done: true });
    expect(queuedCount(m)).toBe(0);
  });

  it("a wrong answer starts again; an unqueued question is untouched", () => {
    let m = enqueue({}, [q(0)], { 0: "A" }, 0);
    m = review(m, 0, true, 1);
    m = review(m, 0, false, 4);
    expect(m["0"]).toEqual({ box: 0, streak: 0, due: 5 });
    expect(review(m, 9, true, 4)).toBe(m);
  });

  it("a waiting question keeps its box when wrong again; a learnt one comes back new", () => {
    let m = enqueue({}, [q(0)], { 0: "A" }, 0);
    m = review(m, 0, true, 1);
    expect(enqueue(m, [q(0)], { 0: "A" }, 2)).toBe(m);
    m = review(review(m, 0, true, 4), 0, true, 11);
    expect(m["0"].done).toBe(true);
    expect(enqueue(m, [q(0)], { 0: "A" }, 20)["0"]).toEqual({ box: 0, streak: 0, due: 21 });
  });

  it("release ends the queue and the flag; causes and flags clean up empty marks", () => {
    let m = toggleFlag({}, 1);
    m = setCause(m, 1, "p");
    expect(m["1"]).toEqual({ flag: true, cause: "p", box: 0, streak: 0 });
    expect(release(m, 1)["1"]).toEqual({ cause: "p", box: 0, streak: 0, done: true });
    expect(toggleFlag(toggleFlag({}, 4), 4)).toEqual({});
    expect(setCause(setCause({}, 4, "g"), 4, null)).toEqual({});
  });

  it("counts local days", () => {
    expect(dayNumber(new Date(2026, 10, 14, 0, 5).getTime())).toBe(dayNumber(new Date(2026, 10, 14, 23, 55).getTime()));
    expect(dayNumber(new Date(2026, 10, 15, 0, 5).getTime())).toBe(dayNumber(new Date(2026, 10, 14, 23, 55).getTime()) + 1);
  });
});
