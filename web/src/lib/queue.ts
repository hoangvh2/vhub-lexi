/**
 * Builds the study queue. Pure functions: easy to test, and the Android port mirrors them.
 *
 *   learning  cards in (re)learning whose short step is due (or due within the learn-ahead window)
 *   review    review cards due before the next study-day boundary, most overdue first
 *   new       never-seen cards, capped by the daily limit and shared out between decks by weight (see shareOut)
 *
 * Siblings (cards of the same note) are buried for the rest of the session once one is answered,
 * so you never see "word → meaning" and "cloze of the same word" back to back. Review cards of a note answered
 * today are also held until the next study day (Anki's "bury review siblings"): the session-only set is lost when
 * the screen is left, and the same word came back as "Ôn" right after the learner had rated it Hard for 27 days.
 * New siblings of a note answered today wait for the next study day too, so leaving and reopening the study screen
 * never serves the cloze of a word met minutes ago as "Mới".
 *
 * The daily "new" quota counts words, not cards: see isFreeNew. A word's typing cards are offered without using it.
 *
 * A word is typed only once it is recognised: while a note's "recognize" card is not yet in Review (new, still in its
 * learning steps, or relearning after a lapse), its other new cards (recall, cloze, listen: all typing cards) wait.
 * Notes without a live recognize card (other note types, or the learner turned that template off) are not held.
 *
 * Custom study (Anki's "Custom study session", kept to what a vocabulary learner uses): `noteIds` limits the
 * session to some notes (a lesson tag) and `reviewAheadDays` also takes review cards due in the next N days.
 * Scheduling is unchanged: FSRS treats an early answer as a review at a shorter elapsed time.
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
  /** Share of the daily new words per deck (Deck.newWeight, see deckWeights); a deck missing from the map counts as 1. */
  deckWeights?: ReadonlyMap<Id, number>;
  /** Vietnamese meaning phrases per note (meaningsByNote); when given, near-synonyms are introduced apart. */
  meanings?: ReadonlyMap<Id, readonly string[]>;
  /** Only these notes (e.g. the notes of one lesson tag). */
  noteIds?: ReadonlySet<Id>;
  /** Also review cards due within this many days after today (review ahead). */
  reviewAheadDays?: number;
}

export interface Queue {
  /** New cards that do not use today's quota (see isFreeNew); also part of newCards. */
  freeNew: Card[];
  learning: Card[];
  review: Card[];
  newCards: Card[];
  /** Counts for the header; `new` and `review` already respect the daily limits. */
  counts: { new: number; learning: number; review: number };
}

/** Notes with a card answered in the current study day (from the cards' lastReview, so it holds across sessions and devices). */
export function answeredToday(cards: readonly Card[], now: number, dayStartHour: number): Set<Id> {
  const dayStart = nextDayStart(now, dayStartHour) - 86_400_000;
  const out = new Set<Id>();
  for (const c of cards) if (c.state !== CardState.New && c.lastReview !== undefined && c.lastReview >= dayStart) out.add(c.noteId);
  return out;
}

/** Weights of decks for the queue: Deck.newWeight, or 1 when the learner never set one (equal shares). */
export function deckWeights(decks: readonly { id: Id; newWeight?: number }[]): Map<Id, number> {
  return new Map(decks.map((d) => [d.id, d.newWeight ?? 1]));
}

export interface NewShare {
  id: Id;
  /** Relative share (integer >= 0; 0 = paused). */
  weight: number;
  /** Most this deck can take. */
  cap: number;
}

/**
 * Splits `total` new words between decks in proportion to their weights, in whole words (largest remainder; ties go to
 * the heavier deck, then the smaller id). A deck that cannot take its share (cap) gives the rest back to the others, so
 * the total only falls short when every deck is out of words. Integer arithmetic only: the Kotlin port must agree.
 */
export function shareOut(total: number, items: readonly NewShare[]): Map<Id, number> {
  const out = new Map<Id, number>(items.map((x) => [x.id, 0]));
  let remaining = Math.max(0, Math.floor(total));
  let active = items.filter((x) => x.weight > 0 && x.cap > 0);
  while (remaining > 0 && active.length > 0) {
    const sum = active.reduce((n, x) => n + x.weight, 0);
    const capped = active.filter((x) => remaining * x.weight > x.cap * sum);
    if (capped.length > 0) {
      for (const x of capped) {
        out.set(x.id, x.cap);
        remaining -= x.cap;
      }
      active = active.filter((x) => !capped.includes(x));
      continue;
    }
    const parts = active.map((x) => ({ x, q: Math.floor((remaining * x.weight) / sum), r: (remaining * x.weight) % sum }));
    let left = remaining - parts.reduce((n, a) => n + a.q, 0);
    for (const a of parts) out.set(a.x.id, a.q);
    parts.sort((a, b) => b.r - a.r || b.x.weight - a.x.weight || (a.x.id < b.x.id ? -1 : a.x.id > b.x.id ? 1 : 0));
    for (const a of parts) {
      if (left <= 0) break;
      out.set(a.x.id, (out.get(a.x.id) ?? 0) + 1);
      left--;
    }
    break;
  }
  return out;
}

