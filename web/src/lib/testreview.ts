/**
 * "Ôn câu sai": the questions of a Bộ đề to do again, kept in the set's own `state` (lib/testsync.ts), outside FSRS.
 *
 * A question gets a mark when the learner flags it (⚑) while doing the test, or when it is wrong (or left blank) at the
 * moment of submitting. A queued mark comes back after 1, 3, 7, 14 days (`box` 0..3 = which of these is next); two right
 * answers in a row from box 2 on make it learnt (`done`), a wrong answer starts the boxes again.
 *
 * Pure and Kotlin-ported (android/core TestReview.kt): shared/vectors/testreview.json. Days are whole local days
 * (`dayNumber`), so "tomorrow" is the same on both sides.
 */
import type { Letter } from "./import.ts";
import type { SetQuestion } from "./testset.ts";

export const CAUSE_KEYS = ["v", "g", "p", "t"] as const;
export type MarkCause = (typeof CAUSE_KEYS)[number];

/** Days until a question comes back, by box. */
export const GAPS = [1, 3, 7, 14] as const;
/** Right answers in a row, from box 2 on, that make a question learnt. */
export const LEARNT_STREAK = 2;

export interface Mark {
  /** ⚑: the learner wanted this one looked at again. */
  flag?: true;
  cause?: MarkCause;
  /** The day (dayNumber) it is next due; absent while only flagged (not yet queued) or once learnt. */
  due?: number;
  box: number;
  streak: number;
  done?: true;
}
export type Marks = Record<string, Mark>;

/** Whole local days since 1970-01-01 of a moment. */
export const dayNumber = (ms: number): number => {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
};

const fresh = (): Mark => ({ box: 0, streak: 0 });
const empty = (m: Mark) => !m.flag && !m.cause && m.due === undefined && !m.done;

function put(marks: Marks, i: number, m: Mark): Marks {
  const out = { ...marks };
  if (empty(m)) delete out[String(i)];
  else out[String(i)] = m;
  return out;
}

export function toggleFlag(marks: Marks, i: number): Marks {
  const m = { ...(marks[String(i)] ?? fresh()) };
  if (m.flag) delete m.flag;
  else m.flag = true;
  return put(marks, i, m);
}

export function setCause(marks: Marks, i: number, cause: MarkCause | null): Marks {
  const m = { ...(marks[String(i)] ?? fresh()) };
  if (cause) m.cause = cause;
  else delete m.cause;
  return put(marks, i, m);
}

/** A question the learner got wrong: answered, or left blank, against a known key. */
export const isWrong = (q: Pick<SetQuestion, "correct">, pick: Letter | undefined): boolean => !!q.correct && pick !== q.correct;

/**
 * At submit: every flagged or wrong question of the Part joins the queue, due tomorrow. One already waiting keeps its box;
 * one learnt before comes back as new.
 */
export function enqueue(marks: Marks, questions: ReadonlyArray<Pick<SetQuestion, "i" | "correct">>, answers: Readonly<Record<number, Letter>>, today: number): Marks {
  let out = marks;
  for (const q of questions) {
    const m = out[String(q.i)];
    if (!isWrong(q, answers[q.i]) && !m?.flag) continue;
    if (m && m.due !== undefined && !m.done) continue;
    const next: Mark = { ...(m ?? fresh()), box: 0, streak: 0, due: today + GAPS[0] };
    delete next.done;
    out = put(out, q.i, next);
  }
  return out;
}

/** An answer in "Ôn câu sai". */
export function review(marks: Marks, i: number, correct: boolean, today: number): Marks {
  const m = marks[String(i)];
  if (!m || m.due === undefined) return marks;
  const next: Mark = { ...m };
  if (!correct) {
    next.box = 0;
    next.streak = 0;
    next.due = today + GAPS[0];
    return put(marks, i, next);
  }
  next.streak = m.streak + 1;
  next.box = Math.min(m.box + 1, GAPS.length - 1);
  if (next.streak >= LEARNT_STREAK && next.box >= 2) {
    delete next.due;
    next.done = true;
  } else next.due = today + GAPS[next.box];
  return put(marks, i, next);
}

/** "Bỏ khỏi ôn": learnt by the learner's say. The flag goes too. */
export function release(marks: Marks, i: number): Marks {
  const m = marks[String(i)];
  if (!m) return marks;
  const next: Mark = { ...m, done: true };
  delete next.due;
  delete next.flag;
  return put(marks, i, next);
}

/** Question positions due on or before `today`, oldest first. */
export function dueOf(marks: Marks, today: number): number[] {
  return Object.entries(marks)
    .filter(([, m]) => m.due !== undefined && !m.done && m.due <= today)
    .sort(([a, x], [b, y]) => x.due! - y.due! || Number(a) - Number(b))
    .map(([k]) => Number(k));
}

/** How many are waiting for a day (not yet due included). */
export const queuedCount = (marks: Marks): number => Object.values(marks).filter((m) => m.due !== undefined && !m.done).length;
