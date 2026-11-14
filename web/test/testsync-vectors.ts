/**
 * Inputs and TypeScript outputs of the Bộ đề sync helpers (lib/testsync.ts), replayed by the Kotlin port
 * (android/core TestSetSyncVectorsTest). Written to shared/vectors/testsync.json by vectors.test.ts.
 */
import type { SetQuestion, TestSet } from "../src/lib/testset.ts";
import { filesOf, mediaKey, mediaPath, metaOf, planSync, progressOf, withProgress } from "../src/lib/testsync.ts";

const q = (i: number, clip?: SetQuestion["clip"]): SetQuestion => ({
  i, number: i + 1, part: 2, kind: "listen", choices: 3, stem: "", options: { A: "", B: "", C: "", D: "" }, correct: "B",
  passage: null, topic: "", rule: "", translation: "", flags: [], ...(clip ? { clip } : {}),
});

export const syncSet = (): TestSet => ({
  id: "s1", name: "ETS Test 1 LC", createdAt: 1000, updatedAt: 2000, section: "lc",
  source: { fileName: "ets.pdf", pages: 40 },
  tracks: [{ key: "s1:a0", name: "01.mp3", bytes: 300 }, { key: "s1:a1", name: "02.mp3", bytes: 400 }],
  pictures: [{ part: 1, page: 3, key: "s1:p3" }],
  passages: [],
  questions: [q(0, { track: 0, from: 1200, to: 9000 }), q(1), q(2, { track: 1, from: 0, to: 5000 })],
  attempt: { startedAt: 5, elapsedMs: 60_000, answers: { 2: "C", 0: "A" } },
});

const states = [
  '{"clips":{}}',
  '{"attempt":{"startedAt":7,"elapsedMs":120000,"answers":{"1":"B","9":"D"},"finishedAt":99,"resultNoteId":"n1"},"clips":{"1":{"track":1,"from":10,"to":20}}}',
  '{"attempt":{"startedAt":7,"elapsedMs":1,"answers":{"0":"E","x":"A","1":5,"2":"D"}},"clips":{"0":{"track":"0","from":1,"to":2},"2":{"track":1,"from":3,"to":4}}}',
  '{"attempt":{"startedAt":"7","elapsedMs":1,"answers":{}},"clips":{}}',
  '{"attempt":"x"}',
  "not json",
  "[]",
  "null",
  "{}",
  '{"clips":{},"parts":{"5":{"startedAt":3,"elapsedMs":9000,"answers":{"0":"A","1":"B"},"finishedAt":50,"resultNoteId":"n5"},"7":{"startedAt":4,"elapsedMs":10,"answers":{"2":"D"}}}}',
  '{"clips":{},"parts":{"5":{"startedAt":3,"elapsedMs":9000,"answers":{"0":"E","x":"A"}},"abc":{"startedAt":1},"6":{"startedAt":1.5,"elapsedMs":2,"answers":{}}}}',
  '{"clips":{},"parts":{"5":{"startedAt":3,"elapsedMs":9000,"answers":{}},"6":{"startedAt":"x","elapsedMs":2,"answers":{}}}}',
  '{"clips":{},"parts":[]}',
  '{"clips":{},"parts":{}}',
  '{"attempt":{"startedAt":7,"elapsedMs":1,"answers":{"2":"A"}},"clips":{},"parts":{"6":{"startedAt":2,"elapsedMs":3,"answers":{"1":"C"}}}}',
];

export function testsyncVectors() {
  const set = syncSet();
  const { attempt: _a, ...noAttempt } = set;
  return {
    set,
    progress: ([set, noAttempt, { ...set, attempt: { ...set.attempt!, finishedAt: 70, resultNoteId: "r" } }, { ...set, parts: { "7": { startedAt: 2, elapsedMs: 5, answers: { 1: "B", 0: "A" }, finishedAt: 9, resultNoteId: "r7" }, "5": { startedAt: 1, elapsedMs: 4, answers: {} } } }, { ...noAttempt, parts: { "2": { startedAt: 3, elapsedMs: 6, answers: { 2: "C" } } } }] as TestSet[]).map((s) => ({ set: s, out: JSON.parse(progressOf(s)) })),
    withProgress: states.map((state) => {
      const out = withProgress(set, state);
      return { state, attempt: out.attempt ?? null, parts: out.parts ?? null, clips: out.questions.map((x) => x.clip ?? null) };
    }),
    files: filesOf(set),
    meta: metaOf(set, 1234),
    paths: ["s1:a0", "s1:p12", "x:y:a1"].map((key) => ({ key, path: mediaPath(key) })),
    keys: ["media/a0", "media/p3", "set.json"].map((path) => ({ path, key: mediaKey("s1", path) })),
    plans: [
      { local: [], remote: [] },
      { local: [{ id: "new", updatedAt: 5 }], remote: [] },
      { local: [{ id: "gone", updatedAt: 5, syncedAt: 6 }], remote: [] },
      { local: [{ id: "a", updatedAt: 9, syncedAt: 6 }], remote: [{ id: "a", updatedAt: 5 }] },
      { local: [{ id: "a", updatedAt: 5, syncedAt: 6 }], remote: [{ id: "a", updatedAt: 9 }] },
      { local: [{ id: "a", updatedAt: 5, syncedAt: 6 }], remote: [{ id: "a", updatedAt: 5 }] },
      { local: [{ id: "a", updatedAt: 5 }], remote: [{ id: "a", updatedAt: 5 }] },
      { local: [{ id: "a", updatedAt: 9 }], remote: [{ id: "a", updatedAt: 5 }] },
      { local: [{ id: "b", updatedAt: 1, syncedAt: 1 }, { id: "c", updatedAt: 2 }], remote: [{ id: "z", updatedAt: 3 }, { id: "b", updatedAt: 1 }, { id: "y", updatedAt: 4 }] },
    ].map((c) => ({ ...c, out: planSync(c.local, c.remote) })),
  };
}
