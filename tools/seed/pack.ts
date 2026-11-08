/** How the grammar pack is built from its text, shared by the build script and the web test that checks the JSON. */
import { parseSeedText, seedProblems, type SeedPack } from "../../shared/seed.ts";

export const GRAMMAR_PACK = {
  text: "grammar-toeic.txt",
  json: "grammar-toeic.json",
  prefix: "seed-gt-",
  deckId: "seed-gt",
  /** 2026-11-08 00:00 UTC: fixed so every device writes byte-identical documents. */
  createdAt: Date.UTC(2026, 10, 8),
} as const;

export function buildPack(text: string): { pack: SeedPack; json: string; problems: string[] } {
  const pack = parseSeedText(text, GRAMMAR_PACK);
  return { pack, json: JSON.stringify(pack, null, 1) + "\n", problems: seedProblems(pack) };
}
