import { describe, expect, it } from "vitest";
import type { FieldValue, Note } from "@shared/model.ts";
import { aiBatch, confirmAndRun, runBatch, stopBatch, type BatchDeps } from "../src/lib/batch.ts";
import { mergeEnrich, type Enriched } from "../src/lib/enrich.ts";

const AI: Enriched = {
  vi: "(công việc) trình diễn; (chung) chứng minh",
  en: "to show how something works",
  examples: ["The rep demonstrated the printer.", "Results demonstrate the point."],
  examplesVi: ["Nhân viên trình diễn máy in.", "Kết quả chứng minh luận điểm."],
  existingVi: ["Cô ấy trình diễn ứng dụng."],
  mnemonic: "Anh sales demonstrate cái máy in mới.",
};

describe("mergeEnrich", () => {
  it("fills an empty note and keeps translations aligned with examples", () => {
    const m = mergeEnrich({ word: "demonstrate", examples: ["She demonstrated the app."] }, [], AI);
    expect(m.fields.vi).toBe(AI.vi);
    expect(m.fields.examples).toEqual(["She demonstrated the app.", ...AI.examples!]);
    expect(m.fields.examplesVi).toEqual(["Cô ấy trình diễn ứng dụng.", ...AI.examplesVi!]);
    expect(m.fields.mnemonic).toBe(AI.mnemonic);
    expect(m.aiFields.sort()).toEqual(["en", "examples", "examplesVi", "mnemonic", "vi"]);
  });
  it("keeps what the learner wrote unless asked to overwrite the meaning", () => {
    const mine = { word: "demonstrate", vi: "biểu diễn", en: "show", mnemonic: "của tôi" };
    const m = mergeEnrich(mine, [], AI);
    expect(m.fields.vi).toBe("biểu diễn");
    expect(m.fields.en).toBe("show");
    expect(m.fields.mnemonic).toBe("của tôi");
    expect(m.aiFields).not.toContain("vi");
    expect(mergeEnrich(mine, [], AI, { overwriteVi: true }).fields.vi).toBe(AI.vi);
    // A meaning AI wrote before is refreshed.
    expect(mergeEnrich({ ...mine, vi: "cũ" }, ["vi"], AI).fields.vi).toBe(AI.vi);
  });
  it("never lets a translation slide onto the wrong sentence", () => {
    // The second existing example got no translation: it moves behind the translated ones instead of shifting them.
    const m = mergeEnrich({ word: "x", examples: ["A x.", "B x."] }, [], { ...AI, existingVi: ["A dịch", ""] });
    expect(m.fields.examples).toEqual(["A x.", ...AI.examples!, "B x."]);
    expect(m.fields.examplesVi).toEqual(["A dịch", ...AI.examplesVi!]);
    // Nothing new and nothing translated: the note is left as it was.
    const same = mergeEnrich({ word: "x", examples: ["B x.", "A x."], examplesVi: [] }, [], { vi: "" });
    expect(same.fields.examples).toEqual(["B x.", "A x."]);
  });
  it("skips duplicate sentences and stops at 8 examples", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `Sentence ${i} demonstrate.`);
    const m = mergeEnrich({ word: "demonstrate", examples: eight }, [], AI);
    expect(m.fields.examples).toEqual(eight);
    const dup = mergeEnrich({ word: "demonstrate", examples: [AI.examples![0].toUpperCase()] }, [], { ...AI, existingVi: [] });
    expect(dup.fields.examples).toEqual([AI.examples![1], AI.examples![0].toUpperCase()]);
    expect(dup.fields.examplesVi).toEqual([AI.examplesVi![1]]);
  });
});

