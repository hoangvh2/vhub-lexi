/**
 * Data model shared by the web app, the Cloud Functions and (as a Kotlin port) the Android app.
 *
 * Anki-style split so new study material can be added without touching the scheduler or sync:
 *
 *   Note   = the content ("serendipity" and its meaning), typed by `type` (vocab today, toeic-mcq later).
 *   Card   = one thing to review, derived from a note by a template ("recognize", "cloze"…) and
 *            carrying the FSRS memory state.
 *   Review = append-only log of one answer.
 *   Daily  = per-day counters (cheap to read; used for limits and statistics).
 *
 * Firestore layout (all under users/{uid}): decks, notes, cards, reviews, daily, settings/prefs.
 * All times are epoch milliseconds (numbers), never Firestore Timestamps, so the same documents
 * round-trip through Room and IndexedDB unchanged.
 */

export type Id = string;

/** FSRS card state, same numbering as ts-fsrs / Anki. (A const object, not an enum: runs under type stripping.) */
export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type CardState = (typeof CardState)[keyof typeof CardState];

/** 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4;

export interface Deck {
  id: Id;
  name: string;
  /** Overrides Prefs.newPerDay for this deck when set. */
  newPerDay?: number;
  createdAt: number;
  updatedAt: number;
}

export type FieldValue = string | string[];

export interface Note {
  id: Id;
  /** Key into the note-type registry (shared/notetypes.ts). */
  type: string;
  deckId: Id;
  fields: Record<string, FieldValue>;
  /** Names of fields whose current value was written by AI (shown with an "AI" label). */
  aiFields?: string[];
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Card {
  id: Id; // `${noteId}.${template}` so two devices never create duplicates
  noteId: Id;
  deckId: Id;
  template: string;
  state: CardState;
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview?: number;
  suspended?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewLog {
  id: Id; // `${cardId}@${reviewedAt}`
  cardId: Id;
  noteId: Id;
  deckId: Id;
  rating: Rating;
  /** State of the card before this answer. */
  state: CardState;
  /** Memory values after this answer. */
  stability: number;
  difficulty: number;
  scheduledDays: number;
  reviewedAt: number;
  durationMs: number;
  device: "web" | "android";
}

/**
 * Counters for one study day; id = YYYY-MM-DD. Updated with atomic increments (Firestore
 * `increment`), so two devices working offline converge on the same totals.
 */
export interface Daily {
  id: string;
  /** Cards seen for the first time. */
  newCards: number;
  /** Answers to cards that were already Learning/Review/Relearning. */
  reviews: number;
  /** Answers by rating. */
  again: number;
  hard: number;
  good: number;
  easy: number;
  /** Total answer time in milliseconds. */
  ms: number;
  updatedAt: number;
}

/** What one answer adds to a Daily document. */
export interface DailyDelta {
  id: string;
  newCards: 0 | 1;
  reviews: 0 | 1;
  rating: Rating;
  ms: number;
}

export const RATING_FIELD: Record<Rating, "again" | "hard" | "good" | "easy"> = { 1: "again", 2: "hard", 3: "good", 4: "easy" };

export interface CardLayout {
  showIpa: boolean;
  showPos: boolean;
  showEn: boolean;
  showVi: boolean;
  showExamples: boolean;
  showMnemonic: boolean;
}

export interface Prefs {
  /** FSRS target probability of recall at review time. */
  desiredRetention: number;
  newPerDay: number;
  maxReviewsPerDay: number;
  /** Templates to generate per note type, e.g. { vocab: ["recognize", "cloze"] }. */
  templates: Record<string, string[]>;
  layout: CardLayout;
  autoSpeak: "off" | "front" | "back";
  theme: "system" | "light" | "dark";
  accent: "teal" | "blue" | "orange" | "violet";
  aiEnabled: boolean;
  /** Hour (0-23) when the study day rolls over. */
  dayStartHour: number;
  /** Deck new notes go to by default. */
  defaultDeckId?: Id;
  updatedAt: number;
}

export const DEFAULT_PREFS: Prefs = {
  desiredRetention: 0.9,
  newPerDay: 15,
  maxReviewsPerDay: 200,
  templates: { vocab: ["recognize", "cloze"] },
  layout: { showIpa: true, showPos: true, showEn: true, showVi: true, showExamples: true, showMnemonic: true },
  autoSpeak: "off",
  theme: "system",
  accent: "teal",
  aiEnabled: true,
  dayStartHour: 4,
  updatedAt: 0,
};

export function normalizePrefs(p: Partial<Prefs> | null | undefined): Prefs {
  const d = DEFAULT_PREFS;
  const x = p ?? {};
  const num = (v: unknown, lo: number, hi: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  return {
    desiredRetention: num(x.desiredRetention, 0.7, 0.99, d.desiredRetention),
    newPerDay: Math.round(num(x.newPerDay, 0, 200, d.newPerDay)),
    maxReviewsPerDay: Math.round(num(x.maxReviewsPerDay, 0, 9999, d.maxReviewsPerDay)),
    templates: x.templates && typeof x.templates === "object" ? { ...d.templates, ...x.templates } : d.templates,
    layout: { ...d.layout, ...(x.layout ?? {}) },
    autoSpeak: x.autoSpeak === "front" || x.autoSpeak === "back" ? x.autoSpeak : "off",
    theme: x.theme === "light" || x.theme === "dark" ? x.theme : "system",
    accent: x.accent === "blue" || x.accent === "orange" || x.accent === "violet" ? x.accent : "teal",
    aiEnabled: x.aiEnabled !== false,
    dayStartHour: Math.round(num(x.dayStartHour, 0, 23, d.dayStartHour)),
    defaultDeckId: typeof x.defaultDeckId === "string" ? x.defaultDeckId : undefined,
    updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : 0,
  };
}

export const cardId = (noteId: Id, template: string) => `${noteId}.${template}`;
export const reviewId = (cid: Id, at: number) => `${cid}@${at}`;

/** Local calendar day id (YYYY-MM-DD) with the study day starting at `dayStartHour`. */
export function dayId(ms: number, dayStartHour = 4): string {
  const d = new Date(ms - dayStartHour * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Epoch ms of the next study-day boundary after `ms`. */
export function nextDayStart(ms: number, dayStartHour = 4): number {
  const d = new Date(ms - dayStartHour * 3_600_000);
  d.setHours(24 + dayStartHour, 0, 0, 0);
  return d.getTime();
}

export const DEFAULT_DECK_NAME = "Mặc định";
