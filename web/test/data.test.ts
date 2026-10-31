import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, dayId } from "@shared/model.ts";
import { addNote, removeNote, reviewCard, savePrefs, setSuspended, undoReview, updateNote } from "../src/data/actions.ts";
import { LocalRepo } from "../src/data/local.ts";
import { validateExport } from "../src/data/repo.ts";
import { cards, daily, decks, notes, prefs, startRepo, stopRepo, currentRepo } from "../src/data/state.ts";
import { Dictionary, viFor } from "../src/lib/dict.ts";

let n = 0;
async function fresh() {
  stopRepo();
  await startRepo(new LocalRepo(`test-${++n}`));
}
const vocab = { word: "resilient", ipa: "rɪˈzɪljənt", pos: "adjective", vi: "kiên cường", en: "able to recover", examples: ["Children are resilient."] };

describe("actions on the local repo", () => {
  beforeEach(fresh);

  it("addNote creates the default deck, the note and one card per applicable template", async () => {
    const note = await addNote({ type: "vocab", fields: vocab });
    expect(decks.get()).toHaveLength(1);
    expect(notes.get()[0].id).toBe(note.id);
    const cs = cards.get();
    expect(cs.map((c) => c.template).sort()).toEqual(["cloze", "recognize"]);
    expect(cs.every((c) => c.state === CardState.New && c.id.startsWith(note.id))).toBe(true);
  });

  it("card info: the answer history of a note, oldest first", async () => {
    const note = await addNote({ type: "vocab", fields: vocab });
    const card = cards.get().find((c) => c.template === "recognize")!;
    const t = Date.now();
    await reviewCard(card, 3, 1000, t);
    await reviewCard(cards.get().find((c) => c.id === card.id)!, 1, 2000, t + 60_000);
    const h = await currentRepo().reviewsOfNote(note.id);
    expect(h.map((r) => r.rating)).toEqual([3, 1]);
    expect(await currentRepo().reviewsOfNote("other")).toEqual([]);
  });

  it("drops empty fields and rejects unknown note types", async () => {
    const note = await addNote({ type: "vocab", fields: { ...vocab, mnemonic: "   ", examples: ["", " a "] } });
    expect(note.fields.mnemonic).toBeUndefined();
    expect(note.fields.examples).toEqual(["a"]);
    await expect(addNote({ type: "nope", fields: {} })).rejects.toThrow();
  });

  it("review updates the card and the day counters; undo restores both", async () => {
    await addNote({ type: "vocab", fields: vocab });
    const card = cards.get().find((c) => c.template === "recognize")!;
    const t = Date.now();
    const r = await reviewCard(card, 3, 4000, t);
    const after = cards.get().find((c) => c.id === card.id)!;
    expect(after.state).not.toBe(CardState.New);
    expect(after.reps).toBe(1);
    const day = daily.get().find((d) => d.id === dayId(t, prefs.get().dayStartHour))!;
    expect(day).toMatchObject({ newCards: 1, reviews: 0, good: 1, ms: 4000 });

    await undoReview(r);
    expect(cards.get().find((c) => c.id === card.id)).toMatchObject({ state: CardState.New, reps: 0 });
    expect(daily.get()[0]).toMatchObject({ newCards: 0, good: 0, ms: 0 });
    const exp = await currentRepo().exportAll();
    expect(exp.reviews).toHaveLength(0);
  });

  it("second answer counts as a review, not a new card", async () => {
    await addNote({ type: "vocab", fields: vocab });
    const card = cards.get()[0];
    const first = await reviewCard(card, 3, 1000, Date.now());
    await reviewCard(first.next, 3, 1000, Date.now() + 1);
    expect(daily.get()[0]).toMatchObject({ newCards: 1, reviews: 1, good: 2 });
  });

  it("editing a note creates cards that became possible and removes unused new ones", async () => {
    const note = await addNote({ type: "vocab", fields: { ...vocab, examples: [] } });
    expect(cards.get().map((c) => c.template)).toEqual(["recognize"]);
    await updateNote(notes.get()[0], { fields: { ...vocab } });
    expect(cards.get().map((c) => c.template).sort()).toEqual(["cloze", "recognize"]);
    await updateNote(notes.get()[0], { fields: { ...vocab, examples: [] } });
    expect(cards.get().map((c) => c.template)).toEqual(["recognize"]);
    expect(note.id).toBe(notes.get()[0].id);
  });

  it("changing templates in settings adds cards for existing notes", async () => {
    await addNote({ type: "vocab", fields: vocab });
    await savePrefs({ ...prefs.get(), templates: { vocab: ["recognize", "recall", "cloze"] } });
    expect(cards.get()).toHaveLength(3);
    await savePrefs({ ...prefs.get(), templates: { vocab: ["recognize"] } });
    expect(cards.get().map((c) => c.template)).toEqual(["recognize"]);
  });

  it("removeNote deletes its cards but keeps review history", async () => {
    const note = await addNote({ type: "vocab", fields: vocab });
    await reviewCard(cards.get()[0], 3, 100);
    await removeNote(note);
    expect(notes.get()).toHaveLength(0);
    expect(cards.get()).toHaveLength(0);
    expect((await currentRepo().exportAll()).reviews).toHaveLength(1);
  });

  it("suspend toggles", async () => {
    await addNote({ type: "vocab", fields: vocab });
    const c = cards.get()[0];
    await setSuspended(c, true);
    expect(cards.get().find((x) => x.id === c.id)!.suspended).toBe(true);
    await setSuspended(cards.get().find((x) => x.id === c.id)!, false);
    expect(cards.get().find((x) => x.id === c.id)!.suspended).toBeUndefined();
  });

  it("export then import into a fresh database restores everything", async () => {
    await addNote({ type: "vocab", fields: vocab });
    await reviewCard(cards.get()[0], 4, 100);
    await savePrefs({ ...prefs.get(), newPerDay: 7 });
    const file = JSON.parse(JSON.stringify(await currentRepo().exportAll()));
    expect(validateExport(file)).toBe(true);
    expect(validateExport({ app: "other" })).toBe(false);
    await fresh();
    expect(notes.get()).toHaveLength(0);
    const r = await currentRepo().importAll(file);
    expect(r).toEqual({ notes: 1, cards: 2 });
    expect(notes.get()).toHaveLength(1);
    expect(cards.get().some((c) => c.state !== CardState.New)).toBe(true);
    expect(prefs.get().newPerDay).toBe(7);
    expect(daily.get()).toHaveLength(1);
  });

  it("persists across reopening the database", async () => {
    await addNote({ type: "vocab", fields: vocab });
    stopRepo();
    await startRepo(new LocalRepo(`test-${n}`));
    expect(notes.get()).toHaveLength(1);
    expect(cards.get()).toHaveLength(2);
    expect(prefs.get().desiredRetention).toBe(DEFAULT_PREFS.desiredRetention);
  });
});

