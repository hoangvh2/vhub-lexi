/**
 * Reminders for "Từ hay quên": a notification now and then that shows one marked word, until the learner says it is
 * remembered ("Đã nhớ" clears the mark, the same as un-ticking it in the list).
 *
 * Everything here runs on the device. The schedule (which word, when it comes back) is kept per device (web
 * localStorage, Android SharedPreferences) and never written to Firestore; the only synced write is clearing the mark.
 *
 * - At most `perDay` notifications a day, at fixed times spread over the window [start, end) (local time).
 * - One word per notification: the one waiting longest, a word forgotten for both meaning and sound first.
 * - Each time a word is shown without "Chưa nhớ", it comes back after twice the gap (1, 2, 4, 8, 16 days, then 16).
 *   "Chưa nhớ" (or a miss in practice) brings it back the next day. After REMIND_SUGGEST clean shows the notification
 *   asks whether the word is remembered now.
 *
 * Port: android/core Remind.kt; vectors: shared/vectors/remind.json.
 */
import type { Note } from "./model.ts";
import { forgotNotes, forgotOf, shortMeaning, type ForgotKind } from "./drill.ts";
import { str } from "./notetypes.ts";

export interface RemindSettings {
  on: boolean;
  /** Notifications a day, 1..REMIND_MAX_PER_DAY. */
  perDay: number;
  /** Window in minutes after local midnight: first slot at or after `start`, last one before `end`. */
  start: number;
  end: number;
}

export const REMIND_DEFAULT: RemindSettings = { on: false, perDay: 3, start: 8 * 60, end: 21 * 60 + 30 };
export const REMIND_MAX_PER_DAY = 6;
/** A slot missed by more than this (phone off, browser closed) is skipped rather than shown late. */
export const REMIND_GRACE = 2 * 3600_000;
/** Clean shows after which the notification asks "Đã nhớ?". */
export const REMIND_SUGGEST = 5;
/** Longest gap between two shows of the same word, in days (2^4). */
export const REMIND_MAX_LEVEL = 4;

const MIN = 60_000;
const DAY = 86_400_000;
/** A word due "tomorrow" is due a little before the same time tomorrow, so the same slot finds it. */
const SLACK = 2 * 3600_000;

export interface RemindWord {
  /** Shows in a row without "Chưa nhớ". */
  level: number;
  /** Epoch ms from which the word may be shown again. */
  next: number;
}

export interface RemindState {
  words: Record<string, RemindWord>;
  /** Epoch ms of the last slot that was handled (shown or found nothing to show). */
  lastSlot: number;
}

export const REMIND_EMPTY: RemindState = { words: {}, lastSlot: 0 };

/** Settings with every value in range; a window shorter than 30 minutes falls back to the default window. */
export function cleanSettings(s: Partial<RemindSettings> | null | undefined): RemindSettings {
  const int = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
  const perDay = Math.min(REMIND_MAX_PER_DAY, Math.max(1, int(s?.perDay, REMIND_DEFAULT.perDay)));
  let start = Math.min(1439, Math.max(0, int(s?.start, REMIND_DEFAULT.start)));
  let end = Math.min(1440, Math.max(0, int(s?.end, REMIND_DEFAULT.end)));
  if (end - start < 30) [start, end] = [REMIND_DEFAULT.start, REMIND_DEFAULT.end];
  return { on: s?.on === true, perDay, start, end };
}

/** The slot times of a day, in minutes after midnight: `perDay` points spread evenly, each in the middle of its share. */
export function slotMinutes(s: RemindSettings): number[] {
  const c = cleanSettings(s);
  return Array.from({ length: c.perDay }, (_, i) => c.start + Math.floor(((c.end - c.start) * (2 * i + 1)) / (2 * c.perDay)));
}

/** Epoch ms of a slot: `dayOffset` days from the local day of `now`, `minute` after its midnight. tz = minutes east of UTC. */
function slotAt(now: number, tz: number, dayOffset: number, minute: number): number {
  const localDay = Math.floor((now + tz * MIN) / DAY);
  return (localDay + dayOffset) * DAY + minute * MIN - tz * MIN;
}

/** The first slot strictly after `now` (null when reminders are off): when the next check should run. */
export function nextSlot(now: number, s: RemindSettings, tz: number): number | null {
  if (!s.on) return null;
  const mins = slotMinutes(s);
  for (let d = 0; d <= 1; d++) for (const m of mins) {
    const t = slotAt(now, tz, d, m);
    if (t > now) return t;
  }
  return null;
}

