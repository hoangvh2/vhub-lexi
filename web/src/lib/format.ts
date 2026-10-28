import { CardState, type Card } from "@shared/model.ts";
import { formatInterval } from "./scheduler.ts";

export const STATE_LABEL: Record<number, string> = { 0: "Mới", 1: "Đang học", 2: "Ôn tập", 3: "Học lại" };

/** "Mới", "Đến hạn" or "sau 3ng" for a card. */
export function dueLabel(c: Card, now: number): string {
  if (c.suspended) return "Đã ẩn";
  if (c.state === CardState.New) return "Mới";
  if (c.due <= now) return "Đến hạn";
  return `sau ${formatInterval(c.due - now)}`;
}

export function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
