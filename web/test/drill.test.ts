import { describe, expect, it } from "vitest";
import { afterAnswer, drillRound, forgotNotes, forgotOf, meaningOptions, withForgot, type DrillItem } from "@shared/drill.ts";
import { drillNotes } from "./drill-vectors.ts";

const notes = drillNotes();
const byId = (id: string) => notes.find((n) => n.id === id)!;

describe("Từ hay quên marks", () => {
  it("toggling changes only the mark and updatedAt, and clearing the last mark leaves no field behind", () => {
    const n = byId("n02");
    const marked = withForgot(n, "sound", true, 50);
    expect(marked).toEqual({ ...n, forgot: ["sound"], forgotAt: 50, updatedAt: 50 });
    const both = withForgot(marked, "meaning", true, 60);
    expect(both.forgot).toEqual(["meaning", "sound"]);
    expect(both.forgotAt).toBe(60);
    const cleared = withForgot(withForgot(both, "meaning", false, 70), "sound", false, 80);
    expect("forgot" in cleared || "forgotAt" in cleared).toBe(false);
    expect({ ...cleared, updatedAt: n.updatedAt }).toEqual(n);
  });
  it("lists marked vocab only, newest mark first", () => {
    expect(forgotNotes(notes).map((n) => n.id)).toEqual(["n03", "n05", "n10", "n01", "n11", "n12"]);
    expect(forgotOf(byId("n12"))).toEqual(["sound"]);
  });
});

describe("practice round", () => {
  const round = drillRound(forgotNotes(notes), notes, "x");
  it("gives each mark its exercises, never the same word twice in a row while others are left", () => {
    const of = (id: string) => round.filter((i) => i.noteId === id).map((i) => i.mode);
    expect(of("n01").sort()).toEqual(["meaning", "recall"]);
    expect(of("n03").sort()).toEqual(["listen", "say"]);
    expect(of("n05").sort()).toEqual(["listen", "meaning", "recall", "say"]);
    // No meaning, so nothing to ask for the meaning of n11.
    expect(of("n11")).toEqual([]);
    // Only n05 has more exercises than the others, so only its last two can meet.
    for (let i = 1; i < round.length; i++) if (round[i].noteId === round[i - 1].noteId) expect(round[i].noteId).toBe("n05");
    // The choice comes before typing the word (recognise, then produce); saying comes before typing what is heard.
    const at = (id: string, mode: string) => round.findIndex((i) => i.noteId === id && i.mode === mode);
    expect(at("n01", "meaning")).toBeLessThan(at("n01", "recall"));
    expect(at("n03", "say")).toBeLessThan(at("n03", "listen"));
  });
  it("meaning choices hold the answer once and no other choice sharing a phrase with it", () => {
    for (const it of round.filter((i) => i.mode === "meaning")) {
      expect(it.options).toHaveLength(4);
      expect(it.options!.filter((o) => o === it.noteId)).toHaveLength(1);
    }
    // "postpone" (hoãn lại; trì hoãn) never gets "delay" (trì hoãn; …) as a wrong choice.
    for (const seed of ["a", "b", "c", "d"]) expect(meaningOptions(byId("n01"), notes, seed)).not.toContain("n02");
  });
  it("a miss comes back after three others until it is right; the round ends", () => {
    let q: DrillItem[] = round.slice(0, 5);
    const first = q[0];
    q = afterAnswer(q, false);
    expect(q.indexOf(first)).toBe(3);
    let steps = 0;
    while (q.length && steps++ < 100) q = afterAnswer(q, true);
    expect(q).toEqual([]);
  });
  it("is pure: the notes it was given are not changed", () => {
    const before = JSON.stringify(notes);
    drillRound(forgotNotes(notes), notes, "y");
    expect(JSON.stringify(notes)).toBe(before);
  });
});
