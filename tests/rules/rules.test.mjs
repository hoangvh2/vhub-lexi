// Run with: npm run rules   (starts the Firestore emulator, loads firestore.rules generated for owner@example.com)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, increment, limit, query, setDoc, writeBatch } from "firebase/firestore";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-lexi", firestore: { rules, host: "127.0.0.1", port: 8080 } });
});
after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

const claims = (email, extra = {}) => ({ email, email_verified: true, firebase: { sign_in_provider: "google.com" }, ...extra });
const me = () => env.authenticatedContext("alice", claims("owner@example.com")).firestore();
const path = (...p) => ["users", "alice", ...p];
const clone = (x) => JSON.parse(JSON.stringify(x));

describe("who may use the data", () => {
  it("the allowlisted owner reads and writes their own documents", async () => {
    const db = me();
    await assertSucceeds(setDoc(doc(db, ...path("decks", fx.deck.id)), fx.deck));
    await assertSucceeds(getDoc(doc(db, ...path("decks", fx.deck.id))));
    await assertSucceeds(getDocs(query(collection(db, ...path("decks")), limit(200))));
  });
  it("matching is case-insensitive on the email", async () => {
    const db = env.authenticatedContext("alice", claims("Owner@Example.com")).firestore();
    await assertSucceeds(setDoc(doc(db, ...path("decks", "deck1")), fx.deck));
  });
  it("another allowlisted-looking uid cannot read or write someone else's path", async () => {
    await assertSucceeds(setDoc(doc(me(), ...path("decks", "deck1")), fx.deck));
    const bob = env.authenticatedContext("bob", claims("owner@example.com")).firestore();
    await assertFails(getDoc(doc(bob, ...path("decks", "deck1"))));
    await assertFails(setDoc(doc(bob, ...path("decks", "deck2")), { ...fx.deck, id: "deck2" }));
  });
  it("rejects signed-out, non-allowlisted, unverified and password sign-ins", async () => {
    const d = (db) => setDoc(doc(db, ...path("decks", "deck1")), fx.deck);
    await assertFails(d(env.unauthenticatedContext().firestore()));
    await assertFails(d(env.authenticatedContext("alice", claims("stranger@example.com")).firestore()));
    await assertFails(d(env.authenticatedContext("alice", claims("owner@example.com", { email_verified: false })).firestore()));
    await assertFails(d(env.authenticatedContext("alice", claims("owner@example.com", { firebase: { sign_in_provider: "password" } })).firestore()));
  });
  it("denies unknown collections and the server-only meta documents", async () => {
    const db = me();
    await assertFails(setDoc(doc(db, ...path("meta", "usage")), { day: "2026-01-01", count: 0 }));
    await assertFails(getDoc(doc(db, ...path("meta", "usage"))));
    await assertFails(setDoc(doc(db, ...path("secrets", "x")), { a: 1 }));
    await assertFails(setDoc(doc(db, "shares", "x"), { a: 1 }));
  });
});

describe("documents the app really writes are accepted", () => {
  it("deck, note, every card state, review log, daily counters, prefs", async () => {
    const db = me();
    await assertSucceeds(setDoc(doc(db, ...path("decks", fx.deck.id)), fx.deck));
    await assertSucceeds(setDoc(doc(db, ...path("notes", fx.note.id)), fx.note));
    for (const c of Object.values(fx.cards)) await assertSucceeds(setDoc(doc(db, ...path("cards", c.id)), c));
    await assertSucceeds(setDoc(doc(db, ...path("reviews", fx.review.id)), fx.review));
    await assertSucceeds(setDoc(doc(db, ...path("daily", fx.daily.id)), fx.daily));
    await assertSucceeds(setDoc(doc(db, ...path("settings", "prefs")), fx.prefs));
    await assertSucceeds(getDocs(query(collection(db, ...path("cards")), limit(10000))));
  });
  it("a review commit (card + log + atomic day counters) as one batch, repeated and undone", async () => {
    const db = me();
    const day = doc(db, ...path("daily", fx.daily.id));
    const log = (n) => ({ ...fx.review, id: `${fx.review.cardId}@${fx.review.reviewedAt + n}`, reviewedAt: fx.review.reviewedAt + n });
    const commit = async (sign, n) => {
      const b = writeBatch(db);
      b.set(doc(db, ...path("cards", fx.cards.learning.id)), fx.cards.learning);
      if (sign > 0) b.set(doc(db, ...path("reviews", log(n).id)), log(n));
      else b.delete(doc(db, ...path("reviews", log(n).id)));
      b.set(day, { id: fx.daily.id, newCards: increment(sign), reviews: increment(0), good: increment(sign), ms: increment(sign * 4200), updatedAt: 1 }, { merge: true });
      await b.commit();
    };
    await assertSucceeds(commit(1, 0));
    await assertSucceeds(commit(1, 1));
    assert.equal((await getDoc(day)).data().newCards, 2);
    await assertSucceeds(commit(-1, 1));
    assert.equal((await getDoc(day)).data().newCards, 1);
    await assertFails(setDoc(doc(db, ...path("reviews", log(0).id)), { ...log(0), rating: 1 })); // history is append-only
  });
});

