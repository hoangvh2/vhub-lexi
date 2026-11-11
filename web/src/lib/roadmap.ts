/**
 * Roadmap statistics: how far along the library is (counted in WORDS, not cards) and a forecast of when the learner
 * will have started every word and "know" 80% of them. Pure functions; the Kotlin port is android/core Roadmap.kt and
 * shared/vectors/roadmap.json (made by web/test/roadmap-vectors.ts) pins both.
 *
 * The forecast is a Monte Carlo run of the real FSRS scheduler over the learner's own cards (see `simulate`): the same
 * learning steps, the same interval formulas, the learner's rating mix and their real pace of new words. It assumes the
 * learner keeps that pace; it cannot know about days off, new words added later or changed settings.
 */
import { default_w } from "ts-fsrs";
import { CardState, dayId, type Card, type Daily } from "@shared/model.ts";
import { answer, makeScheduler } from "./scheduler.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** The template that introduces a word (shared/queue rules: queue.ts INTRO_TEMPLATE). */
const INTRO = "recognize";
const INTRO_ORDER = ["recognize", "recall", "cloze", "listen"];
const introRank = (t: string) => {
  const i = INTRO_ORDER.indexOf(t);
  return i < 0 ? INTRO_ORDER.length : i;
};
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isLearning = (c: Card) => c.state === CardState.Learning || c.state === CardState.Relearning;

/** Interval (days) from which a card counts as known: Anki's "mature". */
export const MATURE_DAYS = 21;
/** Share of the library that has to be known for the "mature" milestone. */
export const MATURE_SHARE = 0.8;

export interface WordStatus {
  total: number;
  /** Every card still new. */
  unseen: number;
  /** At least one card in (re)learning. */
  learning: number;
  /** Started, none learning, but a card is still new or on an interval under MATURE_DAYS. */
  young: number;
  /** Every card is on an interval of MATURE_DAYS or more. */
  mature: number;
}

function groupByNote(cards: readonly Card[]): Map<string, Card[]> {
  const m = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.suspended) continue;
    const g = m.get(c.noteId);
    if (g) g.push(c);
    else m.set(c.noteId, [c]);
  }
  return m;
}

function wordOf(cs: readonly Card[]): "unseen" | "learning" | "young" | "mature" {
  if (cs.every((c) => c.state === CardState.New)) return "unseen";
  if (cs.some(isLearning)) return "learning";
  return cs.every((c) => c.state !== CardState.New && c.scheduledDays >= MATURE_DAYS) ? "mature" : "young";
}

/** Words by progress. Pass only the cards of notes that count as vocabulary. Suspended cards are ignored. */
export function wordStatus(cards: readonly Card[]): WordStatus {
  const r: WordStatus = { total: 0, unseen: 0, learning: 0, young: 0, mature: 0 };
  for (const cs of groupByNote(cards).values()) {
    r.total++;
    r[wordOf(cs)]++;
  }
  return r;
}

const DEFAULT_DECAY_W = 20;

/** FSRS-6 forgetting curve, same formula and rounding as the Kotlin Fsrs port. */
export function recallProbability(c: Card, now: number, w: readonly number[] = default_w): number {
  const decay = -w[DEFAULT_DECAY_W];
  const factor = Math.round((Math.exp((1 / decay) * Math.log(0.9)) - 1) * 1e8) / 1e8;
  const last = c.lastReview ?? c.due - c.scheduledDays * DAY;
  const t = Math.max(0, (now - last) / DAY);
  if (!(c.stability > 0)) return 1;
  return Math.round(Math.pow(1 + (factor * t) / c.stability, decay) * 1e8) / 1e8;
}

export interface RecallEstimate {
  /** Words with at least one answered card. */
  started: number;
  /** Expected number of those words the learner would recall right now (sum of per-word recall probability). */
  recalled: number;
}

/** A word's recall = the mean over its answered cards. */
export function recallNow(cards: readonly Card[], now: number, w?: readonly number[]): RecallEstimate {
  let started = 0;
  let recalled = 0;
  for (const cs of groupByNote(cards).values()) {
    const seen = cs.filter((c) => c.state !== CardState.New);
    if (!seen.length) continue;
    started++;
    recalled += seen.reduce((n, c) => n + recallProbability(c, now, w), 0) / seen.length;
  }
  return { started, recalled };
}

