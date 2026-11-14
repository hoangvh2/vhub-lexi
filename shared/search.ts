/**
 * Library search: which notes match a query, and how well. Port: android/core Search.kt (vectors: shared/vectors/search.json).
 *
 * Matching ignores case, Vietnamese tone marks and đ ("xac dinh" finds "xác định"), and repeated spaces. A note's rank:
 *   0 its headword is the query ("determine")      1 the headword starts with it ("determined")
 *   2 the headword contains it ("predetermine")     3 its meaning does (vi / en, grammar translation, pattern topic)
 *   4 anything else the note holds (examples, phrases, notes, tags)
 * Lower ranks come first; within ranks 1-2 shorter headwords first; then the list's own order (newest, A-Z, due).
 */
import type { Note } from "./model.ts";
import { list, noteType, str } from "./notetypes.ts";

export function foldSearch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The meaning part of a note, by note type. */
function meaningOf(n: Note): string {
  const f = n.fields;
  switch (n.type) {
    case "vocab": return [str(f.vi), str(f.en)].join(" ");
    case "grammar": return str(f.translation);
    case "pattern": return [str(f.topic), ...list(f.why)].join(" ");
    default: return "";
  }
}

export interface SearchHit {
  rank: number;
  /** Headword length for ranks 1-2 (shorter first), else 0. */
  len: number;
}

/** How [note] matches [query] (already folded or not), or null when it does not. An empty query matches everything. */
export function searchHit(note: Note, query: string): SearchHit | null {
  const q = foldSearch(query);
  if (!q) return { rank: 0, len: 0 };
  const def = noteType(note.type);
  if (!def) return null;
  const head = foldSearch(def.title(note));
  if (head === q) return { rank: 0, len: 0 };
  if (head.startsWith(q)) return { rank: 1, len: head.length };
  if (head.includes(q)) return { rank: 2, len: head.length };
  if (foldSearch(meaningOf(note)).includes(q)) return { rank: 3, len: 0 };
  if (foldSearch(def.searchText(note)).includes(q)) return { rank: 4, len: 0 };
  return null;
}

/** Orders search hits: best rank first, then shorter headword; 0 keeps the list's own order (stable sort). */
export function compareHits(a: SearchHit, b: SearchHit): number {
  return a.rank - b.rank || a.len - b.len;
}
