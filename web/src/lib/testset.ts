/**
 * "Bộ đề": a whole Reading or Listening test the learner imported from a PDF (and, for Listening, its audio files),
 * kept on this device only, taken inside Lexi.
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
/**
 * Pages typed as "45-60, 290-292" (also "45–60", "45 đến 60", spaces or ";" between) → sorted page numbers within
 * 1..numPages. Empty → every page. `null` when something is not a page or a range, or a range runs backwards, so the
 * screen can say so instead of silently reading other pages.
 */
export function parsePageRange(text: string, numPages: number): number[] | null {
  const t = text.trim().toLowerCase().replace(/\s*(?:[-–—]|đến|to)\s*/g, "-");
  if (!t) return Array.from({ length: numPages }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const s of t.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,5})(-(\d{1,5})?)?$/.exec(s);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[3] !== undefined ? Number(m[3]) : m[2] ? numPages : a;
    if (a < 1 || b < a || a > numPages) return null;
    for (let n = a; n <= Math.min(b, numPages); n++) out.add(n);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}

/** Selected pages written back short: [1,2,3,7,9,10] → "1-3, 7, 9-10". */
export function formatPages(pages: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    out.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j;
  }
  return out.join(", ");
}

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

export type SetPart = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SetQuestion {
  /** Position in the set, from 0: the id of the question inside it. */
  i: number;
  number: number | null;
  part: SetPart | null;
  /** "listen": a Part 1–2 question with nothing printed but its number; the choices are heard. */
  kind: ExtractedQuestion["kind"] | "listen";
  /** Letters to choose from when the options are not printed (Part 1: 4, Part 2: 3). */
  choices?: number;
  /** Listening, one audio file per question: the index into the set's `tracks`. */
  track?: number;
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

/** An audio file of a Listening set; its bytes are in the device store under `key`. */
export interface SetTrack {
  key: string;
  name: string;
  bytes: number;
}

export interface TestSet {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Absent on sets made before Listening: Reading. */
  section?: "rc" | "lc";
  source: { fileName: string; pages: number; range?: string };
  /** Listening: the audio, played in this order during the test. */
  tracks?: SetTrack[];
  /** Listening: pages kept as pictures (Part 1 photos, graphics of Part 3–4), stored under `${id}:p${n}`. */
  pictures?: Array<{ part: SetPart | null; page: number; key: string }>;
  passages: SetPassage[];
  questions: SetQuestion[];
  attempt?: Attempt;
}

/** Question numbers of the Listening parts printed with nothing but their number (Part 1, Part 2). */
export interface LcLayout {
  p1: [number, number] | null;
  p2: [number, number] | null;
}
export const LC_LAYOUT: LcLayout = { p1: [1, 6], p2: [7, 31] };
export const LC_PARTS = [
  { key: "p1", part: 1, label: "Part 1", total: 6 },
  { key: "p2", part: 2, label: "Part 2", total: 25 },
  { key: "p3", part: 3, label: "Part 3", total: 39 },
  { key: "p4", part: 4, label: "Part 4", total: 30 },
] as const;
export type LcPartKey = (typeof LC_PARTS)[number]["key"];

/** Listening part of a TOEIC question number (1–6, 7–31, 32–70, 71–100), with the learner's own Part 1–2 ranges. */
export function lcPartOfNumber(n: number | null, layout: LcLayout = LC_LAYOUT): 1 | 2 | 3 | 4 | null {
  if (n === null) return null;
  const inside = (r: [number, number] | null) => !!r && n >= r[0] && n <= r[1];
  if (inside(layout.p1)) return 1;
  if (inside(layout.p2)) return 2;
  if (n >= 32 && n <= 70) return 3;
  if (n >= 71 && n <= 100) return 4;
  return null;
}

/** "1-6" → [1, 6]; "" → null (no such part in this set); anything else → undefined. */
export function parseNumberRange(text: string): [number, number] | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,3})\s*(?:[-–—]|đến|to)\s*(\d{1,3})$/i.exec(t) ?? /^(\d{1,3})$/.exec(t);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  return a >= 1 && b >= a && b <= 200 ? [a, b] : undefined;
}