const packDir = join(__dirname, "../../dist-dict");
describe.skipIf(!existsSync(join(packDir, "latest.json")))("dictionary client (real pack)", () => {
  const fetcher = async (url: string) => {
    const path = join(packDir, url.replace(/^\/dict\//, ""));
    return existsSync(path) ? new Response(readFileSync(path), { status: 200 }) : new Response("", { status: 404 });
  };
  const dict = new Dictionary("/dict", fetcher as never);

  it("exact lookup returns IPA, parts of speech and examples", async () => {
    const r = await dict.lookup("Serendipity ");
    expect(r?.entry.word).toBe("serendipity");
    expect(r?.entry.ipa).toBe("ˌsɛrənˈdɪpɪti");
    expect(r?.entry.pos[0].pos).toBe("n");
  });
  it("finds base forms of inflected words", async () => {
    expect((await dict.lookup("running"))?.entry.word).toBe("running"); // a headword itself
    const went = await dict.lookup("went");
    expect(went?.entry.word).toBe("go");
    expect(went?.inflectedFrom).toBe("went");
    const studies = await dict.lookup("studies");
    expect(studies?.entry.word === "studies" || studies?.inflectedFrom === "studies").toBe(true);
    const r = await dict.lookup("procrastinating");
    expect(r?.entry.word).toBe("procrastinate");
    expect(r?.inflectedFrom).toBe("procrastinating");
    expect((await dict.lookup("children"))?.entry.word).toBeDefined();
  });
  it("suggests by prefix, common words first", async () => {
    const s = await dict.suggest("serend");
    expect(s.map((e) => e.word)).toContain("serendipity");
    const s2 = await dict.suggest("resil");
    expect(s2[0].word.startsWith("resil")).toBe(true);
    expect(await dict.suggest("a")).toEqual([]);
  });
  it("carries Vietnamese meanings by part of speech", async () => {
    const book = (await dict.lookup("book"))!.entry;
    expect(viFor(book, "noun")).toContain("sách");
    expect(viFor(book, "verb")).not.toBe("");
    expect(viFor((await dict.lookup("serendipity"))!.entry, "verb")).toBe(""); // never another WordNet part of speech
  });
  it("returns null for gibberish and survives a missing pack", async () => {
    expect(await dict.lookup("qzxwv")).toBeNull();
    const none = new Dictionary("/dict", (async () => new Response("", { status: 404 })) as never);
    expect(await none.lookup("hello")).toBeNull();
    expect(await none.available()).toBe(false);
  });
});