/** shareOut for a whole day, plus: every deck above 0% that has words gets at least one, as long as there are enough words for that. */
export function dailyShares(total: number, items: readonly NewShare[]): Map<Id, number> {
  const out = shareOut(total, items);
  const eligible = items.filter((x) => x.weight > 0 && x.cap > 0).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (total < eligible.length) return out;
  for (const x of eligible) {
    if ((out.get(x.id) ?? 0) > 0) continue;
    const donors = eligible.filter((d) => (out.get(d.id) ?? 0) >= 2).sort((a, b) => (out.get(b.id) ?? 0) - (out.get(a.id) ?? 0) || b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (!donors[0]) break;
    out.set(donors[0].id, (out.get(donors[0].id) ?? 0) - 1);
    out.set(x.id, 1);
  }
  return out;
}

/** Notes (not cards) with a new card, per deck, in the order the cards come: what each deck can still offer today. */
function distinctNotes(cards: readonly Card[] | undefined): number {
  return new Set((cards ?? []).map((c) => c.noteId)).size;
}

/** The template that introduces a word; the note's typing cards wait until it reaches Review (see awaitingRecognize). */
export const INTRO_TEMPLATE = "recognize";

/** Notes whose live (eligible, not suspended) "recognize" card is not in Review yet: their other new cards wait. */
export function awaitingRecognize(cards: readonly Card[], eligible: (c: Card) => boolean): Set<Id> {
  const out = new Set<Id>();
  for (const c of cards) if (c.template === INTRO_TEMPLATE && !c.suspended && c.state !== CardState.Review && eligible(c)) out.add(c.noteId);
  return out;
}

/** Notes that have a live (eligible, not suspended) "recognize" card, in any state. */
export function liveRecognize(cards: readonly Card[], eligible: (c: Card) => boolean): Set<Id> {
  const out = new Set<Id>();
  for (const c of cards) if (c.template === INTRO_TEMPLATE && !c.suspended && eligible(c)) out.add(c.noteId);
  return out;
}

/**
 * The daily "new" quota counts WORDS: a word's recognize card uses one slot, and its typing cards (recall, cloze,
 * listen) come later for free, once the word is recognised. A new card is free when its note has a live recognize card
 * and it is not that card; notes without one (template off, other note types) count every card as before.
 */
export const isFreeNew = (c: Card, live: ReadonlySet<Id>) => c.state === CardState.New && c.template !== INTRO_TEMPLATE && live.has(c.noteId);

/** A new card that may be introduced now: not a typing card of a word whose recognize card is still settling. */
export const introducible = (c: Card, waiting: ReadonlySet<Id>) => c.template === INTRO_TEMPLATE || !waiting.has(c.noteId);

export function buildQueue(i: QueueInput): Queue {
  const cutoff = nextDayStart(i.now, i.prefs.dayStartHour) + (i.reviewAheadDays ?? 0) * 86_400_000;
  const doneToday = answeredToday(i.cards, i.now, i.prefs.dayStartHour);
  const waiting = awaitingRecognize(i.cards, i.eligible);
  const live = liveRecognize(i.cards, i.eligible);
  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: Card[] = [];
  const freeAll: Card[] = [];
  for (const c of i.cards) {
    if (c.suspended || !i.eligible(c)) continue;
    if (i.deckId && c.deckId !== i.deckId) continue;
    if (i.noteIds && !i.noteIds.has(c.noteId)) continue;
    if (c.state === CardState.Learning || c.state === CardState.Relearning) {
      if (c.due <= i.now + (i.learnAheadMs ?? 0)) learning.push(c);
    } else if (c.state === CardState.Review) {
      if (c.due < cutoff && !i.buried.has(c.noteId) && !doneToday.has(c.noteId)) review.push(c);
    } else if (!i.buried.has(c.noteId) && !doneToday.has(c.noteId) && introducible(c, waiting)) {
      (isFreeNew(c, live) ? freeAll : fresh).push(c);
    }
  }
  learning.sort((a, b) => a.due - b.due);
  review.sort((a, b) => a.due - b.due);
  const byIntro = (a: Card, b: Card) => a.createdAt - b.createdAt || introRank(a.template) - introRank(b.template) || (a.id < b.id ? -1 : 1);
  fresh.sort(byIntro);
  // Typing cards of recognised words: one per word per queue, outside the daily quota (the next one waits a day).
  const freeNew: Card[] = [];
  const freeSeen = new Set<Id>();
  for (const c of freeAll.sort(byIntro)) if (!freeSeen.has(c.noteId)) (freeSeen.add(c.noteId), freeNew.push(c));

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

  // New words: today's total is shared out between decks by weight (a deck that cannot fill its share gives it back),
  // each deck keeps its own order, and the picks are dealt out deck by deck so the session mixes them.
  const doneBy = i.today?.newByDeck ?? {};
  const groups = new Map<Id, Card[]>();
  for (const c of fresh) {
    const g = groups.get(c.deckId);
    if (g) g.push(c);
    else groups.set(c.deckId, [c]);
  }
  const weightOf = (id: Id) => i.deckWeights?.get(id) ?? 1;
  const ids = [...new Set([...(i.deckWeights?.keys() ?? []), ...groups.keys()])];
  const items: NewShare[] = ids.map((id) => ({ id, weight: weightOf(id), cap: (doneBy[id] ?? 0) + distinctNotes(groups.get(id)) }));
  const targets = dailyShares(i.prefs.newPerDay, items);
  const take = new Map<Id, number>();
  for (const x of items) take.set(x.id, Math.max(0, (targets.get(x.id) ?? 0) - (doneBy[x.id] ?? 0)));
  let want = new Map(take);
  if ([...take.values()].reduce((n, v) => n + v, 0) > newLimit) {
    // Some deck is already past its share today (weights changed): trim to what is left, still by weight.
    want = shareOut(newLimit, items.filter((x) => (take.get(x.id) ?? 0) > 0).map((x) => ({ id: x.id, weight: x.weight, cap: take.get(x.id) ?? 0 })));
  }
  const order = items.filter((x) => x.weight > 0).sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => x.id);
  const seen = new Set<Id>(); // one new card per note per session (siblings wait for the next session)
  const picked = new Map<Id, Card[]>(order.map((d) => [d, []]));
  const cursor = new Map<Id, number>();
  const grab = (d: Id, n: number): number => {
    const list = groups.get(d) ?? [];
    let k = cursor.get(d) ?? 0;
    let got = 0;
    while (got < n && k < list.length) {
      const c = list[k++];
      if (seen.has(c.noteId) || blocked(c.noteId)) continue;
      seen.add(c.noteId);
      hold(c.noteId);
      picked.get(d)?.push(c);
      got++;
    }
    cursor.set(d, k);
    return got;
  };
  let taken = 0;
  for (const d of order) taken += grab(d, Math.min(want.get(d) ?? 0, newLimit - taken));
  // A near-synonym held a word back: fill the gap from the other decks, one word each in turn.
  for (let moved = true; moved && taken < newLimit; ) {
    moved = false;
    for (const d of order) {
      if (taken >= newLimit) break;
      if (grab(d, 1) > 0) (taken++, (moved = true));
    }
  }
  const newCards: Card[] = [];
  for (let round = 0, more = true; more; round++) {
    more = false;
    for (const d of order) {
      const c = picked.get(d)?.[round];
      if (c) (newCards.push(c), (more = true));
    }
  }
  newCards.push(...freeNew);
  const reviewCapped = review.slice(0, reviewLimit);
  return {
    freeNew,
    learning,
    review: reviewCapped,
    newCards,
    counts: { new: newCards.length, learning: learning.length, review: reviewCapped.length },
  };
}

