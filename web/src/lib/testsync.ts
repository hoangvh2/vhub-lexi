/**
 * Bộ đề across devices: what goes where, and what to do when this device's sets and the account's meet.
 *
 *  - Cloud Storage `users/{uid}/testsets/{id}/set.json`: the set as imported (questions, passages, tracks, pictures),
 *    written once. `.../media/a0`, `.../media/p3`: the audio files and page pictures (device keys `${id}:a0`…).
 *  - Firestore `users/{uid}/testsets/{id}`: a small document to list the set and continue it anywhere; `state` holds
 *    what changes while the learner works (the attempt, the replay positions) as JSON text.
 *
 * Pure: the Kotlin port (android/core TestSetSync.kt) replays shared/vectors/testsync.json.
 */
import type { Attempt, SetQuestion, TestSet } from "./testset.ts";

export const SET_FILE = "set.json";
/** Firestore list cap (firestore.rules.tmpl) and the most sets the screen lists. */
export const MAX_SETS = 200;

export interface CloudMeta {
  id: string;
  name: string;
  section: "rc" | "lc";
  createdAt: number;
  updatedAt: number;
  /** Paths under the set's folder: "set.json", "media/a0", "media/p3"… */
  files: string[];
  /** Everything in `files` together, for "41 MB". */
  bytes: number;
  questions: number;
  state: string;
}

type Clip = NonNullable<SetQuestion["clip"]>;
interface Progress {
  attempt?: Attempt;
  clips: Record<string, Clip>;
}

/** Device media key → its path in the set's folder: "abc:a0" → "media/a0". */
export const mediaPath = (key: string): string => `media/${key.slice(key.indexOf(":") + 1)}`;
/** Path in the set's folder → device media key: ("abc", "media/a0") → "abc:a0"; null for set.json. */
export const mediaKey = (id: string, path: string): string | null => (path.startsWith("media/") ? `${id}:${path.slice(6)}` : null);

/** The set's files in the cloud: set.json first, then audio in play order, then pictures. */
export function filesOf(set: Pick<TestSet, "tracks" | "pictures">): string[] {
  return [SET_FILE, ...(set.tracks ?? []).map((t) => mediaPath(t.key)), ...(set.pictures ?? []).map((p) => mediaPath(p.key))];
}

/** What changes while the learner works, as stored in `state`. Clips by question position. */
export function progressOf(set: Pick<TestSet, "attempt" | "questions">): string {
  const clips: Record<string, Clip> = {};
  for (const q of set.questions) if (q.clip) clips[String(q.i)] = { track: q.clip.track, from: q.clip.from, to: q.clip.to };
  const p: Progress = { clips };
  if (set.attempt) {
    const a = set.attempt;
    const answers: Record<string, string> = {};
    for (const k of Object.keys(a.answers).map(Number).sort((x, y) => x - y)) answers[String(k)] = a.answers[k];
    p.attempt = { startedAt: a.startedAt, elapsedMs: a.elapsedMs, answers: answers as Attempt["answers"] };
    if (a.finishedAt !== undefined) p.attempt.finishedAt = a.finishedAt;
    if (a.resultNoteId !== undefined) p.attempt.resultNoteId = a.resultNoteId;
  }
  return JSON.stringify(p);
}

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/**
 * The set with the progress in `state` (another device's) in place of its own: the attempt replaced (or gone),
 * every question's clip as `state` has it. Text that does not parse, or has the wrong shape, changes nothing.
 */
export function withProgress<T extends Pick<TestSet, "attempt" | "questions">>(set: T, state: string): T {
  let p: unknown;
  try {
    p = JSON.parse(state);
  } catch {
    return set;
  }
  const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  // progressOf always writes `clips`: without it this is not a state.
  if (!obj(p) || !obj(p.clips)) return set;
  const { attempt } = p;
  const c = p.clips;
  let a: Attempt | undefined;
  if (obj(attempt)) {
    const x = attempt;
    if (!isInt(x.startedAt) || !isInt(x.elapsedMs)) return set;
    const answers: Record<number, Attempt["answers"][number]> = {};
    for (const [k, v] of Object.entries(obj(x.answers) ? x.answers : {})) {
      if (/^\d+$/.test(k) && typeof v === "string" && /^[A-D]$/.test(v)) answers[Number(k)] = v as Attempt["answers"][number];
    }
    a = { startedAt: x.startedAt, elapsedMs: x.elapsedMs, answers };
    if (isInt(x.finishedAt)) a.finishedAt = x.finishedAt;
    if (typeof x.resultNoteId === "string" && x.resultNoteId) a.resultNoteId = x.resultNoteId;
  } else if (attempt !== undefined) return set;
  const questions = set.questions.map((q) => {
    const v = c[String(q.i)];
    const clip = obj(v) && isInt(v.track) && isInt(v.from) && isInt(v.to) ? { track: v.track, from: v.from, to: v.to } : undefined;
    const { clip: _old, ...rest } = q;
    return clip ? { ...rest, clip } : rest;
  });
  const out = { ...set, questions };
  if (a) out.attempt = a;
  else delete out.attempt;
  return out;
}

/** The set as uploaded in set.json: without what only this device knows or what `state` carries. */
export function contentOf(set: TestSet): TestSet {
  const { attempt: _a, syncedAt: _s, ...rest } = set;
  return rest;
}

/** The Firestore document for `set`; `bytes` is the size of set.json plus its media. */
export function metaOf(set: TestSet, bytes: number): CloudMeta {
  return {
    id: set.id,
    name: set.name.slice(0, 200) || "Bộ đề",
    section: set.section ?? "rc",
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
    files: filesOf(set),
    bytes,
    questions: set.questions.length,
    state: progressOf(set),
  };
}

export type SyncAction =
  /** Only here, never uploaded: upload its files, then the document. */
  | { kind: "upload"; id: string }
  /** On both, this device changed it last: write the document. */
  | { kind: "push"; id: string }
  /** On both, another device changed it last (or this one never marked it): take the account's progress. */
  | { kind: "pull"; id: string }
  /** Uploaded once, gone from the account: deleted on another device, so delete it here too. */
  | { kind: "drop"; id: string }
  /** Only in the account: listed, downloaded when the learner opens it. */
  | { kind: "remote"; id: string };

/**
 * What to do with every set, given this device's (`syncedAt`: when it was last known to be in the account) and the
 * account's as the server listed them. Only call it with a list from the server: a missing document means "deleted".
 */
export function planSync(local: ReadonlyArray<{ id: string; updatedAt: number; syncedAt?: number }>, remote: ReadonlyArray<{ id: string; updatedAt: number }>): SyncAction[] {
  const r = new Map(remote.map((m) => [m.id, m]));
  const out: SyncAction[] = [];
  for (const l of local) {
    const m = r.get(l.id);
    if (!m) out.push({ kind: l.syncedAt ? "drop" : "upload", id: l.id });
    else if (l.updatedAt > m.updatedAt) out.push({ kind: "push", id: l.id });
    // Same version but not marked as in the account yet (the upload finished, the mark did not): pull marks it.
    else if (m.updatedAt > l.updatedAt || !l.syncedAt) out.push({ kind: "pull", id: l.id });
  }
  const here = new Set(local.map((l) => l.id));
  for (const m of remote) if (!here.has(m.id)) out.push({ kind: "remote", id: m.id });
  return out;
}
