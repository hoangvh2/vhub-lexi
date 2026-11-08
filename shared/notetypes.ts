/**
 * Note-type registry: the extension point of the app.
 *
 * To add TOEIC / IELTS material later you add a NoteTypeDef here (fields + templates) and, only if
 * you need a new kind of answer UI, a new `mode`. Storage, sync, the scheduler, queues, statistics
 * and the library screen already work on any registered note type.
 *
 *   vocab        implemented (this file)
 *   grammar      one sentence missed in a test (fill card)
 *   pattern      a grammar rule or trap with several sentences (fill / rule / find-the-mistake cards)
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
  | { k: "quote"; text: string }
  /**
   * An example sentence; `at` = [start, end) of the studied word in it (highlighted), `vi` = its translation.
   * `phrase` marks a short phrase (3-5 words, one per meaning) rather than a full sentence; it stays out of rotateExamples.
   * `wrong` lists the trap options of a grammar sentence, shown struck through (library view only).
   */
  | { k: "example"; text: string; at?: [number, number]; vi?: string; phrase?: true; wrong?: string[] }
  /** The memory tip (sound-alike pun or short hook), shown in its own box. */
  | { k: "memo"; text: string }
  /** Secondary text, collapsed under `label` until the learner opens it. */
  | { k: "fold"; label: string; text: string }
  /** A large play button that reads `text` aloud (listening cards). */
  | { k: "listen"; text: string }
  /** A small section heading (the library's view of a whole note). */
  | { k: "label"; text: string };

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
  const at = findWord(sentence, word);
  if (!at) return null;
  return { text: sentence.slice(0, at[0]) + "_____" + sentence.slice(at[1]), answer: sentence.slice(at[0], at[1]) };
}

