import type { FieldValue } from "@shared/model.ts";
import { list, str } from "@shared/notetypes.ts";

/** What the `enrich` Cloud Function returns (functions/src/enrich.ts). Older deployments send only vi/en/examples/mnemonic. */
export interface Enriched {
  vi?: string;
  en?: string;
  examples?: string[];
  examplesVi?: string[];
  existingVi?: string[];
  mnemonic?: string;
}

/** The field holds at most 8 sentences (Firestore rules). */
const MAX_EXAMPLES = 8;

export interface MergeOptions {
  /** Replace a Vietnamese meaning the learner (or a dictionary) wrote. Off by default. */
  overwriteVi?: boolean;
}

/**
 * Folds an AI answer into a vocab note's fields without losing what the learner wrote:
 * - vi and mnemonic are filled when empty or when they were AI-written before (or vi when asked to overwrite);
 * - en only when empty;
 * - new example sentences are added (at most 8), existing ones get the translations they lack.
 * `examplesVi` must stay aligned with `examples`, and saving drops empty lines, so translated sentences are moved
 * in front of untranslated ones: a translation after a missing one would slide onto the wrong sentence.
 */
export function mergeEnrich(
  fields: Record<string, FieldValue>,
  aiFields: readonly string[],
  r: Enriched,
  opts: MergeOptions = {},
): { fields: Record<string, FieldValue>; aiFields: string[] } {
  const next = { ...fields };
  const ai = new Set(aiFields);
  const vi = (r.vi ?? "").trim();
  if (vi && (!str(fields.vi) || ai.has("vi") || opts.overwriteVi)) (next.vi = vi, ai.add("vi"));
  if (r.en?.trim() && !str(fields.en)) (next.en = r.en.trim(), ai.add("en"));
  const mn = (r.mnemonic ?? "").trim();
  if (mn && (!str(fields.mnemonic) || ai.has("mnemonic"))) (next.mnemonic = mn, ai.add("mnemonic"));

  const existing = list(fields.examples);
  const oldVi = list(fields.examplesVi);
  const pairs = existing.map((ex, i) => ({ ex, tr: oldVi[i] || r.existingVi?.[i]?.trim() || "" }));
  const filled = existing.some((_, i) => !oldVi[i] && pairs[i].tr);
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  let added = false;
  for (const [j, ex] of (r.examples ?? []).entries()) {
    const e = ex.trim();
    if (!e || seen.has(e.toLowerCase()) || pairs.length >= MAX_EXAMPLES) continue;
    seen.add(e.toLowerCase());
    pairs.push({ ex: e, tr: r.examplesVi?.[j]?.trim() ?? "" });
    added = true;
  }
  // Translated sentences go first (stable otherwise), so one untranslated sentence does not hide every translation after it.
  const ordered = [...pairs.filter((x) => x.tr), ...pairs.filter((x) => !x.tr)];
  if (ordered.some((x, i) => x.ex !== existing[i])) next.examples = ordered.map((x) => x.ex);
  if (added) ai.add("examples");
  const aligned = ordered.filter((x) => x.tr).map((x) => x.tr);
  if (aligned.length > oldVi.length && (filled || added)) (next.examplesVi = aligned, ai.add("examplesVi"));
  return { fields: next, aiFields: [...ai] };
}

/** Has AI already filled this note's meaning? Used to skip or filter notes in a batch. */
export function hasAi(aiFields: readonly string[] | undefined): boolean {
  return !!aiFields?.includes("vi");
}
