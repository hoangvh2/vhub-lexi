/**
 * "Từ lạ trong đoạn đọc": which words of a pasted passage the learner does not have yet.
 *
 * A word counts as covered when it is a very common word, when it is in the learner's deck and has been learned,
 * or when the learner says they know it. Everything else is "lạ" and can be turned into a card in one tap, with
 * the sentence it appeared in as the example. A passage with more than about 1 unknown word in 20 is hard to read
 * (Laufer, Hu & Nation), so the coverage figure is the reason to do this, not decoration.
 *
 * The common-word list below is a hand-written set of everyday English (function words and basic vocabulary),
 * not a corpus list: it says "you surely know this", not "this is frequent in TOEIC".
 */
import { CardState, type Card, type Note } from "@shared/model.ts";
import { IRREGULAR } from "@shared/irregular.ts";
import { baseForms } from "@shared/morphy.ts";
import { str } from "@shared/notetypes.ts";

const COMMON_TEXT = `
a an the this that these those my your his her its our their me him us them i you he she it we they who whom whose which what where when why how
am is are was were be been being do does did done doing have has had having will would shall should can could may might must ought let
and or but so if then than because as while although though unless until since after before once whether either neither nor both not no yes
of in on at by for with about against between into through during without within along across behind beyond near up down out off over under again
to from upon around among toward towards per via like than
all any each every some many much more most few less least other another such only own same very too quite rather just even still also ever never always often
sometimes usually already yet now then here there today tomorrow yesterday soon later again away back well far
one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand million first second third last next
go goes went gone going get gets got getting make makes made making take takes took taken taking come comes came coming see sees saw seen seeing
know knew known say says said give gave given find found tell told work works worked working call called try tried ask asked need needed feel felt
become became leave left put mean meant keep kept begin began begun seem seemed help helped show showed shown hear heard play played run ran move moved
live lived believe bring brought happen happened write wrote written sit stand stood lose lost pay paid meet met include included continue set learn
change changed lead led understand watch follow stop create speak spoke read allow add spend grow open walk win offer remember love consider appear buy bought
wait serve send sent expect build stay fall cut reach remain use used using want wanted look looked think thought turn turned start started
good new old long great little big high small large young important different same right bad able free sure real best better full special easy clear
late early hard major local whole short available possible human public next sure low
time year years people way ways day days man men thing things woman women life child children world school state family student group country problem hand
part place case week weeks company system program question number night point home water room mother father area money story fact month months lot
study book eye job word business issue side kind head house service friend power hour hours game line end member law car city community name team minute
minutes idea body information parent face level office door health person art war history party result morning reason girl guy moment air teacher
education name page note list day week plan plans please thank thanks sorry hello dear
don doesn didn isn aren wasn weren won wouldn couldn shouldn haven hasn hadn cannot ll ve re
mr mrs ms dr
monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december
dollar dollars percent
`;
const COMMON: ReadonlySet<string> = new Set(COMMON_TEXT.split(/\s+/).filter(Boolean));

export type Kind = "common" | "known" | "deck" | "ignored" | "unknown" | "skip";

export interface Tok {
  start: number;
  end: number;
  raw: string;
  /** Lower-case form without a trailing 's / 'll … */
  key: string;
  kind: Kind;
}

export interface Unknown {
  key: string;
  count: number;
  first: Tok;
}

export interface Analysis {
  tokens: Tok[];
  /** Words that count toward coverage (everything but proper nouns, acronyms, numbers). */
  counted: number;
  covered: number;
  /** covered / counted, or null for a passage with no countable word. */
  coverage: number | null;
  /** Words with no card yet, one entry per word. */
  unknown: Unknown[];
  /** Distinct words that are in the deck but not learned yet (they lower coverage until they are). */
  pending: number;
}

export type DeckIndex = ReadonlyMap<string, "known" | "deck">;

/** Single-word vocab notes by word: "known" once a card of the note has been through review, else "deck". */
export function buildIndex(notes: readonly Note[], cards: readonly Card[]): Map<string, "known" | "deck"> {
  const reviewed = new Set<string>();
  for (const c of cards) if (c.state === CardState.Review) reviewed.add(c.noteId);
  const out = new Map<string, "known" | "deck">();
  for (const n of notes) {
    if (n.type !== "vocab") continue;
    const w = str(n.fields.word).toLowerCase();
    if (!w || /\s/.test(w)) continue;
    if (out.get(w) !== "known") out.set(w, reviewed.has(n.id) ? "known" : "deck");
  }
  return out;
}

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