/** Where `word` (or an inflection of its first word) occurs in `sentence`: [start, end), or null. */
export function findWord(sentence: string, word: string): [number, number] | null {
  const parts = word.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const [head, ...rest] = parts;
  const h = head.toLowerCase();
  // "resilient" -> stem "resilien"? No: drop at most 2 trailing letters and keep >= 4.
  const stemLen = h.length >= 6 ? h.length - 2 : h.length >= 4 ? h.length - 1 : h.length;
  const stem = h.slice(0, stemLen);
  // Short words take suffixes, with a doubled final consonant: run -> running, put -> putting.
  const last = escapeRe(h[h.length - 1]);
  // Letters are any Unicode letter, so "cafés" is one word and never cut to "caf" + "és".
  const headRe = h.length >= 4 ? `${escapeRe(stem)}\\p{L}*` : `${escapeRe(h)}${last}?(?:s|es|ed|d|ing)?`;
  const re = new RegExp(`(?<!\\p{L})(${[headRe, ...rest.map(escapeRe)].join("\\s+")})(?!\\p{L})`, "iu");
  const m = re.exec(sentence);
  return m ? [m.index, m.index + m[0].length] : null;
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

// ------------------------------------------------------------------ short phrases (one per meaning)

/** One short phrase of a word: "accommodate 200 guests" and what it means in that setting. */
export interface Phrase {
  text: string;
  vi: string;
}

/** Longest phrase line kept (`text | vi`), also the field's per-line limit. */
export const PHRASE_LINE_MAX = 120;

/** "accommodate 200 guests | chứa được 200 khách" -> {text, vi}. The translation is optional. */
export function parsePhrase(line: string): Phrase | null {
  const bar = line.indexOf("|");
  const text = (bar < 0 ? line : line.slice(0, bar)).replace(/\s+/g, " ").trim();
  const vi = bar < 0 ? "" : line.slice(bar + 1).replace(/\s+/g, " ").trim();
  return text ? { text, vi } : null;
}

/** The phrases of a vocab note that contain the word (a phrase without it could not be blanked out). */
export function phrasesOf(note: Note): Phrase[] {
  const word = str(note.fields.word);
  if (!word) return [];
  return list(note.fields.phrases)
    .map(parsePhrase)
    .filter((p): p is Phrase => p !== null && findWord(p.text, word) !== null);
}

/** The phrases as answer-side blocks: the word highlighted, its meaning underneath. */
export function phraseBlocks(note: Note): Block[] {
  const word = str(note.fields.word);
  return phrasesOf(note).map((p): Block => {
    const at = findWord(p.text, word);
    return { k: "example", text: p.text, ...(at ? { at } : {}), ...(p.vi ? { vi: p.vi } : {}), phrase: true };
  });
}

/**
 * The note as one card shows it. A fill-in-the-blank card asks a different meaning each review: the phrase at
 * `reps` mod (number of phrases) goes in front of the examples, so every part of the template (blank, hint, accepted
 * forms, read-aloud) follows it. Other templates, and notes without phrases, are shown as they are.
 * Both platforms pick the same phrase because the choice depends only on the card's review count.
 */
export function studyNote(note: Note, templateId: string, reps: number): Note {
  if (note.type === "pattern") return studyPattern(note, templateId, reps);
  if (note.type !== "vocab" || templateId !== "cloze") return note;
  const ps = phrasesOf(note);
  if (!ps.length) return note;
  const p = ps[((reps % ps.length) + ps.length) % ps.length];
  // Translations stay aligned with their sentences: without one for the phrase, the old ones would slide onto it.
  const examplesVi = p.vi ? [p.vi, ...list(note.fields.examplesVi)] : [];
  return { ...note, fields: { ...note.fields, examples: [p.text, ...list(note.fields.examples)], examplesVi } };
}

/**
 * A grammar pattern asks a different sentence each review: the usable sentence at `reps` mod (their number) moves to the
 * front of `items` (for "find the mistake", only sentences with a wrong option count). The rule card shows that
 * sentence as its example. Sentences that cannot be parsed stay where they are, after the chosen one.
 */
function studyPattern(note: Note, templateId: string, reps: number): Note {
  const lines = list(note.fields.items);
  const usable = lines.filter((l) => {
    const it = parsePatternItem(l);
    return it !== null && (templateId !== "spot" || it.wrong.length > 0);
  });
  if (usable.length < 2) return note;
  const pick = usable[((reps % usable.length) + usable.length) % usable.length];
  const i = lines.indexOf(pick);
  return { ...note, fields: { ...note.fields, items: [pick, ...lines.slice(0, i), ...lines.slice(i + 1)] } };
}

// ------------------------------------------------------------------ vocab

const POS_LABEL: Record<string, string> = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
export const posLabel = (code: string) => POS_LABEL[code] ?? code;

/** The first example that contains the word, with its index (to find its translation) and the blanked version. */
function firstExampleWith(note: Note): { sentence: string; index: number; cloze: { text: string; answer: string } } | null {
  const word = str(note.fields.word);
  const examples = list(note.fields.examples);
  for (const [index, ex] of examples.entries()) {
    const c = clozeSentence(ex, word);
    if (c) return { sentence: ex, index, cloze: c };
  }
  return null;
}

function meaningLine(note: Note): string {
  return str(note.fields.vi) || str(note.fields.en);
}

/** Translation of example `i`; translations are kept in the same order as the examples. */
function exampleVi(note: Note, i: number): string {
  return list(note.fields.examplesVi)[i] ?? "";
}

function exampleBlock(note: Note, sentence: string, i: number): Block {
  const at = findWord(sentence, str(note.fields.word));
  const vi = exampleVi(note, i);
  return { k: "example", text: sentence, ...(at ? { at } : {}), ...(vi ? { vi } : {}) };
}

const EN_LABEL = "Định nghĩa Anh-Anh";

/**
 * The answer side, in the order that makes a word click fastest for a Vietnamese learner: the Vietnamese meaning,
 * then examples (word highlighted, with their translation), the memory tip, and the English definition folded away.
 */
function detailBlocks(note: Note, l: CardLayout, opts: { skipExamples?: boolean; skipVi?: boolean; skipEn?: boolean } = {}): Block[] {
  const out: Block[] = [];
  const vi = opts.skipVi ? "" : str(note.fields.vi);
  const en = opts.skipEn ? "" : str(note.fields.en);
  if (l.showVi && vi) out.push({ k: "text", text: vi, tone: "strong" });
  // The short phrases, one per meaning, sit next to the meanings: they are what ties each meaning to a use.
  if (l.showExamples) out.push(...phraseBlocks(note));
  if (l.showExamples && !opts.skipExamples) list(note.fields.examples).forEach((e, i) => out.push(exampleBlock(note, e, i)));
  if (l.showMnemonic && str(note.fields.mnemonic)) out.push({ k: "memo", text: str(note.fields.mnemonic) });
  if (l.showEn && en) out.push((l.showVi && vi) || opts.skipVi ? { k: "fold", label: EN_LABEL, text: en } : { k: "text", text: en, tone: "strong" });
  return out;
}

function wordHeader(note: Note, l: CardLayout, opts: { skipPos?: boolean } = {}): Block[] {
  const out: Block[] = [{ k: "title", text: str(note.fields.word) }];
  if (l.showPos && !opts.skipPos && str(note.fields.pos)) out.push({ k: "badge", text: str(note.fields.pos) });
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
    if (vi && en && l.showEn) out.push({ k: "fold", label: EN_LABEL, text: en });
    return out;
  },
  // The front stays on screen above the back once revealed, so the back adds only what is new:
  // the part-of-speech badge is already on the front.
  back: (n, l) => [...wordHeader(n, l, { skipPos: true }), ...(l.showExamples ? [...phraseBlocks(n), ...list(n.fields.examples).map((e, i) => exampleBlock(n, e, i))] : [])],
  expected: (n) => [str(n.fields.word)],
  speak: { back: (n) => str(n.fields.word) },
};

