/**
 * Inputs and TypeScript outputs of the "Từ hay quên" reminder schedule (shared/remind.ts), replayed by the Kotlin port
 * (android/core RemindVectorsTest). Written to shared/vectors/remind.json by vectors.test.ts.
 */
import type { Note } from "@shared/model.ts";
import {
  REMIND_EMPTY, afterNotYet, afterShown, cleanSettings, dueSlot, nextSlot, pickWord, pruneState, remindMessage, restoreForgot,
  slotHandled, slotMinutes, suggestDone, type RemindSettings, type RemindState,
} from "@shared/remind.ts";
import { drillNotes } from "./drill-vectors.ts";

/** 2026-11-23 00:00 UTC. */
const T0 = Date.UTC(2026, 10, 23);
const H = 3600_000;
const ON: RemindSettings = { on: true, perDay: 3, start: 480, end: 1290 };

const settingsIn: Array<Partial<RemindSettings> | null> = [
  null,
  { on: true },
  { on: true, perDay: 0, start: -5, end: 2000 },
  { on: true, perDay: 9, start: 600, end: 610 },
  { on: true, perDay: 2.6, start: 1380, end: 1440 },
  { on: "yes" as unknown as boolean, perDay: Number.NaN },
];

/** Simulate `days` days of slots: at each slot pick a word, show it, and say "Chưa nhớ" for ids in `notYet`. */
function simulate(notes: Note[], s: RemindSettings, tz: number, days: number, notYet: Set<string>) {
  let st: RemindState = REMIND_EMPTY;
  const out: Array<[number, string | null]> = [];
  let now = T0;
  const end = T0 + days * 24 * H;
  for (;;) {
    const t = nextSlot(now, s, tz);
    if (t === null || t > end) break;
    // The check runs a few minutes late, as WorkManager / a background tab timer would.
    now = t + 7 * 60_000;
    const slot = dueSlot(now, s, tz, st.lastSlot);
    if (slot === null) continue;
    const n = pickWord(notes, st, now);
    if (!n) {
      st = slotHandled(st, slot);
      out.push([slot, null]);
      continue;
    }
    st = afterShown(st, n.id, now, slot);
    if (notYet.has(n.id)) st = afterNotYet(st, n.id, now + 60_000);
    out.push([slot, n.id]);
  }
  return { shows: out, state: st };
}

export function remindVectors() {
  const notes = drillNotes();
  const tzs = [420, 0, -300];
  const times = [T0 - 30 * 60_000, T0 + 1 * H, T0 + 3 * H + 15 * 60_000, T0 + 7 * H, T0 + 12 * H + 30 * 60_000, T0 + 23 * H + 59 * 60_000];
  const st1 = afterShown(REMIND_EMPTY, "n03", T0 + 3 * H, T0 + 3 * H);
  const st2 = afterShown(afterShown(st1, "n03", T0 + 30 * H, T0 + 30 * H), "n05", T0 + 31 * H, T0 + 31 * H);
  let st5: RemindState = REMIND_EMPTY;
  for (let i = 0; i < 6; i++) st5 = afterShown(st5, "n01", T0 + i * 40 * 24 * H, T0 + i * 40 * 24 * H);
  return {
    t0: T0,
    cleanSettings: settingsIn.map((s) => ({ in: s, out: cleanSettings(s) })),
    slotMinutes: [ON, { ...ON, perDay: 1 }, { ...ON, perDay: 6 }, { on: true, perDay: 4, start: 0, end: 1440 }, { on: true, perDay: 5, start: 1000, end: 1037 }].map((s) => ({ in: s, out: slotMinutes(s) })),
    nextSlot: tzs.flatMap((tz) => times.map((now) => ({ tz, now, out: nextSlot(now, ON, tz), off: nextSlot(now, { ...ON, on: false }, tz) }))),
    dueSlot: tzs.flatMap((tz) => times.flatMap((now) => [0, now - H].map((lastSlot) => ({ tz, now, lastSlot, out: dueSlot(now, ON, tz, lastSlot) })))),
    pickWord: [
      { state: REMIND_EMPTY, now: T0, out: pickWord(notes, REMIND_EMPTY, T0)?.id ?? null },
      { state: st1, now: T0 + 4 * H, out: pickWord(notes, st1, T0 + 4 * H)?.id ?? null },
      { state: st2, now: T0 + 32 * H, out: pickWord(notes, st2, T0 + 32 * H)?.id ?? null },
    ],
    afterShown: { st1, st2, st5 },
    afterNotYet: afterNotYet(st5, "n01", T0 + 300 * 24 * H),
    suggestDone: [st1, st2, st5].map((st) => ["n01", "n03", "n05"].map((id) => suggestDone(st, id))),
    prune: pruneState({ words: { ...st2.words, gone: { level: 2, next: 5 }, n02: { level: 1, next: 9 } }, lastSlot: 77 }, notes),
    message: notes.filter((n) => n.forgot?.length).map((n) => ({ id: n.id, plain: remindMessage(n, REMIND_EMPTY), suggest: remindMessage(n, { words: { [n.id]: { level: 5, next: 0 } }, lastSlot: 0 }) })),
    restore: [
      restoreForgot(notes[0], [], undefined, 3000),
      restoreForgot(restoreForgot(notes[4], [], undefined, 3000), ["meaning", "sound"], 700, 3100),
      restoreForgot(notes[1], ["sound"], undefined, 3200),
    ],
    simulate: [
      { tz: 420, days: 40, notYet: [] as string[], ...simulate(notes, ON, 420, 40, new Set()) },
      { tz: 0, days: 20, notYet: ["n05"], ...simulate(notes, { ...ON, perDay: 6, start: 360, end: 1380 }, 0, 20, new Set(["n05"])) },
      { tz: -300, days: 10, notYet: ["n03", "n10"], ...simulate(notes, { ...ON, perDay: 1 }, -300, 10, new Set(["n03", "n10"])) },
    ].map((r, i) => ({ ...r, settings: i === 0 ? ON : i === 1 ? { ...ON, perDay: 6, start: 360, end: 1380 } : { ...ON, perDay: 1 } })),
  };
}
