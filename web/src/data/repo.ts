import type { Card, Daily, DailyDelta, Deck, Note, Prefs, ReviewLog } from "@shared/model.ts";
import type { SeedPack, SeedState } from "@shared/seed.ts";

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
  /**
   * Writes whole notes and cards in as few atomic batches as the store allows (Firestore: 500 writes); a note and
   * the cards given for it always land in the same batch. No reads. Moving words to another deck goes through here.
   */
  saveMany(notes: Note[], cards: Card[]): Promise<void>;
  deleteCards(ids: string[]): Promise<void>;
  /** Atomically stores the new card state, appends the log and bumps the day counters. */
  commitReview(card: Card, log: ReviewLog, delta: DailyDelta): Promise<void>;
  /** Reverts commitReview: restores the card, removes the log, subtracts the counters. */
  undoReview(prev: Card, logId: string, delta: DailyDelta): Promise<void>;
  savePrefs(p: Prefs): Promise<void>;
  /**
   * Answer history of one note (all its cards), oldest first: the "card info" view and the study screen's hint lock.
   * `cache: false` (cloud): fail when the server cannot be asked instead of scanning the local cache.
   */
  reviewsOfNote(noteId: string, opts?: { cache?: boolean }): Promise<ReviewLog[]>;
  /** Every answer on record (up to the review limit): the FSRS optimizer's training data. */
  allReviews(): Promise<ReviewLog[]>;
  /**
   * What the store holds of a built-in pack (shared/seed.ts): the version recorded as loaded and the pack's notes,
   * cards and deck still there. Cloud: asked from the server only, never the cache; null when it cannot be reached.
   * `ignoreMarker` reports version 0 (the learner asked to bring back what is missing).
   */
  seedState(pack: SeedPack, opts?: { ignoreMarker?: boolean }): Promise<{ state: SeedState; cardIds: Set<string> } | null>;
  /** Records that `version` of pack `packId` is loaded (settings/seeds). */
  markSeed(packId: string, version: number): Promise<void>;
  exportAll(): Promise<ExportFile>;
  /** Merges a previously exported file (existing ids are overwritten). */
  importAll(f: ExportFile): Promise<{ notes: number; cards: number }>;
}

export function validateExport(x: unknown): x is ExportFile {
  const f = x as Partial<ExportFile> | null;
  return !!f && f.app === "vhub-lexi" && f.version === 1 && Array.isArray(f.notes) && Array.isArray(f.cards) && Array.isArray(f.decks);
}
