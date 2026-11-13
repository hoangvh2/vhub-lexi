/**
 * Everything the UI can do to the data. Pure orchestration over the Repo; no UI code here.
 */
import {
  CardState, DEFAULT_DECK_NAME, cardId, dayId, reviewId,
  type Card, type DailyDelta, type Deck, type FieldValue, type Id, type Note, type Prefs, type Rating, type ReviewLog,
} from "@shared/model.ts";
import { NOTE_TYPES, noteType, wantedTemplates } from "@shared/notetypes.ts";
import { forgotOf, withForgot, type ForgotKind } from "@shared/drill.ts";
import type { Answer, FitResult } from "../lib/optimizer.ts";
import type { WorkerReply, WorkerRequest } from "../lib/optimizer.worker.ts";
import { answer, makeScheduler, newCard } from "../lib/scheduler.ts";
import { eligibility } from "../lib/select.ts";
import { isFreeNew, liveRecognize } from "../lib/queue.ts";
import { cards, currentRepo, decks, notes, prefs } from "./state.ts";

export const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 20);

// ------------------------------------------------------------------ decks

/** Returns the id of a deck to put new notes in, creating "Mặc định" on first use. */
export async function ensureDeck(): Promise<Id> {
  const want = prefs.get().defaultDeckId;
  const list = decks.get();
  if (want && list.some((d) => d.id === want)) return want;
  if (list[0]) return list[0].id;
  const now = Date.now();
  const d: Deck = { id: newId(), name: DEFAULT_DECK_NAME, createdAt: now, updatedAt: now };
  await currentRepo().saveDeck(d);
  return d.id;
}

export async function createDeck(name: string): Promise<Deck> {
  const now = Date.now();
  const d: Deck = { id: newId(), name: name.trim().slice(0, 60) || DEFAULT_DECK_NAME, createdAt: now, updatedAt: now };
  await currentRepo().saveDeck(d);
  return d;
}

/** Saves each deck's share of the daily new words (Deck.newWeight); `undefined` removes it, which means an equal share. */
export async function setDeckWeights(weights: ReadonlyMap<Id, number | undefined>) {
  const now = Date.now();
  for (const d of decks.get()) {
    if (!weights.has(d.id)) continue;
    const w = weights.get(d.id);
    if (w === d.newWeight) continue;
    const { newWeight: _old, ...rest } = d;
    await currentRepo().saveDeck({ ...rest, ...(w === undefined ? {} : { newWeight: Math.max(0, Math.min(100, Math.round(w))) }), updatedAt: now });
  }
}

export async function renameDeck(d: Deck, name: string) {
  await currentRepo().saveDeck({ ...d, name: name.trim().slice(0, 60) || d.name, updatedAt: Date.now() });
}

/** Deletes a deck together with its notes and cards. Callers must have confirmed. */
export async function deleteDeckAndContents(deckId: Id) {
  const repo = currentRepo();
  for (const n of notes.get().filter((n) => n.deckId === deckId)) {
    await repo.deleteNote(n.id, cards.get().filter((c) => c.noteId === n.id).map((c) => c.id));
  }
  await repo.deleteDeck(deckId);
}

// ------------------------------------------------------------------ notes

export interface NoteDraft {
  type: string;
  deckId?: Id;
  fields: Record<string, FieldValue>;
  aiFields?: string[];
  tags?: string[];
}

function cleanFields(type: string, fields: Record<string, FieldValue>): Record<string, FieldValue> {
  const def = noteType(type);
  const out: Record<string, FieldValue> = {};
  for (const f of def?.fields ?? []) {
    const v = fields[f.key];
    if (f.kind === "list") {
      const l = (Array.isArray(v) ? v : []).map((s) => s.trim().slice(0, f.maxLength)).filter(Boolean).slice(0, 8);
      if (l.length) out[f.key] = l;
    } else {
      const s = (typeof v === "string" ? v : "").trim().slice(0, f.maxLength);
      if (s) out[f.key] = s;
    }
  }
  return out;
}