/**
 * Typed answers for cards that blank the word out of an example: the word being learned first (the answer hint
 * spells it out), then the form the sentence uses when it differs ("sail", "sailed"). Both are correct.
 */
function clozeExpected(n: Note): string[] {
  const word = str(n.fields.word);
  const form = firstExampleWith(n)?.cloze.answer ?? "";
  return form && normalizeAnswer(form) !== normalizeAnswer(word) ? [word, form] : [word];
}

const cloze: TemplateDef = {
  id: "cloze",
  label: "Điền vào chỗ trống",
  description: "Cụm hoặc câu ví dụ che mất từ, mỗi lần hỏi một nghĩa; gợi ý bằng bản dịch (nếu có) hoặc nghĩa của từ.",
  mode: "type",
  applies: (n) => !!str(n.fields.word) && (firstExampleWith(n) !== null || phrasesOf(n).length > 0),
  front: (n, l) => {
    const c = firstExampleWith(n);
    const out: Block[] = [];
    if (c) out.push({ k: "quote", text: c.cloze.text });
    // The sentence's own translation points at exactly one word, which a bare meaning shared with synonyms does not.
    const tr = c ? exampleVi(n, c.index) : "";
    if (tr) out.push({ k: "text", text: tr });
    else {
      const hint = str(n.fields.vi) || str(n.fields.en);
      if (hint) out.push({ k: "text", text: hint, tone: "muted" });
    }
    if (l.showPos && str(n.fields.pos)) out.push({ k: "badge", text: str(n.fields.pos) });
    return out;
  },
  // The front (blanked sentence, hint, badge) stays on screen above the back once revealed, so the
  // back must not repeat the sentence, the hint or the badge: it adds the word and what the hint lacked.
  back: (n, l) => {
    const c = firstExampleWith(n);
    const usedTr = !!(c && exampleVi(n, c.index));
    const usedVi = !usedTr && !!str(n.fields.vi);
    const usedEn = !usedTr && !usedVi;
    return [...wordHeader(n, l, { skipPos: true }), ...detailBlocks(n, l, { skipExamples: true, skipVi: usedVi, skipEn: usedEn })];
  },
  expected: clozeExpected,
  speak: { back: (n) => firstExampleWith(n)?.sentence ?? null },
};

const listen: TemplateDef = {
  id: "listen",
  label: "Nghe và gõ từ",
  description: "Nghe câu ví dụ, gõ từ còn thiếu. Luyện tai cho phần Nghe của TOEIC.",
  mode: "type",
  applies: (n) => !!str(n.fields.word) && firstExampleWith(n) !== null,
  front: (n) => {
    const c = firstExampleWith(n)!;
    return [{ k: "listen", text: c.sentence }, { k: "quote", text: c.cloze.text }];
  },
  // After the answer: the word, the whole sentence with the word highlighted and translated, then the details.
  back: (n, l) => {
    const c = firstExampleWith(n)!;
    return [...wordHeader(n, l), exampleBlock(n, c.sentence, c.index), ...detailBlocks(n, l, { skipExamples: true })];
  },
  expected: clozeExpected,
  speak: { front: (n) => firstExampleWith(n)?.sentence ?? null, back: (n) => str(n.fields.word) },
};

