/**
 * Note-type registry: the extension point of the app.
 *
 * To add TOEIC / IELTS material later you add a NoteTypeDef here (fields + templates) and, only if
 * you need a new kind of answer UI, a new `mode`. Storage, sync, the scheduler, queues, statistics
 * and the library screen already work on any registered note type.
 *
 *   vocab        implemented (this file)
 *   toeic-mcq    future: question, options[], answer, explanation  -> template mode "choice"
 *   ielts-prompt future: task, sample answer, AI feedback via Cloud Function
 *
 * Templates are pure functions of a note, so the web app and the Android app render from the same
 * description; shared/vectors/templates.json pins their output for the Kotlin port.
 */
import type { CardLayout, FieldValue, Note } from "./model.ts";

export type Block =
  | { k: "title"; text: string }
  | { k: "ipa"; text: string }
  | { k: "speak"; text: string }
  | { k: "badge"; text: string }
  | { k: "text"; text: string; tone?: "strong" | "muted" }
  | { k: "quote"; text: string };

/** How the learner answers: "flip" = think, reveal, self-rate; "type" = type it, then self-rate. */
export type AnswerMode = "flip" | "type";

export interface TemplateDef {
  id: string;
  label: string;
  description: string;
  mode: AnswerMode;
  applies(note: Note): boolean;
  front(note: Note, layout: CardLayout): Block[];
  back(note: Note, layout: CardLayout): Block[];
  /** Accepted typed answers (mode "type"). */
  expected?(note: Note): string[];
  /** What to read aloud when the front / back is shown. */
  speak?: { front?(note: Note): string | null; back?(note: Note): string | null };
}

export interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "longtext" | "list";
  required?: boolean;
  placeholder?: string;
  maxLength: number;
}

export interface NoteTypeDef {
  id: string;
  label: string;
  fields: FieldDef[];
  templates: TemplateDef[];
  title(note: Note): string;
  subtitle(note: Note): string;
  /** Lower-cased text the library search looks in. */
  searchText(note: Note): string;
}

// ------------------------------------------------------------------ helpers

