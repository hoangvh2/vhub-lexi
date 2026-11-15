/**
 * Where each Part of a Listening test is inside its audio, set by the learner and kept with the set.
 *
 * A real test (ETS) is one long file: Part 1, 2, 3, 4 one after the other, so "do Part 3 on its own" needs to know where
 * Part 3 starts and ends. The marks are boundaries: the end of Part 2 and the start of Part 3 are usually the same
 * moment, so setting one sets the other (until the learner pulls them apart). The first Part of a file starts at 0:00
 * and the last one ends with the file, unless the learner says otherwise. Nothing is guessed: a Part whose start or end
 * is not known has no window, and the screen asks for it.
 *
 * Pure and Kotlin-ported (android/core PartMarks.kt): shared/vectors/partmarks.json. Times are whole milliseconds.
 */

/** One Part's place in the audio. `start` / `end` are ms into file `track`; absent = not set. */
export interface PartCut {
  track: number;
  start?: number;
  end?: number;
}
export type PartCuts = Record<string, PartCut>;

export type Field = "start" | "end";
/** Why a mark was refused. */
export type MarkError = "negative" | "order";

/** The stretch of a file a Part is heard in. `to` null = to the end of the file. */
export type PartWindow = { ok: true; track: number; from: number; to: number | null } | { ok: false; missing: Field };

const cutOf = (cuts: PartCuts, part: number): PartCut | undefined => cuts[String(part)];

/** The file each Part is in: its own mark's, else the previous Part's, else the first file. */
function tracksOf(cuts: PartCuts, order: readonly number[]): number[] {
  const out: number[] = [];
  for (const p of order) out.push(cutOf(cuts, p)?.track ?? out[out.length - 1] ?? 0);
  return out;
}

/** The file `part` is in. */
export const trackOf = (cuts: PartCuts, order: readonly number[], part: number): number => tracksOf(cuts, order)[order.indexOf(part)] ?? 0;

/** The Parts in `order` that share a file with the one at `at`, with their positions in `order`. */
function inTrack(cuts: PartCuts, order: readonly number[], track: number): number[] {
  const t = tracksOf(cuts, order);
  return order.filter((_, i) => t[i] === track);
}

/**
 * Where `part` is heard: from its start (0 for the first Part of a file) to its end (the next Part's start when it has
 * none of its own; the end of the file for the last Part of a file). Missing when that is not known yet.
 */
export function partWindow(cuts: PartCuts, order: readonly number[], part: number): PartWindow {
  const i = order.indexOf(part);
  if (i < 0) return { ok: false, missing: "start" };
  const track = tracksOf(cuts, order)[i];
  const mine = inTrack(cuts, order, track);
  const k = mine.indexOf(part);
  const cut = cutOf(cuts, part);
  const from = cut?.start ?? (k === 0 ? 0 : undefined);
  if (from === undefined) return { ok: false, missing: "start" };
  const next = k + 1 < mine.length ? cutOf(cuts, mine[k + 1]) : undefined;
  const to = cut?.end ?? (k + 1 < mine.length ? next?.start : null);
  if (to === undefined) return { ok: false, missing: "end" };
  if (to !== null && to <= from) return { ok: false, missing: "end" };
  return { ok: true, track, from, to };
}

/** Are the marks of a file in order: each Part starts before it ends, and each ends no later than the next starts. */
function inOrder(cuts: PartCuts, order: readonly number[]): boolean {
  const tracks = tracksOf(cuts, order);
  for (const track of new Set(tracks)) {
    let last = -1;
    for (const p of inTrack(cuts, order, track)) {
      const c = cutOf(cuts, p);
      if (c?.start !== undefined) {
        if (c.start < last) return false;
        last = c.start;
      }
      if (c?.end !== undefined) {
        if (c.end < last || (c.start !== undefined && c.end === last)) return false;
        last = c.end;
      }
    }
  }
  return true;
}

/**
 * Sets the start or the end of `part` to `ms` in file `track`. With `link`, the neighbouring side moves with it when it
 * was the same moment or not set: the end of Part 2 and the start of Part 3 are one boundary. Refused (marks unchanged)
 * when the result would not be in order.
 */
export function setMark(cuts: PartCuts, order: readonly number[], part: number, field: Field, ms: number, track = 0, link = true): { cuts: PartCuts; error?: MarkError } {
  if (!Number.isInteger(ms) || ms < 0) return { cuts, error: "negative" };
  const next: PartCuts = {};
  for (const [k, v] of Object.entries(cuts)) next[k] = { ...v };
  const set = (p: number, f: Field, v: number | undefined, t: number) => {
    const c = (next[String(p)] ??= { track: t });
    c.track = t;
    if (v === undefined) delete c[f];
    else c[f] = v;
  };
  const before = cutOf(cuts, part);
  const old = before?.[field];
  set(part, field, ms, track);
  if (link) {
    const i = order.indexOf(part);
    const mine = inTrack(next, order, track);
    const k = mine.indexOf(part);
    const other = field === "end" ? mine[k + 1] : mine[k - 1];
    const otherField: Field = field === "end" ? "start" : "end";
    if (i >= 0 && other !== undefined) {
      const c = cutOf(next, other);
      const v = c?.[otherField];
      if (v === undefined || v === old) set(other, otherField, ms, track);
    }
  }
  return inOrder(next, order) ? { cuts: next } : { cuts, error: "order" };
}

/** Removes the start or the end of `part` (the file it is in stays). An emptied mark is dropped. */
export function clearMark(cuts: PartCuts, part: number, field: Field): PartCuts {
  const c = cutOf(cuts, part);
  if (!c || c[field] === undefined) return cuts;
  const rest: PartCut = { ...c };
  delete rest[field];
  const out = { ...cuts };
  if (rest.start === undefined && rest.end === undefined) delete out[String(part)];
  else out[String(part)] = rest;
  return out;
}

/**
 * "21:34", "1:02:03", "94" (seconds), "21:34.5" → ms; null when it is not a time. The seconds are below 60 once there
 * is a minutes part.
 */
export function parseClock(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x): x is string => x !== undefined).map(Number);
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  let sec: number;
  if (parts.length === 1) sec = parts[0];
  else {
    if (parts.slice(1).some((x) => x >= 60)) return null;
    sec = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return sec * 1000 + frac;
}

/** "21:34" (an hour or more: "1:02:03"); tenths of a second only when there are some. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const s = Math.floor(total / 1000);
  const tenth = Math.round((total % 1000) / 100);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const base = h ? `${h}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
  return tenth && tenth < 10 ? `${base}.${tenth}` : base;
}

/**
 * Does this Listening set need marks to be done a Part at a time: one audio file holds more than one Part (so a Part
 * cannot be told from its file). Sets with a file per Part, or per question, do not.
 */
export function needsPartMarks(set: { tracks?: readonly unknown[]; questions: ReadonlyArray<{ part: number | null; track?: number }> }): boolean {
  const tracks = set.tracks?.length ?? 0;
  if (!tracks) return false;
  const lc = set.questions.filter((q) => q.part !== null && q.part <= 4);
  if (!lc.length || lc.some((q) => q.track !== undefined)) return false;
  const parts = new Set(lc.map((q) => q.part));
  return parts.size >= 2 && tracks < parts.size;
}

/** The Listening Parts of a set in order, as the marks refer to them. */
export const markParts = (set: { questions: ReadonlyArray<{ part: number | null }> }): number[] =>
  [...new Set(set.questions.map((q) => q.part).filter((p): p is number => p !== null && p <= 4))].sort((a, b) => a - b);