export const VOCAB: NoteTypeDef = {
  id: "vocab",
  label: "Từ vựng",
  fields: [
    { key: "word", label: "Từ", kind: "text", required: true, maxLength: 80 },
    { key: "ipa", label: "Phiên âm IPA", kind: "text", maxLength: 80 },
    { key: "pos", label: "Loại từ", kind: "text", maxLength: 30 },
    { key: "vi", label: "Nghĩa tiếng Việt", kind: "text", maxLength: 300 },
    { key: "phrases", label: "Cụm ngắn theo nghĩa", kind: "list", maxLength: PHRASE_LINE_MAX, placeholder: "Mỗi dòng một cụm 3-5 từ: cụm tiếng Anh | nghĩa\nví dụ: accommodate 200 guests | chứa được 200 khách" },
    { key: "en", label: "Định nghĩa tiếng Anh", kind: "longtext", maxLength: 400 },
    { key: "examples", label: "Ví dụ", kind: "list", maxLength: 300 },
    { key: "examplesVi", label: "Dịch ví dụ", kind: "list", maxLength: 300, placeholder: "Mỗi dòng dịch một ví dụ, cùng thứ tự" },
    { key: "mnemonic", label: "Mẹo nhớ", kind: "longtext", maxLength: 300 },
    { key: "notes", label: "Ghi chú của tôi", kind: "longtext", maxLength: 500, placeholder: "Điều bạn hay nhầm, cách dùng, từ hay đi kèm…" },
  ],
  templates: [recognize, recall, cloze, listen],
  title: (n) => str(n.fields.word),
  subtitle: (n) => str(n.fields.vi) || str(n.fields.en),
  searchText: (n) =>
    [str(n.fields.word), str(n.fields.vi), str(n.fields.en), ...list(n.fields.phrases), ...list(n.fields.examples), ...list(n.fields.examplesVi), str(n.fields.notes), ...(n.tags ?? [])].join(" ").toLowerCase(),
};

// ------------------------------------------------------------------ grammar (TOEIC Part 5/6 patterns)

/** Where `answer` occurs in `sentence` as whole words, ignoring case: [start, end), or null. No inflection matching:
 *  in grammar practice "completion" must never blank out "complete". */
export function findExact(sentence: string, answer: string): [number, number] | null {
  const a = answer.trim();
  if (!a) return null;
  const re = new RegExp(`(?<![A-Za-z0-9'])${escapeRe(a).replace(/\s+/g, "\\s+")}(?![A-Za-z0-9'])`, "i");
  const m = re.exec(sentence);
  return m ? [m.index, m.index + m[0].length] : null;
}

/** The grammar topics TOEIC Part 5/6 keeps asking, as the learner picks them (stored as text in `topic`). */
export const GRAMMAR_TOPICS = ["Dạng từ", "Giới từ / liên từ", "Thì và bị động", "Mệnh đề quan hệ", "Trợ động từ", "Đảo ngữ", "Khác"] as const;

function grammarCloze(n: Note): { text: string; at: [number, number] } | null {
  const sentence = str(n.fields.sentence);
  const at = findExact(sentence, str(n.fields.answer));
  return at ? { text: sentence.slice(0, at[0]) + "_____" + sentence.slice(at[1]), at } : null;
}

const fill: TemplateDef = {
  id: "fill",
  label: "Điền từ vào câu",
  description: "Câu TOEIC Part 5 che mất đáp án; gõ lại từ đúng, lý do hiện ở mặt sau.",
  mode: "type",
  applies: (n) => grammarCloze(n) !== null,
  front: (n) => {
    const c = grammarCloze(n);
    const out: Block[] = c ? [{ k: "quote", text: c.text }] : [];
    if (str(n.fields.topic)) out.push({ k: "badge", text: str(n.fields.topic) });
    return out;
  },
  // The blanked sentence stays above the back, so the back shows the answer, the full sentence and why.
  back: (n) => {
    const c = grammarCloze(n);
    const vi = str(n.fields.translation);
    const out: Block[] = [{ k: "title", text: str(n.fields.answer) }];
    out.push({ k: "example", text: str(n.fields.sentence), ...(c ? { at: c.at } : {}), ...(vi ? { vi } : {}) });
    if (str(n.fields.rule)) out.push({ k: "text", text: `Quy tắc: ${str(n.fields.rule)}` });
    return out;
  },
  expected: (n) => [str(n.fields.answer)],
  speak: { back: (n) => str(n.fields.sentence) || null },
};

