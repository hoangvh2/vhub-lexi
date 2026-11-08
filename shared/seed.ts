/**
 * Built-in study material the app loads into a learner's account by itself ("seed packs"): today the TOEIC grammar
 * traps in shared/seed/grammar-toeic.txt, compiled to grammar-toeic.json by tools/seed/build.ts.
 *
 * Loading is a one-way, add-only migration, safe to run on every start and on every device:
 *  - Every document has a fixed id (`seed-gt-<slug>`, its cards `<note id>.<template>`), so two devices that load the
 *    same pack write the same documents instead of duplicates. Timestamps are fixed too, so those writes are identical.
 *  - A note, card or deck that already exists ON THE SERVER is never written again: edits, review progress and
 *    suspensions stay as the learner left them. The app asks the server (not its cache) before writing.
 *  - Once a pack version is loaded, `settings/seeds` records it, so a note the learner deleted does not come back.
 *    A later version only adds the notes marked `since` that version.
 * Both apps share this plan (Kotlin port: android/core/.../Seed.kt, pinned by shared/vectors/seed.json).
 */
import type { Deck, FieldValue, Id, Note } from "./model.ts";
import { list, noteType, normalizeAnswer, parsePatternItem, str, wantedTemplates } from "./notetypes.ts";

export interface SeedNote {
  id: Id;
  /** Pack version that introduced this note. */
  since: number;
  type: string;
  fields: Record<string, FieldValue>;
  tags: string[];
}

export interface SeedPack {
  id: string;
  version: number;
  /** Every note id starts with it (and so does every card id): the server is asked for this id range only. */
  prefix: string;
  deck: { id: Id; name: string };
  /** Fixed creation time of the pack's documents; note i is created at createdAt + i (keeps the pack's order). */
  createdAt: number;
  notes: SeedNote[];
}

/** What the server holds of a pack: the version already loaded (0 = never) and the pack's documents still there. */
export interface SeedState {
  applied: number;
  noteIds: ReadonlySet<Id>;
  deckExists: boolean;
}

export interface SeedPlan {
  deck: Deck | null;
  notes: Note[];
  /** Version to record once the writes are sent. */
  version: number;
}

/** Ids of the pack's documents lie in [start, end): "seed-gt-" … "seed-gt." ('.' sorts right after '-'). */
export function seedIdRange(prefix: string): [string, string] {
  const last = prefix.charCodeAt(prefix.length - 1);
  return [prefix, prefix.slice(0, -1) + String.fromCharCode(last + 1)];
}

/** The documents to write for `pack` given what the server already has; null when this version is already loaded. */
export function planSeed(pack: SeedPack, state: SeedState): SeedPlan | null {
  if (state.applied >= pack.version) return null;
  const notes: Note[] = [];
  pack.notes.forEach((s, i) => {
    if (s.since <= state.applied || state.noteIds.has(s.id)) return;
    const at = pack.createdAt + i;
    notes.push({ id: s.id, type: s.type, deckId: pack.deck.id, fields: s.fields, ...(s.tags.length ? { tags: s.tags } : {}), createdAt: at, updatedAt: at });
  });
  const deck: Deck | null = notes.length && !state.deckExists ? { id: pack.deck.id, name: pack.deck.name, createdAt: pack.createdAt, updatedAt: pack.createdAt } : null;
  return { deck, notes, version: pack.version };
}

/** Name of the settings document that records loaded pack versions ({ [pack id]: version, updatedAt }). */
export const SEEDS_DOC = "seeds";

// ------------------------------------------------------------------ the text format (tools/seed/build.ts)

/** ASCII slug of a Vietnamese label: "Liên từ & giới từ" -> "lien-tu-gioi-tu". */
export function slugVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SINGLE = ["title", "ask", "signals", "rule", "formula", "tip"] as const;

/**
 * Parses the pack text: `@pack/@version/@deck` headers, then one block per pattern:
 *   == <slug> | <Topic>            (since: <n> optional, default 1)
 *   title: … / ask: … / signals: … / rule: … / formula: … / tip: …
 *   why: …                          (repeatable)
 *   - sentence with [answer] | wrong / wrong | meaning   (repeatable)
 * Lines starting with // are comments. Throws with the line number on anything it does not understand.
 */
