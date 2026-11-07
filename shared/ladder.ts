/**
 * The recall ladder on typing cards: help that still makes the learner TYPE the word. Each rung gives more and
 * costs more of the rating, and the word is never offered as a choice to click.
 *
 *   0  nothing extra (the blanks and the first letter)
 *   1  a phrase for ANOTHER meaning of the word, word blanked   (best rating: Good)
 *   2  the letters appear one by one, a new one every 2 s        (best rating: Hard)
 *   3  four words flash for 1.5 s, not clickable                 (best rating: Hard)
 *   4  the answer flashes for 0.6 s, then it is gone             (best rating: Again)
 *
 * Pure functions: the Kotlin port (android/core Ladder.kt) replays shared/vectors/ladder.json.
 */
import type { Seg } from "./hints.ts";
import { maskHint } from "./hints.ts";
import type { Note } from "./model.ts";
import { phrasesOf } from "./notetypes.ts";

export type Rung = 0 | 1 | 2 | 3 | 4;
export const LADDER_TOP: Rung = 4;
export const LETTER_STEP_MS = 2000;
export const FLASH_WORDS_MS = 1500;
export const FLASH_ANSWER_MS = 600;

/** The ReviewLog.hint value of a rung: 1 and 2 are the old cue/whole levels, 3 = the answer was shown (rating Again). */
export function rungHint(rung: Rung): 0 | 1 | 2 | 3 {
  return rung === 0 ? 0 : rung === 1 ? 1 : rung === 4 ? 3 : 2;
}

/** The rung one button press leads to; rung 1 is skipped when the word has no second phrase. null = already at the top. */
export function nextRung(rung: Rung, hasOtherPhrase: boolean): Rung | null {
  if (rung >= LADDER_TOP) return null;
  if (rung === 0) return hasOtherPhrase ? 1 : 2;
  return (rung + 1) as Rung;
}

/** How many letters of the word show after `elapsedMs` on rung 2 (the first letter is free; never all of them). */
export function lettersShown(elapsedMs: number, letters: number): number {
  const n = 1 + Math.floor(Math.max(0, elapsedMs) / LETTER_STEP_MS);
  return Math.max(1, Math.min(n, letters - 1));
}

/** The phrase to show on rung 1: the one the card is NOT using (studyNote shows phrase reps % n), word blanked. */
export function otherPhrase(note: Note, reps: number): { segs: Seg[]; vi: string } | null {
  const ps = phrasesOf(note);
  if (ps.length < 2) return null;
  const p = ps[(((reps + 1) % ps.length) + ps.length) % ps.length];
  return { segs: maskHint(p.text, note, "cloze"), vi: p.vi };
}

const fnv = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * Rung 3: the word among three others (the learner's own confusable or same-part-of-speech words first), in an
 * order fixed by `seed` so a re-render does not reshuffle them. null when there are fewer than 2 other words.
 */
export function flashWords(word: string, pool: readonly string[], seed: string): string[] | null {
  const w = word.trim().toLowerCase();
  const others: string[] = [];
  for (const c of pool) {
    const t = c.trim();
    if (t && t.toLowerCase() !== w && !others.some((o) => o.toLowerCase() === t.toLowerCase())) others.push(t);
    if (others.length === 3) break;
  }
  if (others.length < 2) return null;
  return [word.trim(), ...others].sort((a, b) => fnv(seed + a) - fnv(seed + b) || (a < b ? -1 : a > b ? 1 : 0));
}