/**
 * The Part 1–2 questions of a Listening set: one per number, nothing printed, the answer from the key. They are
 * made here, not read by the AI: the page holds only "7. Mark your answer on your answer sheet."
 */
export function listenQuestions(layout: LcLayout, key: ReadonlyMap<number, Letter>): Omit<SetQuestion, "i">[] {
  const out: Omit<SetQuestion, "i">[] = [];
  for (const [part, r, choices] of [[1, layout.p1, 4], [2, layout.p2, 3]] as const) {
    if (!r) continue;
    for (let n = r[0]; n <= r[1]; n++) {
      const k = key.get(n) ?? null;
      const correct = k && LETTERS.indexOf(k) < choices ? k : null;
      out.push({ number: n, part, kind: "listen", choices, stem: "", options: { A: "", B: "", C: "", D: "" }, correct, passage: null, topic: "", rule: "", translation: "", flags: correct ? [] : ["no-answer"] });
    }
  }
  return out;
}

/** Audio files in play order: by the first number in the name ("002 - x.mp3" before "010.mp3"), then by name. */
export function sortTracks<T extends { name: string }>(files: readonly T[]): T[] {
  const num = (n: string) => Number(/\d+/.exec(n.replace(/\.[a-z0-9]+$/i, ""))?.[0] ?? Infinity);
  return [...files].sort((a, b) => num(a.name) - num(b.name) || a.name.localeCompare(b.name));
}

/** The letters a question can be answered with: its printed options, or its `choices` when nothing is printed. */
export function lettersOf(q: Pick<SetQuestion, "options" | "choices">): Letter[] {
  const printed = LETTERS.filter((l) => q.options[l]);
  return printed.length ? printed : LETTERS.slice(0, q.choices ?? 4);
}

/** Reading part of a TOEIC question number (101–130 Part 5, 131–146 Part 6, 147–200 Part 7). */
export function partOfNumber(n: number | null): 5 | 6 | 7 | null {
  if (n === null) return null;
  if (n >= 101 && n <= 130) return 5;
  if (n >= 131 && n <= 146) return 6;
  if (n >= 147 && n <= 200) return 7;
  return null;
}

const stemWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
function sameStem(a: string, b: string): boolean {
  const x = stemWords(a);
  const y = stemWords(b);
  return !x || !y || x.startsWith(y.slice(0, 40)) || y.startsWith(x.slice(0, 40));
}
const keyOf = (q: Pick<ExtractedQuestion, "number" | "kind" | "stem">) => (q.number !== null ? `#${q.number}` : `${q.kind}|${str(q.stem).toLowerCase()}`);

/**
 * All pieces' answers as one set, in question-number order: a question seen in two pieces is kept once (the reading
 * with more options wins), passages are renumbered, the PDF's own answer key overrides what the model read, and
 * the part comes from the number when the test is numbered the TOEIC way.
 */
