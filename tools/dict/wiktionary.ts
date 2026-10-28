/**
 * Vietnamese meanings from Wiktionary, read from the kaikki.org (wiktextract) JSONL extracts:
 *   - English Wiktionary: the Vietnamese rows of each English entry's translation tables (short, modern).
 *   - Vietnamese Wiktionary: the Vietnamese glosses of its English entries (wide coverage, older wording).
 * Both are CC BY-SA. Translations come first because they are tied to a sense and read like a dictionary
 * headword; glosses fill the words that have no translation table.
 */

/** WordNet codes for the four parts of speech the pack knows; the rest keep a short English label. */
const POS: Record<string, string> = {
  noun: "n", verb: "v", adj: "a", adv: "r",
  pron: "pron", prep: "prep", conj: "conj", intj: "intj", det: "det", article: "det", num: "num", phrase: "phrase", particle: "particle",
};
const POS_ORDER = ["n", "v", "a", "r", "pron", "prep", "conj", "det", "num", "intj", "particle", "phrase"];

export const MAX_MEANINGS = 3;
export const MAX_LEN = 90;

/** word -> pos -> [translations, glosses], in source order. */
export type Collected = Map<string, Map<string, [string[], string[]]>>;

interface KaikkiEntry {
  word?: string;
  lang_code?: string;
  pos?: string;
  senses?: Array<{ glosses?: string[]; tags?: string[]; translations?: KaikkiTranslation[] }>;
  translations?: KaikkiTranslation[];
}
interface KaikkiTranslation {
  lang_code?: string;
  code?: string;
  word?: string;
}

function slot(into: Collected, word: string, pos: string): [string[], string[]] {
  const w = into.get(word) ?? into.set(word, new Map()).get(word)!;
  return w.get(pos) ?? w.set(pos, [[], []]).get(pos)!;
}

/** Feeds one line of the English Wiktionary extract. `keep` limits the words collected. */
export function addEnglishLine(into: Collected, line: string, keep: (word: string) => boolean): void {
  if (!line.includes('"vi"')) return; // cheap pre-filter: most lines have no Vietnamese row
  const o = JSON.parse(line) as KaikkiEntry;
  const pos = POS[o.pos ?? ""];
  const word = o.word;
  // Capitalised headwords are names or acronyms (IT, US); the pack has none of them.
  if (o.lang_code !== "en" || !pos || !word || word !== word.toLowerCase() || !keep(word)) return;
  const rows = [...(o.translations ?? []), ...(o.senses ?? []).flatMap((s) => s.translations ?? [])];
  for (const t of rows) if ((t.lang_code ?? t.code) === "vi" && t.word) slot(into, word, pos)[0].push(t.word);
}

/** Feeds one line of the Vietnamese Wiktionary extract (only its English entries are used). */
export function addVietnameseLine(into: Collected, line: string, keep: (word: string) => boolean): void {
  if (!line.includes('"en"')) return;
  const o = JSON.parse(line) as KaikkiEntry;
  const pos = POS[o.pos ?? ""];
  const word = o.word;
  if (o.lang_code !== "en" || !pos || !word || word !== word.toLowerCase() || !keep(word)) return;
  for (const s of o.senses ?? []) for (const g of s.glosses ?? []) slot(into, word, pos)[1].push(g);
}

/** "Bây giờ, lúc này, giờ đây." -> "bây giờ, lúc này, giờ đây"; drops wiki leftovers such as a leading ", ". */
export function cleanMeaning(s: string): string {
  let t = s.replace(/\s+/g, " ").replace(/^[\s,;.:]+|[\s,;.:]+$/g, "").replace(/\(\s*\)/g, "").trim();
  if (/^\p{Lu}\p{Ll}/u.test(t)) t = t[0].toLowerCase() + t.slice(1);
  return t;
}

/** Up to MAX_MEANINGS distinct meanings, joined with "; ", cut at a meaning boundary near MAX_LEN. */
export function joinMeanings(translations: string[], glosses: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let len = 0;
  for (const raw of [...translations, ...glosses]) {
    const m = cleanMeaning(raw);
    const key = m.toLowerCase();
    if (!m || seen.has(key) || m.length > MAX_LEN) continue;
    if (out.length && len + 2 + m.length > MAX_LEN) continue;
    seen.add(key);
    out.push(m);
    len += (out.length > 1 ? 2 : 0) + m.length;
    if (out.length >= MAX_MEANINGS) break;
  }
  return out.join("; ");
}

/** word -> [[pos, meanings]] with the four WordNet parts of speech first. */
export function finalize(c: Collected): Record<string, Array<[string, string]>> {
  const out: Record<string, Array<[string, string]>> = {};
  for (const word of [...c.keys()].sort()) {
    const rows: Array<[string, string]> = [];
    for (const pos of POS_ORDER) {
      const v = c.get(word)!.get(pos);
      const text = v ? joinMeanings(v[0], v[1]) : "";
      if (text) rows.push([pos, text]);
    }
    if (rows.length) out[word] = rows;
  }
  return out;
}