/** Cards that should exist for this note but do not yet. */
function missingCards(note: Note, existing: readonly Card[], now: number): Card[] {
  const have = new Set(existing.filter((c) => c.noteId === note.id).map((c) => c.template));
  return wantedTemplates(note, prefs.get().templates)
    .filter((t) => !have.has(t))
    .map((t) => newCard(note.id, note.deckId, t, now));
}

export async function addNote(d: NoteDraft): Promise<Note> {
  if (!NOTE_TYPES[d.type]) throw new Error(`Unknown note type ${d.type}`);
  const now = Date.now();
  const note: Note = {
    id: newId(),
    type: d.type,
    deckId: d.deckId ?? (await ensureDeck()),
    fields: cleanFields(d.type, d.fields),
    ...(d.aiFields?.length ? { aiFields: d.aiFields } : {}),
    ...(d.tags?.length ? { tags: d.tags } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await currentRepo().saveNote(note, missingCards(note, [], now));
  return note;
}

/** Edits a note; creates cards that became possible and deletes ones that no longer apply (and never reviewed). */
export async function updateNote(note: Note, patch: { fields?: Record<string, FieldValue>; deckId?: Id; aiFields?: string[]; tags?: string[] }) {
  const now = Date.now();
  const next: Note = {
    ...note,
    deckId: patch.deckId ?? note.deckId,
    fields: patch.fields ? cleanFields(note.type, patch.fields) : note.fields,
    aiFields: patch.aiFields ?? note.aiFields,
    tags: patch.tags ?? note.tags,
    updatedAt: now,
  };
  if (!next.aiFields?.length) delete next.aiFields;
  if (!next.tags?.length) delete next.tags;
  const repo = currentRepo();
  const existing = cards.get().filter((c) => c.noteId === note.id);
  const fresh = missingCards(next, existing, now);
  await repo.saveNote(next, fresh);
  if (next.deckId !== note.deckId) for (const c of existing) await repo.saveCard({ ...c, deckId: next.deckId, updatedAt: now });
  const wanted = new Set(wantedTemplates(next, prefs.get().templates));
  const stale = existing.filter((c) => !wanted.has(c.template) && c.state === CardState.New).map((c) => c.id);
  if (stale.length) await repo.deleteCards(stale);
}

/**
 * The writes that move notes to another deck: each note and all its cards get the new deckId, nothing else changes
 * (FSRS state, due dates, suspension and the review history stay as they are). Notes already there are skipped.
 */
export function planMove(allNotes: readonly Note[], allCards: readonly Card[], noteIds: Iterable<Id>, deckId: Id, now: number): { notes: Note[]; cards: Card[] } {
  const ids = new Set(noteIds);
  const moved = allNotes.filter((n) => ids.has(n.id) && n.deckId !== deckId).map((n) => ({ ...n, deckId, updatedAt: now }));
  const movedIds = new Set(moved.map((n) => n.id));
  const movedCards = allCards.filter((c) => movedIds.has(c.noteId)).map((c) => ({ ...c, deckId, updatedAt: now }));
  return { notes: moved, cards: movedCards };
}

/** Moves the chosen notes (and their cards) to `deckId` (an existing or just-created deck) in batched writes; returns how many notes moved. */
export async function moveNotes(noteIds: Iterable<Id>, deckId: Id): Promise<number> {
  const plan = planMove(notes.get(), cards.get(), noteIds, deckId, Date.now());
  if (plan.notes.length) await currentRepo().saveMany(plan.notes, plan.cards);
  return plan.notes.length;
}

/**
 * Marks a word "hay quên" (its meaning or its sound) or clears the mark: one write of the note document, nothing
 * else. Cards, FSRS state and the review log are not touched (shared/drill.ts).
 */
export async function setForgot(note: Note, kind: ForgotKind, on: boolean) {
  const latest = notes.get().find((n) => n.id === note.id) ?? note;
  if (forgotOf(latest).includes(kind) === on) return;
  await currentRepo().saveNote(withForgot(latest, kind, on, Date.now()), []);
}

export async function removeNote(note: Note) {
  const ids = cards.get().filter((c) => c.noteId === note.id).map((c) => c.id);
  await currentRepo().deleteNote(note.id, ids);
}

export async function setSuspended(card: Card, suspended: boolean) {
  const next: Card = { ...card, suspended: suspended || undefined, updatedAt: Date.now() };
  if (!suspended) delete next.suspended;
  await currentRepo().saveCard(next);
}

/** Applies new preferences and creates/removes cards when the chosen templates changed. */
/**
 * Fits FSRS to the learner's answer history in a Worker (Anki's "Optimize"); nothing is saved until applyFsrs.
 * Loads the optimizer (~1.4 MB WebAssembly) on first use.
 */
export async function optimizeFsrs(onProgress?: (fraction: number) => void): Promise<FitResult> {
  const p = prefs.get();
  const logs = await currentRepo().allReviews();
  const answers: Answer[] = logs.map((r) => ({ cardId: r.cardId, reviewedAt: r.reviewedAt, rating: r.rating, state: r.state }));
  const worker = new Worker(new URL("../lib/optimizer.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<FitResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const m = e.data;
        if ("progress" in m) onProgress?.(m.progress[1] ? m.progress[0] / m.progress[1] : 0);
        else if ("result" in m) resolve(m.result);
        else reject(new Error(m.error));
      };
      worker.onerror = (e) => reject(new Error(e.message || "Không chạy được bộ tối ưu"));
      const req: WorkerRequest = {
        answers,
        options: { dayStartHour: p.dayStartHour, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", current: p.fsrsWeights },
      };
      worker.postMessage(req);
    });
  } finally {
    worker.terminate();
  }
}

/** Keeps fitted parameters; both schedulers use them from the next answer on. Memory states already stored stay. */
export async function applyFsrs(r: Extract<FitResult, { status: "fitted" }>) {
  await savePrefs({ ...prefs.get(), fsrsWeights: r.w, fsrsOptimizedAt: Date.now(), fsrsOptimizedReviews: r.reviews });
}

export async function savePrefs(p: Prefs) {
  const now = Date.now();
  const repo = currentRepo();
  await repo.savePrefs({ ...p, updatedAt: now });
  const create: Card[] = [];
  const drop: Id[] = [];
  const allCards = cards.get();
  for (const n of notes.get()) {
    const wanted = new Set(wantedTemplates(n, p.templates));
    const have = allCards.filter((c) => c.noteId === n.id);
    for (const t of wanted) if (!have.some((c) => c.template === t)) create.push(newCard(n.id, n.deckId, t, now));
    for (const c of have) if (!wanted.has(c.template) && c.state === CardState.New) drop.push(c.id);
  }
  for (const c of create) await repo.saveCard(c);
  if (drop.length) await repo.deleteCards(drop);
}

// ------------------------------------------------------------------ reviewing

export interface Reviewed {
  prev: Card;
  next: Card;
  logId: Id;
  delta: DailyDelta;
}

export async function reviewCard(card: Card, rating: Rating, durationMs: number, now = Date.now(), hint: 0 | 1 | 2 | 3 = 0): Promise<Reviewed> {
  const p = prefs.get();
  const sched = makeScheduler(p.desiredRetention, p.fsrsWeights);
  const next = answer(sched, card, rating, now);
  const log: ReviewLog = {
    id: reviewId(card.id, now),
    cardId: card.id,
    noteId: card.noteId,
    deckId: card.deckId,
    rating,
    state: card.state,
    stability: next.stability,
    difficulty: next.difficulty,
    scheduledDays: next.scheduledDays,
    reviewedAt: now,
    durationMs: Math.max(0, Math.min(Math.round(durationMs), 10 * 60_000)),
    device: "web",
    ...(hint ? { hint } : {}),
  };
  // The daily quota counts words: a typing card of a recognised word is answered as a review, not a new word.
  const counted = card.state === CardState.New && !isFreeNew(card, liveRecognize(cards.get(), eligibility(notes.get())));
  const delta: DailyDelta = { id: dayId(now, p.dayStartHour), newCards: counted ? 1 : 0, ...(counted ? { deckId: card.deckId } : {}), reviews: counted ? 0 : 1, rating, ms: log.durationMs };
  await currentRepo().commitReview(next, log, delta);
  return { prev: card, next, logId: log.id, delta };
}

export async function undoReview(r: Reviewed) {
  await currentRepo().undoReview(r.prev, r.logId, r.delta);
}

export { cardId };
