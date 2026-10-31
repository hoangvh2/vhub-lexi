import type { Card, Daily, DailyDelta, Deck, Note, Prefs, ReviewLog } from "@shared/model.ts";

/** Everything the UI reads. Repos push partial updates as their listeners fire. */
export interface Snapshot {
  decks: Deck[];
  notes: Note[];
  cards: Card[];
  daily: Daily[];
  prefs: Prefs | null;
}

export type SyncState = "local" | "loading" | "synced" | "pending" | "offline" | "denied" | "error";

export interface RepoEvents {
  data(patch: Partial<Snapshot>): void;
  sync(s: SyncState): void;
  /** A write the server rejected or a listener that failed: shown to the learner and logged. */
  warn?(message: string, error?: unknown): void;
}

export interface ExportFile {
  app: "vhub-lexi";
  version: 1;
  exportedAt: number;
  decks: Deck[];
  notes: Note[];
  cards: Card[];
  reviews: ReviewLog[];
  daily: Daily[];
  prefs: Prefs | null;
}

/**
 * Persistence boundary. Two implementations: IndexedDB (local-only mode, tests) and Firestore
 * (sync). Everything above this interface is storage-agnostic.
 */
export interface Repo {
  readonly kind: "local" | "cloud";
  start(ev: RepoEvents): Promise<void>;
  stop(): void;
  saveDeck(d: Deck): Promise<void>;
  deleteDeck(id: string): Promise<void>;
  /** Creates or updates a note and writes its (new) cards in one atomic batch. */
  saveNote(note: Note, newCards: Card[]): Promise<void>;
  /** Deletes a note, its cards and nothing else (review logs stay as history). */
  deleteNote(noteId: string, cardIds: string[]): Promise<void>;
  saveCard(c: Card): Promise<void>;
  deleteCards(ids: string[]): Promise<void>;
  /** Atomically stores the new card state, appends the log and bumps the day counters. */
  commitReview(card: Card, log: ReviewLog, delta: DailyDelta): Promise<void>;
  /** Reverts commitReview: restores the card, removes the log, subtracts the counters. */
  undoReview(prev: Card, logId: string, delta: DailyDelta): Promise<void>;
  savePrefs(p: Prefs): Promise<void>;
  /** Answer history of one note (all its cards), oldest first: the "card info" view. */
  reviewsOfNote(noteId: string): Promise<ReviewLog[]>;
  /** Every answer on record (up to the review limit): the FSRS optimizer's training data. */
  allReviews(): Promise<ReviewLog[]>;
  exportAll(): Promise<ExportFile>;
  /** Merges a previously exported file (existing ids are overwritten). */
  importAll(f: ExportFile): Promise<{ notes: number; cards: number }>;
}

export function validateExport(x: unknown): x is ExportFile {
  const f = x as Partial<ExportFile> | null;
  return !!f && f.app === "vhub-lexi" && f.version === 1 && Array.isArray(f.notes) && Array.isArray(f.cards) && Array.isArray(f.decks);
}
