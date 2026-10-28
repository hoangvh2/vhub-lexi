import { CardState, dayId, nextDayStart, type Card, type Daily } from "@shared/model.ts";

export interface CardCounts {
  total: number;
  new: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
}

/** Mature = interval of 21+ days, same convention as Anki. */
export function cardCounts(cards: readonly Card[]): CardCounts {
  const r: CardCounts = { total: cards.length, new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  for (const c of cards) {
    if (c.suspended) r.suspended++;
    else if (c.state === CardState.New) r.new++;
    else if (c.state === CardState.Learning || c.state === CardState.Relearning) r.learning++;
    else if (c.scheduledDays >= 21) r.mature++;
    else r.young++;
  }
  return r;
}

/** Cards due per study day for the next `days` days (day 0 includes everything overdue). */
export function forecast(cards: readonly Card[], now: number, dayStartHour: number, days = 14): number[] {
  const out = new Array<number>(days).fill(0);
  const bounds: number[] = [];
  let t = now;
  for (let i = 0; i < days; i++) {
    t = nextDayStart(t, dayStartHour);
    bounds.push(t);
  }
  for (const c of cards) {
    if (c.suspended || c.state === CardState.New) continue;
    const i = bounds.findIndex((b) => c.due < b);
    if (i >= 0) out[i]++;
  }
  return out;
}

export function streak(daily: readonly Daily[], now: number, dayStartHour: number): number {
  const active = new Set(daily.filter((d) => d.newCards + d.reviews > 0).map((d) => d.id));
  let n = 0;
  let t = now;
  // Today may still be empty; count from yesterday in that case.
  if (!active.has(dayId(t, dayStartHour))) t -= 86_400_000;
  while (active.has(dayId(t, dayStartHour))) {
    n++;
    t -= 86_400_000;
  }
  return n;
}

/** Share of review answers that were not "Again" over the last `days` days; null when no data. */
export function retention(daily: readonly Daily[], now: number, dayStartHour: number, days = 30): number | null {
  const since = dayId(now - days * 86_400_000, dayStartHour);
  let ok = 0;
  let all = 0;
  for (const d of daily) {
    if (d.id < since) continue;
    all += d.again + d.hard + d.good + d.easy;
    ok += d.hard + d.good + d.easy;
  }
  return all ? ok / all : null;
}

export interface HeatCell {
  id: string;
  count: number;
  week: number;
  dow: number;
}

/** `weeks` columns ending with the current week (Monday first). */
export function heatmap(daily: readonly Daily[], now: number, dayStartHour: number, weeks = 26): HeatCell[] {
  const byId = new Map(daily.map((d) => [d.id, d.newCards + d.reviews]));
  const today = new Date(now - dayStartHour * 3_600_000);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const cells: HeatCell[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    for (let d = 0; d < 7; d++) {
      const offset = w * 7 + (dow - d); // days before today
      if (offset < 0) continue;
      const t = now - offset * 86_400_000;
      const id = dayId(t, dayStartHour);
      cells.push({ id, count: byId.get(id) ?? 0, week: weeks - 1 - w, dow: d });
    }
  }
  return cells;
}

export function level(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}
