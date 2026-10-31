import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, dayId, type Deck, type Note } from "@shared/model.ts";
import { LocalRepo } from "../src/data/local.ts";
import { convertAnki, defaultPlan, guessFields, htmlLines, memoryFromSm2, normalizePos, tagOf, type ImportExisting } from "../src/lib/anki/convert.ts";
import { AnkiFormatError, readApkg, type AnkiCollection } from "../src/lib/anki/read.ts";

// Built by tools/anki/make-fixture.py with Anki's own Python library (anki 26.9.3).
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
const NOW = Date.UTC(2026, 9, 31, 3, 0, 0);
const none: ImportExisting = { decks: [], notes: [], daily: [], prefs: DEFAULT_PREFS };

let modern: AnkiCollection;
let legacy: AnkiCollection;
beforeAll(async () => {
  modern = await readApkg(fixture("anki-fsrs.apkg"));
  legacy = await readApkg(fixture("anki-legacy.apkg"));
});

describe("reading .apkg", () => {
  it("reads the modern (anki21b, zstd) and the legacy (anki21) collection the same way", () => {
    for (const c of [modern, legacy]) {
      expect(c.notes).toHaveLength(6);
      expect(c.cards).toHaveLength(6);
      expect(c.revlog).toHaveLength(6);
      expect(c.crt).toBeGreaterThan(1_700_000_000);
      const names = [...c.decks.values()].map((d) => d.name).sort();
      expect(names).toEqual(["600 Essential", "600 Essential::Lesson 01", "600 Essential::Lesson 02", "Default"]);
      const nt = [...c.notetypes.values()].find((m) => m.name === "TOEIC2")!;
      expect(nt.fields.map((f) => f.name).slice(0, 4)).toEqual(["Target word", "Transcription", "Word type", "Vietnamese"]);
      expect(nt.templates.map((t) => t.name)).toEqual(["Card 1"]);
    }
  });

  it("keeps FSRS memory state written by Anki (cards.data s/d)", () => {
    expect(modern.cards.filter((c) => c.data.s !== undefined).length).toBe(3);
    expect(legacy.cards.every((c) => c.data.s === undefined)).toBe(true);
  });

  it("rejects files that are not Anki packages", async () => {
    await expect(readApkg(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(AnkiFormatError);
  });
});

describe("field text and mapping", () => {
  it("turns Anki HTML into lines of text", () => {
    expect(htmlLines("<div>a. The <b>deal</b>&nbsp;was signed.</div><div>b. Second&#39;s line<br>third</div>[sound:x.mp3]<img src='a.jpg'>")).toEqual([
      "a. The deal was signed.",
      "b. Second's line",
      "third",
    ]);
    expect(htmlLines("  ")).toEqual([]);
  });

  it("normalises parts of speech and builds tags", () => {
    expect(normalizePos("(v)")).toBe("verb");
    expect(normalizePos("(n, v)")).toBe("noun, verb");
    expect(normalizePos("(adj)")).toBe("adjective");
    expect(normalizePos("idiom")).toBe("idiom");
    expect(tagOf("Lesson 01")).toBe("lesson-01");
    expect(tagOf("Bài 3: Hợp đồng")).toBe("bai-3-hop-dong");
  });

  it("guesses the TOEIC2 field mapping by name", () => {
    const nt = [...modern.notetypes.values()].find((m) => m.name === "TOEIC2")!;
    expect(guessFields(nt)).toEqual({
      word: "Target word", ipa: "Transcription", pos: "Word type", vi: "Vietnamese", en: "Explanation",
      examples: "Example", examplesVi: "Translation", mnemonic: "",
    });
  });

  it("estimates memory from an SM-2 interval like Anki does (S = interval at 90%)", () => {
    const m = memoryFromSm2(30, 2500);
    expect(m.stability).toBe(30);
    expect(m.difficulty).toBeGreaterThanOrEqual(1);
    expect(m.difficulty).toBeLessThanOrEqual(10);
    expect(memoryFromSm2(30, 1300).difficulty).toBeGreaterThan(memoryFromSm2(30, 2500).difficulty);
  });
});

describe("converting to Lexi", () => {
  for (const [label, col] of [["modern", () => modern], ["legacy", () => legacy]] as const) {
    it(`${label}: notes, deck, lesson tags and fields`, () => {
      const c = col();
      const { file, report } = convertAnki(c, defaultPlan(c)!, none, NOW);
      expect(report.notes).toBe(6);
      expect(file.decks.map((d) => d.name)).toEqual(["600 Essential"]);
      expect(report.lessons).toEqual(["lesson-01", "lesson-02"]);
      const abide = file.notes.find((n) => n.fields.word === "abide by")!;
      expect(abide.tags).toEqual(["lesson-01", "anki", "lesson1"]);
      expect(abide.fields).toMatchObject({
        ipa: "/əˈbaɪd baɪ/",
        pos: "verb",
        vi: "tôn trọng, tuân theo",
        examples: ["The two parties agreed to abide by the contract.", "Employees must abide by the rules."],
        examplesVi: ["Hai bên đồng ý tuân theo hợp đồng.", "Nhân viên phải tuân theo quy định."],
      });
      expect(file.notes.find((n) => n.fields.word === "agreement")!.fields.examples).toEqual(["The agreement was signed yesterday."]);
      // Image / sound fields are not imported.
      expect(JSON.stringify(file.notes)).not.toMatch(/img|sound:|\.mp3/);
    });

    it(`${label}: card states, due dates and Anki's new-card order`, () => {
      const c = col();
      const { file, report } = convertAnki(c, defaultPlan(c)!, none, NOW);
      const byWord = (w: string, t = "recognize") => {
        const n = file.notes.find((x) => x.fields.word === w)!;
        return file.cards.find((x) => x.noteId === n.id && x.template === t)!;
      };
      const review = file.cards.find((x) => x.state === CardState.Review)!;
      const anki = c.cards.find((x) => x.type === 2)!;
      expect(review.due).toBe((c.crt + anki.due * 86_400) * 1000);
      expect(review.scheduledDays).toBe(30);
      expect(review.reps).toBe(4);
      expect(review.stability).toBeGreaterThan(0);
      expect(file.cards.filter((x) => x.state === CardState.Learning)).toHaveLength(2);
      expect(byWord("competition").suspended).toBe(true);
      expect(byWord("attract").state).toBe(CardState.New);
      expect(byWord("attract").createdAt).toBeLessThan(byWord("compare").createdAt);
      expect(report).toMatchObject({ studied: 3, suspended: 1, reviews: 6 });
      // The learner's other Lexi templates (cloze by default) start as new cards when the note allows them.
      expect(byWord("abide by", "cloze").state).toBe(CardState.New);
      expect(file.cards.every((x) => x.id === `${x.noteId}.${x.template}`)).toBe(true);
    });

    it(`${label}: review log becomes Lexi reviews and day counters`, () => {
      const c = col();
      const { file } = convertAnki(c, defaultPlan(c)!, none, NOW);
      expect(file.reviews).toHaveLength(6);
      expect(file.reviews.every((r) => r.device === "anki" && r.rating >= 1 && r.rating <= 4)).toBe(true);
      const total = file.daily.reduce((a, d) => a + d.newCards + d.reviews, 0);
      expect(total).toBe(6);
      const first = c.revlog[0];
      expect(file.daily[0].id).toBe(dayId(first.id, DEFAULT_PREFS.dayStartHour));
    });
  }

  it("uses Anki's FSRS memory when present, otherwise replays the log", () => {
    const fromFsrs = convertAnki(modern, defaultPlan(modern)!, none, NOW).file.cards.find((x) => x.state === CardState.Review)!;
    const anki = modern.cards.find((x) => x.type === 2)!;
    expect(fromFsrs.stability).toBeCloseTo(anki.data.s!, 3);
    expect(fromFsrs.difficulty).toBeCloseTo(anki.data.d!, 3);
    const replayed = convertAnki(legacy, defaultPlan(legacy)!, none, NOW).file.cards.find((x) => x.state === CardState.Review)!;
    expect(replayed.stability).toBeGreaterThan(1);
  });

  it("never overwrites what is already in Lexi", () => {
    const first = convertAnki(legacy, defaultPlan(legacy)!, none, NOW).file;
    const own: Note = { id: "mine", type: "vocab", deckId: "d", fields: { word: "Compare" }, createdAt: 1, updatedAt: 1 };
    const deck: Deck = { id: "x1", name: "600 essential", createdAt: 1, updatedAt: 1 };
    const existing = { ...none, decks: [deck], notes: [first.notes[0], own], daily: [{ ...first.daily[0], newCards: 5 }] };
    const { file, report } = convertAnki(legacy, defaultPlan(legacy)!, existing, NOW);
    expect(report.skippedExisting).toBe(1);
    expect(report.skippedDuplicates).toEqual(["compare"]);
    expect(report.notes).toBe(4);
    expect(file.decks).toEqual([]); // reuses the Lexi deck with the same name
    expect(file.notes.every((n) => n.deckId === "x1")).toBe(true);
    // Reviews of skipped notes are not imported again; counters of a day add to Lexi's own.
    expect(file.reviews.some((r) => r.noteId === first.notes[0].id)).toBe(false);
  });

  it("drops cards whose template is mapped to nothing", () => {
    const plan = { ...defaultPlan(legacy)!, templates: { 0: "" } };
    const { file, report } = convertAnki(legacy, plan, { ...none, prefs: { ...DEFAULT_PREFS, templates: { vocab: ["recognize"] } } }, NOW);
    expect(report.droppedCards).toBe(6);
    expect(file.cards.every((c) => c.state === CardState.New)).toBe(true);
    expect(file.reviews).toEqual([]);
  });

  it("imports through the repository and passes the same checks as a Lexi backup", async () => {
    const repo = new LocalRepo(`anki-${Date.now()}`);
    await repo.start({ data: () => {}, sync: () => {} });
    const { file } = convertAnki(modern, defaultPlan(modern)!, none, NOW);
    const r = await repo.importAll(file);
    expect(r.notes).toBe(6);
    const back = await repo.exportAll();
    expect(back.reviews).toHaveLength(6);
    expect(back.cards.length).toBe(file.cards.length);
    repo.stop();
  });
});