/**
 * Order in which a new note's cards are introduced: see the word and its meaning first, type it later. Without
 * this, cards made at the same moment sorted by id and a brand-new word opened with "cloze" (typing a word the
 * learner had never seen).
 */
export const INTRO_ORDER = ["recognize", "recall", "cloze", "listen"];
const introRank = (template: string) => {
  const i = INTRO_ORDER.indexOf(template);
  return i < 0 ? INTRO_ORDER.length : i;
};

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

/**
 * Review cards outside today's queue that `reviewAheadDays = days` would add (for the "review ahead" button).
 * `skip`: notes the queue holds back today (answeredToday), so the button never offers cards it would not add.
 */
export function dueWithin(cards: readonly Card[], eligible: (c: Card) => boolean, now: number, dayStartHour: number, days: number, deckId?: Id | null, noteIds?: ReadonlySet<Id>, skip?: ReadonlySet<Id>): number {
  const today = nextDayStart(now, dayStartHour);
  const until = today + days * 86_400_000;
  return cards.filter((c) => c.state === CardState.Review && !c.suspended && c.due >= today && c.due < until && eligible(c) && (!deckId || c.deckId === deckId) && (!noteIds || noteIds.has(c.noteId)) && !skip?.has(c.noteId)).length;
}

/** Lesson / topic tags in use, with how many notes carry each; natural order ("lesson-2" before "lesson-10"). */
export function tagCounts(notes: readonly { tags?: string[] }[]): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const n of notes) for (const t of n.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, "en", { numeric: true }));
}

export function isLeech(c: Card): boolean {
  return c.lapses >= LEECH_LAPSES;
}
