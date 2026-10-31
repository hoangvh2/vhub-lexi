/**
 * Reads an Anki package (.apkg / .colpkg) into plain objects. Text and scheduling only: media files are
 * not read (Lexi has no media storage; audio comes from the device's TTS).
 *
 * Package layout (Anki rslib/src/import_export/package):
 *   collection.anki21b  SQLite, zstd-compressed     (Anki 2.1.50+ "modern" export)
 *   collection.anki21   SQLite                       (legacy export, schema 11)
 *   collection.anki2    SQLite; in modern packages only a stub telling old clients to update
 *
 * SQLite is read with sql.js (WebAssembly embedded in one JS chunk, so the page's CSP allows
 * 'wasm-unsafe-eval'). The chunk is about 1 MB and only loaded when the learner imports a file.
 */
import { unzipSync } from "fflate";
import { decompress } from "fzstd";
import type { Database, SqlValue } from "sql.js";

export interface AnkiField {
  ord: number;
  name: string;
}

export interface AnkiNotetype {
  id: string;
  name: string;
  fields: AnkiField[];
  templates: AnkiField[];
}

export interface AnkiDeck {
  id: string;
  /** Full path, levels joined with "::" (e.g. "600 Essential::Lesson 01"). */
  name: string;
  /** Filtered (dynamic) deck. */
  filtered: boolean;
}

export interface AnkiNote {
  id: string;
  guid: string;
  mid: string;
  tags: string[];
  fields: string[];
}

export interface AnkiCard {
  id: string;
  nid: string;
  did: string;
  /** Home deck when the card sits in a filtered deck, else "0". */
  odid: string;
  ord: number;
  /** 0 new, 1 learning, 2 review, 3 relearning. */
  type: number;
  /** -3 / -2 buried, -1 suspended, 0 new, 1 learning, 2 review, 3 day-learning, 4 preview. */
  queue: number;
  due: number;
  odue: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  /** cards.data: FSRS memory state (`s`, `d`) when FSRS was on, `pos` = original new position, `lrt` = last review (epoch s). */
  data: { s?: number; d?: number; pos?: number; lrt?: number };
}

export interface AnkiRevlog {
  /** Epoch ms of the answer (the row id). */
  id: number;
  cid: string;
  /** 1-4; 0 = manual reschedule. */
  ease: number;
  /** Interval after the answer: days if > 0, -seconds if < 0. */
  ivl: number;
  lastIvl: number;
  factor: number;
  /** Answer time in ms. */
  time: number;
  /** 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual, 5 rescheduled. */
  type: number;
}

export interface AnkiCollection {
  /** Collection creation time, epoch seconds, at the day rollover; review due dates count days from it. */
  crt: number;
  notetypes: Map<string, AnkiNotetype>;
  decks: Map<string, AnkiDeck>;
  notes: AnkiNote[];
  cards: AnkiCard[];
  revlog: AnkiRevlog[];
}

export class AnkiFormatError extends Error {}

type SqlJs = { Database: new (data?: Uint8Array) => Database };
let sqlJs: Promise<SqlJs> | null = null;
function loadSqlJs(): Promise<SqlJs> {
  sqlJs ??= import("sql.js/dist/sql-wasm-inline.js").then((m) => m.default() as Promise<SqlJs>);
  return sqlJs;
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((x, i) => b[i] === x);

/** Picks the newest collection file in the package and returns it as SQLite bytes. */
export function collectionBytes(apkg: Uint8Array): Uint8Array {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(apkg, { filter: (f) => f.name.startsWith("collection.anki") });
  } catch {
    throw new AnkiFormatError("File không phải gói Anki (.apkg)");
  }
  const b = files["collection.anki21b"] ?? files["collection.anki21"] ?? files["collection.anki2"];
  if (!b) throw new AnkiFormatError("Gói Anki không có collection");
  return isZstd(b) ? decompress(b) : b;
}

