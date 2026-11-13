/**
 * "Từ hay quên": words the learner marks as often forgotten (the meaning, the pronunciation, or both), and the
 * active practice drawn from them. Practice lives outside FSRS: it writes no review log and never changes a card's
 * due date, stability or difficulty. The only thing stored is the mark on the note (fields `forgot`/`forgotAt`), so a
 * mark costs one note write and syncs with the note document; a practice round costs no write at all.
 *
 * Pure helpers over notes, shared by the web app and (as a Kotlin port, android/core Drill.kt) the Android app;
 * shared/vectors/drill.json holds the reference outputs.
 */
import { CardState, type Card, type Note } from "./model.ts";
import { meaningPhrases } from "./confusables.ts";
import { str } from "./notetypes.ts";

export type ForgotKind = "meaning" | "sound";
export const FORGOT_KINDS: readonly ForgotKind[] = ["meaning", "sound"];
export const FORGOT_LABEL: Record<ForgotKind, string> = { meaning: "Quên nghĩa", sound: "Quên phát âm" };

/** The marks on a note, in a fixed order (meaning, then sound); unknown values are ignored. */
export function forgotOf(n: Note): ForgotKind[] {
  const f = n.forgot ?? [];
  return FORGOT_KINDS.filter((k) => f.includes(k));
}

/**
 * The note with `kind` marked (`on`) or cleared. `forgotAt` is the time of the latest mark, so the list shows recent
 * marks first; clearing the last mark removes both fields, leaving the document as it was before any mark.
 */
export function withForgot(n: Note, kind: ForgotKind, on: boolean, now: number): Note {
  const cur = forgotOf(n);
  const next = FORGOT_KINDS.filter((k) => (k === kind ? on : cur.includes(k)));
  const out: Note = { ...n, updatedAt: now };
  delete out.forgot;
  delete out.forgotAt;
  if (next.length) {
    out.forgot = next;
    out.forgotAt = on && !cur.includes(kind) ? now : (n.forgotAt ?? now);
  }
  return out;
}

