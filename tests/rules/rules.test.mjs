// Run with: npm run rules   (starts the Firestore emulator, loads firestore.rules generated for owner@example.com)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, documentId, getDoc, getDocs, increment, limit, query, setDoc, where, writeBatch } from "firebase/firestore";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
// The built-in TOEIC grammar pack exactly as the apps load it (shared/seed.ts).
const pack = JSON.parse(readFileSync(new URL("../../shared/seed/grammar-toeic.json", import.meta.url), "utf8"));
// FSRS-6 defaults, as an optimizer run would store them (21 numbers).
const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
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
      b.set(day, { id: fx.daily.id, newCards: increment(sign), newByDeck: { [fx.deck.id]: increment(sign) }, reviews: increment(0), good: increment(sign), ms: increment(sign * 4200), updatedAt: 1 }, { merge: true });
      await b.commit();
    };
    await assertSucceeds(commit(1, 0));
    await assertSucceeds(commit(1, 1));
    assert.equal((await getDoc(day)).data().newCards, 2);
    assert.equal((await getDoc(day)).data().newByDeck[fx.deck.id], 2);
    await assertSucceeds(commit(-1, 1));
    assert.equal((await getDoc(day)).data().newCards, 1);
    assert.equal((await getDoc(day)).data().newByDeck[fx.deck.id], 1);
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
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, examplesVi: Array(9).fill("a") } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, examplesVi: "not a list" } }));
    // Short phrases, one per meaning: a list of up to 8 lines (the same cap as the examples).
    await assertSucceeds(put("notes", n.id, { ...n, fields: { ...n.fields, phrases: ["accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu"] } }));
    await assertSucceeds(put("notes", n.id, { ...n, fields: { ...n.fields, phrases: Array(8).fill("a b c | d") } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, phrases: Array(9).fill("a b c | d") } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, phrases: "not a list" } }));
    await assertFails(put("notes", "other", n));
    const { deckId, ...noDeck } = n;
    await assertFails(put("notes", n.id, noDeck));
    await assertFails(put("notes", n.id, { ...n, extra: 1 }));
    // The learner's own notes ("Ghi chú"): text up to 500 characters.
    await assertSucceeds(put("notes", n.id, { ...n, fields: { ...n.fields, notes: "Khác prevent. protect A from B." } }));
    await assertSucceeds(put("notes", n.id, { ...n, fields: { ...n.fields, notes: "x".repeat(500) } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, notes: "x".repeat(501) } }));
    await assertFails(put("notes", n.id, { ...n, fields: { ...n.fields, notes: ["a list"] } }));
  });
  it("grammar and test notes: accepted when well formed, rejected with unknown/oversized/missing fields", async () => {
    const base = { id: "g1", type: "grammar", deckId: "deck1", createdAt: 1, updatedAt: 1, tags: ["ngu-phap"] };
    const g = { ...base, fields: { sentence: "Should you need help, call us.", answer: "Should", topic: "Đảo ngữ", translation: "Nếu cần, hãy gọi.", rule: "Should + S + V = If you should need" } };
    await assertSucceeds(put("notes", "g1", g));
    await assertSucceeds(put("cards", "g1.fill", { ...fx.cards.fresh, id: "g1.fill", noteId: "g1", template: "fill" }));
    await assertFails(put("notes", "g1", { ...g, fields: { ...g.fields, answer: "" } }));
    await assertFails(put("notes", "g1", { ...g, fields: { sentence: g.fields.sentence } }));
    await assertFails(put("notes", "g1", { ...g, fields: { ...g.fields, sentence: "x".repeat(301) } }));
    await assertFails(put("notes", "g1", { ...g, fields: { ...g.fields, word: "x" } }));
    await assertFails(put("notes", "g1", { ...g, fields: { ...g.fields, rule: "x".repeat(301) } }));
    const t = { id: "t1", type: "test", deckId: "deck1", createdAt: 1, updatedAt: 1, fields: { name: "Test 1 TOEIC NEW 2026", date: "2026-10-31", p5: "20/30", p6: "8/16", p7: "25/54", minutes: "57", v: "10", g: "8", p: "6", t: "0" } };
    await assertSucceeds(put("notes", "t1", t));
    await assertFails(put("notes", "t1", { ...t, fields: { ...t.fields, name: "" } }));
    await assertFails(put("notes", "t1", { ...t, fields: { ...t.fields, score: "99" } }));
    await assertFails(put("notes", "t1", { ...t, fields: { ...t.fields, p5: "1234567890" } }));
    await assertFails(put("notes", "t1", { ...t, fields: { ...t.fields, v: 5 } }));
  });
  it("grammar pack: every seed note, its cards, the deck and the loaded-version marker are accepted; a second device rewrites them", async () => {
    const deck = { id: pack.deck.id, name: pack.deck.name, createdAt: pack.createdAt, updatedAt: pack.createdAt };
    const notes = pack.notes.map((s, i) => ({ id: s.id, type: s.type, deckId: deck.id, fields: s.fields, tags: s.tags, createdAt: pack.createdAt + i, updatedAt: pack.createdAt + i }));
    const cards = notes.flatMap((n) => ["fill", "rule", "spot"].map((t) => ({ ...fx.cards.fresh, id: `${n.id}.${t}`, noteId: n.id, deckId: deck.id, template: t, due: n.createdAt, createdAt: n.createdAt, updatedAt: n.createdAt })));
    const writeAll = async () => {
      const db = me();
      await assertSucceeds(setDoc(doc(db, ...path("decks", deck.id)), deck));
      for (let i = 0; i < notes.length; i += 100) {
        const b = writeBatch(db);
        for (const n of notes.slice(i, i + 100)) b.set(doc(db, ...path("notes", n.id)), n);
        await assertSucceeds(b.commit());
      }
      for (let i = 0; i < cards.length; i += 400) {
        const b = writeBatch(db);
        for (const c of cards.slice(i, i + 400)) b.set(doc(db, ...path("cards", c.id)), c);
        await assertSucceeds(b.commit());
      }
      await assertSucceeds(setDoc(doc(db, ...path("settings", "seeds")), { [pack.id]: pack.version, updatedAt: 1 }, { merge: true }));
    };
    await writeAll();
    await writeAll(); // same ids, same createdAt: an identical write from another device passes the update rules
    const db = me();
    const range = (name) => query(collection(db, ...path(name)), where(documentId(), ">=", pack.prefix), where(documentId(), "<", "seed-gt."), limit(1000));
    assert.equal((await assertSucceeds(getDocs(range("notes")))).size, notes.length);
    assert.equal((await assertSucceeds(getDocs(range("cards")))).size, cards.length);
    assert.equal((await assertSucceeds(getDoc(doc(db, ...path("settings", "seeds"))))).data()[pack.id], pack.version);
  });
  it("pattern notes and the seeds marker: malformed ones rejected", async () => {
    const n = { id: "p1", type: "pattern", deckId: "deck1", createdAt: 1, updatedAt: 1, fields: { title: "Until + HTĐ", rule: "Mệnh đề thời gian dùng hiện tại.", items: ["Wait until he [arrives]. | will arrive / arrived | Đợi đến khi anh ấy tới."] } };
    await assertSucceeds(put("notes", "p1", n));
    await assertFails(put("notes", "p1", { ...n, fields: { ...n.fields, title: "" } }));
    await assertFails(put("notes", "p1", { ...n, fields: { title: "x", rule: "y" } }));
    await assertFails(put("notes", "p1", { ...n, fields: { ...n.fields, items: Array(9).fill("a [b] | c / d | e") } }));
    await assertFails(put("notes", "p1", { ...n, fields: { ...n.fields, rule: "x".repeat(301) } }));
    await assertFails(put("notes", "p1", { ...n, fields: { ...n.fields, word: "x" } }));
    await assertFails(put("notes", "p1", { ...n, fields: { ...n.fields, items: "one line" } }));
    await assertFails(put("settings", "seeds", { "grammar-toeic": "1" }));
    await assertFails(put("settings", "seeds", { "grammar-toeic": 1, other: 2 }));
    await assertSucceeds(put("settings", "seeds", { "grammar-toeic": 1, updatedAt: 5 }));
  });
  it("notes: type and createdAt cannot change after creation", async () => {
    await assertSucceeds(put("notes", fx.note.id, fx.note));
    await assertFails(put("notes", fx.note.id, { ...fx.note, createdAt: fx.note.createdAt + 1 }));
    await assertSucceeds(put("notes", fx.note.id, { ...fx.note, updatedAt: fx.note.updatedAt + 1 }));
  });
  it("notes: the \"hay quên\" mark (forgot + forgotAt) accepted when well formed, rejected otherwise", async () => {
    const n = (extra) => ({ ...fx.note, ...extra });
    await assertSucceeds(put("notes", fx.note.id, n({ forgot: ["meaning"], forgotAt: 5 })));
    await assertSucceeds(put("notes", fx.note.id, n({ forgot: ["meaning", "sound"], forgotAt: 6 })));
    await assertSucceeds(put("notes", fx.note.id, n({ forgot: ["sound"], forgotAt: 7 })));
    // Clearing the last mark removes both fields.
    await assertSucceeds(put("notes", fx.note.id, fx.note));
    await assertFails(put("notes", fx.note.id, n({ forgot: ["meaning"] })));
    await assertFails(put("notes", fx.note.id, n({ forgotAt: 5 })));
    await assertFails(put("notes", fx.note.id, n({ forgot: [], forgotAt: 5 })));
    await assertFails(put("notes", fx.note.id, n({ forgot: ["spelling"], forgotAt: 5 })));
    await assertFails(put("notes", fx.note.id, n({ forgot: ["meaning", "sound", "meaning"], forgotAt: 5 })));
    await assertFails(put("notes", fx.note.id, n({ forgot: "meaning", forgotAt: 5 })));
    await assertFails(put("notes", fx.note.id, n({ forgot: ["meaning"], forgotAt: "5" })));
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
  it("reviews: a hint caps the rating (cue at Good, whole hint at Hard, flashed answer at Again); bad hint values rejected", async () => {
    const r = (n, rating, hint) => ({ ...fx.review, id: `${fx.review.cardId}@${fx.review.reviewedAt + n}`, reviewedAt: fx.review.reviewedAt + n, rating, hint });
    await assertSucceeds(put("reviews", r(1, 3, 1).id, r(1, 3, 1)));
    await assertFails(put("reviews", r(2, 4, 1).id, r(2, 4, 1)));
    await assertSucceeds(put("reviews", r(3, 2, 2).id, r(3, 2, 2)));
    await assertFails(put("reviews", r(4, 3, 2).id, r(4, 3, 2)));
    await assertFails(put("reviews", r(5, 1, 0).id, r(5, 1, 0)));
    // The recall ladder's last rung flashed the answer: only Again is allowed.
    await assertSucceeds(put("reviews", r(6, 1, 3).id, r(6, 1, 3)));
    await assertFails(put("reviews", r(8, 2, 3).id, r(8, 2, 3)));
    await assertFails(put("reviews", r(9, 1, 4).id, r(9, 1, 4)));
    await assertFails(put("reviews", r(7, 1, "1").id, r(7, 1, "1")));
  });
  it("anki import: every document the importer writes is accepted", async () => {
    const a = fx.anki;
    for (const d of a.decks) await assertSucceeds(put("decks", d.id, d));
    for (const n of a.notes) await assertSucceeds(put("notes", n.id, n));
    for (const c of a.cards) await assertSucceeds(put("cards", c.id, c));
    for (const r of a.reviews) await assertSucceeds(put("reviews", r.id, r));
    for (const d of a.daily) await assertSucceeds(put("daily", d.id, d));
    assert.ok(a.reviews.length > 0 && a.reviews.every((r) => r.device === "anki"));
  });
  it("daily: id must be a date and match the path", async () => {
    await assertFails(put("daily", "today", { ...fx.daily, id: "today" }));
    await assertFails(put("daily", "2026-01-15", { ...fx.daily, id: "2026-01-16" }));
    await assertFails(put("daily", fx.daily.id, { ...fx.daily, good: "many" }));
    await assertFails(put("daily", fx.daily.id, { ...fx.daily, newByDeck: 3 }));
  });
  it("prefs: optimized FSRS parameters accepted", async () => {
    await assertSucceeds(put("settings", "prefs", { ...fx.prefs, fsrsWeights: W, fsrsOptimizedAt: 1_760_000_000_000, fsrsOptimizedReviews: 1200 }));
  });
  it("prefs: out-of-range or unknown values rejected", async () => {
    const p = fx.prefs;
    await assertFails(put("settings", "prefs", { ...p, desiredRetention: 0.5 }));
    await assertFails(put("settings", "prefs", { ...p, newPerDay: 5000 }));
    await assertFails(put("settings", "prefs", { ...p, theme: "neon" }));
    await assertFails(put("settings", "prefs", { ...p, layout: { ...p.layout, showEverything: true } }));
    await assertFails(put("settings", "prefs", { ...p, dayStartHour: 24 }));
    await assertFails(put("settings", "prefs", { ...p, fsrsWeights: W.slice(0, 20) }));
    await assertFails(put("settings", "prefs", { ...p, fsrsWeights: [...W.slice(0, 20), "0.15"] }));
    await assertFails(put("settings", "prefs", { ...p, fsrsWeights: W, fsrsOptimizedAt: "today" }));
    await assertFails(put("settings", "other", p));
  });
  it("decks: empty or very long names rejected", async () => {
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", name: "" }));
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", name: "x".repeat(61) }));
  });
  it("decks: newWeight is a whole number from 0 to 100", async () => {
    await assertSucceeds(put("decks", "d", { ...fx.deck, id: "d", newWeight: 0 }));
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", newWeight: 101 }));
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", newWeight: -1 }));
    await assertFails(put("decks", "d", { ...fx.deck, id: "d", newWeight: 2.5 }));
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

describe("Bộ đề (test sets): the small document every device lists", () => {
  const ID = "0b9c6f1e-2f43-4a3a-9d0e-7a1c2b3d4e5f";
  const set = () => ({
    id: ID,
    name: "ETS 2024 Test 1 LC",
    section: "lc",
    createdAt: 1762800000000,
    updatedAt: 1762800000000,
    files: ["set.json", "media/a0", "media/p1"],
    bytes: 41_000_000,
    questions: 100,
    state: JSON.stringify({ attempt: { startedAt: 1, elapsedMs: 0, answers: { 0: "A" } }, clips: [] }),
  });
  const put = (d, id = ID) => setDoc(doc(me(), ...path("testsets", id)), d);

  it("accepts the document the apps write, lists it, updates the state, deletes it", async () => {
    await assertSucceeds(put(set()));
    await assertSucceeds(getDocs(query(collection(me(), ...path("testsets")), limit(200))));
    await assertSucceeds(put({ ...set(), updatedAt: 1762800009999, state: "{}" }));
    await assertSucceeds(deleteDoc(doc(me(), ...path("testsets", ID))));
  });
  it("a set from before (no questions, no state) is fine", async () => {
    const { questions, state, ...bare } = set();
    await assertSucceeds(put(bare));
  });
  it("rejects wrong shapes, other ids, unknown fields, an oversized state", async () => {
    await assertFails(put({ ...set(), id: "other" }));
    await assertFails(put({ ...set(), id: "a b" }, "a b"));
    await assertFails(put({ ...set(), section: "ielts" }));
    await assertFails(put({ ...set(), name: "" }));
    await assertFails(put({ ...set(), files: [] }));
    await assertFails(put({ ...set(), files: "set.json" }));
    await assertFails(put({ ...set(), bytes: -1 }));
    await assertFails(put({ ...set(), questions: 1001 }));
    await assertFails(put({ ...set(), pdf: "base64…" }));
    await assertFails(put({ ...set(), state: "x".repeat(200_001) }));
  });
  it("createdAt and section cannot change on update", async () => {
    await assertSucceeds(put(set()));
    await assertFails(put({ ...set(), createdAt: 5 }));
    await assertFails(put({ ...set(), section: "rc" }));
  });
  it("only the owner, and lists are bounded", async () => {
    await assertSucceeds(put(set()));
    const bob = env.authenticatedContext("bob", claims("owner@example.com")).firestore();
    await assertFails(getDoc(doc(bob, ...path("testsets", ID))));
    await assertFails(getDocs(query(collection(me(), ...path("testsets")), limit(201))));
    await assertFails(getDocs(collection(me(), ...path("testsets"))));
  });
});