function rows(db: Database, sql: string): SqlValue[][] {
  const r = db.exec(sql);
  return r[0]?.values ?? [];
}
const hasTable = (db: Database, name: string) => rows(db, `select 1 from sqlite_master where type='table' and name='${name}'`).length > 0;
const s = (v: SqlValue) => (v === null ? "" : typeof v === "string" ? v : v instanceof Uint8Array ? new TextDecoder().decode(v) : String(v));
const n = (v: SqlValue) => (typeof v === "number" ? v : Number(s(v)) || 0);
function json<T>(v: SqlValue, fallback: T): T {
  try {
    const t = s(v);
    return t ? (JSON.parse(t) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function readApkg(apkg: Uint8Array): Promise<AnkiCollection> {
  const bytes = collectionBytes(apkg);
  const SQL = await loadSqlJs();
  let db: Database;
  try {
    db = withoutUnicase(SQL, new SQL.Database(bytes));
    rows(db, "select 1 from col");
  } catch {
    throw new AnkiFormatError("Không đọc được dữ liệu trong gói Anki");
  }
  try {
    return readDb(db);
  } finally {
    db.close();
  }
}

/**
 * Modern collections declare name columns `COLLATE unicase`, a collation Anki registers in Rust. SQLite
 * refuses to read those tables without it ("no query solution") and sql.js cannot register collations,
 * so the schema text is rewritten to the default collation and the database reopened. Safe for reading:
 * nothing here searches or sorts by those columns.
 */
function withoutUnicase(SQL: SqlJs, db: Database): Database {
  if (rows(db, "select 1 from sqlite_master where sql like '%unicase%'").length === 0) return db;
  db.exec("PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql = replace(sql, 'COLLATE unicase', '') WHERE sql LIKE '%unicase%'; PRAGMA writable_schema=OFF;");
  const fixed = new SQL.Database(db.export());
  db.close();
  return fixed;
}

function readDb(db: Database): AnkiCollection {
  const [col] = rows(db, "select crt, models, decks from col");
  if (!col) throw new AnkiFormatError("Gói Anki rỗng");
  const crt = n(col[0]);
  const notetypes = new Map<string, AnkiNotetype>();
  const decks = new Map<string, AnkiDeck>();

  if (hasTable(db, "notetypes")) {
    // Schema 18 (modern): one table per kind; ids cast to text because they exceed 2^53 in theory.
    for (const [id, name] of rows(db, "select cast(id as text), name from notetypes")) {
      notetypes.set(s(id), { id: s(id), name: s(name), fields: [], templates: [] });
    }
    // Rows of deleted note types can remain; they are ignored.
    for (const [ntid, ord, name] of rows(db, "select cast(ntid as text), ord, name from fields")) {
      notetypes.get(s(ntid))?.fields.push({ ord: n(ord), name: s(name) });
    }
    for (const [ntid, ord, name] of rows(db, "select cast(ntid as text), ord, name from templates")) {
      notetypes.get(s(ntid))?.templates.push({ ord: n(ord), name: s(name) });
    }
    for (const m of notetypes.values()) {
      m.fields.sort((a, b) => a.ord - b.ord);
      m.templates.sort((a, b) => a.ord - b.ord);
    }
    // Deck kind is a protobuf blob; filtered decks are told apart by their (unused) home-deck ids instead.
    const filteredIds = new Set(rows(db, "select distinct cast(did as text) from cards where odid != 0").map((r) => s(r[0])));
    for (const [id, name] of rows(db, "select cast(id as text), name from decks")) {
      decks.set(s(id), { id: s(id), name: s(name).split("\x1f").join("::"), filtered: filteredIds.has(s(id)) });
    }
  } else {
    type LegacyModel = { id: number | string; name: string; flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number }[] };
    for (const m of Object.values(json<Record<string, LegacyModel>>(col[1], {}))) {
      notetypes.set(String(m.id), {
        id: String(m.id),
        name: m.name,
        fields: (m.flds ?? []).map((f) => ({ ord: f.ord, name: f.name })).sort((a, b) => a.ord - b.ord),
        templates: (m.tmpls ?? []).map((t) => ({ ord: t.ord, name: t.name })).sort((a, b) => a.ord - b.ord),
      });
    }
    type LegacyDeck = { id: number | string; name: string; dyn?: number };
    for (const d of Object.values(json<Record<string, LegacyDeck>>(col[2], {}))) {
      decks.set(String(d.id), { id: String(d.id), name: d.name, filtered: !!d.dyn });
    }
  }

  const notes: AnkiNote[] = rows(db, "select cast(id as text), guid, cast(mid as text), tags, flds from notes").map((r) => ({
    id: s(r[0]),
    guid: s(r[1]),
    mid: s(r[2]),
    tags: s(r[3]).split(/\s+/).filter(Boolean),
    fields: s(r[4]).split("\x1f"),
  }));
  const cards: AnkiCard[] = rows(
    db,
    "select cast(id as text), cast(nid as text), cast(did as text), cast(odid as text), ord, type, queue, due, odue, ivl, factor, reps, lapses, data from cards",
  ).map((r) => ({
    id: s(r[0]),
    nid: s(r[1]),
    did: s(r[2]),
    odid: s(r[3]),
    ord: n(r[4]),
    type: n(r[5]),
    queue: n(r[6]),
    due: n(r[7]),
    odue: n(r[8]),
    ivl: n(r[9]),
    factor: n(r[10]),
    reps: n(r[11]),
    lapses: n(r[12]),
    data: json<AnkiCard["data"]>(r[13], {}),
  }));
  const revlog: AnkiRevlog[] = rows(db, "select id, cast(cid as text), ease, ivl, lastIvl, factor, time, type from revlog order by id").map((r) => ({
    id: n(r[0]),
    cid: s(r[1]),
    ease: n(r[2]),
    ivl: n(r[3]),
    lastIvl: n(r[4]),
    factor: n(r[5]),
    time: n(r[6]),
    type: n(r[7]),
  }));
  return { crt, notetypes, decks, notes, cards, revlog };
}
