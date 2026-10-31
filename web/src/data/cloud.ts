/**
 * Firestore repo. Layout under users/{uid}: decks, notes, cards, reviews, daily, settings/prefs.
 *
 * Offline: Firestore's persistent cache keeps everything on the device. Writes are applied to the
 * cache immediately (listeners fire with hasPendingWrites) and sent when the network is back, so
 * we never await `commit()`: offline it would not resolve until the server acknowledges.
 */
import {
  collection, deleteDoc, doc, getDocs, increment, limit, onSnapshot, orderBy, query, setDoc, where, writeBatch,
  type DocumentData, type Firestore, type Query, type QuerySnapshot, type WriteBatch,
} from "firebase/firestore";
import { RATING_FIELD, type Card, type Daily, type DailyDelta, type Deck, type Note, type Prefs, type ReviewLog } from "@shared/model.ts";
import { firebase } from "./fbimpl.ts";
import type { ExportFile, Repo, RepoEvents, SyncState } from "./repo.ts";

export const LIMITS = { decks: 200, notes: 5000, cards: 10000, daily: 800, reviews: 20000 } as const;

export class CloudRepo implements Repo {
  readonly kind = "cloud" as const;
  private ev!: RepoEvents;
  private unsubs: Array<() => void> = [];
  private readonly db: Firestore;
  private pending = false;
  private denied = false;
  private failed = false;
  /** A failure stays visible for a while even though the rolled-back snapshot that follows looks healthy. */
  private errorUntil = 0;

  constructor(
    private readonly uid: string,
    db?: Firestore,
  ) {
    this.db = db ?? firebase().db;
  }

  private col(name: string) {
    return collection(this.db, "users", this.uid, name);
  }
  private ref(name: string, id: string) {
    return doc(this.db, "users", this.uid, name, id);
  }

  private publish() {
    let s: SyncState = "synced";
    if (this.denied) s = "denied";
    else if (this.failed || Date.now() < this.errorUntil) s = "error";
    else if (this.pending) s = typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "pending";
    this.ev.sync(s);
  }

