/**
 * Inputs and TypeScript outputs of the Listening Part marks (lib/partmarks.ts), replayed by the Kotlin port
 * (android/core PartMarksVectorsTest). Written to shared/vectors/partmarks.json by vectors.test.ts.
 */
import { envelope, placeQuestionsByPart, snapCandidates, type PartSpot } from "../src/lib/audio.ts";
import { clearMark, formatClock, markParts, needsPartMarks, parseClock, partWindow, setMark, type Field, type PartCuts } from "../src/lib/partmarks.ts";

type Step =
  | { op: "set"; part: number; field: Field; ms: number; track?: number; link?: boolean }
  | { op: "clear"; part: number; field: Field };

const order = [1, 2, 3, 4];

function run(steps: Step[], o: number[] = order) {
  let cuts: PartCuts = {};
  return steps.map((s) => {
    let error: string | null = null;
    if (s.op === "set") {
      const r = setMark(cuts, o, s.part, s.field, s.ms, s.track ?? 0, s.link ?? true);
      cuts = r.cuts;
      error = r.error ?? null;
    } else cuts = clearMark(cuts, s.part, s.field);
    return { cuts, error, windows: o.map((p) => partWindow(cuts, o, p)) };
  });
}

const scripts: Array<{ order: number[]; steps: Step[] }> = [
  // Boundaries: ends set the next start; the first starts at 0 and the last ends with the file.
  { order, steps: [
    { op: "set", part: 1, field: "end", ms: 400_000 },
    { op: "set", part: 2, field: "end", ms: 1_293_000 },
    { op: "set", part: 3, field: "end", ms: 2_290_000 },
  ] },
  // A start sets the end before it; apart (link off) the Part after skips its directions.
  { order, steps: [
    { op: "set", part: 3, field: "start", ms: 1_300_000 },
    { op: "set", part: 2, field: "end", ms: 1_290_000, link: false },
    { op: "set", part: 3, field: "start", ms: 1_310_000, link: false },
  ] },
  // Out of order or negative is refused and changes nothing.
  { order, steps: [
    { op: "set", part: 2, field: "end", ms: 900_000 },
    { op: "set", part: 1, field: "end", ms: 950_000 },
    { op: "set", part: 3, field: "end", ms: 800_000 },
    { op: "set", part: 2, field: "start", ms: -5 },
    { op: "set", part: 2, field: "start", ms: 12.5 },
  ] },
  // A start after its own end is refused; clearing a mark leaves the rest.
  { order, steps: [
    { op: "set", part: 2, field: "start", ms: 100_000, link: false },
    { op: "set", part: 2, field: "end", ms: 100_000, link: false },
    { op: "set", part: 2, field: "end", ms: 600_000, link: false },
    { op: "clear", part: 2, field: "start" },
    { op: "clear", part: 2, field: "end" },
    { op: "clear", part: 4, field: "end" },
  ] },
  // Two files: Part 1–2 in file 0, Part 3–4 in file 1; boundaries do not cross files.
  { order, steps: [
    { op: "set", part: 2, field: "end", ms: 900_000, track: 0 },
    { op: "set", part: 3, field: "start", ms: 30_000, track: 1 },
    { op: "set", part: 3, field: "end", ms: 800_000, track: 1 },
  ] },
  // Only some Parts in the set (Part 2 and 4): the file starts and ends with them.
  { order: [2, 4], steps: [
    { op: "set", part: 2, field: "end", ms: 700_000 },
    { op: "set", part: 4, field: "end", ms: 1_500_000 },
  ] },
];

const times = ["21:34", "1:02:03", "94", "0:05", "21:34.5", "21:34,25", "00:00", " 7:30 ", "", "abc", "12:75", "1:2:3:4", "-3", "21:", ":30", "1.5", "100:00"];
const formats = [0, 999, 1000, 94_000, 1_294_000, 1_294_500, 3_723_000, 59_999, 600_000, 3_599_950];

