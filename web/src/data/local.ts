/**
 * IndexedDB repo: used when Firebase is not configured (local-only mode) and by the tests.
 * Data is held in memory and written through, so reads are synchronous and writes survive reloads.
 */
import { RATING_FIELD, type Card, type Daily, type DailyDelta, type Deck, type Note, type Prefs, type ReviewLog } from "@shared/model.ts";
import type { ExportFile, Repo, RepoEvents, Snapshot } from "./repo.ts";

const STORES = ["decks", "notes", "cards", "reviews", "daily", "kv"] as const;
type StoreName = (typeof STORES)[number];

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export function applyDelta(prev: Daily | undefined, d: DailyDelta, sign: 1 | -1, now: number): Daily {
  const base: Daily = prev ?? { id: d.id, newCards: 0, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, ms: 0, updatedAt: now };
  const f = RATING_FIELD[d.rating];
  return {
    ...base,
    newCards: Math.max(0, base.newCards + sign * d.newCards),
    reviews: Math.max(0, base.reviews + sign * d.reviews),
    [f]: Math.max(0, base[f] + sign),
    ms: Math.max(0, base.ms + sign * d.ms),
    updatedAt: now,
  };
}

export class LocalRepo implements Repo {
  readonly kind = "local" as const;
  private db!: IDBDatabase;
  private ev!: RepoEvents;
  private decks = new Map<string, Deck>();
  private notes = new Map<string, Note>();
  private cards = new Map<string, Card>();
  private reviews = new Map<string, ReviewLog>();
  private daily = new Map<string, Daily>();
  private prefs: Prefs | null = null;

  constructor(private readonly dbName = "vhub-lexi") {}

  async start(ev: RepoEvents): Promise<void> {
    this.ev = ev;
    this.db = await open(this.dbName);
    const all = <T>(s: StoreName) =>
      new Promise<T[]>((resolve, reject) => {
        const r = this.db.transaction(s).objectStore(s).getAll();
        r.onsuccess = () => resolve(r.result as T[]);
        r.onerror = () => reject(r.error);
      });
    for (const d of await all<Deck>("decks")) this.decks.set(d.id, d);
    for (const n of await all<Note>("notes")) this.notes.set(n.id, n);
    for (const c of await all<Card>("cards")) this.cards.set(c.id, c);
    for (const r of await all<ReviewLog>("reviews")) this.reviews.set(r.id, r);
    for (const d of await all<Daily>("daily")) this.daily.set(d.id, d);
    this.prefs = ((await all<{ id: string; value: Prefs }>("kv")).find((k) => k.id === "prefs")?.value) ?? null;
    this.emit();
    ev.sync("local");
  }

  stop() {
    this.db?.close();
  }

  private emit(only?: Array<keyof Snapshot>) {
    const snap: Snapshot = {
      decks: [...this.decks.values()],
      notes: [...this.notes.values()],
      cards: [...this.cards.values()],
      daily: [...this.daily.values()],
      prefs: this.prefs,
    };
    if (!only) this.ev.data(snap);
    else this.ev.data(Object.fromEntries(only.map((k) => [k, snap[k]])) as Partial<Snapshot>);
  }

  private async write(ops: Array<{ store: StoreName; put?: object; del?: string }>) {
    const tx = this.db.transaction([...new Set(ops.map((o) => o.store))], "readwrite");
    for (const o of ops) {
      const s = tx.objectStore(o.store);
      if (o.put) s.put(o.put);
      if (o.del !== undefined) s.delete(o.del);
    }
    await done(tx);
  }

  async saveDeck(d: Deck) {
    this.decks.set(d.id, d);
    await this.write([{ store: "decks", put: d }]);
    this.emit(["decks"]);
  }

  async deleteDeck(id: string) {
    this.decks.delete(id);
    await this.write([{ store: "decks", del: id }]);
    this.emit(["decks"]);
  }

  async saveNote(note: Note, newCards: Card[]) {
    this.notes.set(note.id, note);
    for (const c of newCards) this.cards.set(c.id, c);
    await this.write([{ store: "notes", put: note }, ...newCards.map((c) => ({ store: "cards" as const, put: c }))]);
    this.emit(["notes", "cards"]);
  }

  async deleteNote(noteId: string, cardIds: string[]) {
    this.notes.delete(noteId);
    for (const id of cardIds) this.cards.delete(id);
    await this.write([{ store: "notes", del: noteId }, ...cardIds.map((id) => ({ store: "cards" as const, del: id }))]);
    this.emit(["notes", "cards"]);
  }

  async saveCard(c: Card) {
    this.cards.set(c.id, c);
    await this.write([{ store: "cards", put: c }]);
    this.emit(["cards"]);
  }

  async deleteCards(ids: string[]) {
    for (const id of ids) this.cards.delete(id);
    await this.write(ids.map((id) => ({ store: "cards" as const, del: id })));
    this.emit(["cards"]);
  }

  async commitReview(card: Card, log: ReviewLog, delta: DailyDelta) {
    const day = applyDelta(this.daily.get(delta.id), delta, 1, card.updatedAt);
    this.cards.set(card.id, card);
    this.reviews.set(log.id, log);
    this.daily.set(day.id, day);
    await this.write([
      { store: "cards", put: card },
      { store: "reviews", put: log },
      { store: "daily", put: day },
    ]);
    this.emit(["cards", "daily"]);
  }

  async undoReview(prev: Card, logId: string, delta: DailyDelta) {
    const day = applyDelta(this.daily.get(delta.id), delta, -1, Date.now());
    this.cards.set(prev.id, prev);
    this.reviews.delete(logId);
    this.daily.set(day.id, day);
    await this.write([
      { store: "cards", put: prev },
      { store: "reviews", del: logId },
      { store: "daily", put: day },
    ]);
    this.emit(["cards", "daily"]);
  }

  async savePrefs(p: Prefs) {
    this.prefs = p;
    await this.write([{ store: "kv", put: { id: "prefs", value: p } }]);
    this.emit(["prefs"]);
  }

  async allReviews() {
    return [...this.reviews.values()];
  }

  async reviewsOfNote(noteId: string) {
    return [...this.reviews.values()].filter((r) => r.noteId === noteId).sort((a, b) => a.reviewedAt - b.reviewedAt);
  }

  async exportAll(): Promise<ExportFile> {
    return {
      app: "vhub-lexi",
      version: 1,
      exportedAt: Date.now(),
      decks: [...this.decks.values()],
      notes: [...this.notes.values()],
      cards: [...this.cards.values()],
      reviews: [...this.reviews.values()],
      daily: [...this.daily.values()],
      prefs: this.prefs,
    };
  }

  async importAll(f: ExportFile) {
    const ops: Array<{ store: StoreName; put: object }> = [];
    for (const d of f.decks) (this.decks.set(d.id, d), ops.push({ store: "decks", put: d }));
    for (const n of f.notes) (this.notes.set(n.id, n), ops.push({ store: "notes", put: n }));
    for (const c of f.cards) (this.cards.set(c.id, c), ops.push({ store: "cards", put: c }));
    for (const r of f.reviews ?? []) (this.reviews.set(r.id, r), ops.push({ store: "reviews", put: r }));
    for (const d of f.daily ?? []) (this.daily.set(d.id, d), ops.push({ store: "daily", put: d }));
    if (f.prefs) {
      this.prefs = f.prefs;
      ops.push({ store: "kv", put: { id: "prefs", value: f.prefs } });
    }
    await this.write(ops);
    this.emit();
    return { notes: f.notes.length, cards: f.cards.length };
  }
}
