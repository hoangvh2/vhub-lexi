/**
 * Words a learner can mix up with the one under review, found in the learner's own notes.
 *
 * Many English words share a Vietnamese meaning (convince, persuade: "thuyết phục, làm cho tin"), so a
 * typing card whose prompt is that meaning has more than one plausible answer. This module finds those
 * neighbours so the study screen can name the target unambiguously (first letter and length, "not: …")
 * and can tell "you typed another word with this meaning" apart from a plain miss.
 *
 * Neighbours come from the learner's notes only (no dictionary or network): two notes are confusable when
 * their Vietnamese meanings share a phrase, or when the words share a long prefix (persuade, persuasion).
 * shared/vectors/confusables.json pins the behaviour for the Kotlin port (android/core Confusables.kt).
 */
import { IRREGULAR } from "./irregular.ts";
import type { Note } from "./model.ts";
import { baseForms } from "./morphy.ts";
import { normalizeAnswer, str, suggestedRating, type AnswerVerdict } from "./notetypes.ts";

export interface Confusable {
  noteId: string;
  word: string;
  pos: string;
  vi: string;
  en: string;
  /** "meaning": a Vietnamese meaning phrase in common; "spelling": a long common prefix. */
  reason: "meaning" | "spelling";
}

// Nominalisers and adverb markers that turn one meaning into another part of speech: "sự thuyết phục" ~ "thuyết phục".
const VI_PREFIXES = ["một cách ", "sự ", "việc ", "cuộc ", "tính "];

/** The distinct meaning phrases of a Vietnamese meaning line: split on ; , /, without parentheses or nominalisers. */
export function meaningPhrases(vi: string): string[] {
  const out: string[] = [];
  const text = vi.normalize("NFC").toLowerCase().replace(/\([^)]*\)/g, " ");
  for (const raw of text.split(/[;,/]/)) {
    let p = raw.replace(/[.…!?"“”]/g, " ").replace(/\s+/g, " ").trim();
    for (const pre of VI_PREFIXES) {
      if (p.startsWith(pre) && p.length > pre.length + 1) {
        p = p.slice(pre.length).trim();
        break;
      }
    }
    if (p.length >= 2 && !out.includes(p)) out.push(p);
  }
  return out;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** persuade/persuasion, important/importance: single words sharing all but their last two or three letters. */
function similarSpelling(a: string, b: string): boolean {
  if (a.includes(" ") || b.includes(" ")) return false;
  return commonPrefix(a, b) >= Math.max(5, Math.min(a.length, b.length) - 2);
}

/**
 * Notes of the same type whose word can be mistaken for `note`'s word, most likely first:
 * shared meaning phrases (more shared first), then similar spelling, then alphabetical.
 */
export function confusables(note: Note, notes: readonly Note[]): Confusable[] {
  const word = normalizeAnswer(str(note.fields.word));
  if (!word) return [];
  const mine = meaningPhrases(str(note.fields.vi));
  const found: Array<Confusable & { shared: number }> = [];
  const seen = new Set<string>();
  for (const o of notes) {
    if (o.id === note.id || o.type !== note.type) continue;
    const w = normalizeAnswer(str(o.fields.word));
    if (!w || w === word || seen.has(w)) continue;
    const theirs = meaningPhrases(str(o.fields.vi));
    const shared = mine.filter((p) => theirs.includes(p)).length;
    const reason = shared > 0 ? "meaning" : similarSpelling(word, w) ? "spelling" : null;
    if (!reason) continue;
    seen.add(w);
    found.push({ noteId: o.id, word: str(o.fields.word), pos: str(o.fields.pos), vi: str(o.fields.vi), en: str(o.fields.en), reason, shared });
  }
  found.sort((a, b) => b.shared - a.shared || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  return found.map(({ shared: _, ...c }) => c);
}

/** The confusable word the learner typed (also as an inflected form: "persuaded" -> persuade), or null. */
export function matchConfusable(typed: string, list: readonly Confusable[]): Confusable | null {
  const t = normalizeAnswer(typed);
  if (!t) return null;
  const forms = [t, ...baseForms(t, IRREGULAR)];
  return list.find((c) => forms.includes(normalizeAnswer(c.word))) ?? null;
}

/** Letters in an answer (spaces, hyphens and apostrophes are not letters). */
export function letterCount(answer: string): number {
  return [...answer.trim()].filter((ch) => /\p{L}/u.test(ch)).length;
}

/**
 * The answer with only its first `shown` letters visible: answerHint("look after", 1) = "l___ _____".
 * Never shows every letter: at most all but the last.
 */
export function answerHint(answer: string, shown: number): string {
  const a = answer.trim();
  const limit = Math.max(0, Math.min(shown, letterCount(a) - 1));
  let n = 0;
  let out = "";
  for (const ch of a) {
    if (/\p{L}/u.test(ch)) {
      out += n < limit ? ch : "_";
      n++;
    } else out += ch;
  }
  return out;
}

/**
 * Suggested rating for a typed answer, given how much help the learner needed: extra hint letters beyond the
 * first, or a second try after typing a confusable word, cap a correct answer at "Hard".
 */
export function suggestedRatingWith(v: AnswerVerdict, help: { extraHints: number; retried: boolean }): 1 | 2 | 3 {
  const r = suggestedRating(v);
  return r === 3 && (help.extraHints > 0 || help.retried) ? 2 : r;
}