export function mergeExtracted(results: readonly Extracted[], key: ReadonlyMap<number, Letter>, lc?: LcLayout): Pick<TestSet, "passages" | "questions"> {
  const passages: SetPassage[] = [];
  const byKey = new Map<string, Omit<SetQuestion, "i">>();
  const order: string[] = [];
  // Listening: Part 1–2 are made from their numbers (the model has nothing to read there); a reading of one is dropped.
  if (lc) {
    for (const q of listenQuestions(lc, key)) {
      byKey.set(`#${q.number}`, q);
      order.push(`#${q.number}`);
    }
  }
  for (const r of results) {
    const local = new Map<number, number>();
    for (const p of r.passages ?? []) {
      local.set(p.id, passages.length);
      passages.push({ label: str(p.label), text: str(p.text), truncated: !!p.truncated });
    }
    for (const q of r.questions ?? []) {
      const number = typeof q.number === "number" ? q.number : null;
      const lcPart = lc ? lcPartOfNumber(number, lc) : null;
      if (lcPart === 1 || lcPart === 2) continue;
      const options = { A: str(q.options?.A), B: str(q.options?.B), C: str(q.options?.C), D: str(q.options?.D) };
      const fromKey = number !== null ? key.get(number) ?? null : null;
      const read = q.correct && LETTERS.includes(q.correct) && options[q.correct] ? q.correct : null;
      const correct = fromKey && options[fromKey] ? fromKey : fromKey ? null : read;
      const flags = (q.flags ?? []).filter((f) => !(correct && (f === "no-answer" || f === "answer-empty")));
      if (fromKey && read && fromKey !== read) flags.push("key-differs");
      if (fromKey && !options[fromKey]) flags.push("answer-empty");
      const item: Omit<SetQuestion, "i"> = {
        number,
        part: lc ? lcPart : partOfNumber(number) ?? q.part ?? null,
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
      // The same number is the same question only when the stems agree: a book numbers each exercise from 1 again,
      // so "1." on two pages is two questions, while one question read twice across a page break keeps its stem.
      let k = keyOf({ number, kind: q.kind, stem: item.stem });
      for (let d = 1; number !== null && byKey.has(k) && !sameStem(byKey.get(k)!.stem, item.stem); d++) k = `#${number}~${d}`;
      const prev = byKey.get(k);
      const filled = (o: Record<Letter, string>) => LETTERS.filter((l) => o[l]).length;
      if (!prev) {
        byKey.set(k, item);
        order.push(k);
      } else if (filled(item.options) > filled(prev.options) || (item.passage !== null && prev.passage === null)) byKey.set(k, item);
    }
  }
  const qs = order.map((k) => byKey.get(k)!);
  // Numbered questions in number order; unnumbered ones, or a book's exercises that each start at 1, keep the
  // order they were read in.
  const unique = new Set(qs.map((q) => q.number)).size === qs.length;
  const sorted = unique && qs.every((q) => q.number !== null) ? [...qs].sort((a, b) => a.number! - b.number!) : qs;
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
  const byPart: Record<PartKey | LcPartKey | "other", number> = { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0, other: 0 };
  for (const q of set.questions) byPart[q.part ? (`p${q.part}` as PartKey | LcPartKey) : "other"]++;
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
  lcParts: Record<LcPartKey, Score | null>;
  /** Part 1–4 together: the "LC" of the Kết quả bài form. */
  lc: Score | null;
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
  const lcParts: Record<LcPartKey, Score | null> = { p1: null, p2: null, p3: null, p4: null };
  let lc: Score | null = null;
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
    if (q.part && q.part >= 5) {
      const s = (parts[`p${q.part}` as PartKey] ??= { right: 0, total: 0 });
      s.total++;
      if (ok) s.right++;
    } else if (q.part) {
      const s = (lcParts[`p${q.part}` as LcPartKey] ??= { right: 0, total: 0 });
      s.total++;
      lc ??= { right: 0, total: 0 };
      lc.total++;
      if (ok) (s.right++, lc.right++);
    }
  }
  return { parts, lcParts, lc, ungraded, right, total, wrong };
}

/** Fields of the "test" note an attempt is logged as (same shape the "Kết quả bài" form writes). */
export function resultFields(name: string, date: string, g: Graded, elapsedMs: number): Record<string, string> {
  const f: Record<string, string> = { name: name.trim().slice(0, 80) || "Bộ đề", date };
  for (const p of PARTS) if (g.parts[p.key]) f[p.key] = formatScore(g.parts[p.key]!);
  if (g.lc) f.lc = formatScore(g.lc);
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
  // Part 1–2 have nothing printed to make a card from: counted with the other kinds that are skipped.
  const printed = qs.filter((q): q is SetQuestion & { kind: ExtractedQuestion["kind"] } => q.kind !== "listen");
  const extracted: Extracted = {
    passages: [],
    questions: printed.map((q) => ({ ...q, part: q.part !== null && q.part >= 5 ? (q.part as 5 | 6 | 7) : null, result: "wrong" as const })),
  };
  const made = draftsFrom(extracted, existing);
  const drafts = made.drafts;
  const skipped = made.skipped + (qs.length - printed.length);
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
