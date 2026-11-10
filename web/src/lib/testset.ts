/**
 * "Bộ đề": a whole Reading test the learner imported from a PDF, kept on this device only, taken inside Lexi.
 * Pure helpers: finding the answer key in the PDF text, cutting the pages into pieces the `extract-questions` function
 * can read in one call, merging what it returns, and scoring an attempt. The PDF reading itself is in pdf.ts.
 */
import { str } from "@shared/notetypes.ts";
import { LETTERS, draftsFrom, type Draft, type Extracted, type ExtractedPassage, type ExtractedQuestion, type Letter } from "./import.ts";
import { PARTS, formatScore, type PartKey, type Score } from "./practice.ts";

/** One page as pdf.ts read it: its text (empty for a scanned page) and whether it has to be sent as a picture. */
export interface PdfPage {
  n: number;
  text: string;
  scanned: boolean;
}

/** Text per call: well under the function's 12 000, so the transcription plus JSON stays inside its output budget. */
export const CHUNK_CHARS = 5000;
/** Scanned pages per call: one page of Part 7 transcribed is about 3–4k output tokens of the function's 8k. */
export const CHUNK_IMAGES = 2;
/** Below this many characters a page is treated as a picture (a scan, or a page whose text layer is empty). */
export const SCANNED_BELOW = 40;

// "101. (A)", "101 A", "101-B", "101) C", "1. D": a number then one letter that stands alone.
const KEY_RE = /(?<![\d.])([1-9]\d{0,2})\s*[.):\-–]?\s*\(?([A-D])\)?(?![A-Za-z])/g;

/** Every "number → letter" pair in `text`, numbers 1–200. A later pair for the same number wins. */
export function keyPairs(text: string): Map<number, Letter> {
  const m = new Map<number, Letter>();
  for (const x of text.matchAll(KEY_RE)) {
    const n = Number(x[1]);
    if (n >= 1 && n <= 200) m.set(n, x[2] as Letter);
  }
  return m;
}

/**
 * A page that is an answer key: titled so near its top ("Answer key", "Đáp án") with a few pairs, or at least 10
 * pairs that are most of what is on it (a question page has "(A) word" options too, but those carry no number and
 * the page is mostly sentences).
 */
export function isKeyPage(text: string): boolean {
  const pairs = [...text.matchAll(KEY_RE)];
  const titled = /answer\s*key|đáp\s*án/i.test(text.slice(0, 200));
  if (pairs.length < (titled ? 3 : 10)) return false;
  const covered = pairs.reduce((a, x) => a + x[0].replace(/\s/g, "").length, 0);
  const rest = text.replace(/\s/g, "").length;
  // A title alone is not enough: a Vietnamese question page may say "Chọn đáp án đúng" at its top.
  return covered / Math.max(1, rest) >= (titled ? 0.25 : 0.45);
}

/** The answer key of the PDF: the pairs found on its key pages. */
export function findKey(pages: readonly PdfPage[]): { key: Map<number, Letter>; keyPages: number[] } {
  const key = new Map<number, Letter>();
  const keyPages: number[] = [];
  for (const p of pages) {
    if (p.scanned || !isKeyPage(p.text)) continue;
    keyPages.push(p.n);
    for (const [n, l] of keyPairs(p.text)) key.set(n, l);
  }
  return { key, keyPages };
}

/** Question numbers printed at the start of a line ("147." / "147)"), so a piece only carries its own answers. */
export const numbersIn = (text: string): number[] => [...text.matchAll(/(?:^|\n)\s*(\d{1,3})\s*[.)]\s/g)].map((x) => Number(x[1])).filter((n) => n >= 1 && n <= 200);

/** What one function call reads: text, or a few scanned pages (`pages` are page numbers to render). */
export type Chunk = { kind: "text"; pages: number[]; text: string } | { kind: "images"; pages: number[] };