const sets = [
  { tracks: 1, parts: [1, 1, 2, 3, 4, 4], perQuestionTrack: false },
  { tracks: 4, parts: [1, 2, 3, 4], perQuestionTrack: false },
  { tracks: 2, parts: [1, 2, 3, 4], perQuestionTrack: false },
  { tracks: 1, parts: [3], perQuestionTrack: false },
  { tracks: 0, parts: [1, 2], perQuestionTrack: false },
  { tracks: 1, parts: [1, 2], perQuestionTrack: true },
  { tracks: 1, parts: [5, 6, 7], perQuestionTrack: false },
  { tracks: 1, parts: [1, 2, 5], perQuestionTrack: false },
];

const g = (a: number, b: number) => [a, b] as [number, number];
/** One 60 s file: Part 1 0–20 s (2 questions, 5 s pauses), Part 2 20–60 s (2 questions, 8 s pauses), directions before each. */
const bigTrack = { gaps: [g(0, 500), g(4000, 9000), g(11000, 12000), g(15000, 20000), g(24000, 25000), g(32000, 40000), g(41000, 42000), g(50000, 58000)], durationMs: 60000 };
const spotCases: Array<{ tracks: Array<{ gaps: Array<[number, number]>; durationMs: number }>; parts: Array<number | null>; windows: Record<string, PartSpot> }> = [
  { tracks: [bigTrack], parts: [1, 1, 2, 2], windows: { 1: { track: 0, from: 0, to: 20000 }, 2: { track: 0, from: 20000, to: null } } },
  // One Part has no window: its questions are left alone, the other still splits.
  { tracks: [bigTrack], parts: [1, 1, 2, 2], windows: { 2: { track: 0, from: 20000, to: 60000 } } },
  // Too many questions for the pauses inside the window.
  { tracks: [bigTrack], parts: [1, 1, 1, 2, 2], windows: { 1: { track: 0, from: 0, to: 20000 }, 2: { track: 0, from: 20000, to: null } } },
  // A window that starts inside a silence keeps only the part of it that is inside.
  { tracks: [bigTrack], parts: [2, 2], windows: { 2: { track: 0, from: 28000, to: 60000 } } },
  { tracks: [bigTrack], parts: [null, 2], windows: { 2: { track: 5, from: 0, to: null } } },
];
const envLevels = [-20, -30, -100, -45, -50, -10, -60, -60, -60, -25, -90];
const snapCases: Array<{ gaps: Array<[number, number]>; ms: number; count: number }> = [
  { gaps: bigTrack.gaps, ms: 21000, count: 3 },
  { gaps: bigTrack.gaps, ms: 0, count: 2 },
  { gaps: bigTrack.gaps, ms: 59000, count: 5 },
  { gaps: [g(1000, 1500)], ms: 1000, count: 3 },
];

export function partmarksVectors() {
  return {
    byPart: spotCases.map((c) => ({ ...c, out: placeQuestionsByPart(c.tracks, c.parts, c.windows) })),
    envelope: [[envLevels, 50, 100], [envLevels, 50, 250], [[], 50, 1000]].map(([levels, frameMs, binMs]) => ({ levels, frameMs, binMs, out: envelope(levels as number[], frameMs as number, binMs as number) })),
    snap: snapCases.map((c) => ({ ...c, out: snapCandidates(c.gaps, c.ms, c.count) })),
    scripts: scripts.map((c) => ({ order: c.order, steps: c.steps, out: run(c.steps, c.order) })),
    parse: times.map((text) => ({ text, ms: parseClock(text) })),
    format: formats.map((ms) => ({ ms, text: formatClock(ms) })),
    needs: sets.map((s) => {
      const questions = s.parts.map((part, i) => ({ part, ...(s.perQuestionTrack ? { track: i } : {}) }));
      const set = { tracks: Array.from({ length: s.tracks }, () => ({})), questions };
      return { tracks: s.tracks, parts: s.parts, perQuestionTrack: s.perQuestionTrack, needs: needsPartMarks(set), order: markParts(set) };
    }),
  };
}