/** Marked vocab notes, most recently marked first. */
export function forgotNotes(notes: readonly Note[]): Note[] {
  return notes
    .filter((n) => n.type === "vocab" && str(n.fields.word) && forgotOf(n).length > 0)
    .sort((a, b) => (b.forgotAt ?? 0) - (a.forgotAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The meaning shown on a choice: the first sense of `vi` (up to the first ';'), at most 80 characters. */
export function shortMeaning(n: Note): string {
  const first = str(n.fields.vi).split(";")[0].trim();
  return first.length > 80 ? first.slice(0, 79).trimEnd() + "…" : first;
}

/**
 * One exercise. "meaning": see the word, pick its meaning (`options` = 4 note ids, the answer among them).
 * "recall": see the meaning, type the word. "listen": hear the word, type it. "say": see the word, say it aloud,
 * then hear it and grade yourself.
 */
export type DrillMode = "meaning" | "recall" | "listen" | "say";
export interface DrillItem {
  noteId: string;
  mode: DrillMode;
  options?: string[];
}

/** Words in one round; a longer list is practised over several rounds, most recently marked first. */
export const DRILL_ROUND = 20;

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const bySeed = (seed: string) => (a: string, b: string) => fnv(seed + a) - fnv(seed + b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Three wrong meanings for `n` from `pool`: vocab words with a meaning that shares no phrase with n's (so there is
 * one right answer), the same part of speech first, in an order fixed by `seed`. null when fewer than 3 exist.
 */
export function meaningOptions(n: Note, pool: readonly Note[], seed: string): string[] | null {
  const own = new Set(meaningPhrases(str(n.fields.vi)));
  const ownShort = shortMeaning(n);
  const pos = str(n.fields.pos);
  const seen = new Set<string>([ownShort]);
  const others = pool
    .filter((o) => o.id !== n.id && o.type === "vocab" && shortMeaning(o) && !meaningPhrases(str(o.fields.vi)).some((p) => own.has(p)))
    .map((o) => o.id);
  const byId = new Map(pool.map((o) => [o.id, o]));
  const order = bySeed(seed + n.id);
  others.sort((a, b) => Number(str(byId.get(b)!.fields.pos) === pos && !!pos) - Number(str(byId.get(a)!.fields.pos) === pos && !!pos) || order(a, b));
  const picked: string[] = [];
  for (const id of others) {
    const m = shortMeaning(byId.get(id)!);
    if (seen.has(m)) continue;
    seen.add(m);
    picked.push(id);
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return null;
  return [n.id, ...picked].sort(bySeed(seed + ":" + n.id));
}

/**
 * One practice round over `marked` (forgotNotes order; the first DRILL_ROUND are taken). A word marked for its
 * meaning gets "meaning" (when 3 wrong meanings exist), then "recall" (when it has a meaning); one marked for its
 * sound gets "say", then "listen"; a word with both marks alternates them (meaning, say, recall, listen).
 * The round goes in layers: every word's first exercise, then every word's second, and so on, each layer in an
 * order fixed by `seed`, so a word comes back only after the others and never twice in a row.
 */
export function drillRound(marked: readonly Note[], pool: readonly Note[], seed: string): DrillItem[] {
  const layers: DrillItem[][] = [];
  for (const n of marked.slice(0, DRILL_ROUND)) {
    const kinds = forgotOf(n);
    const meaning: DrillItem[] = [];
    const sound: DrillItem[] = [];
    if (kinds.includes("meaning") && shortMeaning(n)) {
      const options = meaningOptions(n, pool, seed);
      if (options) meaning.push({ noteId: n.id, mode: "meaning", options });
      meaning.push({ noteId: n.id, mode: "recall" });
    }
    if (kinds.includes("sound")) sound.push({ noteId: n.id, mode: "say" }, { noteId: n.id, mode: "listen" });
    const items: DrillItem[] = [];
    for (let i = 0; i < Math.max(meaning.length, sound.length); i++) {
      if (meaning[i]) items.push(meaning[i]);
      if (sound[i]) items.push(sound[i]);
    }
    items.forEach((it, i) => (layers[i] ??= []).push(it));
  }
  const key = (it: DrillItem) => `${it.noteId}/${it.mode}`;
  const order = bySeed(seed);
  const out: DrillItem[] = [];
  for (const layer of layers) {
    layer.sort((a, b) => order(key(a), key(b)));
    // No word twice in a row across the seam between two layers.
    if (out.length && layer.length > 1 && layer[0].noteId === out[out.length - 1].noteId) [layer[0], layer[1]] = [layer[1], layer[0]];
    out.push(...layer);
  }
  return out;
}

/** How far back a missed exercise goes: it comes again after this many others (or at the end of a shorter queue). */
export const RETRY_GAP = 3;

/** The queue after answering its head: removed when right, moved RETRY_GAP places back when wrong. */
export function afterAnswer(queue: readonly DrillItem[], right: boolean): DrillItem[] {
  const [head, ...rest] = queue;
  if (!head || right) return rest;
  const at = Math.min(RETRY_GAP, rest.length);
  return [...rest.slice(0, at), head, ...rest.slice(at)];
}

/**
 * Words FSRS says are forgotten most (lapses over all their cards; suspended cards left out), recently forgotten
 * first: the "Từ hay quên" suggestions. Read from cards already in memory, so it costs no read.
 */
export function wordsToWatch(cards: readonly Card[], notes: readonly Note[], limit: number): Array<{ note: Note; lapses: number }> {
  const byNote = new Map<string, { lapses: number; last: number }>();
  for (const c of cards) {
    if (c.suspended || c.lapses === 0) continue;
    const w = byNote.get(c.noteId) ?? { lapses: 0, last: 0 };
    w.lapses += c.lapses;
    w.last = Math.max(w.last, c.state === CardState.Relearning ? Number.MAX_SAFE_INTEGER : (c.lastReview ?? 0));
    byNote.set(c.noteId, w);
  }
  const noteById = new Map(notes.map((n) => [n.id, n]));
  return [...byNote.entries()]
    .filter(([id]) => noteById.has(id))
    .sort((a, b) => b[1].lapses - a[1].lapses || b[1].last - a[1].last)
    .slice(0, limit)
    .map(([id, w]) => ({ note: noteById.get(id)!, lapses: w.lapses }));
}
