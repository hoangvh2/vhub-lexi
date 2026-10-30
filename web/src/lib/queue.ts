/**
 * Builds the study queue. Pure functions: easy to test, and the Android port mirrors them.
 *
 *   learning  cards in (re)learning whose short step is due (or due within the learn-ahead window)
 *   review    review cards due before the next study-day boundary, most overdue first
 *   new       never-seen cards, oldest first, capped by the daily limit
 *
 * Siblings (cards of the same note) are buried for the rest of the session once one is answered,
 * so you never see "word → meaning" and "cloze of the same word" back to back.
 *
 * Near-synonyms learned at the same time interfere with each other (convince/persuade both mean "thuyết
 * phục"), so a new word waits while another word sharing a Vietnamese meaning phrase is still settling:
 * introduced in this queue, or reviewed but not yet on an interval of SETTLE_DAYS days.
 */
import { CardState, nextDayStart, type Card, type Daily, type Id, type Prefs } from "@shared/model.ts";

/** How far ahead "learn ahead" looks when the learner chooses to continue early. */
export const LEARN_AHEAD_MS = 20 * 60_000;
export const LEECH_LAPSES = 8;
/** A card on an interval this long (days) is settled enough for a near-synonym to start. */
export const SETTLE_DAYS = 3;

export interface QueueInput {
  cards: readonly Card[];
  /** False for cards whose note is gone or whose template no longer applies to the note. */
  eligible(c: Card): boolean;
  today: Daily | undefined;
  prefs: Prefs;
  now: number;
  deckId?: Id | null;
  /** Show learning cards due within this many ms (0 = only when due). */
  learnAheadMs?: number;
  /** Notes whose other cards are hidden for this session. */
  buried: ReadonlySet<Id>;
  /** Deck-specific new-card limits. */
  deckNewPerDay?: ReadonlyMap<Id, number>;
  /** Vietnamese meaning phrases per note (meaningsByNote); when given, near-synonyms are introduced apart. */
  meanings?: ReadonlyMap<Id, readonly string[]>;
}

export interface Queue {
  learning: Card[];
  review: Card[];
  newCards: Card[];
  /** Counts for the header; `new` and `review` already respect the daily limits. */
  counts: { new: number; learning: number; review: number };
}

export function buildQueue(i: QueueInput): Queue {
  const cutoff = nextDayStart(i.now, i.prefs.dayStartHour);
  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: Card[] = [];
  for (const c of i.cards) {
    if (c.suspended || !i.eligible(c)) continue;
    if (i.deckId && c.deckId !== i.deckId) continue;
    if (c.state === CardState.Learning || c.state === CardState.Relearning) {
      if (c.due <= i.now + (i.learnAheadMs ?? 0)) learning.push(c);
    } else if (c.state === CardState.Review) {
      if (c.due < cutoff && !i.buried.has(c.noteId)) review.push(c);
    } else if (!i.buried.has(c.noteId)) {
      fresh.push(c);
    }
  }
  learning.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due);
  fresh.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));

  const newLimit = Math.max(0, i.prefs.newPerDay - (i.today?.newCards ?? 0));
  const reviewLimit = Math.max(0, i.prefs.maxReviewsPerDay - (i.today?.reviews ?? 0));

  // Meaning phrase -> notes still settling with it (any deck: interference does not care about decks).
  const settling = new Map<string, Set<Id>>();
  const hold = (noteId: Id) => {
    for (const p of i.meanings?.get(noteId) ?? []) {
      const owners = settling.get(p) ?? new Set<Id>();
      owners.add(noteId);
      settling.set(p, owners);
    }
  };
  const blocked = (noteId: Id) =>
    (i.meanings?.get(noteId) ?? []).some((p) => {
      const owners = settling.get(p);
      return !!owners && (owners.size > 1 || !owners.has(noteId));
    });
  if (i.meanings) {
    for (const c of i.cards) if (!c.suspended && c.state !== CardState.New && c.scheduledDays < SETTLE_DAYS) hold(c.noteId);
  }

  // One new card per note per session (siblings wait for the next session).
  const seen = new Set<Id>();
  const newCards: Card[] = [];
  for (const c of fresh) {
    if (newCards.length >= newLimit) break;
    if (seen.has(c.noteId) || blocked(c.noteId)) continue;
    seen.add(c.noteId);
    hold(c.noteId);
    newCards.push(c);
  }
  const reviewCapped = review.slice(0, reviewLimit);
  return {
    learning,
    review: reviewCapped,
    newCards,
    counts: { new: newCards.length, learning: learning.length, review: reviewCapped.length },
  };
}

export interface SessionState {
  shown: number;
  shownNew: number;
}

/** Next card to show, or null when the session is done. Learning cards that are due come first. */
export function pickNext(q: Queue, s: SessionState, now: number): Card | null {
  const due = q.learning.find((c) => c.due <= now);
  if (due) return due;
  const rest = q.review.length + q.newCards.length;
  if (rest === 0) return q.learning[0] ?? null;
  if (q.newCards.length === 0) return q.review[0];
  if (q.review.length === 0) return q.newCards[0];
  // Spread new cards evenly among reviews.
  const share = q.newCards.length / rest;
  return s.shownNew < Math.round((s.shown + 1) * share) ? q.newCards[0] : q.review[0];
}

export function isLeech(c: Card): boolean {
  return c.lapses >= LEECH_LAPSES;
}
