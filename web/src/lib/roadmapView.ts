/** Text and small numbers for the Thống kê roadmap, kept apart from the components so they can be tested. */
import type { Daily } from "@shared/model.ts";
import { dayId } from "@shared/model.ts";

const DAY = 86_400_000;
export const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/** "17/12" for study day `d` counted from the day that starts at `todayStart`. */
export function dm(todayStart: number, d: number): string {
  const t = new Date(todayStart + d * DAY + 12 * 3_600_000);
  return `${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}`;
}

/** Weekday label (Monday first) of study day `d`. */
export function weekdayOf(todayStart: number, d: number): string {
  const t = new Date(todayStart + d * DAY + 12 * 3_600_000);
  return WEEKDAYS[(t.getDay() + 6) % 7];
}

/** "5 tuần" / "3 tháng" for a day count, for the sentences under the dates. */
export function span(days: number): string {
  if (days < 14) return `${days} ngày`;
  if (days < 60) return `${Math.round(days / 7)} tuần`;
  return `${Math.round(days / 30.4375)} tháng`;
}

export interface Effort {
  /** Seconds per answered card over the last `days` days; null without data. */
  secPerCard: number | null;
  /** Median answers on the days the learner studied; null without data. */
  usual: number | null;
}

/** How long a card takes and how much a normal day holds, from the learner's own days. */
export function effortOf(daily: readonly Daily[], now: number, dayStartHour: number, days = 30): Effort {
  const since = dayId(now - days * DAY, dayStartHour);
  let ms = 0;
  let n = 0;
  const per: number[] = [];
  for (const d of daily) {
    const a = d.newCards + d.reviews;
    if (d.id < since || a <= 0) continue;
    ms += d.ms;
    n += a;
    per.push(a);
  }
  if (!n) return { secPerCard: null, usual: null };
  per.sort((a, b) => a - b);
  const sec = ms / n / 1000;
  return { secPerCard: sec > 0 ? Math.min(60, Math.max(3, sec)) : null, usual: per[Math.floor((per.length - 1) / 2)] };
}

/** Answers a new word takes (recognize with its two learning steps), used for the minutes estimate. */
export const NEW_WORD_ANSWERS = 3;

export function minutes(answers: number, secPerCard: number | null): number | null {
  return secPerCard === null ? null : Math.max(0, Math.round((answers * secPerCard) / 60));
}
