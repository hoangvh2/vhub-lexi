/**
 * Fast input for the practice loop: what the `extract-questions` Cloud Function reads from screenshots or pasted text
 * becomes review rows, and each accepted row becomes a grammar note. The model only proposes. Every check here is
 * deterministic, mirrored in android/core/.../Import.kt (shared/vectors/import.json), and nothing is saved before the
 * learner has looked at the row.
 */
import { findExact, str } from "@shared/notetypes.ts";
import type { Note } from "@shared/model.ts";
import { completeSentence } from "./practice.ts";

export const LETTERS = ["A", "B", "C", "D"] as const;
export type Letter = (typeof LETTERS)[number];

/** The function's answer (functions/src/extract.ts `ExtractResult`). Fields may be missing on an older deployment. */
export interface ExtractedQuestion {
  number: number | null;
  part: 5 | 6 | 7 | null;
  kind: "fill" | "insert" | "reading";
  stem: string;
  options: Record<Letter, string>;
  correct: Letter | null;
  result: "wrong" | "right" | "unknown";
  passage: number | null;
  topic: string;
  rule: string;
  translation: string;
  flags: string[];
}
export interface ExtractedPassage {
  id: number;
  label: string;
  text: string;
  truncated: boolean;
}
export interface Extracted {
  passages: ExtractedPassage[];
  questions: ExtractedQuestion[];
}

export interface Draft {
  key: string;
  number: number | null;
  stem: string;
  options: Record<Letter, string>;
  correct: Letter | null;
  result: ExtractedQuestion["result"];
  topic: string;
  rule: string;
  translation: string;
  /** Flags the model side raised (unsure, few-options …). */
  flags: string[];
  include: boolean;
  /** Fields the learner changed by hand: they are theirs, not AI's. */
  edited: string[];
}

/** Why a row cannot be saved as it is (`block`) or deserves a second look (`warn`). */
export interface Problems {
  block: Array<"no-answer" | "no-blank" | "not-found">;
  warn: Array<"duplicate" | "unsure" | "few-options" | "right">;
}

export const answerOf = (d: Pick<Draft, "options" | "correct">): string => (d.correct ? d.options[d.correct] ?? "" : "");

export function problems(d: Draft, existingSentences: ReadonlySet<string>): Problems {
  const block: Problems["block"] = [];
  const warn: Problems["warn"] = [];
  const answer = answerOf(d);
  const full = completeSentence(d.stem, answer);
  if (!answer) block.push("no-answer");
  else if (!/_{2,}/.test(d.stem)) block.push("no-blank");
  else if (findExact(full, answer) === null) block.push("not-found");
  if (existingSentences.has(full.toLowerCase())) warn.push("duplicate");
  if (d.flags.includes("unsure")) warn.push("unsure");
  if (d.flags.includes("few-options")) warn.push("few-options");
  if (d.result === "right") warn.push("right");
  return { block, warn };
}

export const PROBLEM_TEXT: Record<Problems["block"][number] | Problems["warn"][number], string> = {
  "no-answer": "Chưa có đáp án đúng: chọn một đáp án bên dưới",
  "no-blank": "Câu không có chỗ trống (_____)",
  "not-found": "Đáp án không khớp chỗ trống",
  duplicate: "Câu này đã có thẻ",
  unsure: "AI không chắc khi đọc câu này, hãy đối chiếu với đề",
  "few-options": "Thiếu đáp án (ảnh có thể bị cắt)",
  right: "Bạn đã làm đúng câu này",
};

/** The fields of the grammar note a row becomes. */
export function grammarFields(d: Draft): Record<string, string> {
  const answer = answerOf(d).trim();
  return { sentence: completeSentence(d.stem, answer), answer, topic: d.topic, translation: d.translation.trim(), rule: d.rule.trim() };
}

/** Which of topic, rule and translation the AI wrote and the learner did not touch: they get the "AI" label. */
export function aiFieldsOf(d: Draft): string[] {
  return (["topic", "rule", "translation"] as const).filter((k) => d[k].trim() && !d.edited.includes(k));
}

/** Rows ready for review from the function's answer. Only one-word-or-phrase blanks become grammar rows. */
export function draftsFrom(r: Extracted, existingSentences: ReadonlySet<string>): { drafts: Draft[]; skipped: number } {
  const drafts: Draft[] = [];
  let skipped = 0;
  for (const [i, q] of (r.questions ?? []).entries()) {
    if (q.kind !== "fill") {
      skipped++;
      continue;
    }
    const d: Draft = {
      key: `q${i}`,
      number: q.number ?? null,
      stem: str(q.stem),
      options: { A: str(q.options?.A), B: str(q.options?.B), C: str(q.options?.C), D: str(q.options?.D) },
      correct: q.correct && LETTERS.includes(q.correct) && str(q.options?.[q.correct]) ? q.correct : null,
      result: q.result ?? "unknown",
      topic: str(q.topic),
      rule: str(q.rule),
      translation: str(q.translation),
      flags: q.flags ?? [],
      include: false,
      edited: [],
    };
    d.include = recommended(d, existingSentences);
    drafts.push(d);
  }
  return { drafts, skipped };
}

/** Selected by default: a question the learner missed (or did not report on) that passes every check. */
export function recommended(d: Draft, existingSentences: ReadonlySet<string>): boolean {
  const p = problems(d, existingSentences);
  return p.block.length === 0 && !p.warn.includes("duplicate") && !p.warn.includes("unsure") && d.result !== "right";
}

/** Lower-cased sentences of the grammar notes already saved, to flag duplicates. */
export const existingSentences = (notes: readonly Note[]): Set<string> =>
  new Set(notes.filter((n) => n.type === "grammar").map((n) => str(n.fields.sentence).toLowerCase()));
