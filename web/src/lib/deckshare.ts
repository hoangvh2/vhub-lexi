/**
 * Pure helpers for the "new words by deck" settings (the queue itself is queue.ts shareOut). Weights are whole numbers
 * kept relative to each other; the screen shows them as percentages that add up to 100. The Kotlin port is
 * android/core/.../DeckShare.kt and its test replays the same cases.
 */
export type ShareMode = "equal" | "rank" | "custom";

/** `total` split into whole numbers in proportion to `weights` (largest remainder); all zeros when every weight is 0. */
function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const parts = weights.map((w, i) => ({ i, q: Math.floor((w * total) / sum), r: (w * total) % sum, w }));
  let left = total - parts.reduce((n, p) => n + p.q, 0);
  const out = parts.map((p) => p.q);
  for (const p of [...parts].sort((x, y) => y.r - x.r || y.w - x.w || x.i - y.i)) {
    if (left <= 0) break;
    out[p.i]++;
    left--;
  }
  return out;
}

/** Whole percentages of `weights` that add up to 100; all zeros when every weight is 0. */
export const percents = (weights: readonly number[]): number[] => apportion(100, weights);

/** Weights for "by priority": the first deck counts 1, the second 1/2, the third 1/3 ... (4 decks: 48/24/16/12). */
export function rankWeights(n: number): number[] {
  return percents(Array.from({ length: n }, (_, i) => Math.round(1_000_000 / (i + 1))));
}

/** Put deck `i` at `pct` percent; the others share what is left in proportion to what they had (equally if they had nothing). */
export function setPercent(weights: readonly number[], i: number, pct: number): number[] {
  if (weights.length <= 1) return weights.map(() => 100);
  const want = Math.max(0, Math.min(100, Math.round(pct)));
  const others = weights.map((w, k) => (k === i ? 0 : w));
  const basis = others.some((w) => w > 0) ? others : others.map((_, k) => (k === i ? 0 : 1));
  return apportion(100 - want, basis).map((v, k) => (k === i ? want : v));
}

/** Which of the three modes the weights are in: all equal, exactly by priority, or anything else. */
export function shareMode(weights: readonly number[]): ShareMode {
  if (weights.length === 0 || weights.every((w) => w === weights[0])) return "equal";
  const sorted = [...weights].sort((a, b) => b - a);
  const rank = rankWeights(weights.length);
  const p = percents(sorted);
  return p.every((v, k) => v === rank[k]) ? "rank" : "custom";
}
