import { describe, expect, it } from "vitest";
import { contentOf, filesOf, mediaKey, mediaPath, metaOf, planSync, progressOf, withProgress } from "../src/lib/testsync.ts";
import type { TestSet } from "../src/lib/testset.ts";
import { syncSet } from "./testsync-vectors.ts";

describe("Bộ đề sync: what travels in the document", () => {
  it("progress round-trips: attempt and clips from one device land on the other", () => {
    const a = syncSet();
    const b: TestSet = { ...syncSet(), attempt: undefined, questions: syncSet().questions.map(({ clip: _c, ...q }) => q) };
    const got = withProgress(b, progressOf(a));
    expect(got.attempt).toEqual(a.attempt);
    expect(got.questions.map((q) => q.clip ?? null)).toEqual(a.questions.map((q) => q.clip ?? null));
  });
  it("no attempt in the state takes the attempt away; a clip not in the state goes too", () => {
    const got = withProgress(syncSet(), '{"clips":{"2":{"track":1,"from":100,"to":200}}}');
    expect(got.attempt).toBeUndefined();
    expect(got.questions.map((q) => q.clip ?? null)).toEqual([null, null, { track: 1, from: 100, to: 200 }]);
  });
  it("text that does not parse or has the wrong shape changes nothing", () => {
    for (const s of ["", "not json", "null", "[1]", "{}", '{"clips":[]}', '{"attempt":"x"}', '{"attempt":{"startedAt":"1","elapsedMs":0}}']) {
      expect(withProgress(syncSet(), s), s).toEqual(syncSet());
    }
  });
  it("bad answers are dropped one by one, good ones kept", () => {
    const got = withProgress(syncSet(), '{"attempt":{"startedAt":1,"elapsedMs":2,"answers":{"0":"E","1":"B","x":"A","2":3}},"clips":{}}');
    expect(got.attempt).toEqual({ startedAt: 1, elapsedMs: 2, answers: { 1: "B" } });
  });
  it("set.json leaves out the attempt and this device's sync mark", () => {
    const c = contentOf({ ...syncSet(), syncedAt: 9 });
    expect(c).not.toHaveProperty("attempt");
    expect(c).not.toHaveProperty("syncedAt");
    expect(c.questions).toHaveLength(3);
  });
  it("the document names every file and fits the rules", () => {
    const m = metaOf(syncSet(), 1234);
    expect(m.files).toEqual(["set.json", "media/a0", "media/a1", "media/p3"]);
    expect(filesOf({})).toEqual(["set.json"]);
    expect(Object.keys(m).sort()).toEqual(["bytes", "createdAt", "files", "id", "name", "questions", "section", "state", "updatedAt"]);
    expect(metaOf({ ...syncSet(), name: "", section: undefined }, 0)).toMatchObject({ name: "Bộ đề", section: "rc" });
    expect(metaOf({ ...syncSet(), name: "x".repeat(300) }, 0).name).toHaveLength(200);
  });
  it("media keys and paths map both ways", () => {
    expect(mediaPath("s1:a0")).toBe("media/a0");
    expect(mediaKey("s1", "media/p12")).toBe("s1:p12");
    expect(mediaKey("s1", "set.json")).toBeNull();
  });
});

describe("Bộ đề sync: planSync", () => {
  it("uploads what was never in the account, drops what was and is gone", () => {
    expect(planSync([{ id: "a", updatedAt: 1 }], [])).toEqual([{ kind: "upload", id: "a" }]);
    expect(planSync([{ id: "a", updatedAt: 1, syncedAt: 2 }], [])).toEqual([{ kind: "drop", id: "a" }]);
  });
  it("the newer side wins; equal and marked = nothing to do", () => {
    expect(planSync([{ id: "a", updatedAt: 9, syncedAt: 1 }], [{ id: "a", updatedAt: 5 }])).toEqual([{ kind: "push", id: "a" }]);
    expect(planSync([{ id: "a", updatedAt: 5, syncedAt: 1 }], [{ id: "a", updatedAt: 9 }])).toEqual([{ kind: "pull", id: "a" }]);
    expect(planSync([{ id: "a", updatedAt: 5, syncedAt: 1 }], [{ id: "a", updatedAt: 5 }])).toEqual([]);
    expect(planSync([{ id: "a", updatedAt: 5 }], [{ id: "a", updatedAt: 5 }])).toEqual([{ kind: "pull", id: "a" }]);
  });
  it("lists what only the account has", () => {
    expect(planSync([], [{ id: "z", updatedAt: 1 }])).toEqual([{ kind: "remote", id: "z" }]);
  });
});

describe("Bộ đề sync: attempts per Part", () => {
  const base = { questions: [], attempt: undefined, parts: undefined } as Pick<TestSet, "questions" | "attempt" | "parts">;
  const a = { startedAt: 3, elapsedMs: 900, answers: { 1: "B", 0: "A" } as Record<number, "A" | "B">, finishedAt: 5, resultNoteId: "n" };

  it("writes the Part attempts into state and reads them back on another device", () => {
    const state = progressOf({ ...base, parts: { "7": { ...a, finishedAt: undefined, resultNoteId: undefined }, "5": a } });
    expect(Object.keys(JSON.parse(state).parts)).toEqual(["5", "7"]);
    const back = withProgress({ ...base }, state);
    expect(back.parts!["5"]).toEqual(a);
    expect(back.parts!["7"].finishedAt).toBeUndefined();
  });

  it("a state with no Part attempts clears this device's (the other device is newer), and a bad one changes nothing", () => {
    const mine = { ...base, parts: { "5": a } };
    expect(withProgress(mine, '{"clips":{}}').parts).toBeUndefined();
    expect(withProgress(mine, '{"clips":{},"parts":{"5":{"startedAt":"x"}}}')).toBe(mine);
    expect(withProgress(mine, '{"clips":{},"parts":[]}')).toBe(mine);
  });

  it("an old state (before Parts) has no `parts` key, so what an older device writes is unchanged", () => {
    expect(JSON.parse(progressOf({ ...base, attempt: a })).parts).toBeUndefined();
  });

  it("the set uploaded once carries no attempts", () => {
    const set = { id: "s", name: "x", createdAt: 1, updatedAt: 2, source: { fileName: "f", pages: 1 }, passages: [], questions: [], attempt: a, parts: { "5": a }, syncedAt: 4 } as TestSet;
    const c = contentOf(set);
    expect("attempt" in c || "parts" in c || "syncedAt" in c).toBe(false);
  });
});