/** Lower-case key: "Company's" -> "company", "don't" -> "do". */
export function keyOf(raw: string): string {
  const lower = raw.toLowerCase().replace(/’/g, "'");
  if (/n't$/.test(lower)) return lower === "can't" ? "can" : lower === "won't" ? "will" : lower.slice(0, -3);
  return lower.replace(/'(?:s|re|ve|ll|d|m)$/, "");
}

/** The words a token may be an inflection of (itself first). */
function forms(key: string): string[] {
  return [key, ...baseForms(key, IRREGULAR)];
}

const SENTENCE_END = /[.!?:;\n•*]/;

function startsSentence(text: string, at: number): boolean {
  let i = at - 1;
  // A word that begins a line begins a sentence (emails, lists, headings).
  while (i >= 0 && /[\s"'“‘(\[\-–—]/.test(text[i])) {
    if (text[i] === "\n") return true;
    i--;
  }
  if (i < 0) return true;
  if (text[i] === "." && /\b(?:mr|mrs|ms|dr|prof|inc|corp|ltd|co|st|jr|sr|vs|no|dept|a\.m|p\.m)$/i.test(text.slice(Math.max(0, i - 5), i))) return false;
  if (SENTENCE_END.test(text[i])) return true;
  // "1." / "a)" list markers
  return /[\d)]/.test(text[i]) && /(?:^|\n)\s*[\w]{1,2}[.)]\s*$/.test(text.slice(Math.max(0, at - 6), at));
}

/** A line where most words are capitalised is a heading: capitals there say nothing about proper nouns. */
function headingLines(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const words = line.match(WORD) ?? [];
    if (words.length >= 2 && !/[.,;:!?]\s*$/.test(line) && words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.6) out.push([pos, pos + line.length]);
    pos += line.length + 1;
  }
  return out;
}

export function analyze(text: string, index: DeckIndex, ignored: ReadonlySet<string> = new Set()): Analysis {
  const heads = headingLines(text);
  const tokens: Tok[] = [];
  for (const m of text.matchAll(WORD)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const key = keyOf(raw);
    let kind: Kind;
    const inHeading = heads.some(([a, b]) => start >= a && start < b);
    const acronym = raw.length >= 2 && raw === raw.toUpperCase() && !/\s/.test(raw) && raw.length <= 6 && !COMMON.has(key);
    const proper = /^[A-Z]/.test(raw) && !inHeading && !startsSentence(text, start);
    if (key.length < 2 && key !== "a" && key !== "i") kind = "skip";
    else if (acronym || proper) kind = "skip";
    else {
      const fs = forms(key);
      const hit = fs.find((f) => COMMON.has(f));
      const deck = fs.map((f) => index.get(f)).find(Boolean);
      kind = hit ? "common" : deck === "known" ? "known" : ignored.has(key) ? "ignored" : deck === "deck" ? "deck" : "unknown";
    }
    tokens.push({ start, end: start + raw.length, raw, key, kind });
  }
  const counted = tokens.filter((t) => t.kind !== "skip");
  // A word in the deck that has not been learned yet is not covered: the learner would still stumble on it.
  const covered = counted.filter((t) => t.kind === "common" || t.kind === "known" || t.kind === "ignored").length;
  const uniq = new Map<string, Unknown>();
  const pending = new Set<string>();
  for (const t of counted) {
    if (t.kind === "deck") pending.add(t.key);
    if (t.kind !== "unknown") continue;
    const u = uniq.get(t.key);
    if (u) u.count++;
    else uniq.set(t.key, { key: t.key, count: 1, first: t });
  }
  return { tokens, counted: counted.length, covered, coverage: counted.length ? covered / counted.length : null, unknown: [...uniq.values()], pending: pending.size };
}

/** The sentence of `text` that contains `at`, trimmed, at most `max` characters. */
export function sentenceAround(text: string, at: number, max = 300): string {
  let a = at;
  while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
  let b = at;
  while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
  if (b < text.length && /[.!?]/.test(text[b])) b++;
  const s = text.slice(a, b).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  // Too long: keep a window around the word, on word boundaries.
  const rel = at - a;
  const from = Math.max(0, rel - Math.floor(max / 2));
  return s.slice(from, from + max).replace(/^\S*\s/, "").replace(/\s\S*$/, "").trim();
}
