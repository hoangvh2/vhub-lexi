import { describe, expect, it } from "vitest";
import { ANSWER_PAUSE_MS, findGaps, frameLevels, placeQuestions, questionSpans } from "../src/lib/audio.ts";

/** A recording at 1 kHz: [seconds, loud?] pieces. */
function track(pieces: Array<[number, boolean]>): Float32Array {
  const out: number[] = [];
  for (const [sec, loud] of pieces) for (let i = 0; i < sec * 1000; i++) out.push(loud ? 0.3 * Math.sin(i / 3) : 0.0005);
  return Float32Array.from(out);
}
const levels = (pieces: Array<[number, boolean]>) => frameLevels(track(pieces), 1000);
/** Directions, a 3 s pause, then n questions of (1 s, 1 s gap, 1.5 s) each followed by `pause` s. */
const exam = (n: number, pause = 5): Array<[number, boolean]> => [[4, true], [3, false], ...Array.from({ length: n }, () => [[1, true], [1, false], [1.5, true], [pause, false]] as Array<[number, boolean]>).flat()];

describe("finding the questions in a Listening file", () => {
  it("measures loudness per 50 ms frame and finds the silent stretches", () => {
    const lv = levels([[1, true], [2, false], [1, true]]);
    expect(lv.length).toBe(80);
    expect(findGaps(lv)).toEqual([[1000, 3000]]);
    // Shorter than 600 ms is the breath between two words, not a gap.
    expect(findGaps(levels([[1, true], [0.4, false], [1, true]]))).toEqual([]);
    // A file that ends in silence keeps that last gap.
    expect(findGaps(levels([[1, true], [3, false]]))).toEqual([[1000, 4000]]);
  });

  it("one question per answer pause; the first starts after the directions", () => {
    const lv = levels(exam(3));
    const spans = questionSpans(findGaps(lv), 32_500, 3)!;
    expect(spans.map(([a, b]) => [Math.round(a / 100) / 10, Math.round(b / 100) / 10])).toEqual([[7, 10.8], [15.5, 19.3], [24, 27.8]]);
  });

  it("cannot split a file without a long pause after each question (options and questions 1 s apart)", () => {
    const flat: Array<[number, boolean]> = Array.from({ length: 20 }, (_, i) => [i % 2 ? 1.1 : 1.4, i % 2 === 0] as [number, boolean]);
    expect(questionSpans(findGaps(levels(flat)), 25_000, 5)).toBeNull();
    expect(ANSWER_PAUSE_MS).toBeGreaterThan(1100);
  });

  it("places questions in one file, or one file per part, and refuses anything else", () => {
    const one = { gaps: findGaps(levels(exam(3))), durationMs: 32_500 };
    expect(placeQuestions([one], [2, 2, 2]).map((c) => c?.track)).toEqual([0, 0, 0]);
    const two = placeQuestions([{ gaps: findGaps(levels(exam(2))), durationMs: 22_000 }, one], [1, 1, 2, 2, 2]);
    expect(two.map((c) => c?.track)).toEqual([0, 0, 1, 1, 1]);
    expect(two[2]!.from).toBe(7000);
    expect(placeQuestions([one, one], [2, 2, 2])).toEqual([null, null, null]);
    // More questions than the file has pauses for: nothing is guessed.
    expect(placeQuestions([one], [2, 2, 2, 2])).toEqual([null, null, null, null]);
  });
});
