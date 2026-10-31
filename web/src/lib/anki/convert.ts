/**
 * Turns an Anki collection (read.ts) into a Lexi export file that Repo.importAll writes as-is.
 * Pure: no storage, no clock (the caller passes `now`), so it is unit-tested on real .apkg fixtures.
 *
 * What carries over, and how (Anki semantics from rslib/src/scheduler and storage/card/data.rs):
 *   note fields   HTML -> plain text, mapped to vocab fields by name (editable in the import dialog)
 *   deck          the top-level Anki deck becomes one Lexi deck; sub-decks ("Lesson 01") become tags
 *   card state    type/queue -> New/Learning/Review/Relearning; queue -1 -> suspended
 *   due           review / day-learning: days since collection creation (`crt`) -> epoch ms;
 *                 learning: epoch seconds; new: Anki's new-card order is kept through `createdAt`
 *   memory        cards.data `s`/`d` (Anki with FSRS on); otherwise the review log is replayed through
 *                 Lexi's FSRS; with no log, estimated from interval and ease like Anki's
 *                 memory_state_from_sm2
 *   review log    every answer (ease 1-4) -> reviews (device "anki") and per-day counters (heatmap,
 *                 streak, retention); manual reschedules (ease 0) are skipped
 *
 * Notes that already exist (same Anki note id, or the same word in any deck) are skipped, so importing
 * the same file twice never resets progress made in Lexi.
 */
import { createEmptyCard, default_w, type Grade } from "ts-fsrs";
import { CardState, RATING_FIELD, cardId, dayId, reviewId, type Card, type Daily, type Deck, type Note, type Prefs, type Rating, type ReviewLog } from "@shared/model.ts";
import { NOTE_TYPES, wantedTemplates } from "@shared/notetypes.ts";
import type { ExportFile } from "../../data/repo.ts";
import { makeScheduler } from "../scheduler.ts";
import type { AnkiCard, AnkiCollection, AnkiNotetype, AnkiRevlog } from "./read.ts";

/** Lexi vocab field -> Anki field name ("" = not imported). */
export type FieldMap = Record<VocabKey, string>;
export type VocabKey = "word" | "ipa" | "pos" | "vi" | "en" | "examples" | "examplesVi" | "mnemonic";
export const VOCAB_KEYS: VocabKey[] = ["word", "ipa", "pos", "vi", "en", "examples", "examplesVi", "mnemonic"];

/** Anki template ord -> Lexi template id ("" = drop those cards). */
export type TemplateMap = Record<number, string>;

export interface ImportPlan {
  notetypeId: string;
  fields: FieldMap;
  templates: TemplateMap;
}

export interface ImportExisting {
  decks: readonly Deck[];
  notes: readonly Note[];
  daily: readonly Daily[];
  prefs: Prefs;
}

export interface ImportReport {
  notes: number;
  cards: number;
  reviews: number;
  /** Cards carrying Anki progress (not new). */
  studied: number;
  suspended: number;
  /** Review cards due on or before today. */
  dueToday: number;
  skippedExisting: number;
  /** Words already in Lexi (another note with the same word). */
  skippedDuplicates: string[];
  skippedEmpty: number;
  /** Anki cards whose template was mapped to nothing. */
  droppedCards: number;
  /** Fields cut to Lexi's length limits. */
  truncated: number;
  /** Tags made from sub-deck names, in order. */
  lessons: string[];
  /** Firestore writes the import needs (free tier: 20,000 per day). */
  writes: number;
}

const DAY_MS = 86_400_000;

// ------------------------------------------------------------------ guessing the mapping

const FIELD_GUESS: Array<[VocabKey, RegExp]> = [
  ["examplesVi", /translat|dịch|vi(etnamese)?[ _-]?example|example[ _-]?vi/i],
  ["examples", /example|sentence|ví dụ|context/i],
  ["ipa", /transcri|ipa|phonetic|phiên âm/i],
  ["pos", /word ?type|part of speech|^pos$|^type$|loại từ|class/i],
  ["vi", /vietnam|tiếng việt|nghĩa|meaning|^vi$|^back$/i],
  ["en", /explan|defin|english|^en$|giải thích/i],
  ["mnemonic", /mnemonic|mẹo|hint|memo/i],
  ["word", /^(target )?word$|^front$|^term$|^vocab|^từ( vựng)?$|^english word$|^expression$/i],
];

