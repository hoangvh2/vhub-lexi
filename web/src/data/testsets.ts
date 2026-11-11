/**
 * Imported test sets: kept in this browser's IndexedDB (so a test opens and plays offline), and, when signed in, in
 * the learner's own account so every device has them (lib/testsync.ts, data/setscloud.ts). Never in the JSON backup.
 * The test's text is the learner's personal copy for their own study.
 */
import { createStore } from "../lib/store.ts";
import type { TestSet } from "../lib/testset.ts";
import { SET_FILE, contentOf, mediaKey, mediaPath, metaOf, planSync, withProgress, type CloudMeta } from "../lib/testsync.ts";
import type { SetsCloud } from "./setscloud.ts";

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

/** Stored as given: a change here goes through saveTestSet, which dates it. */
async function putLocal(set: TestSet): Promise<void> {
  await run("readwrite", (s) => void s.put(set));
  testSets.set([set, ...testSets.get().filter((x) => x.id !== set.id)].sort(newest));
}

export async function saveTestSet(set: TestSet): Promise<void> {
  // Never older than what is stored: the next sync compares it with the account's.
  const next = { ...set, updatedAt: Math.max(Date.now(), set.updatedAt + 1) };
  await putLocal(next);
  syncSoon(next.id);
}

async function deleteLocal(id: string): Promise<void> {
  await run("readwrite", (s) => void s.delete(id));
  // Its audio and pictures go with it: every key of a set starts with its id.
  await run("readwrite", (s) => void s.delete(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`)), MEDIA);
  testSets.set(testSets.get().filter((x) => x.id !== id));
}

/** From this device and, once it was uploaded, from the account (so from every device). */
export async function deleteTestSet(id: string): Promise<void> {
  const set = testSets.get().find((x) => x.id === id);
  const stub = remoteSets.get().find((m) => m.id === id);
  await deleteLocal(id);
  remoteSets.set(remoteSets.get().filter((m) => m.id !== id));
  if (!cloud || !(set?.syncedAt || stub)) return;
  const files = stub?.files ?? (set ? metaOf(set, 0).files : [SET_FILE]);
  pendingDeletes.add(id, files);
  await serial(() => flushDeletes()).catch(() => undefined);
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

// ------------------------------------------------------------------ in the account (every device)

let cloud: SetsCloud | null = null;
/** Sets in the account that are not on this device yet: listed, downloaded when opened. */
export const remoteSets = createStore<CloudMeta[]>([]);
/** What the sync is doing now ("" when idle) and its last problem, for the list's header. */
export const setsSync = createStore<{ busy: string; error: string; on: boolean }>({ busy: "", error: "", on: false });
/** The size of each set in the account, as last listed or uploaded (`bytes` of its document). */
const bytesById = new Map<string, number>();

/** Signed in: sets go to the account. Null (signed out, local-only mode): this device only. */
export function useSetsCloud(c: SetsCloud | null): void {
  cloud = c;
  remoteSets.set([]);
  bytesById.clear();
  setsSync.set({ busy: "", error: "", on: !!c });
}

let chain: Promise<unknown> = Promise.resolve();
/** One cloud job at a time: an upload, a download and a sync never interleave. */
function serial<T>(f: () => Promise<T>): Promise<T> {
  const next = chain.then(f, f);
  chain = next.catch(() => undefined);
  return next;
}

const busy = (text: string) => setsSync.update((s) => ({ ...s, busy: text }));
const failed = (text: string) => setsSync.update((s) => ({ ...s, busy: "", error: text }));
const pct = (sent: number, total: number) => `${Math.min(100, Math.round((sent / Math.max(1, total)) * 100))}%`;

/** Deletions not yet done in the account (offline): retried by every sync, so a deleted set does not come back. */
const pendingDeletes = {
  KEY: "lexi-sets-deleted",
  /** Also kept in memory: with storage blocked the deletion is still retried while the page is open. */
  memory: {} as Record<string, string[]>,
  all(): Record<string, string[]> {
    try {
      return { ...this.memory, ...(JSON.parse(localStorage.getItem(this.KEY) ?? "{}") as Record<string, string[]>) };
    } catch {
      return { ...this.memory };
    }
  },
  write(v: Record<string, string[]>) {
    this.memory = v;
    try {
      localStorage.setItem(this.KEY, JSON.stringify(v));
    } catch {
      /* storage blocked: memory only */
    }
  },
  add(id: string, files: string[]) {
    this.write({ ...this.all(), [id]: files });
  },
  done(id: string) {
    const { [id]: _, ...rest } = this.all();
    this.write(rest);
  },
};

async function flushDeletes(): Promise<void> {
  if (!cloud) return;
  for (const [id, files] of Object.entries(pendingDeletes.all())) {
    await cloud.remove(id, files);
    pendingDeletes.done(id);
  }
}

async function upload(set: TestSet): Promise<void> {
  const c = cloud!;
  const json = new Blob([JSON.stringify(contentOf(set))], { type: "application/json" });
  const media: Array<{ path: string; blob: Blob }> = [];
  for (const key of [...(set.tracks ?? []).map((t) => t.key), ...(set.pictures ?? []).map((p) => p.key)]) {
    const blob = await loadMedia(key);
    if (blob) media.push({ path: mediaPath(key), blob });
  }
  const total = json.size + media.reduce((a, m) => a + m.blob.size, 0);
  let done = 0;
  const label = `Đang đưa “${set.name}” lên tài khoản`;
  busy(`${label}…`);
  await c.putFile(set.id, SET_FILE, json);
  done += json.size;
  for (const m of media) {
    await c.putFile(set.id, m.path, m.blob, (sent) => busy(`${label}… ${pct(done + sent, total)}`));
    done += m.blob.size;
  }
  // The document last: another device lists the set only once every file it names is there.
  const meta = { ...metaOf(set, total), files: [SET_FILE, ...media.map((m) => m.path)] };
  await c.putMeta(meta);
  bytesById.set(set.id, total);
  await markSynced(set.id, meta.updatedAt);
}

/** Records that version `updatedAt` of the set is in the account, unless it changed again meanwhile. */
async function markSynced(id: string, updatedAt: number): Promise<void> {
  const now = testSets.get().find((x) => x.id === id);
  if (now && now.updatedAt === updatedAt) await putLocal({ ...now, syncedAt: Date.now() });
}

async function push(set: TestSet): Promise<void> {
  const meta = metaOf(set, bytesById.get(set.id) ?? 0);
  await cloud!.putMeta(meta);
  await markSynced(set.id, set.updatedAt);
}

/** Lists the account and brings both sides together (see planSync). Runs when the Bộ đề screen opens. */
export function syncTestSets(): Promise<void> {
  if (!cloud) return Promise.resolve();
  return serial(async () => {
    try {
      await loadTestSets();
      await flushDeletes();
      busy("Đang đồng bộ…");
      const remote = await cloud!.list();
      const byId = new Map(remote.map((m) => [m.id, m]));
      for (const m of remote) bytesById.set(m.id, m.bytes);
      const stubs: CloudMeta[] = [];
      for (const a of planSync(testSets.get(), remote)) {
        const set = testSets.get().find((x) => x.id === a.id);
        const m = byId.get(a.id);
        if (a.kind === "upload" && set) await upload(set);
        else if (a.kind === "push" && set) await push(set);
        else if (a.kind === "pull" && set && m && set.updatedAt <= m.updatedAt) {
          await putLocal({ ...withProgress(set, m.state), name: m.name, updatedAt: m.updatedAt, syncedAt: Date.now() });
        } else if (a.kind === "drop") await deleteLocal(a.id);
        else if (a.kind === "remote" && m) stubs.push(m);
      }
      remoteSets.set(stubs.sort((x, y) => y.createdAt - x.createdAt));
      setsSync.update((s) => ({ ...s, busy: "", error: "" }));
    } catch (e) {
      console.warn("[sets] sync", e);
      failed("Chưa đồng bộ được (mất mạng?). Đề trên máy này vẫn dùng bình thường.");
    }
  });
}

let soon: ReturnType<typeof setTimeout> | null = null;
const soonIds = new Set<string>();
/** After a change: a new set is uploaded, a changed one's progress written, a moment later (answers come in bursts). */
function syncSoon(id: string): void {
  if (!cloud) return;
  soonIds.add(id);
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => {
    soon = null;
    const ids = [...soonIds];
    soonIds.clear();
    void serial(async () => {
      for (const id of ids) {
        const set = testSets.get().find((x) => x.id === id);
        if (!set || !cloud) continue;
        try {
          if (set.syncedAt) await push(set);
          else await upload(set);
          setsSync.update((s) => ({ ...s, busy: "", error: "" }));
        } catch (e) {
          console.warn("[sets] save", e);
          failed("Chưa đồng bộ được (mất mạng?). Lexi sẽ thử lại lần sau mở Bộ đề.");
        }
      }
    });
  }, 1500);
}

/** Brings a set that is only in the account onto this device (its questions, audio and pictures). */
export function downloadTestSet(id: string): Promise<TestSet> {
  return serial(async () => {
    const m = remoteSets.get().find((x) => x.id === id);
    if (!cloud || !m) throw new Error("not in the account");
    const label = `Đang tải “${m.name}” về máy`;
    try {
      busy(`${label}…`);
      const content = JSON.parse(await (await cloud.getFile(id, SET_FILE)).text()) as TestSet;
      if (content?.id !== id || !Array.isArray(content.questions)) throw new Error("set.json does not match");
      const media = m.files.filter((f) => f !== SET_FILE);
      let got = 0;
      for (const f of media) {
        const key = mediaKey(id, f);
        if (!key) continue;
        const blob = await cloud.getFile(id, f);
        await saveMedia([{ key, blob }]);
        got += blob.size;
        busy(`${label}… ${pct(got, m.bytes)}`);
      }
      const set: TestSet = { ...withProgress(contentOf(content), m.state), name: m.name, updatedAt: m.updatedAt, syncedAt: Date.now() };
      await putLocal(set);
      remoteSets.set(remoteSets.get().filter((x) => x.id !== id));
      setsSync.update((s) => ({ ...s, busy: "", error: "" }));
      return set;
    } catch (e) {
      // Whatever arrived of its media goes again: a half-downloaded set is not left behind.
      await run("readwrite", (s) => void s.delete(IDBKeyRange.bound(`${id}:`, `${id}:\uffff`)), MEDIA).catch(() => undefined);
      failed("Không tải được bộ đề (mất mạng?). Thử lại khi có mạng.");
      throw e;
    }
  });
}

/** Tests: run every queued cloud job now. */
export async function flushSetsSync(): Promise<void> {
  if (soon) {
    clearTimeout(soon);
    soon = null;
    const ids = [...soonIds];
    soonIds.clear();
    for (const id of ids) {
      const set = testSets.get().find((x) => x.id === id);
      if (set && cloud) await serial(() => (set.syncedAt ? push(set) : upload(set)));
    }
  }
  await chain;
}