/** Splits a page longer than `max` at the start of a question ("131."), else at a blank line, else hard. */
function splitLong(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const q = lastIndex(head, /\n(?=\s*\d{1,3}[.)]\s)/g);
    const blank = lastIndex(head, /\n\s*\n/g);
    const cut = q > max * 0.4 ? q : blank > max * 0.4 ? blank : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

function lastIndex(s: string, re: RegExp): number {
  let i = -1;
  for (const m of s.matchAll(re)) i = m.index ?? i;
  return i;
}

/**
 * The pages to read, cut into calls: consecutive text pages are joined up to CHUNK_CHARS (a page is never split
 * unless it alone is longer), scanned pages go CHUNK_IMAGES at a time. Key pages and empty pages are left out.
 */
export function chunkPages(pages: readonly PdfPage[], skip: ReadonlySet<number>): Chunk[] {
  const out: Chunk[] = [];
  let text: { pages: number[]; text: string } | null = null;
  let imgs: number[] = [];
  const flushText = () => {
    if (text && text.text.trim()) out.push({ kind: "text", pages: text.pages, text: text.text.trim() });
    text = null;
  };
  const flushImgs = () => {
    if (imgs.length) out.push({ kind: "images", pages: imgs });
    imgs = [];
  };
  for (const p of pages) {
    if (skip.has(p.n)) continue;
    if (p.scanned) {
      flushText();
      imgs.push(p.n);
      if (imgs.length >= CHUNK_IMAGES) flushImgs();
      continue;
    }
    flushImgs();
    if (!p.text.trim()) continue;
    for (const part of p.text.length > CHUNK_CHARS ? splitLong(p.text, CHUNK_CHARS) : [p.text]) {
      if (text && text.text.length + part.length + 2 > CHUNK_CHARS) flushText();
      text ??= { pages: [], text: "" };
      if (!text.pages.includes(p.n)) text.pages.push(p.n);
      text.text += (text.text ? "\n\n" : "") + part;
    }
  }
  flushText();
  flushImgs();
  return out;
}

/** The answers the model should copy for the questions in a piece: only theirs for text, the whole key for pictures. */
export function keyNote(key: ReadonlyMap<number, Letter>, numbers: readonly number[] | "all"): string {
  const ns = numbers === "all" ? [...key.keys()] : numbers.filter((n) => key.has(n));
  if (!ns.length) return "";
  return `\n\nAnswer key (data, from the same test): ${[...new Set(ns)].sort((a, b) => a - b).map((n) => `${n} (${key.get(n)})`).join(", ")}`;
}

// ------------------------------------------------------------------ the stored set

export interface SetQuestion {
  /** Position in the set, from 0: the id of the question inside it. */
  i: number;
  number: number | null;
  part: 5 | 6 | 7 | null;
  kind: ExtractedQuestion["kind"];
  stem: string;
  options: Record<Letter, string>;
  correct: Letter | null;
  /** Index into `passages`, or null. */
  passage: number | null;
  topic: string;
  rule: string;
  translation: string;
  flags: string[];
}

export interface SetPassage {
  label: string;
  text: string;
  truncated: boolean;
}

/** An attempt in progress or finished. `answers` are by question position. */
export interface Attempt {
  startedAt: number;
  /** Time spent with the test open, so closing the tab pauses the clock. */
  elapsedMs: number;
  answers: Record<number, Letter>;
  finishedAt?: number;
  /** The "test" note the result was saved as, once it is. */
  resultNoteId?: string;
}

export interface TestSet {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: { fileName: string; pages: number };
  passages: SetPassage[];
  questions: SetQuestion[];
  attempt?: Attempt;
}

/** Reading part of a TOEIC question number (101–130 Part 5, 131–146 Part 6, 147–200 Part 7). */
export function partOfNumber(n: number | null): 5 | 6 | 7 | null {
  if (n === null) return null;
  if (n >= 101 && n <= 130) return 5;
  if (n >= 131 && n <= 146) return 6;
  if (n >= 147 && n <= 200) return 7;
  return null;
}