/** Best-effort field mapping by field name; the first field is the word when nothing matches. */
export function guessFields(nt: AnkiNotetype): FieldMap {
  const out = Object.fromEntries(VOCAB_KEYS.map((k) => [k, ""])) as FieldMap;
  const used = new Set<string>();
  for (const [key, re] of FIELD_GUESS) {
    const f = nt.fields.find((x) => !used.has(x.name) && re.test(x.name.trim()));
    if (f && !out[key]) {
      out[key] = f.name;
      used.add(f.name);
    }
  }
  if (!out.word && nt.fields[0] && !used.has(nt.fields[0].name)) out.word = nt.fields[0].name;
  return out;
}

/** First Anki template = recognise (word -> meaning), second = recall (meaning -> word), the rest dropped. */
export function guessTemplates(nt: AnkiNotetype): TemplateMap {
  const out: TemplateMap = {};
  for (const t of nt.templates) {
    const name = t.name.toLowerCase();
    out[t.ord] = /cloze|điền/.test(name) ? "cloze" : /listen|nghe|audio/.test(name) ? "listen" : /type|gõ|recall|reverse|ngược/.test(name) ? "recall" : t.ord === 0 ? "recognize" : t.ord === 1 ? "recall" : "";
  }
  return out;
}

/** The note type with the most notes (the deck being imported), and its guessed mapping. */
export function defaultPlan(col: AnkiCollection): ImportPlan | null {
  const counts = new Map<string, number>();
  for (const n of col.notes) counts.set(n.mid, (counts.get(n.mid) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const nt = best && col.notetypes.get(best[0]);
  if (!nt) return null;
  return { notetypeId: nt.id, fields: guessFields(nt), templates: guessTemplates(nt) };
}

// ------------------------------------------------------------------ field text

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Anki field HTML -> lines of plain text (block tags and <br> end a line; sound/image tags dropped). */
export function htmlLines(html: string): string[] {
  const text = html
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|p|li|ul|ol|tr|h[1-6])(\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
const htmlText = (html: string) => htmlLines(html).join(" ");
/** "a. The two parties…" -> "The two parties…" (list markers of the 600 Essential deck). */
const unmark = (l: string) => l.replace(/^(?:[a-h]|\d{1,2})[.)]\s+/i, "");

const POS: Record<string, string> = {
  n: "noun", noun: "noun", v: "verb", verb: "verb", adj: "adjective", a: "adjective", adjective: "adjective",
  adv: "adverb", r: "adverb", adverb: "adverb", prep: "preposition", preposition: "preposition",
  conj: "conjunction", conjunction: "conjunction", pron: "pronoun", pronoun: "pronoun", phr: "phrase", phrase: "phrase",
};
/** "(v)" -> "verb", "(n, v)" -> "noun, verb"; anything unknown kept as written. */
export function normalizePos(s: string): string {
  const t = s.replace(/[()[\]]/g, "").trim();
  const parts = t.split(/\s*[,/;&]\s*|\s+or\s+/i).filter(Boolean);
  const mapped = parts.map((p) => POS[p.toLowerCase().replace(/\.$/, "")]);
  return mapped.every(Boolean) && mapped.length ? [...new Set(mapped)].join(", ") : t;
}

/** URL-safe tag from a deck level name: "Lesson 01" -> "lesson-01", "Bài 3: Hợp đồng" -> "bai-3-hop-dong". */
export function tagOf(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ------------------------------------------------------------------ memory state

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Stability and difficulty for a card studied without FSRS and without a usable log, from its SM-2
 * interval and ease, as fsrs-rs memory_state_from_sm2 does with sm2_retention 0.9: at 90% recall the
 * FSRS interval equals the stability, so S = interval; D solves the stability-increase equation for a
 * "Good" answer that would have multiplied the interval by the ease.
 */
export function memoryFromSm2(ivlDays: number, factor: number): { stability: number; difficulty: number } {
  const w = default_w;
  const stability = Math.max(0.1, ivlDays);
  const ease = factor > 0 ? factor / 1000 : 2.5;
  const r = 0.9;
  const difficulty = 11 - (ease - 1) / (Math.exp(w[8]) * Math.pow(stability, -w[9]) * Math.expm1((1 - r) * w[10]));
  return { stability, difficulty: clamp(difficulty, 1, 10) };
}

const graded = (r: AnkiRevlog) => r.ease >= 1 && r.ease <= 4 && r.type <= 3;

/** Replays a card's Anki answers through Lexi's FSRS: memory after each answer (same order as `log`). */
function replay(log: readonly AnkiRevlog[], desiredRetention: number): Array<{ stability: number; difficulty: number; scheduledDays: number }> {
  const s = makeScheduler(desiredRetention);
  let fc = createEmptyCard(new Date(log[0]?.id ?? 0));
  return log.map((r) => {
    fc = s.next(fc, new Date(r.id), r.ease as Grade).card;
    return { stability: fc.stability, difficulty: fc.difficulty, scheduledDays: fc.scheduled_days };
  });
}

// ------------------------------------------------------------------ conversion

function lexiState(c: AnkiCard): CardState {
  if (c.type === 1) return CardState.Learning;
  if (c.type === 2) return CardState.Review;
  if (c.type === 3) return CardState.Relearning;
  return CardState.New;
}

function emptyDaily(id: string): Daily {
  return { id, newCards: 0, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: 0 };
}

export function convertAnki(col: AnkiCollection, plan: ImportPlan, ex: ImportExisting, now: number): { file: ExportFile; report: ImportReport } {
  const def = NOTE_TYPES.vocab;
  const nt = col.notetypes.get(plan.notetypeId);
  const report: ImportReport = {
    notes: 0, cards: 0, reviews: 0, studied: 0, suspended: 0, dueToday: 0, skippedExisting: 0, skippedDuplicates: [],
    skippedEmpty: 0, droppedCards: 0, truncated: 0, lessons: [], writes: 0,
  };
  const file: ExportFile = { app: "vhub-lexi", version: 1, exportedAt: now, decks: [], notes: [], cards: [], reviews: [], daily: [], prefs: null };
  if (!nt) return { file, report };

  const fieldIndex = new Map(nt.fields.map((f, i) => [f.name, i]));
  const at = (fields: string[], key: VocabKey) => {
    const i = fieldIndex.get(plan.fields[key]);
    return i === undefined ? "" : fields[i] ?? "";
  };
  const limit = (key: string, s: string) => {
    const max = def.fields.find((f) => f.key === key)?.maxLength ?? 300;
    if (s.length <= max) return s;
    report.truncated++;
    return s.slice(0, max - 1).trimEnd() + "…";
  };

  // Decks: one Lexi deck per top-level Anki deck (reusing a Lexi deck of the same name).
  const deckByName = new Map(ex.decks.map((d) => [d.name.trim().toLowerCase(), d]));
  const lexiDeck = new Map<string, Deck>();
  const deckFor = (ankiDid: string): { deck: Deck; tag: string | null } => {
    const path = (col.decks.get(ankiDid)?.name ?? "Anki").split("::").map((p) => p.trim()).filter(Boolean);
    const top = path[0] ?? "Anki";
    let deck = lexiDeck.get(top) ?? deckByName.get(top.toLowerCase());
    if (!deck) {
      deck = { id: `anki-${tagOf(top) || "deck"}`.slice(0, 60), name: top.slice(0, 60), createdAt: now, updatedAt: now };
      file.decks.push(deck);
    }
    lexiDeck.set(top, deck);
    const leaf = path.length > 1 ? tagOf(path[path.length - 1]) : null;
    return { deck, tag: leaf || null };
  };

  const existingIds = new Set(ex.notes.map((n) => n.id));
  const existingWords = new Set(ex.notes.map((n) => String(n.fields.word ?? "").trim().toLowerCase()));
  const cardsByNote = new Map<string, AnkiCard[]>();
  for (const c of col.cards) {
    const l = cardsByNote.get(c.nid) ?? [];
    l.push(c);
    cardsByNote.set(c.nid, l);
  }
  const logByCard = new Map<string, AnkiRevlog[]>();
  for (const r of col.revlog) {
    if (!graded(r)) continue;
    const l = logByCard.get(r.cid) ?? [];
    l.push(r);
    logByCard.set(r.cid, l);
  }
  const dailies = new Map<string, Daily>();
  const lessonSeen = new Set<string>();
  const dayStart = ex.prefs.dayStartHour;
  const todayEnd = (() => {
    const d = new Date(now - dayStart * 3_600_000);
    d.setHours(24 + dayStart, 0, 0, 0);
    return d.getTime();
  })();
  // New cards keep Anki's order (position = due of a new card) via createdAt, which the queue sorts by.
  const newOrder = (c: AnkiCard) => (c.type === 0 ? (c.odid !== "0" ? c.odue : c.due) : (c.data.pos ?? 0));

  const notes = col.notes.filter((n) => n.mid === nt.id).sort((a, b) => {
    const pa = Math.min(...(cardsByNote.get(a.id) ?? []).map(newOrder), Number.MAX_SAFE_INTEGER);
    const pb = Math.min(...(cardsByNote.get(b.id) ?? []).map(newOrder), Number.MAX_SAFE_INTEGER);
    return pa - pb || (a.id < b.id ? -1 : 1);
  });

  notes.forEach((an, order) => {
    const id = `anki-${an.id}`;
    const word = limit("word", htmlText(at(an.fields, "word")));
    if (!word) return void report.skippedEmpty++;
    if (existingIds.has(id)) return void report.skippedExisting++;
    if (existingWords.has(word.toLowerCase())) return void report.skippedDuplicates.push(word);
    existingWords.add(word.toLowerCase());

    const ankiCards = (cardsByNote.get(an.id) ?? []).sort((a, b) => a.ord - b.ord);
    const home = ankiCards[0] ? (ankiCards[0].odid !== "0" ? ankiCards[0].odid : ankiCards[0].did) : "";
    const { deck, tag } = deckFor(home);
    if (tag && !lessonSeen.has(tag)) (lessonSeen.add(tag), report.lessons.push(tag));

    const examples = htmlLines(at(an.fields, "examples")).map(unmark).map((s) => limit("examples", s)).slice(0, 8);
    const examplesVi = htmlLines(at(an.fields, "examplesVi")).map(unmark).map((s) => limit("examplesVi", s)).slice(0, 8);
    const fields: Note["fields"] = {
      word,
      ipa: limit("ipa", htmlText(at(an.fields, "ipa"))),
      pos: limit("pos", normalizePos(htmlText(at(an.fields, "pos")))),
      vi: limit("vi", htmlText(at(an.fields, "vi"))),
      en: limit("en", htmlLines(at(an.fields, "en")).join("\n")),
      mnemonic: limit("mnemonic", htmlLines(at(an.fields, "mnemonic")).join("\n")),
      ...(examples.length ? { examples } : {}),
      ...(examplesVi.length && examples.length ? { examplesVi: examplesVi.slice(0, examples.length) } : {}),
    };
    for (const k of Object.keys(fields)) if (fields[k] === "") delete fields[k];
    const tags = [...new Set([...(tag ? [tag] : []), "anki", ...an.tags.map(tagOf).filter(Boolean)])].slice(0, 10);
    const created = now + order; // keeps Anki's order among new notes and cards
    const note: Note = { id, type: "vocab", deckId: deck.id, fields, tags, createdAt: created, updatedAt: now };
    file.notes.push(note);
    report.notes++;

    const made = new Set<string>();
    for (const ac of ankiCards) {
      const template = plan.templates[ac.ord] ?? "";
      const tdef = def.templates.find((t) => t.id === template);
      if (!tdef || !tdef.applies(note) || made.has(template)) {
        report.droppedCards++;
        continue;
      }
      made.add(template);
      const cid = cardId(id, template);
      const state = lexiState(ac);
      const log = logByCard.get(ac.id) ?? [];
      const memory = log.length ? replay(log, ex.prefs.desiredRetention) : [];
      let stability: number;
      let difficulty: number;
      if (ac.data.s !== undefined && ac.data.d !== undefined) {
        stability = ac.data.s;
        difficulty = ac.data.d;
      } else if (memory.length) {
        ({ stability, difficulty } = memory[memory.length - 1]);
      } else if (state !== CardState.New) {
        ({ stability, difficulty } = memoryFromSm2(ac.ivl, ac.factor));
      } else {
        const e = createEmptyCard(new Date(now));
        stability = e.stability;
        difficulty = e.difficulty;
      }
      const dueRaw = ac.odid !== "0" && ac.odue ? ac.odue : ac.due;
      const byDay = state === CardState.Review || ac.queue === 3 || (state === CardState.Relearning && dueRaw < 1_000_000);
      const due = state === CardState.New ? now : byDay ? (col.crt + dueRaw * 86_400) * 1000 : dueRaw * 1000;
      const lastLog = log[log.length - 1];
      const lastReview = ac.data.lrt !== undefined ? ac.data.lrt * 1000 : lastLog?.id ?? (state === CardState.Review ? due - ac.ivl * DAY_MS : undefined);
      const card: Card = {
        id: cid, noteId: id, deckId: deck.id, template, state, due,
        stability: clamp(stability, 0, 100000),
        difficulty: clamp(difficulty, 1, 10),
        scheduledDays: state === CardState.Review ? Math.max(0, ac.ivl) : 0,
        learningSteps: 0,
        reps: Math.max(0, ac.reps),
        lapses: Math.max(0, ac.lapses),
        ...(state !== CardState.New && lastReview !== undefined ? { lastReview: Math.round(lastReview) } : {}),
        ...(ac.queue === -1 ? { suspended: true } : {}),
        createdAt: created,
        updatedAt: now,
      };
      file.cards.push(card);
      report.cards++;
      if (state !== CardState.New) report.studied++;
      if (card.suspended) report.suspended++;
      if (state === CardState.Review && !card.suspended && due < todayEnd) report.dueToday++;

      log.forEach((r, i) => {
        const before: CardState = i === 0 ? CardState.New : r.type === 1 || r.type === 3 ? CardState.Review : r.type === 2 ? CardState.Relearning : CardState.Learning;
        const m = memory[i];
        const entry: ReviewLog = {
          id: reviewId(cid, r.id), cardId: cid, noteId: id, deckId: deck.id, rating: r.ease as Rating, state: before,
          stability: m.stability,
          difficulty: m.difficulty,
          scheduledDays: r.ivl > 0 ? r.ivl : 0,
          reviewedAt: r.id,
          durationMs: clamp(Math.round(r.time), 0, 3_600_000),
          device: "anki",
        };
        file.reviews.push(entry);
        report.reviews++;
        const day = dayId(r.id, dayStart);
        const d = dailies.get(day) ?? emptyDaily(day);
        if (before === CardState.New) d.newCards++;
        else d.reviews++;
        d[RATING_FIELD[r.ease as Rating]]++;
        d.ms += entry.durationMs;
        dailies.set(day, d);
      });
    }
    // Lexi templates the learner uses that Anki had no card for start as new cards.
    for (const t of wantedTemplates(note, ex.prefs.templates)) {
      if (made.has(t)) continue;
      const e = createEmptyCard(new Date(now));
      file.cards.push({
        id: cardId(id, t), noteId: id, deckId: deck.id, template: t, state: CardState.New, due: now,
        stability: e.stability, difficulty: e.difficulty, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0,
        createdAt: created, updatedAt: now,
      });
      report.cards++;
    }
  });

  // Imported days add to the days already counted in Lexi.
  const have = new Map(ex.daily.map((d) => [d.id, d]));
  for (const d of dailies.values()) {
    const old = have.get(d.id);
    file.daily.push(old ? { ...d, newCards: d.newCards + old.newCards, reviews: d.reviews + old.reviews, again: d.again + old.again, hard: d.hard + old.hard, good: d.good + old.good, easy: d.easy + old.easy, ms: d.ms + old.ms, updatedAt: now } : { ...d, updatedAt: now });
  }
  file.daily.sort((a, b) => (a.id < b.id ? -1 : 1));
  report.writes = file.decks.length + file.notes.length + file.cards.length + file.reviews.length + file.daily.length;
  return { file, report };
}