/** The slot to handle now: the latest one at or before `now`, if it is newer than `lastSlot` and not more than REMIND_GRACE old. */
export function dueSlot(now: number, s: RemindSettings, tz: number, lastSlot: number): number | null {
  if (!s.on) return null;
  const mins = slotMinutes(s);
  for (let d = 0; d >= -1; d--) for (let i = mins.length - 1; i >= 0; i--) {
    const t = slotAt(now, tz, d, mins[i]);
    if (t > now) continue;
    return t > lastSlot && now - t <= REMIND_GRACE ? t : null;
  }
  return null;
}

/** The state without words that are no longer marked (a word marked again later starts over). */
export function pruneState(st: RemindState, notes: readonly Note[]): RemindState {
  const marked = new Set(forgotNotes(notes).map((n) => n.id));
  const words: Record<string, RemindWord> = {};
  for (const id of Object.keys(st.words).sort()) if (marked.has(id)) words[id] = st.words[id];
  return { words, lastSlot: st.lastSlot };
}

/**
 * The word to show at `now`, or null when every marked word is still waiting. Waiting longest first (a word never
 * shown counts as waiting since it was marked); then both kinds marked before one; then the most recently marked.
 */
export function pickWord(notes: readonly Note[], st: RemindState, now: number): Note | null {
  const due = forgotNotes(notes).filter((n) => (st.words[n.id]?.next ?? 0) <= now);
  const since = (n: Note) => st.words[n.id]?.next ?? n.forgotAt ?? 0;
  due.sort((a, b) => since(a) - since(b) || forgotOf(b).length - forgotOf(a).length || (b.forgotAt ?? 0) - (a.forgotAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return due[0] ?? null;
}

/** After `id` was shown at `now` for slot `slot`: it comes back after 2^level days and its level goes up. */
export function afterShown(st: RemindState, id: string, now: number, slot: number): RemindState {
  const level = st.words[id]?.level ?? 0;
  const gap = 2 ** Math.min(level, REMIND_MAX_LEVEL) * DAY - SLACK;
  return { words: { ...st.words, [id]: { level: level + 1, next: now + gap } }, lastSlot: Math.max(st.lastSlot, slot) };
}

/** A slot that found no word to show: handled, so it is not checked again. */
export function slotHandled(st: RemindState, slot: number): RemindState {
  return { words: st.words, lastSlot: Math.max(st.lastSlot, slot) };
}

/** "Chưa nhớ" on a notification, or a miss in practice: level back to 0, shown again from the next day. */
export function afterNotYet(st: RemindState, id: string, now: number): RemindState {
  return { words: { ...st.words, [id]: { level: 0, next: now + DAY - SLACK } }, lastSlot: st.lastSlot };
}

/** True once the word was shown REMIND_SUGGEST times in a row without "Chưa nhớ". */
export function suggestDone(st: RemindState, id: string): boolean {
  return (st.words[id]?.level ?? 0) >= REMIND_SUGGEST;
}

export interface RemindMessage {
  /** The word, with its IPA when it has one. */
  title: string;
  /** The question, without the answer (collapsed notification). */
  prompt: string;
  /** The meaning (expanded notification / second line). */
  answer: string;
}

const PROMPT: Record<string, string> = {
  meaning: "Bạn còn nhớ nghĩa của từ này?",
  sound: "Bạn còn nhớ cách đọc từ này?",
  "meaning,sound": "Nghĩa và cách đọc của từ này là gì?",
};

/** The text of the notification for `n`, shown before it (so the level is the one before this show). */
export function remindMessage(n: Note, st: RemindState): RemindMessage {
  const word = str(n.fields.word);
  const ipa = str(n.fields.ipa);
  const kinds: ForgotKind[] = forgotOf(n);
  let prompt = PROMPT[kinds.join(",")] ?? PROMPT.meaning;
  if (suggestDone(st, n.id)) prompt += " Đã thuộc rồi thì bấm Đã nhớ.";
  return { title: ipa ? `${word} ${ipa}` : word, prompt, answer: shortMeaning(n) || "Chưa có nghĩa" };
}

/** Undo of "Đã nhớ": the note with its old marks and mark time back. */
export function restoreForgot(n: Note, kinds: readonly ForgotKind[], at: number | undefined, now: number): Note {
  const out: Note = { ...n, updatedAt: now };
  delete out.forgot;
  delete out.forgotAt;
  if (kinds.length) {
    out.forgot = [...kinds];
    out.forgotAt = at ?? now;
  }
  return out;
}
