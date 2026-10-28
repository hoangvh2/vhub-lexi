/**
 * Everything the UI can do to the data. Pure orchestration over the Repo; no UI code here.
 */
import {
  CardState, DEFAULT_DECK_NAME, cardId, dayId, reviewId,
  type Card, type DailyDelta, type Deck, type FieldValue, type Id, type Note, type Prefs, type Rating, type ReviewLog,
} from "@shared/model.ts";
import { NOTE_TYPES, noteType, wantedTemplates } from "@shared/notetypes.ts";
import { answer, makeScheduler, newCard } from "../lib/scheduler.ts";
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

export async function reviewCard(card: Card, rating: Rating, durationMs: number, now = Date.now()): Promise<Reviewed> {
  const p = prefs.get();
  const sched = makeScheduler(p.desiredRetention);
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
  };
  const wasNew = card.state === CardState.New;
  const delta: DailyDelta = { id: dayId(now, p.dayStartHour), newCards: wasNew ? 1 : 0, reviews: wasNew ? 0 : 1, rating, ms: log.durationMs };
  await currentRepo().commitReview(next, log, delta);
  return { prev: card, next, logId: log.id, delta };
}

export async function undoReview(r: Reviewed) {
  await currentRepo().undoReview(r.prev, r.logId, r.delta);
}

export { cardId };
