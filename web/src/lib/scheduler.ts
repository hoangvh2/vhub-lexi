/**
 * Thin wrapper over ts-fsrs (FSRS spaced repetition) using our flat Card shape.
 *
 * Fuzz is off on purpose: it keeps the web and Android schedulers bit-for-bit comparable
 * (shared/vectors/fsrs.json) at the cost of slightly more clustered due dates.
 */
import { createEmptyCard, fsrs, generatorParameters, type Card as FCard, type FSRS, type Grade, type State } from "ts-fsrs";
import { CardState, type Card, type Id, type Rating } from "@shared/model.ts";

export type Scheduler = FSRS;

/** `w`: the learner's optimized parameters (Prefs.fsrsWeights); the FSRS-6 defaults when absent. */
export function makeScheduler(desiredRetention: number, w?: readonly number[]): Scheduler {
  return fsrs(
    generatorParameters({
      request_retention: desiredRetention,
      ...(w ? { w } : {}),
      enable_fuzz: false,
      enable_short_term: true,
      maximum_interval: 36500,
    }),
  );
}

export function newCard(noteId: Id, deckId: Id, template: string, now: number): Card {
  const e = createEmptyCard(new Date(now));
  return {
    id: `${noteId}.${template}`,
    noteId,
    deckId,
    template,
    state: CardState.New,
    due: now,
    stability: e.stability,
    difficulty: e.difficulty,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function toFsrs(c: Card): FCard {
  // A new card has no memory yet. ts-fsrs recognises that only as stability = difficulty = 0 and throws on
  // anything else (Anki imports before this fix stored difficulty 1 on new cards, which broke "show answer").
  const fresh = c.state === CardState.New;
  return {
    due: new Date(c.due),
    stability: fresh ? 0 : c.stability,
    difficulty: fresh ? 0 : c.difficulty,
    elapsed_days: 0,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as unknown as State,
    last_review: c.lastReview === undefined ? undefined : new Date(c.lastReview),
  };
}

function fromFsrs(base: Card, f: FCard, now: number): Card {
  const next: Card = {
    ...base,
    state: f.state as unknown as Card["state"],
    due: f.due.getTime(),
    stability: f.stability,
    difficulty: f.difficulty,
    scheduledDays: f.scheduled_days,
    learningSteps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    lastReview: f.last_review ? f.last_review.getTime() : now,
    updatedAt: now,
  };
  return next;
}

export interface Outcome {
  card: Card;
  /** Human interval until next review, e.g. "10m", "3d", "2mo". */
  label: string;
}

export function preview(s: Scheduler, card: Card, now: number): Record<Rating, Outcome> {
  const rec = s.repeat(toFsrs(card), new Date(now));
  const out = {} as Record<Rating, Outcome>;
  for (const r of [1, 2, 3, 4] as const) {
    const item = rec[r as Grade];
    const next = fromFsrs(card, item.card, now);
    out[r] = { card: next, label: formatInterval(next.due - now) };
  }
  return out;
}

export function answer(s: Scheduler, card: Card, rating: Rating, now: number): Card {
  const item = s.next(toFsrs(card), new Date(now), rating as Grade);
  return fromFsrs(card, item.card, now);
}

/** Probability of recall right now, 0..1 (1 for cards not yet learned). */
export function retrievability(s: Scheduler, card: Card, now: number): number {
  if (card.state === CardState.New) return 1;
  return s.get_retrievability(toFsrs(card), new Date(now), false) as number;
}

export function formatInterval(ms: number): string {
  if (ms < 60_000) return "<1p";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}p`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}g`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}ng`;
  const mo = d / 30.4375;
  if (mo < 12) return `${Math.round(mo * 10) / 10}th`.replace(".0", "");
  return `${Math.round((d / 365.25) * 10) / 10}năm`.replace(".0", "");
}