export const GRAMMAR: NoteTypeDef = {
  id: "grammar",
  label: "Ngữ pháp",
  fields: [
    { key: "sentence", label: "Câu đầy đủ (đã có đáp án đúng)", kind: "text", required: true, maxLength: 300 },
    { key: "answer", label: "Đáp án (từ/cụm bị che)", kind: "text", required: true, maxLength: 80 },
    { key: "topic", label: "Chủ đề", kind: "text", maxLength: 40 },
    { key: "translation", label: "Nghĩa của câu", kind: "text", maxLength: 300 },
    { key: "rule", label: "Quy tắc / vì sao đáp án này đúng", kind: "longtext", maxLength: 300 },
  ],
  templates: [fill],
  title: (n) => str(n.fields.sentence),
  subtitle: (n) => [str(n.fields.topic), str(n.fields.answer)].filter(Boolean).join(" · "),
  searchText: (n) => [str(n.fields.sentence), str(n.fields.answer), str(n.fields.topic), str(n.fields.translation), str(n.fields.rule), ...(n.tags ?? [])].join(" ").toLowerCase(),
};

// ------------------------------------------------------------------ pattern (a grammar rule or trap, with sentences to practise it)

/**
 * One practice sentence of a grammar pattern, as the learner writes it on one line:
 *   `Please call us as soon as your taxi [arrives]. | will arrive / arrived / arriving | Hãy gọi ngay khi taxi đến.`
 * The bracketed part is the answer, then (optional) the wrong options separated by " / " (the first one is the trap the
 * "find the mistake" card uses), then (optional) the Vietnamese meaning.
 */
export interface PatternItem {
  /** The sentence with the answer in place and the brackets removed. */
  sentence: string;
  answer: string;
  /** [start, end) of the answer in `sentence`. */
  at: [number, number];
  /** The sentence with the answer blanked out. */
  blanked: string;
  wrong: string[];
  vi: string;
}

/** Longest item line kept, also the field's per-line limit. */
export const PATTERN_ITEM_MAX = 300;

export function parsePatternItem(line: string): PatternItem | null {
  const parts = line.split("|").map((p) => p.replace(/\s+/g, " ").trim());
  const raw = parts[0] ?? "";
  const open = raw.indexOf("[");
  const close = raw.indexOf("]", open + 1);
  if (open < 0 || close < 0 || raw.indexOf("[", open + 1) >= 0 || raw.indexOf("]", close + 1) >= 0) return null;
  const answer = raw.slice(open + 1, close).trim();
  if (!answer) return null;
  const before = raw.slice(0, open);
  const after = raw.slice(close + 1);
  const sentence = before + answer + after;
  const at: [number, number] = [before.length, before.length + answer.length];
  const seen = new Set([normalizeAnswer(answer)]);
  const wrong: string[] = [];
  for (const w of (parts[1] ?? "").split("/").map((x) => x.trim())) {
    const k = normalizeAnswer(w);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    wrong.push(w);
  }
  return { sentence, answer, at, blanked: before + "_____" + after, wrong, vi: parts.slice(2).join(" | ").trim() };
}

/** The usable sentences of a pattern note, in the order they are stored. */
export function patternItems(note: Note): PatternItem[] {
  return list(note.fields.items).map(parsePatternItem).filter((x): x is PatternItem => x !== null);
}