const keyOf = (q: Pick<ExtractedQuestion, "number" | "kind" | "stem">) => (q.number !== null ? `#${q.number}` : `${q.kind}|${str(q.stem).toLowerCase()}`);

/**
 * All pieces' answers as one set, in question-number order: a question seen in two pieces is kept once (the reading
 * with more options wins), passages are renumbered, the PDF's own answer key overrides what the model read, and
 * the part comes from the number when the test is numbered the TOEIC way.
 */
export function mergeExtracted(results: readonly Extracted[], key: ReadonlyMap<number, Letter>): Pick<TestSet, "passages" | "questions"> {
  const passages: SetPassage[] = [];
  const byKey = new Map<string, Omit<SetQuestion, "i">>();
  const order: string[] = [];
  for (const r of results) {
    const local = new Map<number, number>();
    for (const p of r.passages ?? []) {
      local.set(p.id, passages.length);
      passages.push({ label: str(p.label), text: str(p.text), truncated: !!p.truncated });
    }
    for (const q of r.questions ?? []) {
      const number = typeof q.number === "number" ? q.number : null;
      const options = { A: str(q.options?.A), B: str(q.options?.B), C: str(q.options?.C), D: str(q.options?.D) };
      const fromKey = number !== null ? key.get(number) ?? null : null;
      const read = q.correct && LETTERS.includes(q.correct) && options[q.correct] ? q.correct : null;
      const correct = fromKey && options[fromKey] ? fromKey : fromKey ? null : read;
      const flags = (q.flags ?? []).filter((f) => !(correct && (f === "no-answer" || f === "answer-empty")));
      if (fromKey && read && fromKey !== read) flags.push("key-differs");
      if (fromKey && !options[fromKey]) flags.push("answer-empty");
      const item: Omit<SetQuestion, "i"> = {
        number,
        part: partOfNumber(number) ?? q.part ?? null,
        kind: q.kind,
        stem: str(q.stem),
        options,
        correct,
        passage: q.passage !== null && q.passage !== undefined && local.has(q.passage) ? local.get(q.passage)! : null,
        topic: str(q.topic),
        // An explanation written for another letter than the key's is wrong: drop it.
        rule: correct && correct === read ? str(q.rule) : "",
        translation: correct && correct === read ? str(q.translation) : "",
        flags,
      };
      const k = keyOf({ number, kind: q.kind, stem: item.stem });
      const prev = byKey.get(k);
      const filled = (o: Record<Letter, string>) => LETTERS.filter((l) => o[l]).length;
      if (!prev) {
        byKey.set(k, item);
        order.push(k);
      } else if (filled(item.options) > filled(prev.options) || (item.passage !== null && prev.passage === null)) byKey.set(k, item);
    }
  }
  const qs = order.map((k) => byKey.get(k)!);
  // Numbered questions in number order; unnumbered ones keep their place after the one before them.
  const sorted = qs.every((q) => q.number !== null) ? [...qs].sort((a, b) => a.number! - b.number!) : qs;
  // Drop passages no question points at (a header or a page footer the model took for one).
  const used = [...new Set(sorted.map((q) => q.passage).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  const remap = new Map(used.map((p, i) => [p, i]));
  return {
    passages: used.map((p) => passages[p]),
    questions: sorted.map((q, i) => ({ ...q, i, passage: q.passage === null ? null : remap.get(q.passage)! })),
  };
}

/** What a set holds, for the list and the import summary. */
export function summary(set: Pick<TestSet, "questions">) {
  const byPart: Record<PartKey | "other", number> = { p5: 0, p6: 0, p7: 0, other: 0 };
  for (const q of set.questions) byPart[q.part ? (`p${q.part}` as PartKey) : "other"]++;
  const noAnswer = set.questions.filter((q) => !q.correct).length;
  const numbers = set.questions.map((q) => q.number).filter((n): n is number => n !== null);
  // Gaps inside one part's numbered run (e.g. 101…110 without 104): something the reading missed. A short test may
  // jump from 110 to 131, so the run is per part, not across parts.
  const missing: number[] = [];
  const s = new Set(numbers);
  const groups = new Map<string, number[]>();
  for (const q of set.questions) if (q.number !== null) groups.set(String(q.part), [...(groups.get(String(q.part)) ?? []), q.number]);
  for (const ns of groups.values()) for (let n = Math.min(...ns); n <= Math.max(...ns); n++) if (!s.has(n)) missing.push(n);
  missing.sort((a, b) => a - b);
  return { total: set.questions.length, byPart, noAnswer, missing };
}

// ------------------------------------------------------------------ taking it

export interface Graded {
  parts: Record<PartKey, Score | null>;
  /** Questions with no answer to grade against: not counted. */
  ungraded: number;
  right: number;
  total: number;
  /** Positions answered wrong or left blank. */
  wrong: number[];
}

/** Scores an attempt per reading part; a blank counts as wrong, a question without a known answer is not counted. */
export function grade(set: Pick<TestSet, "questions">, answers: Readonly<Record<number, Letter>>): Graded {
  const parts: Record<PartKey, Score | null> = { p5: null, p6: null, p7: null };
  const wrong: number[] = [];
  let ungraded = 0;
  let right = 0;
  let total = 0;
  for (const q of set.questions) {
    if (!q.correct) {
      ungraded++;
      continue;
    }
    total++;
    const ok = answers[q.i] === q.correct;
    if (ok) right++;
    else wrong.push(q.i);
    if (q.part) {
      const k = `p${q.part}` as PartKey;
      const s = (parts[k] ??= { right: 0, total: 0 });
      s.total++;
      if (ok) s.right++;
    }
  }
  return { parts, ungraded, right, total, wrong };
}

/** Fields of the "test" note an attempt is logged as (same shape the "Kết quả bài" form writes). */
export function resultFields(name: string, date: string, g: Graded, elapsedMs: number): Record<string, string> {
  const f: Record<string, string> = { name: name.trim().slice(0, 80) || "Bộ đề", date };
  for (const p of PARTS) if (g.parts[p.key]) f[p.key] = formatScore(g.parts[p.key]!);
  const min = Math.round(elapsedMs / 60_000);
  if (min > 0) f.minutes = String(Math.min(999, min));
  return f;
}

/**
 * The wrong fill-in questions of an attempt as review rows for grammar cards (the same rows "Nhập nhanh" shows),
 * marked "wrong" so they are selected unless a check fails. Other kinds are counted as `skipped`.
 */
export function wrongDrafts(set: Pick<TestSet, "questions" | "passages">, g: Graded, existing: ReadonlySet<string>): { drafts: Draft[]; skipped: number; passages: ExtractedPassage[] } {
  const wrong = new Set(g.wrong);
  const qs = set.questions.filter((q) => wrong.has(q.i));
  const extracted: Extracted = {
    passages: [],
    questions: qs.map((q) => ({ ...q, result: "wrong" as const })),
  };
  const { drafts, skipped } = draftsFrom(extracted, existing);
  // Passages that hold a missed question: the place to look for the words that were missing.
  const ps = [...new Set(qs.map((q) => q.passage).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  return { drafts, skipped, passages: ps.map((p) => ({ id: p + 1, label: set.passages[p].label, text: set.passages[p].text, truncated: set.passages[p].truncated })) };
}

/**
 * A passage as printed has hard line breaks every ~90 characters; on a phone they leave ragged half-lines. Joins
 * wrapped lines into paragraphs, keeps short lines (headers like "To: All staff", titles) and blank lines as they are.
 */
export function reflow(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  let out = "";
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].trimEnd();
    const next = lines[k + 1];
    out += line;
    if (next === undefined) break;
    const wrapped = line.length >= 45 && !/[:]$/.test(line) && next.trim() !== "" && !/^\s*[-•*]\s/.test(next);
    out += wrapped ? " " : "\n";
  }
  return out;
}