describe("runBatch", () => {
  const note = (id: string, word: string, fields: Record<string, FieldValue> = {}): Note => ({ id, type: "vocab", deckId: "d", fields: { word, ...fields }, createdAt: 0, updatedAt: 0 });

  function setup(words: string[], call: BatchDeps["call"]) {
    const db = new Map(words.map((w, i) => [`n${i}`, note(`n${i}`, w)]));
    const deps: BatchDeps = {
      call,
      getNote: (id) => db.get(id),
      save: async (n, fields, aiFields) => void db.set(n.id, { ...n, fields, aiFields }),
      concurrency: 2,
      retryDelayMs: 0,
    };
    return { db, deps, ids: [...db.keys()] };
  }

  it("fills every selected note, a few at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const { db, deps, ids } = setup(["alpha", "beta", "gamma", "delta", "omega"], async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { vi: "nghĩa" };
    });
    const p = await runBatch(ids, deps);
    expect(p).toMatchObject({ running: false, total: 5, done: 5, failed: 0 });
    expect(p.stopped).toBeUndefined();
    expect(peak).toBe(2);
    expect([...db.values()].every((n) => n.fields.vi === "nghĩa" && n.aiFields?.includes("vi"))).toBe(true);
    expect(aiBatch.get()?.running).toBe(false);
  });

  it("stops when the daily allowance runs out and keeps what was saved", async () => {
    let n = 0;
    const { db, deps, ids } = setup(["a1", "a2", "a3", "a4"], async () => {
      if (++n > 2) throw Object.assign(new Error("x"), { code: "functions/resource-exhausted" });
      return { vi: "ok" };
    });
    const p = await runBatch(ids, { ...deps, concurrency: 1 });
    expect(p).toMatchObject({ done: 2, stopped: "quota" });
    expect([...db.values()].filter((x) => x.fields.vi === "ok")).toHaveLength(2);
  });

  it("retries a temporary failure once, then counts it and moves on", async () => {
    const calls: string[] = [];
    const { deps, ids } = setup(["good", "flaky", "broken"], async (w) => {
      calls.push(w);
      if (w === "broken" || (w === "flaky" && calls.filter((c) => c === "flaky").length === 1)) throw Object.assign(new Error("x"), { code: "functions/unavailable" });
      return { vi: "ok" };
    });
    const p = await runBatch(ids, { ...deps, concurrency: 1 });
    expect(p).toMatchObject({ done: 2, failed: 1 });
    expect(calls.filter((c) => c === "broken")).toHaveLength(2);
  });

  it("Dừng: stops after the calls in flight", async () => {
    const { deps, ids } = setup(["w1", "w2", "w3", "w4"], async () => {
      stopBatch();
      return { vi: "ok" };
    });
    const p = await runBatch(ids, { ...deps, concurrency: 1 });
    expect(p).toMatchObject({ done: 1, stopped: "cancel" });
  });

  it("does not overwrite an edit the learner made while the call was running", async () => {
    const { db, deps, ids } = setup(["edit"], async () => {
      db.set("n0", note("n0", "edit", { vi: "tôi vừa sửa" }));
      return { vi: "AI" , mnemonic: "Tôi edit lại bài." };
    });
    await runBatch(ids, deps);
    expect(db.get("n0")!.fields.vi).toBe("tôi vừa sửa");
    expect(db.get("n0")!.fields.mnemonic).toBe("Tôi edit lại bài.");
  });

  it("replacing meanings asks first: Không leaves every note untouched, Thay replaces", async () => {
    const mine = { vi: "nghĩa của tôi" };
    let calls = 0;
    const call = async () => (calls++, { vi: "(công việc) nghĩa AI" });
    const a = setup(["keep"], call);
    a.db.set("n0", note("n0", "keep", mine));
    const asked: string[] = [];
    expect(await confirmAndRun(a.ids, { overwriteVi: true }, { ...a.deps, confirm: async (o) => (asked.push(o.title), o.danger && false) })).toBeNull();
    expect(asked).toEqual(["Thay nghĩa tiếng Việt của 1 từ?"]);
    expect(calls).toBe(0);
    expect(a.db.get("n0")!.fields.vi).toBe("nghĩa của tôi");

    const p = await confirmAndRun(a.ids, { overwriteVi: true }, { ...a.deps, confirm: async () => true });
    expect(p).toMatchObject({ done: 1 });
    expect(a.db.get("n0")!.fields.vi).toBe("(công việc) nghĩa AI");
  });

  it("filling only gaps never asks", async () => {
    const a = setup(["gap"], async () => ({ vi: "AI" }));
    let asked = false;
    await confirmAndRun(a.ids, {}, { ...a.deps, confirm: async () => (asked = true) });
    expect(asked).toBe(false);
    expect(a.db.get("n0")!.fields.vi).toBe("AI");
  });
});
