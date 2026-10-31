/**
 * The real CloudRepo against the Firestore + Auth emulators and the real security rules:
 * two "devices" (separate Firebase apps, same account) must see each other's writes.
 */
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, terminate } from "firebase/firestore";
import { afterAll, describe, expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, dayId, type Card, type Daily, type DailyDelta, type Note, type Prefs, type ReviewLog } from "@shared/model.ts";
import { CloudRepo } from "../src/data/cloud.ts";
import type { Snapshot, SyncState } from "../src/data/repo.ts";
import { answer, makeScheduler, newCard } from "../src/lib/scheduler.ts";

let seq = 0;
const apps: FirebaseApp[] = [];

async function device(email: string, sub: string) {
  const app = initializeApp({ apiKey: "fake", projectId: "demo-lexi", appId: "1:1:web:1" }, `dev${++seq}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true })));
  const db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const repo = new CloudRepo(cred.user.uid, db);
  const state: Snapshot & { sync: SyncState } = { decks: [], notes: [], cards: [], daily: [], prefs: null, sync: "loading" };
  await repo.start({ data: (p) => Object.assign(state, p), sync: (s) => (state.sync = s), warn: (m, e) => console.log("WARN", email, m, (e as Error)?.message) });
  return { repo, state, uid: cred.user.uid, db };
}

const until = async (cond: () => boolean, what: string, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a).catch(() => undefined)));
});

const T = Date.now();
const note: Note = {
  id: "n1", type: "vocab", deckId: "d1", createdAt: T, updatedAt: T,
  fields: { word: "resilient", vi: "kiên cường", en: "able to recover quickly", examples: ["Children are resilient."] },
};

describe("CloudRepo on the emulator", () => {
  it("syncs notes, cards, reviews, counters and prefs between two devices of one account", async () => {
    const a = await device("owner@example.com", "user-one");
    const b = await device("owner@example.com", "user-one");
    expect(a.uid).toBe(b.uid);

    const cards: Card[] = [newCard("n1", "d1", "recognize", T), newCard("n1", "d1", "cloze", T)];
    await a.repo.saveDeck({ id: "d1", name: "Mặc định", createdAt: T, updatedAt: T });
    await a.repo.saveNote(note, cards);
    await until(() => b.state.notes.length === 1 && b.state.cards.length === 2 && b.state.decks.length === 1, "B to receive the note");
    expect(b.state.notes[0].fields.word).toBe("resilient");

    // Review on B; A sees the new schedule and the day counters.
    const sched = makeScheduler(0.9);
    const next = answer(sched, cards[0], 3, T);
    const log: ReviewLog = {
      id: `${cards[0].id}@${T}`, cardId: cards[0].id, noteId: "n1", deckId: "d1", rating: 3, state: CardState.New,
      stability: next.stability, difficulty: next.difficulty, scheduledDays: next.scheduledDays, reviewedAt: T, durationMs: 3000, device: "web",
    };
    const delta: DailyDelta = { id: dayId(T, 4), newCards: 1, reviews: 0, rating: 3, ms: 3000 };
    await b.repo.commitReview(next, log, delta);
    await until(() => a.state.cards.some((c) => c.id === cards[0].id && c.state !== CardState.New), "A to see the review");
    await until(() => a.state.daily.length === 1, "A to see the counters");
    expect(a.state.daily[0]).toMatchObject({ newCards: 1, reviews: 0, good: 1, ms: 3000 });

    // Both devices answer a card of the same day offline-style: counters add up, not overwrite.
    const next2 = answer(sched, cards[1], 4, T + 1);
    await a.repo.commitReview(next2, { ...log, id: `${cards[1].id}@${T + 1}`, cardId: cards[1].id, rating: 4 }, { ...delta, rating: 4, ms: 1000 });
    await until(() => (b.state.daily[0] as Daily | undefined)?.newCards === 2, "counters to add up");
    expect(b.state.daily[0]).toMatchObject({ newCards: 2, good: 1, easy: 1, ms: 4000 });

    // Undo on A is seen by B.
    await a.repo.undoReview(cards[1], `${cards[1].id}@${T + 1}`, { ...delta, rating: 4, ms: 1000 });
    await until(() => (b.state.daily[0] as Daily | undefined)?.newCards === 1, `undo to propagate (A sync=${a.state.sync}, daily=${JSON.stringify(a.state.daily)})`);
    expect(b.state.cards.find((c) => c.id === cards[1].id)?.state).toBe(CardState.New);

    // Preferences and note edits propagate; deleting removes note and cards everywhere.
    const prefs: Prefs = { ...DEFAULT_PREFS, newPerDay: 9, updatedAt: T };
    await b.repo.savePrefs(prefs);
    await until(() => a.state.prefs?.newPerDay === 9, "prefs");
    await a.repo.saveNote({ ...note, updatedAt: T + 5, fields: { ...note.fields, vi: "bền bỉ" } }, []);
    await until(() => b.state.notes[0]?.fields.vi === "bền bỉ", "note edit");
    await b.repo.deleteNote("n1", cards.map((c) => c.id));
    await until(() => a.state.notes.length === 0 && a.state.cards.length === 0, "delete");

    // Review history survives deletion and is exported.
    const exp = await a.repo.exportAll();
    expect(exp.reviews.map((r) => r.id)).toEqual([`${cards[0].id}@${T}`]);
    // Card info reads one note's history with an equality query the rules allow.
    expect((await b.repo.reviewsOfNote("n1")).map((r) => r.id)).toEqual([`${cards[0].id}@${T}`]);
    expect(exp.prefs?.newPerDay).toBe(9);
    expect(a.state.sync === "synced" || a.state.sync === "pending").toBe(true);
  });

  it("one account never sees another account's data", async () => {
    const a = await device("owner@example.com", "user-one");
    await a.repo.saveNote(note, [newCard("n1", "d1", "recognize", T)]);
    await until(() => a.state.notes.length === 1, "own note");
    const other = await device("second@example.com", "user-two"); // another allowlisted account (the Auth emulator links accounts by email)
    await until(() => other.state.sync !== "loading", "other device state");
    expect(other.state.notes).toHaveLength(0);
  });

  it("a signed-in account that is not on the allowlist is reported as denied", async () => {
    const stranger = await device("stranger@example.com", "user-x");
    await stranger.repo.saveNote(note, [newCard("n1", "d1", "recognize", T)]);
    await until(() => stranger.state.sync === "denied", "denied state");
    // The listeners are refused too, so the app stays on the "not allowed" screen instead of showing data.
    await new Promise((r) => setTimeout(r, 500));
    expect(stranger.state.sync).toBe("denied");
  });

  it("import restores a backup in batches", async () => {
    const a = await device("owner@example.com", "user-imp");
    const many: Note[] = Array.from({ length: 450 }, (_, i) => ({ ...note, id: `n${i}`, fields: { word: `word${i}`, vi: "x" } }));
    const manyCards = many.map((n) => newCard(n.id, "d1", "recognize", T));
    const r = await a.repo.importAll({ app: "vhub-lexi", version: 1, exportedAt: T, decks: [], notes: many, cards: manyCards, reviews: [], daily: [], prefs: null });
    expect(r).toEqual({ notes: 450, cards: 450 });
    await until(() => a.state.notes.length === 450 && a.state.cards.length === 450, "import to land", 20000);
  });

  it("reads a review history larger than one Firestore query allows (10,000 documents)", async () => {
    const a = await device("owner@example.com", "user-history");
    // An Anki import with its review log easily passes 10,000 answers. Production Firestore refused the one
    // limit(20000) query ("Limit value in the structured query is over the maximum value of 10000"); the emulator
    // does not enforce that cap, so this checks the paging and core.test.ts checks every limit stays under it.
    const reviews: ReviewLog[] = Array.from({ length: 10_250 }, (_, i) => ({
      id: `c${i % 900}.recognize@${T + i}`, cardId: `c${i % 900}.recognize`, noteId: `c${i % 900}`, deckId: "d1", rating: 3, state: CardState.Review,
      stability: 3, difficulty: 5, scheduledDays: 3, reviewedAt: T + i, durationMs: 4000, device: "anki",
    }));
    const before = (await a.repo.allReviews()).length;
    await a.repo.importAll({ app: "vhub-lexi", version: 1, exportedAt: T, decks: [], notes: [], cards: [], reviews, daily: [], prefs: null });
    const all = await a.repo.allReviews();
    // The allowlisted test account is shared with the earlier tests, which left a few reviews of their own.
    const ids = new Set(all.map((r) => r.id));
    expect(ids.size).toBe(all.length); // no page read twice
    expect(reviews.every((r) => ids.has(r.id))).toBe(true);
    expect(all.length).toBe(before + 10_250);
    expect((await a.repo.exportAll()).reviews).toHaveLength(all.length);
  }, 120_000);
});