export interface Pace {
  /** New words per day, rest days included. */
  perDay: number;
  /** Days of history the average rests on (0..days). */
  observedDays: number;
  /** Days among them with any study. */
  activeDays: number;
}

/** New words per day over the `days` full study days before today; the window shrinks to the history that exists. */
export function paceOf(daily: readonly Daily[], now: number, dayStartHour: number, days = 14): Pace {
  const byId = new Map(daily.map((d) => [d.id, d]));
  let first = "";
  for (const d of daily) if (d.newCards + d.reviews > 0 && (first === "" || d.id < first)) first = d.id;
  let sum = 0;
  let observed = 0;
  let active = 0;
  if (first !== "") {
    for (let k = 1; k <= days; k++) {
      const id = dayId(now - k * DAY, dayStartHour);
      if (id < first) break;
      observed++;
      const d = byId.get(id);
      sum += d?.newCards ?? 0;
      if (d && d.newCards + d.reviews > 0) active++;
    }
  }
  return { perDay: observed ? sum / observed : 0, observedDays: observed, activeDays: active };
}

/** Prior used until the learner has enough answers of their own: [again, hard, good, easy]. */
const PRIOR_MIX = [0.12, 0.08, 0.7, 0.1];
const PRIOR_WEIGHT = 30;

/** Share of answers by rating over the last `days` days, blended with a small prior so a short history is not extreme. */
export function ratingMix(daily: readonly Daily[], now: number, dayStartHour: number, days = 30): [number, number, number, number] {
  const since = dayId(now - days * DAY, dayStartHour);
  const n = [0, 0, 0, 0];
  for (const d of daily) {
    if (d.id < since) continue;
    n[0] += d.again;
    n[1] += d.hard;
    n[2] += d.good;
    n[3] += d.easy;
  }
  const tot = n[0] + n[1] + n[2] + n[3] + PRIOR_WEIGHT;
  return [0, 1, 2, 3].map((i) => (n[i] + PRIOR_MIX[i] * PRIOR_WEIGHT) / tot) as [number, number, number, number];
}

/** mulberry32: 32-bit integer arithmetic only, so the Kotlin port draws the same numbers. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimInput {
  /** Cards of the notes that count (vocabulary), suspended ones included (they are ignored). */
  cards: readonly Card[];
  now: number;
  /** Epoch ms of the next study-day boundary after `now`: today is [todayEnd - 1 day, todayEnd). */
  todayEnd: number;
  /** New words per day the learner is assumed to start (may be fractional, e.g. their real pace of 11.2). */
  pace: number;
  maxReviewsPerDay: number;
  desiredRetention: number;
  w?: readonly number[];
  /** [again, hard, good, easy] probabilities (see ratingMix). */
  mix: readonly number[];
  /** New words already started today and review answers already given today (they use up today's limits). */
  doneToday: { newWords: number; reviews: number };
  runs?: number;
  horizonDays?: number;
}

export interface Roadmap {
  words: number;
  /** Day index (0 = today) at whose end no word is unseen any more; null when not within the horizon. */
  introDay: number | null;
  /** Day index when MATURE_SHARE of the words are mature; null when not within the horizon. */
  matureDay: number | null;
  /** Number of mature words that MATURE_SHARE means. */
  matureTarget: number;
  /** Median unseen / mature words at the start of day 0, 7, ... 91 (14 points). */
  unseen: number[];
  mature: number[];
  /** Median review answers (due + first typing cards) per day for days 0..90. */
  load: number[];
  /** Highest 7-day average of `load`, and the day it starts on. */
  peakLoad: number;
  peakDay: number;
}

export const SIM_SEED = 20_260_101;
export const SIM_POINTS = 14;
const SIM_LOAD_DAYS = SIM_POINTS * 7; // 98 days: the weekly points plus a full 7-day average at the end

interface SimNote {
  created: number;
  cards: Card[];
  /** The card that introduces the word. */
  intro: number;
}

