/**
 * Inputs and TypeScript outputs of the "Ôn câu sai" helpers (lib/testreview.ts), replayed by the Kotlin port
 * (android/core TestReviewVectorsTest). Written to shared/vectors/testreview.json by vectors.test.ts.
 */
import type { Letter } from "../src/lib/import.ts";
import { dueOf, enqueue, queuedCount, release, review, setCause, toggleFlag, type Marks } from "../src/lib/testreview.ts";

const qs = [0, 1, 2, 3].map((i) => ({ i, correct: (i === 3 ? null : "B") as Letter | null }));

type Step =
  | { op: "flag"; i: number }
  | { op: "cause"; i: number; cause: string | null }
  | { op: "enqueue"; answers: Record<number, Letter>; today: number }
  | { op: "review"; i: number; correct: boolean; today: number }
  | { op: "release"; i: number };

function run(steps: Step[]): Marks[] {
  let m: Marks = {};
  return steps.map((s) => {
    if (s.op === "flag") m = toggleFlag(m, s.i);
    else if (s.op === "cause") m = setCause(m, s.i, s.cause as never);
    else if (s.op === "enqueue") m = enqueue(m, qs, s.answers, s.today);
    else if (s.op === "review") m = review(m, s.i, s.correct, s.today);
    else m = release(m, s.i);
    return m;
  });
}

const scripts: Step[][] = [
  // flag on, off; cause on an empty mark; cause off
  [{ op: "flag", i: 1 }, { op: "flag", i: 1 }, { op: "cause", i: 2, cause: "g" }, { op: "cause", i: 2, cause: null }],
  // submit: wrong (0), blank (1), right (2, unflagged), no key (3); flagged-but-right joins
  [{ op: "flag", i: 2 }, { op: "enqueue", answers: { 0: "A", 2: "B", 3: "A" }, today: 100 }, { op: "enqueue", answers: { 0: "B", 1: "B", 2: "B" }, today: 101 }],
  // 0 right, right (learnt after 2 in a row from box 2), flag gone? no: stays learnt
  [
    { op: "enqueue", answers: { 0: "A", 1: "B", 2: "B" }, today: 10 },
    { op: "review", i: 0, correct: true, today: 11 },
    { op: "review", i: 0, correct: true, today: 14 },
    { op: "review", i: 0, correct: true, today: 21 },
    { op: "enqueue", answers: { 0: "C" }, today: 30 },
  ],
  // wrong resets the boxes; review of an unqueued question changes nothing
  [
    { op: "enqueue", answers: { 0: "A" }, today: 5 },
    { op: "review", i: 0, correct: true, today: 6 },
    { op: "review", i: 0, correct: false, today: 9 },
    { op: "review", i: 1, correct: true, today: 9 },
    { op: "cause", i: 0, cause: "p" },
  ],
  // release: flag and due go, done stays
  [{ op: "flag", i: 0 }, { op: "enqueue", answers: {}, today: 1 }, { op: "release", i: 0 }, { op: "release", i: 3 }, { op: "enqueue", answers: { 1: "D" }, today: 2 }, { op: "flag", i: 0 }],
];

const due: Marks = {
  "5": { box: 0, streak: 0, due: 10 },
  "2": { box: 1, streak: 1, due: 10 },
  "9": { box: 2, streak: 1, due: 12 },
  "7": { box: 3, streak: 2, done: true },
  "1": { box: 0, streak: 0, flag: true },
  "4": { box: 0, streak: 0, due: 8 },
};

export function testreviewVectors() {
  return {
    questions: qs,
    scripts: scripts.map((steps) => ({ steps, out: run(steps) })),
    due: [9, 10, 11, 12, 13].map((today) => ({ marks: due, today, ids: dueOf(due, today), queued: queuedCount(due) })),
  };
}
