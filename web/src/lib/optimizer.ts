/**
 * FSRS parameter optimizer: Anki's "Optimize" button. Fits the 21 FSRS-6 parameters to the learner's own answer
 * history with the official optimizer (fsrs-rs, compiled to threadless WASI), then keeps them only when they predict
 * that history better than the parameters in use.
 *
 * The binding is passed in: the browser build runs in a Worker (optimizer.worker.ts), the Node build in tests.
 * Only card numbers, times and ratings reach it; no vocabulary.
 */
import { clipParameters } from "ts-fsrs";
import { CardState, FSRS_PARAMS, type ReviewLog } from "@shared/model.ts";

/** The part of @open-spaced-repetition/binding this uses. */
export interface OptimizerBinding {
  convertCsvToFsrsItems(data: Uint8Array, nextDayStartsAt: number, timezoneOrOffset: string | number, modelVersion?: "FSRS-6" | "FSRS-7"): unknown[];
  computeParameters(items: unknown[], options: { enableShortTerm: boolean; modelVersion?: "FSRS-6" | "FSRS-7"; numRelearningSteps?: number; progress?: (current: number, total: number) => boolean | undefined | void }): Promise<number[]>;
  FSRSBinding: new (parameters?: number[]) => { evaluate(items: unknown[]): { logLoss: number; rmseBins: number } };
}

/** One answer, as much of a ReviewLog as the optimizer reads. */
export type Answer = Pick<ReviewLog, "cardId" | "reviewedAt" | "rating" | "state">;

export interface Metrics {
  logLoss: number;
  /** RMSE over bins: how far predicted recall is from what actually happened (0.05 = 5 points). */
  rmse: number;
}

export type FitResult =
  | { status: "fitted"; w: number[]; reviews: number; before: Metrics; after: Metrics }
  /** The fitted parameters do not predict the history better than the current ones. */
  | { status: "optimal"; reviews: number; before: Metrics }
  /** Too few answers on a later day to learn anything from. */
  | { status: "not-enough"; reviews: number };

export interface FitOptions {
  dayStartHour: number;
  /** IANA time zone the study days are counted in. */
  timeZone: string;
  /** Parameters in use (Prefs.fsrsWeights); the defaults when absent. */
  current?: readonly number[];
  progress?(current: number, total: number): void;
}

const MODEL = "FSRS-6";

/** The FSRS benchmark's revlog CSV, which the binding turns into training items as Anki does. */
export function revlogCsv(answers: readonly Answer[]): Uint8Array {
  const ids = new Map<string, number>();
  const rows = answers
    .filter((a) => a.rating >= 1 && a.rating <= 4 && Number.isFinite(a.reviewedAt))
    .slice()
    .sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : a.reviewedAt - b.reviewedAt))
    .map((a) => {
      let id = ids.get(a.cardId);
      if (id === undefined) ids.set(a.cardId, (id = ids.size));
      // review_state is the card's state when answered: New 0, Learning 1, Review 2, Relearning 3 (as in ReviewLog).
      return `${id},${Math.round(a.reviewedAt)},${a.rating},${a.state ?? CardState.Review},0`;
    });
  return new TextEncoder().encode(["card_id,review_time,review_rating,review_state,review_duration", ...rows].join("\n"));
}

function evaluate(b: OptimizerBinding, items: unknown[], w?: readonly number[]): Metrics | null {
  try {
    const m = new b.FSRSBinding(w ? [...w] : undefined).evaluate(items);
    return Number.isFinite(m.logLoss) && Number.isFinite(m.rmseBins) ? { logLoss: m.logLoss, rmse: m.rmseBins } : null;
  } catch {
    return null; // fsrs-rs: "NotEnoughData"
  }
}

export async function fit(b: OptimizerBinding, answers: readonly Answer[], o: FitOptions): Promise<FitResult> {
  const reviews = answers.length;
  const items = b.convertCsvToFsrsItems(revlogCsv(answers), o.dayStartHour, o.timeZone, MODEL);
  const before = evaluate(b, items, o.current);
  if (!items.length || !before) return { status: "not-enough", reviews };
  const raw = await b.computeParameters(items, {
    enableShortTerm: true,
    modelVersion: MODEL,
    numRelearningSteps: 1, // Lexi relearns in one 10-minute step
    progress: o.progress ? (c, t) => void o.progress!(c, t) : undefined,
  });
  if (raw.length !== FSRS_PARAMS || !raw.every(Number.isFinite)) return { status: "not-enough", reviews };
  // Stored already clipped, so ts-fsrs (which clips) and the Kotlin port (which does not) schedule alike.
  const w = clipParameters(raw.map((x) => Math.round(x * 1e6) / 1e6), 1, true);
  const after = evaluate(b, items, w);
  if (!after || after.rmse >= before.rmse) return { status: "optimal", reviews, before };
  return { status: "fitted", w, reviews, before, after };
}
