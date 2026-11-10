/**
 * The practice loop: a test is taken, its result is logged, each wrong answer becomes a card (a new word or a
 * grammar sentence) tagged with the test it came from, and the Today screen shows how the results move.
 * Pure helpers over notes, so the UI and the tests share them.
 */
import type { Note } from "@shared/model.ts";
import { str } from "@shared/notetypes.ts";

/** Reading parts and their size in a real test. */
export const PARTS = [
  { key: "p5", label: "Part 5", total: 30 },
  { key: "p6", label: "Part 6", total: 16 },
  { key: "p7", label: "Part 7", total: 54 },
] as const;
export type PartKey = (typeof PARTS)[number]["key"];

/**
 * Right answers per part that go with a total of about 700 (assumption, not an ETS table): RC about 70/100.
 * Part 5 is where points are cheapest, Part 7 the largest pool.
 */
export const PART_TARGET: Record<PartKey, number> = { p5: 25, p6: 11, p7: 34 };
export const RC_TARGET = PART_TARGET.p5 + PART_TARGET.p6 + PART_TARGET.p7;

export const CAUSES = [
  { key: "v", label: "Từ vựng", hint: "Không biết nghĩa từ" },
  { key: "g", label: "Ngữ pháp", hint: "Sai cấu trúc / dạng từ" },
  { key: "p", label: "Diễn đạt lại", hint: "Không nhận ra câu paraphrase, bị bẫy" },
  { key: "t", label: "Thời gian", hint: "Vội, hết giờ" },
] as const;
export type CauseKey = (typeof CAUSES)[number]["key"];

export interface Score {
  right: number;
  total: number;
}

/** "20/30" -> { right: 20, total: 30 }; null for anything else (including right > total). */
export function parseScore(s: string): Score | null {
  const m = /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/.exec(s);
  if (!m) return null;
  const right = Number(m[1]);
  const total = Number(m[2]);
  return total > 0 && right <= total ? { right, total } : null;
}

export const formatScore = (s: Score) => `${s.right}/${s.total}`;

export interface TestResult {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  parts: Record<PartKey, Score | null>;
  lc: Score | null;
  minutes: number | null;
  causes: Record<CauseKey, number>;
  /** Right answers over the reading parts that were entered (all three for a full RC). */
  rcRight: number;
  rcTotal: number;
  /**
   * True when Part 5, 6 and 7 were all entered at their real size (30/16/54), so rcRight is comparable with
   * RC_TARGET. A short imported test (a "Bộ đề" of 20 questions) has all three parts but is not a full RC.
   */
  fullRc: boolean;
  tag: string;
  createdAt: number;
}

const int = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s) : 0);

/** Tag that ties cards to the test they came from: "Test 1 TOEIC NEW 2026" -> "de-test-1-toeic-new-2026". */
export function testTag(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/, "");
  return `de-${slug || "khac"}`;
}

export function toResult(n: Note): TestResult {
  const f = n.fields;
  const parts = { p5: parseScore(str(f.p5)), p6: parseScore(str(f.p6)), p7: parseScore(str(f.p7)) };
  const present = Object.values(parts).filter((p): p is Score => !!p);
  const minutes = int(str(f.minutes));
  return {
    id: n.id,
    name: str(f.name),
    date: str(f.date) || new Date(n.createdAt).toISOString().slice(0, 10),
    parts,
    lc: parseScore(str(f.lc)),
    minutes: minutes || null,
    causes: { v: int(str(f.v)), g: int(str(f.g)), p: int(str(f.p)), t: int(str(f.t)) },
    rcRight: present.reduce((a, p) => a + p.right, 0),
    rcTotal: present.reduce((a, p) => a + p.total, 0),
    fullRc: PARTS.every((p) => parts[p.key]?.total === p.total),
    tag: testTag(str(f.name)),
    createdAt: n.createdAt,
  };
}

/** Logged tests, oldest first. */
export function testResults(notes: readonly Note[]): TestResult[] {
  return notes
    .filter((n) => n.type === "test" && str(n.fields.name))
    .map(toResult)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
}

/** The cause that explains most wrong answers in `r`, or null when none were entered. */
export function topCause(r: TestResult): CauseKey | null {
  let best: CauseKey | null = null;
  for (const c of CAUSES) if (r.causes[c.key] > (best ? r.causes[best] : 0)) best = c.key;
  return best;
}

export const wrongTotal = (r: TestResult) => CAUSES.reduce((a, c) => a + r.causes[c.key], 0);

/** What a note taken from a test is worth studying next: counts of its words/sentences by test tag. */
export function notesByTestTag(notes: readonly Note[]): Map<string, { vocab: number; grammar: number }> {
  const m = new Map<string, { vocab: number; grammar: number }>();
  for (const n of notes) {
    if (n.type !== "vocab" && n.type !== "grammar") continue;
    for (const t of n.tags ?? []) {
      if (!t.startsWith("de-")) continue;
      const e = m.get(t) ?? { vocab: 0, grammar: 0 };
      e[n.type === "vocab" ? "vocab" : "grammar"]++;
      m.set(t, e);
    }
  }
  return m;
}

/** Grammar sentence from what a learner types: `___` in the sentence stands for the answer. */
export function completeSentence(sentence: string, answer: string): string {
  const s = sentence.trim();
  const a = answer.trim();
  return /_{2,}/.test(s) && a ? s.replace(/_{2,}/, () => a) : s;
}