describe("shape checks reject bad data", () => {
  const put = (col, id, data) => setDoc(doc(me(), ...path(col, id)), data);

  it("notes: unknown type, unknown field, empty/oversized word, id mismatch, missing field", async () => {
    const n = fx.note;
    await assertFails(put("notes", n.id, { ...n, type: "toeic-mcq" }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, hack: "x" } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, word: "" } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, word: "x".repeat(81) } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, vi: "x".repeat(301) } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, examples: Array(9).fill("a") } }));
    await assertFails(put("notes", "other", n));
    const { deckId, ...noDeck } = n;
    await assertFails(put("notes", n.id, noDeck));
    await assertFails(put("notes", n.id, { ...n, extra: 1 }));
  });
  it("notes: type and createdAt cannot change after creation", async () => {
    await assertSucceeds(put("notes", fx.note.id, fx.note));
    await assertFails(put("notes", fx.note.id, { ...fx.note, createdAt: fx.note.createdAt + 1 }));
    await assertSucceeds(put("notes", fx.note.id, { ...fx.note, updatedAt: fx.note.updatedAt + 1 }));
  });
  it("cards: bad state, id not matching note+template, negative counters, extra field, createdAt/noteId immutable", async () => {
    const c = fx.cards.learning;
    await assertFails(put("cards", c.id, { ...c, state: 4 }));
    await assertFails(put("cards", c.id, { ...c, id: "note1.cloze" }));
    await assertFails(put("cards", c.id, { ...c, reps: -1 }));
    await assertFails(put("cards", c.id, { ...c, stability: -2 }));
    await assertFails(put("cards", c.id, { ...c, evil: true }));
    await assertFails(put("cards", c.id, { ...c, due: "tomorrow" }));
    await assertSucceeds(put("cards", c.id, c));
    await assertFails(put("cards", c.id, { ...c, createdAt: 1 }));
    await assertFails(put("cards", c.id, { ...c, noteId: "note2", id: "note2.recognize" }));
  });
  it("reviews: append-only (no update), bad rating rejected, undo (delete) allowed", async () => {
    const r = fx.review;
    await assertFails(put("reviews", r.id, { ...r, rating: 5 }));
    await assertFails(put("reviews", r.id, { ...r, device: "ios" }));
    await assertSucceeds(put("reviews", r.id, r));
    await assertFails(put("reviews", r.id, { ...r, rating: 1 }));
    await assertSucceeds(deleteDoc(doc(me(), ...path("reviews", r.id))));
  });
  it("daily: id must be a date and match the path", async () => {
    await assertFails(put("daily", "today", { ...fx.daily, id: "today" }));
    await assertFails(put("daily", "2026-01-15", { ...fx.daily, id: "2026-01-16" }));
    await assertFails(put("daily", fx.daily.id, { ...fx.daily, good: "many" }));
  });
  it("prefs: out-of-range or unknown values rejected", async () => {
    const p = fx.prefs;
    await assertFails(put("settings", "prefs", { ...p, desiredRetention: 0.5 }));
    await assertFails(put("settings", "prefs", { ...p, newPerDay: 5000 }));
    await assertFails(put("settings", "prefs", { ...p, theme: "neon" }));
    await assertFails(put("settings", "prefs", { ...p, layout: { ...p.layout, showEverything: true } }));
    await assertFails(put("settings", "prefs", { ...p, dayStartHour: 24 }));
    await assertFails(put("settings", "other", p));
  });
  it("decks: empty or very long names rejected", async () => {
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", name: "" }));
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", name: "x".repeat(61) }));
  });
});

describe("list queries must be bounded", () => {
  it("a list without limit, or above the cap, is denied", async () => {
    const db = me();
    await assertFails(getDocs(collection(db, ...path("cards"))));
    await assertFails(getDocs(query(collection(db, ...path("cards")), limit(10001))));
    await assertFails(getDocs(query(collection(db, ...path("notes")), limit(5001))));
    await assertSucceeds(getDocs(query(collection(db, ...path("notes")), limit(5000))));
    await assertSucceeds(getDocs(query(collection(db, ...path("daily")), limit(800))));
  });
});
