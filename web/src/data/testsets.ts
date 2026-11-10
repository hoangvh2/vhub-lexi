/**
 * Imported test sets live in this browser's IndexedDB only: never in Firestore, never in the JSON backup. The test's
 * text is the learner's personal copy for their own study; what is learnt from it (the result, the cards made from
 * missed questions) goes through the normal repo and syncs.
 */
import { createStore } from "../lib/store.ts";
import type { TestSet } from "../lib/testset.ts";

const DB = "lexi-private";
const STORE = "testsets";

export const testSets = createStore<TestSet[]>([]);
let loadedOnce = false;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = f(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const newest = (a: TestSet, b: TestSet) => b.createdAt - a.createdAt;

/** Reads the sets once per page load (and again when asked). */
export async function loadTestSets(force = false): Promise<TestSet[]> {
  if (loadedOnce && !force) return testSets.get();
  const all = ((await run<TestSet[]>("readonly", (s) => s.getAll() as IDBRequest<TestSet[]>)) ?? []).sort(newest);
  loadedOnce = true;
  testSets.set(all);
  return all;
}

export async function saveTestSet(set: TestSet): Promise<void> {
  const next = { ...set, updatedAt: Date.now() };
  await run("readwrite", (s) => void s.put(next));
  testSets.set([next, ...testSets.get().filter((x) => x.id !== set.id)].sort(newest));
}

export async function deleteTestSet(id: string): Promise<void> {
  await run("readwrite", (s) => void s.delete(id));
  testSets.set(testSets.get().filter((x) => x.id !== id));
}
