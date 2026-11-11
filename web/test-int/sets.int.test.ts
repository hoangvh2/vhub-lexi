/**
 * Bộ đề across two devices of one account, against the Auth + Firestore + Storage emulators and the real rules:
 * a set imported on one device is listed, downloaded and continued on the other; a delete reaches both.
 * Each device has its own IndexedDB (fake-indexeddb) and its own copy of data/testsets.ts.
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore/lite";
import { connectStorageEmulator, getStorage, ref, getBytes } from "firebase/storage";
import { afterAll, describe, expect, it, vi } from "vitest";
import { bucketOf, makeSetsCloud } from "../src/data/setscloud.ts";
import type { TestSet } from "../src/lib/testset.ts";

type Sets = typeof import("../src/data/testsets.ts");
const apps: FirebaseApp[] = [];
let seq = 0;

async function device(sub: string) {
  const app = initializeApp({ apiKey: "fake", projectId: "demo-lexi", appId: "1:1:web:1" }, `sets${++seq}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email: "owner@example.com", email_verified: true })));
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const storage = getStorage(app, bucketOf("demo-lexi"));
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  const idb = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  vi.resetModules();
  globalThis.indexedDB = idb;
  const sets: Sets = await import("../src/data/testsets.ts");
  const cloud = makeSetsCloud(cred.user.uid, db, storage);
  sets.useSetsCloud(cloud);
  /** Runs `f` as this device: its own IndexedDB. */
  const on = async <T>(f: (s: Sets) => Promise<T>): Promise<T> => {
    globalThis.indexedDB = idb;
    return f(sets);
  };
  return { on, sets, cloud, storage, uid: cred.user.uid };
}

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a).catch(() => undefined)));
});

const T = Date.now();
const set = (id: string): TestSet => ({
  id, name: "ETS Test 1 LC", createdAt: T, updatedAt: T, section: "lc", source: { fileName: "ets.pdf", pages: 3 },
  tracks: [{ key: `${id}:a0`, name: "01.mp3", bytes: 6 }], pictures: [{ part: 1, page: 2, key: `${id}:p2` }], passages: [],
  questions: [
    { i: 0, number: 1, part: 1, kind: "listen", choices: 4, track: 0, stem: "", options: { A: "", B: "", C: "", D: "" }, correct: "B", passage: null, topic: "", rule: "", translation: "", flags: [] },
    { i: 1, number: 2, part: 1, kind: "listen", choices: 4, track: 0, stem: "", options: { A: "", B: "", C: "", D: "" }, correct: "C", passage: null, topic: "", rule: "", translation: "", flags: [] },
  ],
});

describe("Bộ đề on two devices (emulators)", () => {
  it("import on A → listed on B → downloaded with audio and pictures → B's answers reach A → delete reaches both", async () => {
    const id = `set-${T}`;
    const a = await device("sets-user");
    await a.on(async (s) => {
      await s.saveMedia([{ key: `${id}:a0`, blob: new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: "audio/mpeg" }) }, { key: `${id}:p2`, blob: new Blob([new Uint8Array([9, 9])], { type: "image/jpeg" }) }]);
      await s.saveTestSet({ ...set(id), attempt: { startedAt: T, elapsedMs: 1000, answers: { 0: "A" } } });
      await s.flushSetsSync();
      expect(s.testSets.get()[0].syncedAt).toBeGreaterThan(0);
      expect(s.setsSync.get().error).toBe("");
    });
    // In the account: the document and every file, nothing else.
    const listed = await a.cloud.list();
    expect(listed.map((m) => [m.id, m.files, m.bytes, m.questions])).toEqual([[id, ["set.json", "media/a0", "media/p2"], expect.any(Number), 2]]);
    expect(new Uint8Array(await getBytes(ref(a.storage, `users/${a.uid}/testsets/${id}/media/a0`)))).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));

    const b = await device("sets-user");
    expect(b.uid).toBe(a.uid);
    await b.on(async (s) => {
      await s.syncTestSets();
      expect(s.testSets.get()).toEqual([]);
      expect(s.remoteSets.get().map((m) => m.id)).toEqual([id]);
      const got = await s.downloadTestSet(id);
      expect(got.attempt?.answers).toEqual({ 0: "A" });
      expect(got.questions).toHaveLength(2);
      expect(s.remoteSets.get()).toEqual([]);
      expect(new Uint8Array(await (await s.loadMedia(`${id}:a0`))!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
      expect(new Uint8Array(await (await s.loadMedia(`${id}:p2`))!.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
      // B continues the attempt and moves a replay clip.
      const cur = s.testSets.get()[0];
      await s.saveTestSet({ ...cur, attempt: { ...cur.attempt!, answers: { 0: "A", 1: "C" }, elapsedMs: 5000 }, questions: cur.questions.map((q) => (q.i === 1 ? { ...q, clip: { track: 0, from: 10, to: 20 } } : q)) });
      await s.flushSetsSync();
    });
    await a.on(async (s) => {
      await s.syncTestSets();
      const cur = s.testSets.get()[0];
      expect(cur.attempt).toMatchObject({ answers: { 0: "A", 1: "C" }, elapsedMs: 5000 });
      expect(cur.questions[1].clip).toEqual({ track: 0, from: 10, to: 20 });
      // Delete on A: gone from the account, the document first.
      await s.deleteTestSet(id);
      expect(await a.cloud.list()).toEqual([]);
      await expect(getBytes(ref(a.storage, `users/${a.uid}/testsets/${id}/media/a0`))).rejects.toMatchObject({ code: "storage/object-not-found" });
    });
    await b.on(async (s) => {
      await s.syncTestSets();
      expect(s.testSets.get()).toEqual([]);
      expect(await s.loadMedia(`${id}:a0`)).toBeNull();
    });
  });

  it("another account cannot read the files or the document", async () => {
    const a = await device("sets-owner-2");
    await a.cloud.putFile("s9", "set.json", new Blob(["{}"], { type: "application/json" }));
    const app = initializeApp({ apiKey: "fake", projectId: "demo-lexi", appId: "1:1:web:1" }, `sets${++seq}`);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "intruder", email: "second@example.com", email_verified: true })));
    const st = getStorage(app, bucketOf("demo-lexi"));
    connectStorageEmulator(st, "127.0.0.1", 9199);
    await expect(getBytes(ref(st, `users/${a.uid}/testsets/s9/set.json`))).rejects.toMatchObject({ code: "storage/unauthorized" });
  });
});