/** The options a fill card shows: the answer and the wrong ones, in a fixed order (code-unit order, the same on Android). */
export function patternOptions(item: PatternItem): string[] {
  if (!item.wrong.length) return [];
  const key = (s: string) => s.toLowerCase();
  return [item.answer, ...item.wrong].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** The sentence with the trap (first wrong option) in place of the answer: the "find the mistake" card. */
function spotSentence(item: PatternItem): string {
  return item.sentence.slice(0, item.at[0]) + item.wrong[0] + item.sentence.slice(item.at[1]);
}

const firstItem = (n: Note) => patternItems(n)[0] ?? null;
const firstTrapItem = (n: Note) => patternItems(n).find((i) => i.wrong.length > 0) ?? null;

function patternBadge(n: Note): Block[] {
  return str(n.fields.topic) ? [{ k: "badge", text: str(n.fields.topic) }] : [];
}

/** What every answer side explains after the sentence: the trap's name, the rule, its signals and formula, why the others are wrong, the tip. */
function patternExplain(n: Note): Block[] {
  const out: Block[] = [];
  // Names the trap, so each sentence is filed under the pattern it belongs to.
  if (str(n.fields.title)) out.push({ k: "text", text: `Bẫy: ${str(n.fields.title)}`, tone: "muted" });
  if (str(n.fields.rule)) out.push({ k: "text", text: str(n.fields.rule), tone: "strong" });
  if (str(n.fields.signals)) out.push({ k: "text", text: `Dấu hiệu: ${str(n.fields.signals)}` });
  if (str(n.fields.formula)) out.push({ k: "text", text: str(n.fields.formula), tone: "muted" });
  const why = list(n.fields.why);
  if (why.length) out.push({ k: "fold", label: "Vì sao không phải…", text: why.join("\n") });
  if (str(n.fields.tip)) out.push({ k: "memo", text: str(n.fields.tip) });
  return out;
}

function itemExample(item: PatternItem): Block {
  return { k: "example", text: item.sentence, at: item.at, ...(item.vi ? { vi: item.vi } : {}) };
}

const patternFill: TemplateDef = {
  id: "fill",
  label: "Điền câu theo bẫy",
  description: "Mỗi lần ôn là một câu khác của cùng một bẫy: gõ đáp án đúng trong các lựa chọn, quy tắc hiện ở mặt sau.",
  mode: "type",
  applies: (n) => firstItem(n) !== null,
  front: (n) => {
    const it = firstItem(n)!;
    const opts = patternOptions(it);
    return [...patternBadge(n), { k: "quote", text: it.blanked }, ...(opts.length ? ([{ k: "text", text: opts.join(" · "), tone: "muted" }] as Block[]) : [])];
  },
  // The blanked sentence and the options stay above the back, so the back starts with the answer.
  back: (n) => {
    const it = firstItem(n)!;
    return [{ k: "title", text: it.answer }, itemExample(it), ...patternExplain(n)];
  },
  expected: (n) => [firstItem(n)?.answer ?? ""],
  speak: { back: (n) => firstItem(n)?.sentence ?? null },
};

const patternRule: TemplateDef = {
  id: "rule",
  label: "Nhớ quy tắc",
  description: "Thấy câu hỏi về dấu hiệu, tự nhớ lại quy tắc rồi tự chấm.",
  mode: "flip",
  applies: (n) => !!str(n.fields.ask) && !!str(n.fields.rule),
  front: (n) => [...patternBadge(n), { k: "text", text: str(n.fields.ask), tone: "strong" }],
  back: (n) => {
    const it = firstItem(n);
    const out: Block[] = [{ k: "text", text: str(n.fields.rule), tone: "strong" }];
    if (str(n.fields.formula)) out.push({ k: "text", text: str(n.fields.formula), tone: "muted" });
    if (it) out.push(itemExample(it));
    if (str(n.fields.tip)) out.push({ k: "memo", text: str(n.fields.tip) });
    return out;
  },
  speak: { back: (n) => firstItem(n)?.sentence ?? null },
};

const patternSpot: TemplateDef = {
  id: "spot",
  label: "Tìm lỗi sai",
  description: "Câu chứa đúng một lỗi theo bẫy: tìm chỗ sai và gõ lại từ đúng.",
  mode: "type",
  applies: (n) => firstTrapItem(n) !== null,
  front: (n) => {
    const it = firstTrapItem(n)!;
    return [...patternBadge(n), { k: "quote", text: spotSentence(it) }, { k: "text", text: "Câu có một chỗ sai. Gõ lại từ đúng thay cho chỗ sai.", tone: "muted" }];
  },
  back: (n) => {
    const it = firstTrapItem(n)!;
    return [{ k: "title", text: it.answer }, { k: "text", text: `Sai: ${it.wrong[0]} → Đúng: ${it.answer}` }, itemExample(it), ...patternExplain(n)];
  },
  expected: (n) => [firstTrapItem(n)?.answer ?? ""],
  speak: { back: (n) => firstTrapItem(n)?.sentence ?? null },
};

export const PATTERN: NoteTypeDef = {
  id: "pattern",
  label: "Bẫy ngữ pháp",
  fields: [
    { key: "title", label: "Tên bẫy", kind: "text", required: true, maxLength: 80 },
    { key: "topic", label: "Chủ điểm", kind: "text", maxLength: 40 },
    { key: "ask", label: "Câu hỏi nhớ quy tắc", kind: "longtext", maxLength: 200 },
    { key: "signals", label: "Dấu hiệu nhận biết", kind: "text", maxLength: 160 },
    { key: "rule", label: "Quy tắc", kind: "longtext", required: true, maxLength: 300 },
    { key: "formula", label: "Công thức", kind: "text", maxLength: 120 },
    {
      key: "items", label: "Câu luyện", kind: "list", required: true, maxLength: PATTERN_ITEM_MAX,
      placeholder: "Mỗi dòng một câu: câu có [đáp án] | sai 1 / sai 2 / sai 3 | nghĩa\nví dụ: We will wait until he [returns]. | will return / returned | Chúng tôi sẽ đợi đến khi anh ấy về.",
    },
    { key: "why", label: "Vì sao không phải…", kind: "list", maxLength: 160, placeholder: "Mỗi dòng giải thích một lựa chọn sai" },
    { key: "tip", label: "Mẹo nhớ", kind: "longtext", maxLength: 200 },
  ],
  templates: [patternFill, patternRule, patternSpot],
  title: (n) => str(n.fields.title),
  subtitle: (n) => [str(n.fields.topic), `${patternItems(n).length} câu`].filter(Boolean).join(" · "),
  searchText: (n) =>
    [str(n.fields.title), str(n.fields.topic), str(n.fields.ask), str(n.fields.signals), str(n.fields.rule), str(n.fields.formula), ...list(n.fields.items), ...list(n.fields.why), str(n.fields.tip), ...(n.tags ?? [])]
      .join(" ")
      .toLowerCase(),
};

// ------------------------------------------------------------------ test (one practice test's result; makes no cards)

/**
 * A practice test the learner took: how many questions were right per part, and why the wrong ones were wrong.
 * It makes no cards: it is the data the progress panel (Today) reads. Counts are strings ("20/30" = right/total).
 */
export const TEST: NoteTypeDef = {
  id: "test",
  label: "Bài làm thử",
  fields: [
    { key: "name", label: "Tên bài", kind: "text", required: true, maxLength: 80 },
    { key: "date", label: "Ngày làm (YYYY-MM-DD)", kind: "text", maxLength: 10 },
    { key: "p5", label: "Part 5 đúng/tổng", kind: "text", maxLength: 9 },
    { key: "p6", label: "Part 6 đúng/tổng", kind: "text", maxLength: 9 },
    { key: "p7", label: "Part 7 đúng/tổng", kind: "text", maxLength: 9 },
    { key: "lc", label: "Listening đúng/tổng", kind: "text", maxLength: 9 },
    { key: "minutes", label: "Số phút làm RC", kind: "text", maxLength: 3 },
    { key: "v", label: "Sai vì từ vựng", kind: "text", maxLength: 3 },
    { key: "g", label: "Sai vì ngữ pháp", kind: "text", maxLength: 3 },
    { key: "p", label: "Sai vì không nhận ra diễn đạt lại", kind: "text", maxLength: 3 },
    { key: "t", label: "Sai vì hết giờ / vội", kind: "text", maxLength: 3 },
  ],
  templates: [],
  title: (n) => str(n.fields.name),
  subtitle: (n) => str(n.fields.date),
  searchText: (n) => [str(n.fields.name), str(n.fields.date)].join(" ").toLowerCase(),
};

// ------------------------------------------------------------------ the library's view of a whole note ("Xem")

/** What the view says in place of the hidden part when it is covered. */
export const COVER_NOTE: Readonly<Record<string, string>> = {
  vocab: "Nghĩa đang được che. Nhớ thử nghĩa của từ rồi bỏ che để kiểm tra.",
  pattern: "Đáp án và quy tắc đang được che. Tự điền từng câu rồi bỏ che để kiểm tra.",
  grammar: "Đáp án đang được che. Tự điền rồi bỏ che để kiểm tra.",
};

function vocabView(n: Note, covered: boolean): Block[] {
  const word = str(n.fields.word);
  const out: Block[] = [{ k: "title", text: word }];
  if (str(n.fields.pos)) out.push({ k: "badge", text: str(n.fields.pos) });
  if (str(n.fields.ipa)) out.push({ k: "ipa", text: str(n.fields.ipa) });
  if (word) out.push({ k: "speak", text: word });
  const vi = str(n.fields.vi);
  const en = str(n.fields.en);
  const examples = list(n.fields.examples);
  const phrases = phraseBlocks(n);
  if (covered) {
    out.push({ k: "text", text: COVER_NOTE.vocab, tone: "muted" });
    // The English side only: the phrase and sentence translations would give the meaning away.
    if (phrases.length) out.push({ k: "label", text: "Cụm ngắn" }, ...phrases.map((b): Block => (b.k === "example" ? { k: "example", text: b.text, ...(b.at ? { at: b.at } : {}), phrase: true } : b)));
    if (examples.length) out.push({ k: "label", text: "Ví dụ" }, ...examples.map((e): Block => { const at = findWord(e, word); return { k: "example", text: e, ...(at ? { at } : {}) }; }));
    return out;
  }
  if (vi || en) out.push({ k: "label", text: "Nghĩa" }, { k: "text", text: vi || en, tone: "strong" });
  if (phrases.length) out.push({ k: "label", text: "Cụm ngắn" }, ...phrases);
  if (examples.length) out.push({ k: "label", text: "Ví dụ" }, ...examples.map((e, i) => exampleBlock(n, e, i)));
  if (str(n.fields.mnemonic)) out.push({ k: "memo", text: str(n.fields.mnemonic) });
  if (str(n.fields.notes)) out.push({ k: "label", text: "Ghi chú của tôi" }, { k: "text", text: str(n.fields.notes) });
  if (vi && en) out.push({ k: "fold", label: EN_LABEL, text: en });
  return out;
}

function patternView(n: Note, covered: boolean): Block[] {
  const items = patternItems(n);
  const out: Block[] = [...patternBadge(n), { k: "title", text: str(n.fields.title) }];
  if (str(n.fields.ask)) out.push({ k: "text", text: str(n.fields.ask) });
  if (covered) {
    out.push({ k: "text", text: COVER_NOTE.pattern, tone: "muted" });
    if (items.length) out.push({ k: "label", text: `Câu luyện (${items.length})` });
    for (const it of items) {
      out.push({ k: "quote", text: it.blanked });
      const opts = patternOptions(it);
      if (opts.length) out.push({ k: "text", text: opts.join(" · "), tone: "muted" });
    }
    return out;
  }
  if (str(n.fields.rule) || str(n.fields.signals) || str(n.fields.formula)) out.push({ k: "label", text: "Quy tắc" });
  if (str(n.fields.rule)) out.push({ k: "text", text: str(n.fields.rule), tone: "strong" });
  if (str(n.fields.signals)) out.push({ k: "text", text: `Dấu hiệu: ${str(n.fields.signals)}` });
  if (str(n.fields.formula)) out.push({ k: "text", text: str(n.fields.formula), tone: "muted" });
  if (items.length) out.push({ k: "label", text: `Câu luyện (${items.length})` });
  for (const it of items) out.push({ ...itemExample(it), ...(it.wrong.length ? { wrong: it.wrong } : {}) } as Block);
  const why = list(n.fields.why);
  if (why.length) out.push({ k: "label", text: "Vì sao không phải…" }, ...why.map((w): Block => ({ k: "text", text: w })));
  if (str(n.fields.tip)) out.push({ k: "memo", text: str(n.fields.tip) });
  return out;
}

function grammarView(n: Note, covered: boolean): Block[] {
  const c = grammarCloze(n);
  const out: Block[] = str(n.fields.topic) ? [{ k: "badge", text: str(n.fields.topic) }] : [];
  if (covered) return [...out, { k: "quote", text: c?.text ?? str(n.fields.sentence) }, { k: "text", text: COVER_NOTE.grammar, tone: "muted" }];
  const vi = str(n.fields.translation);
  out.push({ k: "title", text: str(n.fields.answer) }, { k: "example", text: str(n.fields.sentence), ...(c ? { at: c.at } : {}), ...(vi ? { vi } : {}) });
  if (str(n.fields.rule)) out.push({ k: "label", text: "Quy tắc" }, { k: "text", text: str(n.fields.rule) });
  return out;
}

/**
 * The whole note as the library shows it when the learner opens it to read ("Xem"), independent of the card layout
 * settings: everything the note holds, in the order of the answer side. `covered` hides what the learner should
 * recall (a word's meanings; a grammar note's answers and rule), so the view doubles as a quick self-test.
 * Empty for note types that have no view (practice test results).
 */
export function noteView(note: Note, covered = false): Block[] {
  if (note.type === "vocab") return vocabView(note, covered);
  if (note.type === "pattern") return patternView(note, covered);
  if (note.type === "grammar") return grammarView(note, covered);
  return [];
}

/** Note types that hold learning material (and so show in the library, the word count and the "no words yet" screen). */
export const isMaterial = (n: { type: string }) => n.type !== "test";

export const NOTE_TYPES: Readonly<Record<string, NoteTypeDef>> = { vocab: VOCAB, grammar: GRAMMAR, pattern: PATTERN, test: TEST };

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