  private fail(e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "permission-denied") this.denied = true;
    else this.failed = true;
    this.errorUntil = Date.now() + 15_000;
    this.ev.warn?.(code === "permission-denied" ? "Máy chủ từ chối thay đổi này (không đủ quyền hoặc dữ liệu không hợp lệ)." : "Không đồng bộ được thay đổi vừa rồi.", e);
    this.publish();
    setTimeout(() => this.publish(), 15_100);
  }

  async start(ev: RepoEvents): Promise<void> {
    this.ev = ev;
    ev.sync("loading");
    const watch = <T>(name: string, q: Query<DocumentData>, apply: (items: T[]) => void, meta = false) => {
      this.unsubs.push(
        onSnapshot(
          q,
          { includeMetadataChanges: meta },
          (snap: QuerySnapshot<DocumentData>) => {
            apply(snap.docs.map((d) => d.data() as T));
            if (meta) {
              this.pending = snap.metadata.hasPendingWrites;
              if (!snap.metadata.fromCache) {
                this.failed = false;
              }
              this.publish();
            }
          },
          (e) => this.fail(e),
        ),
      );
    };
    watch<Deck>("decks", query(this.col("decks"), limit(LIMITS.decks)), (decks) => ev.data({ decks }));
    watch<Note>("notes", query(this.col("notes"), limit(LIMITS.notes)), (notes) => ev.data({ notes }));
    watch<Card>("cards", query(this.col("cards"), limit(LIMITS.cards)), (cards) => ev.data({ cards }), true);
    watch<Daily>("daily", query(this.col("daily"), orderBy("id", "desc"), limit(LIMITS.daily)), (daily) => ev.data({ daily }));
    this.unsubs.push(
      onSnapshot(
        this.ref("settings", "prefs"),
        (d) => ev.data({ prefs: d.exists() ? (d.data() as Prefs) : null }),
        (e) => this.fail(e),
      ),
    );
  }

  stop() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  private send(b: WriteBatch) {
    b.commit().catch((e) => this.fail(e));
  }

  async saveDeck(d: Deck) {
    void setDoc(this.ref("decks", d.id), d).catch((e) => this.fail(e));
  }

  async deleteDeck(id: string) {
    void deleteDoc(this.ref("decks", id)).catch((e) => this.fail(e));
  }

  async saveNote(note: Note, newCards: Card[]) {
    const b = writeBatch(this.db);
    b.set(this.ref("notes", note.id), note);
    for (const c of newCards) b.set(this.ref("cards", c.id), c);
    this.send(b);
  }

  async deleteNote(noteId: string, cardIds: string[]) {
    const b = writeBatch(this.db);
    b.delete(this.ref("notes", noteId));
    for (const id of cardIds) b.delete(this.ref("cards", id));
    this.send(b);
  }

  async saveCard(c: Card) {
    void setDoc(this.ref("cards", c.id), c).catch((e) => this.fail(e));
  }

  async deleteCards(ids: string[]) {
    for (let i = 0; i < ids.length; i += 400) {
      const b = writeBatch(this.db);
      for (const id of ids.slice(i, i + 400)) b.delete(this.ref("cards", id));
      this.send(b);
    }
  }

  private dailyWrite(b: WriteBatch, d: DailyDelta, sign: 1 | -1, now: number) {
    // `-1 * 0` is -0, which Firestore stores as a double and the rules (is int) would reject.
    const inc = (n: number) => increment(n === 0 ? 0 : n);
    b.set(
      this.ref("daily", d.id),
      {
        id: d.id,
        newCards: inc(sign * d.newCards),
        reviews: inc(sign * d.reviews),
        [RATING_FIELD[d.rating]]: inc(sign),
        ms: inc(sign * d.ms),
        updatedAt: now,
      },
      { merge: true },
    );
  }

  async commitReview(card: Card, log: ReviewLog, delta: DailyDelta) {
    const b = writeBatch(this.db);
    b.set(this.ref("cards", card.id), card);
    b.set(this.ref("reviews", log.id), log);
    this.dailyWrite(b, delta, 1, card.updatedAt);
    this.send(b);
  }

  async undoReview(prev: Card, logId: string, delta: DailyDelta) {
    const b = writeBatch(this.db);
    b.set(this.ref("cards", prev.id), prev);
    b.delete(this.ref("reviews", logId));
    this.dailyWrite(b, delta, -1, Date.now());
    this.send(b);
  }

  async savePrefs(p: Prefs) {
    void setDoc(this.ref("settings", "prefs"), p).catch((e) => this.fail(e));
  }

  async reviewsOfNote(noteId: string) {
    // Equality on one field: served by Firestore's automatic index, and from the cache when offline.
    const snap = await getDocs(query(this.col("reviews"), where("noteId", "==", noteId), limit(500)));
    return snap.docs.map((d) => d.data() as ReviewLog).sort((a, b) => a.reviewedAt - b.reviewedAt);
  }

  async exportAll(): Promise<ExportFile> {
    const get = async <T>(name: string, n: number) => (await getDocs(query(this.col(name), limit(n)))).docs.map((d) => d.data() as T);
    const [decks, notes, cards, reviews, daily, prefs] = await Promise.all([
      get<Deck>("decks", LIMITS.decks),
      get<Note>("notes", LIMITS.notes),
      get<Card>("cards", LIMITS.cards),
      get<ReviewLog>("reviews", LIMITS.reviews),
      get<Daily>("daily", LIMITS.daily),
      getDocs(query(this.col("settings"), limit(5))).then((s) => (s.docs.find((d) => d.id === "prefs")?.data() as Prefs | undefined) ?? null),
    ]);
    return { app: "vhub-lexi", version: 1, exportedAt: Date.now(), decks, notes, cards, reviews, daily, prefs };
  }

  async importAll(f: ExportFile) {
    const ops: Array<(b: WriteBatch) => void> = [];
    for (const d of f.decks) ops.push((b) => b.set(this.ref("decks", d.id), d));
    for (const n of f.notes) ops.push((b) => b.set(this.ref("notes", n.id), n));
    for (const c of f.cards) ops.push((b) => b.set(this.ref("cards", c.id), c));
    for (const r of f.reviews ?? []) ops.push((b) => b.set(this.ref("reviews", r.id), r));
    for (const d of f.daily ?? []) ops.push((b) => b.set(this.ref("daily", d.id), d));
    if (f.prefs) ops.push((b) => b.set(this.ref("settings", "prefs"), f.prefs as Prefs));
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(this.db);
      for (const op of ops.slice(i, i + 400)) op(b);
      this.send(b);
    }
    return { notes: f.notes.length, cards: f.cards.length };
  }
}
