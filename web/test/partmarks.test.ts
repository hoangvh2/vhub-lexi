import { describe, expect, it } from "vitest";
import { clearMark, formatClock, needsPartMarks, parseClock, partWindow, setMark, type PartCuts } from "../src/lib/partmarks.ts";

const order = [1, 2, 3, 4];
const ok = (r: { cuts: PartCuts; error?: string }) => (expect(r.error).toBeUndefined(), r.cuts);

describe("Part marks", () => {
  it("a boundary is one mark: the end of Part 2 is the start of Part 3, and the ends of the file need nothing", () => {
    let c: PartCuts = {};
    expect(partWindow(c, order, 1)).toEqual({ ok: false, missing: "end" }); // starts at 0, but where does it end?
    c = ok(setMark(c, order, 1, "end", 400_000));
    c = ok(setMark(c, order, 2, "end", 1_293_000));
    expect(c["3"].start).toBe(1_293_000);
    expect(partWindow(c, order, 1)).toEqual({ ok: true, track: 0, from: 0, to: 400_000 });
    expect(partWindow(c, order, 2)).toEqual({ ok: true, track: 0, from: 400_000, to: 1_293_000 });
    // Part 3 has its start but not its end (Part 4 is not set): no guess.
    expect(partWindow(c, order, 3)).toEqual({ ok: false, missing: "end" });
    c = ok(setMark(c, order, 3, "end", 2_290_000));
    expect(partWindow(c, order, 3)).toEqual({ ok: true, track: 0, from: 1_293_000, to: 2_290_000 });
    expect(partWindow(c, order, 4)).toEqual({ ok: true, track: 0, from: 2_290_000, to: null }); // to the end of the file
  });

  it("moving a linked boundary moves both sides; pulled apart, only one", () => {
    let c = ok(setMark({}, order, 2, "end", 900_000));
    c = ok(setMark(c, order, 2, "end", 950_000));
    expect(c["3"].start).toBe(950_000);
    c = ok(setMark(c, order, 3, "start", 960_000, 0, false));
    expect(c["2"].end).toBe(950_000);
    expect(c["3"].start).toBe(960_000);
    c = ok(setMark(c, order, 2, "end", 940_000)); // apart now: the next start stays
    expect(c["3"].start).toBe(960_000);
  });

  it("refuses marks out of order or not whole milliseconds, and changes nothing", () => {
    const c = ok(setMark({}, order, 2, "end", 900_000));
    expect(setMark(c, order, 1, "end", 950_000)).toEqual({ cuts: c, error: "order" });
    expect(setMark(c, order, 2, "start", -1).error).toBe("negative");
    expect(setMark(c, order, 2, "start", 1.5).error).toBe("negative");
    expect(setMark(c, order, 2, "start", 900_000, 0, false).error).toBe("order"); // start = its own end
  });

  it("clearing a mark drops an emptied one", () => {
    let c = ok(setMark({}, order, 2, "end", 900_000));
    c = clearMark(c, 2, "end");
    expect(c["2"]).toBeUndefined();
    expect(c["3"].start).toBe(900_000);
    expect(clearMark(c, 4, "end")).toBe(c);
  });

  it("a mark in another file does not link across files", () => {
    let c = ok(setMark({}, order, 2, "end", 900_000, 0));
    c = ok(setMark(c, order, 3, "start", 30_000, 1));
    expect(c["2"].end).toBe(900_000);
    expect(partWindow(c, order, 3)).toEqual({ ok: false, missing: "end" });
    expect(partWindow(c, order, 2)).toEqual({ ok: false, missing: "start" }); // Part 1 comes first in this file: Part 2 needs its start
    expect(partWindow(c, order, 4)).toEqual({ ok: false, missing: "start" }); // Part 4 follows Part 3 in file 1: its start is not set
  });

  it("reads and writes times", () => {
    expect(parseClock("21:34")).toBe(1_294_000);
    expect(parseClock("1:02:03")).toBe(3_723_000);
    expect(parseClock("94")).toBe(94_000);
    expect(parseClock("21:34.5")).toBe(1_294_500);
    expect(parseClock("12:75")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(formatClock(1_294_000)).toBe("21:34");
    expect(formatClock(1_294_500)).toBe("21:34.5");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });

  it("only a set with several Parts in fewer files needs marks", () => {
    const q = (...parts: number[]) => parts.map((part) => ({ part }));
    expect(needsPartMarks({ tracks: [{}], questions: q(1, 2, 3, 4) })).toBe(true);
    expect(needsPartMarks({ tracks: [{}, {}, {}, {}], questions: q(1, 2, 3, 4) })).toBe(false);
    expect(needsPartMarks({ tracks: [{}], questions: q(5, 6, 7) })).toBe(false);
    expect(needsPartMarks({ tracks: [{}], questions: [{ part: 1, track: 0 }, { part: 2, track: 1 }] })).toBe(false);
  });
});