const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/**
 * Plays the next `horizonDays` study days `runs` times (different dice, same input) and takes medians.
 *
 * Model of one day, in the order the study queue serves it:
 *   1. cards in (re)learning that are due, until they graduate or the day ends;
 *   2. review cards that are due (most overdue first), one card per word per day, up to the daily review limit;
 *   3. a typing card of every word whose recognize card is already in Review, under the same limit;
 *   4. new words (oldest first): the recognize card is answered, repeating its learning steps the same day.
 * Every answer is Again/Hard/Good/Easy drawn from `mix`; the card then moves exactly as the real scheduler moves it.
 */
export function simulate(inp: SimInput): Roadmap | null {
  const runs = inp.runs ?? 12;
  const horizon = inp.horizonDays ?? 240;
  const sched = makeScheduler(inp.desiredRetention, inp.w);
  const todayStart = inp.todayEnd - DAY;

  const groups = [...groupByNote(inp.cards).entries()];
  const base: SimNote[] = groups.map(([, cs]) => {
    const cards = [...cs].sort((a, b) => introRank(a.template) - introRank(b.template) || cmp(a.id, b.id));
    const r = cards.findIndex((c) => c.template === INTRO);
    return { created: Math.min(...cards.map((c) => c.createdAt)), cards, intro: r >= 0 ? r : 0 };
  });
  base.sort((a, b) => a.created - b.created || cmp(a.cards[0].id, b.cards[0].id));
  const words = base.length;
  if (words === 0) return null;
  const target = Math.ceil(words * MATURE_SHARE);
  const c1 = inp.mix[0];
  const c2 = c1 + inp.mix[1];
  const c3 = c2 + inp.mix[2];

  const introDays: number[] = [];
  const matureDays: number[] = [];
  const unseenPts: number[][] = [];
  const maturePts: number[][] = [];
  const loads: number[][] = [];
  const NEVER = Number.POSITIVE_INFINITY;

  for (let run = 0; run < runs; run++) {
    const rand = rng((SIM_SEED + Math.imul(run, 0x9e3779b9)) | 0);
    const notes = base.map((n) => ({ ...n, cards: [...n.cards] }));
    const rate = (): 1 | 2 | 3 | 4 => {
      const u = rand();
      return u < c1 ? 1 : u < c2 ? 2 : u < c3 ? 3 : 4;
    };
    const status = () => {
      let unseen = 0;
      let mature = 0;
      for (const n of notes) {
        const k = wordOf(n.cards);
        if (k === "unseen") unseen++;
        else if (k === "mature") mature++;
      }
      return { unseen, mature };
    };
    /** Answers a card, then keeps answering it while it sits in a learning step due before `dayEnd`. */
    const play = (n: SimNote, ci: number, at: number, dayEnd: number) => {
      n.cards[ci] = answer(sched, n.cards[ci], rate(), at);
      for (let guard = 0; guard < 12 && isLearning(n.cards[ci]) && n.cards[ci].due < dayEnd; guard++) {
        n.cards[ci] = answer(sched, n.cards[ci], rate(), Math.max(n.cards[ci].due, at));
      }
    };

    const up: number[] = [];
    const mp: number[] = [];
    const load: number[] = [];
    let introDay = NEVER;
    let matureDay = NEVER;
    let acc = 0;
    {
      const s0 = status();
      if (s0.unseen === 0) introDay = 0;
      if (s0.mature >= target) matureDay = 0;
    }
    for (let d = 0; d < horizon; d++) {
      const dayStart = todayStart + d * DAY;
      const dayEnd = dayStart + DAY;
      const at = d === 0 ? inp.now : dayStart + 12 * HOUR;
      if (d % 7 === 0 && d / 7 < SIM_POINTS) {
        const s = status();
        up.push(s.unseen);
        mp.push(s.mature);
      }
      const done = new Set<number>();
      if (d === 0) {
        notes.forEach((n, i) => {
          if (n.cards.some((c) => c.state !== CardState.New && c.lastReview !== undefined && c.lastReview >= dayStart)) done.add(i);
        });
      }
      // 1. learning cards that are due.
      const learn: Array<[number, number]> = [];
      notes.forEach((n, i) => n.cards.forEach((c, ci) => isLearning(c) && c.due < dayEnd && learn.push([i, ci])));
      learn.sort((a, b) => notes[a[0]].cards[a[1]].due - notes[b[0]].cards[b[1]].due || cmp(notes[a[0]].cards[a[1]].id, notes[b[0]].cards[b[1]].id));
      for (const [i, ci] of learn) {
        play(notes[i], ci, Math.max(at, notes[i].cards[ci].due), dayEnd);
        done.add(i);
      }
      // 2. review cards that are due, 3. typing cards of recognised words.
      let budget = d === 0 ? Math.max(0, inp.maxReviewsPerDay - inp.doneToday.reviews) : inp.maxReviewsPerDay;
      let answered = 0;
      const due: Array<[number, number]> = [];
      notes.forEach((n, i) => n.cards.forEach((c, ci) => c.state === CardState.Review && c.due < dayEnd && due.push([i, ci])));
      due.sort((a, b) => notes[a[0]].cards[a[1]].due - notes[b[0]].cards[b[1]].due || cmp(notes[a[0]].cards[a[1]].id, notes[b[0]].cards[b[1]].id));
      for (const [i, ci] of due) {
        if (budget <= 0) break;
        if (done.has(i)) continue;
        play(notes[i], ci, at, dayEnd);
        done.add(i);
        budget--;
        answered++;
      }
      const free: Array<[number, number]> = [];
      notes.forEach((n, i) => {
        if (done.has(i) || n.cards[n.intro].state !== CardState.Review) return;
        const ci = n.cards.findIndex((c) => c.state === CardState.New);
        if (ci >= 0) free.push([i, ci]);
      });
      for (const [i, ci] of free) {
        if (budget <= 0) break;
        play(notes[i], ci, at, dayEnd);
        done.add(i);
        budget--;
        answered++;
      }
      // 4. new words.
      let quota: number;
      if (d === 0) quota = Math.max(0, Math.round(inp.pace) - inp.doneToday.newWords);
      else {
        acc += inp.pace;
        quota = Math.floor(acc);
        acc -= quota;
      }
      for (let i = 0; i < notes.length && quota > 0; i++) {
        const n = notes[i];
        if (done.has(i) || n.cards[n.intro].state !== CardState.New) continue;
        play(n, n.intro, at, dayEnd);
        done.add(i);
        quota--;
      }
      if (d < SIM_LOAD_DAYS) load.push(answered);
      const s = status();
      if (introDay === NEVER && s.unseen === 0) introDay = d;
      if (matureDay === NEVER && s.mature >= target) matureDay = d;
      if (introDay !== NEVER && matureDay !== NEVER && d >= SIM_POINTS * 7) break;
    }
    // A run that stopped early leaves the weekly points at their final value.
    while (up.length < SIM_POINTS) {
      const s = status();
      up.push(s.unseen);
      mp.push(s.mature);
    }
    while (load.length < SIM_LOAD_DAYS) load.push(0);
    introDays.push(introDay);
    matureDays.push(matureDay);
    unseenPts.push(up);
    maturePts.push(mp);
    loads.push(load);
  }

  const dayOrNull = (xs: number[]) => {
    const m = medianOf(xs);
    return Number.isFinite(m) ? m : null;
  };
  const col = (rows: number[][], j: number) => medianOf(rows.map((r) => r[j]));
  const load = Array.from({ length: SIM_LOAD_DAYS }, (_, j) => col(loads, j));
  let peakLoad = 0;
  let peakDay = 0;
  for (let i = 0; i + 7 <= load.length; i++) {
    const avg = load.slice(i, i + 7).reduce((a, b) => a + b, 0) / 7;
    if (avg > peakLoad) (peakLoad = avg, (peakDay = i));
  }
  return {
    words,
    introDay: dayOrNull(introDays),
    matureDay: dayOrNull(matureDays),
    matureTarget: target,
    unseen: Array.from({ length: SIM_POINTS }, (_, j) => col(unseenPts, j)),
    mature: Array.from({ length: SIM_POINTS }, (_, j) => col(maturePts, j)),
    load,
    peakLoad: Math.round(peakLoad),
    peakDay,
  };
}
