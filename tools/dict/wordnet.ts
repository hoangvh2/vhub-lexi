/**
 * Reads the Princeton WordNet 3.1 database files (index.* data.* *.exc).
 * Format reference: wndb(5WN). Only what the flashcard pack needs is kept.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PosCode = "n" | "v" | "a" | "r";
export interface WnSense {
  def: string;
  ex: string[];
}
export interface WnWord {
  /** Sum of WordNet's tagged-sense counts: a rough "how common" score. */
  rank: number;
  pos: Array<{ pos: PosCode; senses: WnSense[]; tag: number }>;
}

const FILES: Array<[string, PosCode]> = [
  ["noun", "n"],
  ["verb", "v"],
  ["adj", "a"],
  ["adv", "r"],
];

const MAX_SENSES_PER_POS = 3;
const MAX_SENSES_TOTAL = 6;
const MAX_EXAMPLES = 2;
const MAX_DEF_LEN = 220;

function readLines(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("  "));
}

/** gloss = `definition; "example"; "example"`; definitions may themselves contain semicolons. */
export function splitGloss(gloss: string): WnSense {
  const g = gloss.trim();
  const firstQuote = g.search(/;\s*"/);
  const defPart = firstQuote >= 0 ? g.slice(0, firstQuote) : g;
  const ex: string[] = [];
  if (firstQuote >= 0) {
    const re = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(g.slice(firstQuote)))) ex.push(m[1].trim());
  }
  let def = defPart.trim();
  if (def.length > MAX_DEF_LEN) def = def.slice(0, MAX_DEF_LEN - 1).trimEnd() + "…";
  return { def, ex: ex.slice(0, MAX_EXAMPLES) };
}

export function parseWordNet(dir: string): { words: Map<string, WnWord> } {
  const words = new Map<string, WnWord>();
  const glossByOffset = new Map<string, string>(); // `${pos}${offset}` -> gloss

  for (const [name, pos] of FILES) {
    for (const line of readLines(join(dir, `data.${name}`))) {
      const bar = line.indexOf("|");
      if (bar < 0) continue;
      const offset = line.slice(0, 8);
      glossByOffset.set(pos + offset, line.slice(bar + 1));
    }
  }

  for (const [name, pos] of FILES) {
    for (const line of readLines(join(dir, `index.${name}`))) {
      const f = line.trim().split(/\s+/);
      const lemma = f[0];
      if (/[A-Z0-9]/.test(lemma) || !/^[a-z][a-z'._-]*$/.test(lemma)) continue;
      const synsetCnt = Number(f[2]);
      const ptrCnt = Number(f[3]);
      const tagsense = Number(f[5 + ptrCnt]);
      const offsets = f.slice(6 + ptrCnt, 6 + ptrCnt + synsetCnt);
      const senses: WnSense[] = [];
      for (const off of offsets) {
        const gloss = glossByOffset.get(pos + off);
        if (!gloss) continue;
        const s = splitGloss(gloss);
        if (s.def) senses.push(s);
        if (senses.length >= MAX_SENSES_PER_POS) break;
      }
      if (!senses.length) continue;
      const key = lemma.replaceAll("_", " ");
      let rec = words.get(key);
      if (!rec) words.set(key, (rec = { rank: 0, pos: [] }));
      rec.rank += Number.isFinite(tagsense) ? tagsense : 0;
      rec.pos.push({ pos, senses, tag: Number.isFinite(tagsense) ? tagsense : 0 });
    }
  }

  // Cap the total number of senses per word, most common part of speech first.
  for (const rec of words.values()) {
    rec.pos.sort((a, b) => b.tag - a.tag); // stable: ties keep noun, verb, adj, adv order
    let left = MAX_SENSES_TOTAL;
    for (const p of rec.pos) {
      p.senses = p.senses.slice(0, Math.max(0, left));
      left -= p.senses.length;
    }
    rec.pos = rec.pos.filter((p) => p.senses.length > 0);
  }

  return { words };
}
