/**
 * Imported test sets live in this browser's IndexedDB only: never in Firestore, never in the JSON backup. The test's
 * text is the learner's personal copy for their own study; what is learnt from it (the result, the cards made from
 * missed questions) goes through the normal repo and syncs.
 */
import { createStore } from "../lib/store.ts";
import type { TestSet } from "../lib/testset.ts";

const DB = "lexi-private";
const STORE = "testsets";
/** The audio files and page pictures of Listening sets, as Blobs keyed by `${setId}:...`. */
const MEDIA = "media";

export const testSets = createStore<TestSet[]>([]);
let loadedOnce = false;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      if (!req.result.objectStoreNames.contains(MEDIA)) req.result.createObjectStore(MEDIA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void, store = STORE): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = f(tx.objectStore(store));
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
  // Its audio and pictures go with it: every key of a set starts with its id.
  await run("readwrite", (s) => void s.delete(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`)), MEDIA);
  testSets.set(testSets.get().filter((x) => x.id !== id));
}

/** Stores a set's audio files and pictures before the set itself, so a saved set never points at missing media. */
export async function saveMedia(items: ReadonlyArray<{ key: string; blob: Blob }>): Promise<void> {
  // Ask the browser not to clear this site's storage under pressure: a test's audio is tens of MB.
  await navigator.storage?.persist?.().catch(() => false);
  for (const it of items) await run("readwrite", (s) => void s.put(it.blob, it.key), MEDIA);
}

export async function loadMedia(key: string): Promise<Blob | null> {
  return ((await run<Blob>("readonly", (s) => s.get(key) as IDBRequest<Blob>, MEDIA)) as Blob | undefined) ?? null;
}

/** How much media is stored, for the set list ("38 MB trên máy"). */
export async function mediaKeys(id: string): Promise<string[]> {
  return ((await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`)) as IDBRequest<IDBValidKey[]>, MEDIA)) ?? []).map(String);
}