export function parseSeedText(text: string, opts: { prefix: string; deckId: Id; createdAt: number }): SeedPack {
  let id = "";
  let version = 0;
  let deckName = "";
  const notes: SeedNote[] = [];
  let cur: { slug: string; topic: string; since: number; one: Record<string, string>; why: string[]; items: string[]; line: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const fields: Record<string, FieldValue> = { topic: cur.topic };
    for (const k of SINGLE) if (cur.one[k]) fields[k] = cur.one[k];
    fields.items = cur.items;
    if (cur.why.length) fields.why = cur.why;
    notes.push({ id: opts.prefix + cur.slug, since: cur.since, type: "pattern", fields, tags: ["ngu-phap-toeic", `np-${slugVi(cur.topic)}`] });
    cur = null;
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const where = `line ${i + 1}`;
    if (!line || line.startsWith("//")) return;
    if (line.startsWith("@")) {
      const [k, ...rest] = line.slice(1).split(/\s+/);
      const v = rest.join(" ");
      if (k === "pack") id = v;
      else if (k === "version") version = Number(v);
      else if (k === "deck") deckName = v;
      else throw new Error(`${where}: unknown header @${k}`);
      return;
    }
    if (line.startsWith("==")) {
      flush();
      const [slug, topic] = line.slice(2).split("|").map((x) => x.trim());
      if (!slug || !/^[a-z0-9-]+$/.test(slug) || !topic) throw new Error(`${where}: expected "== slug | Topic"`);
      cur = { slug, topic, since: 1, one: {}, why: [], items: [], line: i + 1 };
      return;
    }
    if (!cur) throw new Error(`${where}: text outside a pattern block`);
    if (line.startsWith("- ")) {
      cur.items.push(line.slice(2).trim());
      return;
    }
    const m = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`${where}: cannot read "${line.slice(0, 40)}"`);
    const [, key, value] = m;
    if (key === "why") cur.why.push(value);
    else if (key === "since") cur.since = Number(value);
    else if ((SINGLE as readonly string[]).includes(key)) {
      if (cur.one[key]) throw new Error(`${where}: ${key} given twice`);
      cur.one[key] = value;
    } else throw new Error(`${where}: unknown field ${key}`);
  });
  flush();
  if (!id || !Number.isInteger(version) || version < 1 || !deckName) throw new Error("missing @pack, @version or @deck");
  return { id, version, prefix: opts.prefix, deck: { id: opts.deckId, name: deckName }, createdAt: opts.createdAt, notes };
}

/** Limits of note fields and documents the app and the Firestore rules enforce (see firestore.rules.tmpl). */
const MAX_LIST = 8;
const MAX_TAGS = 10;

/**
 * Everything wrong with a pack, as readable lines (empty = fine): fields over their length limits, lists over 8 lines,
 * sentences without exactly one [answer], a wrong option equal to the answer, duplicate ids or sentences, a note that
 * would make no card. tools/seed/build.ts refuses to write a pack with problems, and a test re-checks the JSON.
 */
export function seedProblems(pack: SeedPack): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const sentences = new Map<string, string>();
  if (!/^[A-Za-z0-9_.@-]{1,60}$/.test(pack.deck.id)) out.push(`deck id ${pack.deck.id} is not a valid document id`);
  for (const n of pack.notes) {
    const at = n.id;
    if (ids.has(n.id)) out.push(`${at}: duplicate id`);
    ids.add(n.id);
    if (!n.id.startsWith(pack.prefix) || !/^[A-Za-z0-9_.@-]{1,70}$/.test(n.id)) out.push(`${at}: id must start with ${pack.prefix} and use only letters, digits, - _ . @`);
    if (!Number.isInteger(n.since) || n.since < 1 || n.since > pack.version) out.push(`${at}: since must be 1..${pack.version}`);
    if (n.tags.length > MAX_TAGS) out.push(`${at}: more than ${MAX_TAGS} tags`);
    const def = noteType(n.type);
    if (!def) {
      out.push(`${at}: unknown note type ${n.type}`);
      continue;
    }
    for (const k of Object.keys(n.fields)) if (!def.fields.some((f) => f.key === k)) out.push(`${at}: unknown field ${k}`);
    for (const f of def.fields) {
      const v = n.fields[f.key];
      if (f.kind === "list") {
        const l = Array.isArray(v) ? v : [];
        if (f.required && !l.length) out.push(`${at}: ${f.key} is required`);
        if (l.length > MAX_LIST) out.push(`${at}: ${f.key} has ${l.length} lines (max ${MAX_LIST})`);
        for (const line of l) if (line.length > f.maxLength) out.push(`${at}: a ${f.key} line is ${line.length} chars (max ${f.maxLength}): ${line.slice(0, 50)}`);
      } else {
        const t = typeof v === "string" ? v : "";
        if (v !== undefined && typeof v !== "string") out.push(`${at}: ${f.key} must be text`);
        if (f.required && !t.trim()) out.push(`${at}: ${f.key} is required`);
        if (t.length > f.maxLength) out.push(`${at}: ${f.key} is ${t.length} chars (max ${f.maxLength})`);
      }
    }
    if (n.type === "pattern") {
      const lines = list(n.fields.items);
      if (lines.length < 3) out.push(`${at}: needs at least 3 sentences`);
      for (const line of lines) {
        const it = parsePatternItem(line);
        if (!it) {
          out.push(`${at}: cannot read sentence (needs exactly one [answer]): ${line.slice(0, 60)}`);
          continue;
        }
        const written = (line.split("|")[1] ?? "").split("/").map((w) => w.trim()).filter(Boolean);
        if (written.length !== it.wrong.length) out.push(`${at}: a wrong option repeats the answer or another option: ${line.slice(0, 60)}`);
        if (it.wrong.length < 2) out.push(`${at}: give at least 2 wrong options: ${line.slice(0, 60)}`);
        if (!it.vi) out.push(`${at}: missing Vietnamese meaning: ${line.slice(0, 60)}`);
        if (/\[|\]/.test(it.sentence)) out.push(`${at}: stray bracket: ${line.slice(0, 60)}`);
        const key = normalizeAnswer(it.sentence);
        if (sentences.has(key)) out.push(`${at}: same sentence as ${sentences.get(key)}: ${it.sentence}`);
        sentences.set(key, at);
      }
      if (!str(n.fields.ask)) out.push(`${at}: ask is needed for the rule card`);
    }
    const probe: Note = { id: n.id, type: n.type, deckId: pack.deck.id, fields: n.fields, createdAt: 0, updatedAt: 0 };
    if (!wantedTemplates(probe, undefined).length) out.push(`${at}: makes no card`);
  }
  return out;
}
