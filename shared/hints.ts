/**
 * Hints while studying: the learner's memory tip ("Mẹo nhớ") and own notes ("Ghi chú"), opened from the front of a card.
 *
 * A hint must help recall without turning into the answer, and the schedule must stay honest:
 * - the buttons wake up only after a few seconds on a review card (try to remember first);
 * - level 1 shows a cue (the start of the tip), level 2 the whole text; both mask the answer itself;
 * - a recall helped by a hint cannot be rated Easy (level 1) or above Hard (level 2), so FSRS does not stretch the
 *   interval as if the word came back on its own;
 * - a word that leaned on hints in 3 of its last 5 reviews gets them locked until the answer is shown.
 * The Kotlin port (android/core Hints.kt) replays shared/vectors/hints.json.
 */
import type { Block } from "./notetypes.ts";
import { findWord, str } from "./notetypes.ts";
import type { Note, Rating } from "./model.ts";

/** 0 = no hint, 1 = cue, 2 = whole tip or note. */
export type HintLevel = 0 | 1 | 2;

/** Review cards whose memory is at least this many days old wait longer: the word should come back on its own. */
const STRONG_DAYS = 21;

/** How long the hint buttons stay asleep after the front appears. New and (re)learning cards: no wait. */
export function hintGateMs(card: { state: number; stability: number }): number {
  if (card.state !== 2) return 0;
  return card.stability >= STRONG_DAYS ? 6000 : 4000;
}

/** The best rating a recall helped by a hint of this level may get. */
export function maxRating(level: HintLevel): Rating {
  return level === 2 ? 2 : level === 1 ? 3 : 4;
}

/** A part of a hint text; masked parts are the answer and are drawn as a blank. */
export interface Seg {
  text: string;
  masked: boolean;
}

/** Meanings in the `vi` field: "(công việc) trình diễn, hướng dẫn; (chung) chứng minh" → ["trình diễn", "hướng dẫn", "chứng minh"]. */
export function meaningTerms(vi: string): string[] {
  const out = new Set<string>();
  for (const raw of vi.split(/[;,/]|\n/)) {
    const t = raw.normalize("NFC").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    // One- or two-letter pieces ("có", "là") would blank half a sentence.
    if (t.length >= 3) out.add(t);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Blanks out the answer of the card in a hint text: the Vietnamese meaning when the card shows the English word
 * (recognize), the English word in any form when the card asks for it (recall, cloze, listen).
 */
export function maskHint(text: string, note: Note, templateId: string): Seg[] {
  const src = text.normalize("NFC");
  const ranges: Array<[number, number]> = [];
  if (templateId === "recognize") {
    for (const term of meaningTerms(str(note.fields.vi))) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
      for (const m of src.matchAll(re)) ranges.push([m.index!, m.index! + m[0].length]);
    }
  } else {
    const word = str(note.fields.word);
    let from = 0;
    while (word && from < src.length) {
      const at = findWord(src.slice(from), word);
      if (!at) break;
      ranges.push([from + at[0], from + at[1]]);
      from += at[1];
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segs: Seg[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (e <= pos) continue;
    const start = Math.max(s, pos);
    if (start > pos) segs.push({ text: src.slice(pos, start), masked: false });
    segs.push({ text: src.slice(start, e), masked: true });
    pos = e;
  }
  if (pos < src.length) segs.push({ text: src.slice(pos), masked: false });
  return segs;
}

const CUE_WORDS = 6;

/**
 * Level 1: the start of a hint. A sound-alike tip keeps just its sound ('Đọc như "con vịt"…'); anything else keeps
 * its first line's first clause, at most six words.
 */
export function hintCue(text: string): string {
  const t = text.normalize("NFC").replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const sound = /^Đọc như "[^"]+"/.exec(t);
  if (sound) return sound[0] + "…";
  const line = t.split("\n")[0];
  const clause = /^(.{6,}?)[:;.,!?—–]/u.exec(line)?.[1] ?? line;
  const words = clause.split(" ");
  const cut = words.slice(0, CUE_WORDS).join(" ");
  return cut.length < t.length ? cut.replace(/[\s:;,.—–-]+$/u, "") + "…" : cut;
}

/** One past answer of a note, newest first or in any order. */
export interface HintLog {
  reviewedAt: number;
  rating: number;
  hint?: number;
}

const WINDOW = 5;
const LEANING = 3;

/**
 * Did this word lean on hints: a hint in 3 of its last 5 answers? Two answers in a row without a hint and rated
 * Good or Easy clear it at once.
 */
export function hintDependent(logs: readonly HintLog[]): boolean {
  const last = [...logs].sort((a, b) => b.reviewedAt - a.reviewedAt).slice(0, WINDOW);
  const clean = (l: HintLog) => !l.hint && l.rating >= 3;
  if (last.length >= 2 && clean(last[0]) && clean(last[1])) return false;
  return last.filter((l) => (l.hint ?? 0) > 0).length >= LEANING;
}

/**
 * The answer side lists every example; start the list at a different one each review (by the card's review count),
 * so the word is met in several contexts instead of always the same sentence.
 */
export function rotateExamples(blocks: Block[], reps: number): Block[] {
  // The short phrases (one per meaning) keep their place; only the full example sentences take turns.
  const at = blocks.flatMap((b, i) => (b.k === "example" && !b.phrase ? [i] : []));
  if (at.length < 2) return blocks;
  const shift = ((reps % at.length) + at.length) % at.length;
  if (!shift) return blocks;
  const examples = at.map((i) => blocks[i]);
  const out = [...blocks];
  at.forEach((i, j) => (out[i] = examples[(j + shift) % examples.length]));
  return out;
}