export function str(v: FieldValue | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}
export function list(v: FieldValue | undefined): string[] {
  return Array.isArray(v) ? v.map((s) => s.trim()).filter(Boolean) : [];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Blanks out `word` (allowing common inflections of its first word) in `sentence`.
 * Returns null when the word does not occur.
 */
export function clozeSentence(sentence: string, word: string): { text: string; answer: string } | null {
  const parts = word.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const [head, ...rest] = parts;
  const h = head.toLowerCase();
  // "resilient" -> stem "resilien"? No: drop at most 2 trailing letters and keep >= 4.
  const stemLen = h.length >= 6 ? h.length - 2 : h.length >= 4 ? h.length - 1 : h.length;
  const stem = h.slice(0, stemLen);
  // Short words take suffixes, with a doubled final consonant: run -> running, put -> putting.
  const last = escapeRe(h[h.length - 1]);
  const headRe = h.length >= 4 ? `${escapeRe(stem)}[a-z]*` : `${escapeRe(h)}${last}?(?:s|es|ed|d|ing)?`;
  const re = new RegExp(`(?<![A-Za-z])(${[headRe, ...rest.map(escapeRe)].join("\\s+")})(?![A-Za-z])`, "i");
  const m = re.exec(sentence);
  if (!m) return null;
  return { text: sentence.slice(0, m.index) + "_____" + sentence.slice(m.index + m[0].length), answer: m[1] };
}

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export type AnswerVerdict = "correct" | "close" | "wrong";

export function checkTyped(typed: string, expected: string[]): AnswerVerdict {
  const t = normalizeAnswer(typed);
  if (!t) return "wrong";
  let best = Infinity;
  for (const e of expected) {
    const n = normalizeAnswer(e);
    if (n === t) return "correct";
    best = Math.min(best, levenshtein(t, n));
  }
  return best === 1 && t.length >= 5 ? "close" : "wrong";
}

/** Suggested rating for a typed verdict (the learner can still choose another). */
export const suggestedRating = (v: AnswerVerdict): 1 | 2 | 3 => (v === "correct" ? 3 : v === "close" ? 2 : 1);

// ------------------------------------------------------------------ vocab

const POS_LABEL: Record<string, string> = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
export const posLabel = (code: string) => POS_LABEL[code] ?? code;

function firstExampleWith(note: Note): { sentence: string; cloze: { text: string; answer: string } } | null {
  const word = str(note.fields.word);
  for (const ex of list(note.fields.examples)) {
    const c = clozeSentence(ex, word);
    if (c) return { sentence: ex, cloze: c };
  }
  return null;
}

function meaningLine(note: Note): string {
  return str(note.fields.vi) || str(note.fields.en);
}

function detailBlocks(note: Note, l: CardLayout, opts: { skipExamples?: boolean } = {}): Block[] {
  const out: Block[] = [];
  const vi = str(note.fields.vi);
  const en = str(note.fields.en);
  if (l.showVi && vi) out.push({ k: "text", text: vi, tone: "strong" });
  if (l.showEn && en) out.push({ k: "text", text: en, tone: "muted" });
  if (l.showExamples && !opts.skipExamples) for (const e of list(note.fields.examples)) out.push({ k: "quote", text: e });
  if (l.showMnemonic && str(note.fields.mnemonic)) out.push({ k: "text", text: str(note.fields.mnemonic), tone: "muted" });
  return out;
}

function wordHeader(note: Note, l: CardLayout): Block[] {
  const out: Block[] = [{ k: "title", text: str(note.fields.word) }];
  if (l.showPos && str(note.fields.pos)) out.push({ k: "badge", text: str(note.fields.pos) });
  if (l.showIpa && str(note.fields.ipa)) out.push({ k: "ipa", text: str(note.fields.ipa) });
  out.push({ k: "speak", text: str(note.fields.word) });
  return out;
}

const recognize: TemplateDef = {
  id: "recognize",
  label: "Nhận biết (Anh → nghĩa)",
  description: "Thấy từ tiếng Anh, nhớ nghĩa.",
  mode: "flip",
  applies: (n) => !!str(n.fields.word) && !!meaningLine(n),
  front: (n, l) => [
    { k: "title", text: str(n.fields.word) },
    ...(l.showIpa && str(n.fields.ipa) ? ([{ k: "ipa", text: str(n.fields.ipa) }] as Block[]) : []),
    { k: "speak", text: str(n.fields.word) },
  ],
  back: (n, l) => [...(l.showPos && str(n.fields.pos) ? ([{ k: "badge", text: str(n.fields.pos) }] as Block[]) : []), ...detailBlocks(n, l)],
  speak: { front: (n) => str(n.fields.word) },
};

const recall: TemplateDef = {
  id: "recall",
  label: "Nhớ lại (nghĩa → gõ từ)",
  description: "Thấy nghĩa, tự gõ lại từ tiếng Anh. Nhớ chủ động nên bền hơn.",
  mode: "type",
  applies: (n) => !!str(n.fields.word) && !!meaningLine(n),
  front: (n, l) => {
    const out: Block[] = [];
    if (l.showPos && str(n.fields.pos)) out.push({ k: "badge", text: str(n.fields.pos) });
    const vi = str(n.fields.vi);
    const en = str(n.fields.en);
    if (vi) out.push({ k: "text", text: vi, tone: "strong" });
    else if (en) out.push({ k: "text", text: en, tone: "strong" });
    if (vi && en && l.showEn) out.push({ k: "text", text: en, tone: "muted" });
    return out;
  },
  back: (n, l) => [...wordHeader(n, l), ...(l.showExamples ? list(n.fields.examples).map((e): Block => ({ k: "quote", text: e })) : [])],
  expected: (n) => [str(n.fields.word)],
  speak: { back: (n) => str(n.fields.word) },
};

const cloze: TemplateDef = {
  id: "cloze",
  label: "Điền vào chỗ trống",
  description: "Câu ví dụ che mất từ; cần có ví dụ chứa từ đó.",
  mode: "type",
  applies: (n) => !!str(n.fields.word) && firstExampleWith(n) !== null,
  front: (n, l) => {
    const c = firstExampleWith(n);
    const out: Block[] = [];
    if (c) out.push({ k: "quote", text: c.cloze.text });
    const hint = str(n.fields.vi) || str(n.fields.en);
    if (hint) out.push({ k: "text", text: hint, tone: "muted" });
    if (l.showPos && str(n.fields.pos)) out.push({ k: "badge", text: str(n.fields.pos) });
    return out;
  },
  back: (n, l) => {
    const c = firstExampleWith(n);
    const out: Block[] = [];
    if (c) out.push({ k: "quote", text: c.sentence });
    out.push(...wordHeader(n, l));
    out.push(...detailBlocks(n, l, { skipExamples: true }));
    return out;
  },
  expected: (n) => {
    const c = firstExampleWith(n);
    return c ? [c.cloze.answer, str(n.fields.word)] : [str(n.fields.word)];
  },
  speak: { back: (n) => firstExampleWith(n)?.sentence ?? null },
};

export const VOCAB: NoteTypeDef = {
  id: "vocab",
  label: "Từ vựng",
  fields: [
    { key: "word", label: "Từ", kind: "text", required: true, maxLength: 80 },
    { key: "ipa", label: "Phiên âm IPA", kind: "text", maxLength: 80 },
    { key: "pos", label: "Loại từ", kind: "text", maxLength: 30 },
    { key: "vi", label: "Nghĩa tiếng Việt", kind: "text", maxLength: 300 },
    { key: "en", label: "Định nghĩa tiếng Anh", kind: "longtext", maxLength: 400 },
    { key: "examples", label: "Ví dụ", kind: "list", maxLength: 300 },
    { key: "mnemonic", label: "Mẹo nhớ", kind: "longtext", maxLength: 300 },
  ],
  templates: [recognize, recall, cloze],
  title: (n) => str(n.fields.word),
  subtitle: (n) => str(n.fields.vi) || str(n.fields.en),
  searchText: (n) =>
    [str(n.fields.word), str(n.fields.vi), str(n.fields.en), ...list(n.fields.examples), ...(n.tags ?? [])].join(" ").toLowerCase(),
};

export const NOTE_TYPES: Readonly<Record<string, NoteTypeDef>> = { vocab: VOCAB };

export function noteType(id: string): NoteTypeDef | undefined {
  return NOTE_TYPES[id];
}

export function template(typeId: string, templateId: string): TemplateDef | undefined {
  return NOTE_TYPES[typeId]?.templates.find((t) => t.id === templateId);
}

/** Templates that should exist for `note` given the learner's choices and the note's content. */
export function wantedTemplates(note: Note, chosen: Record<string, string[]> | undefined): string[] {
  const def = NOTE_TYPES[note.type];
  if (!def) return [];
  const ids = chosen?.[note.type] ?? def.templates.map((t) => t.id);
  return def.templates.filter((t) => ids.includes(t.id) && t.applies(note)).map((t) => t.id);
}
