import { describe, expect, it } from "vitest";
import { CardState, DEFAULT_PREFS, type Card, type Note } from "@shared/model.ts";
import { answerHint, confusables, hintNote, letterCount, matchConfusable, meaningPhrases, meaningsByNote, suggestedRatingWith, typingTarget } from "@shared/confusables.ts";
import { checkTyped, template } from "@shared/notetypes.ts";
import { SETTLE_DAYS, buildQueue } from "../src/lib/queue.ts";
import { newCard } from "../src/lib/scheduler.ts";

const T0 = Date.UTC(2026, 9, 29);
const vocab = (id: string, word: string, vi: string, over: Partial<Note> = {}): Note => ({
  id, type: "vocab", deckId: "d1", createdAt: T0, updatedAt: T0, fields: { word, vi, pos: "verb", en: `${word} definition` }, ...over,
});

// Vietnamese meanings exactly as the offline pack prefills them (Wiktionary).
const convince = vocab("n1", "convince", "thuyết phục; làm cho tin, làm cho nghe theo, thuyết phục");
const persuade = vocab("n2", "persuade", "thuyết phục; làm cho tin; thuyết phục");
const persuasion = vocab("n3", "persuasion", "sự làm cho tin, sự thuyết phục; sự tin, sự tin chắc; tín ngưỡng; giáo phái", { fields: { word: "persuasion", pos: "noun", vi: "sự làm cho tin, sự thuyết phục; sự tin, sự tin chắc; tín ngưỡng; giáo phái" } });
const resilient = vocab("n4", "resilient", "kiên cường");
const notes = [convince, persuade, persuasion, resilient];

describe("confusable words", () => {
  it("splits a meaning line into phrases without parentheses or nominalisers", () => {
    expect(meaningPhrases("sự làm cho tin, sự thuyết phục; sự tin")).toEqual(["làm cho tin", "thuyết phục", "tin"]);
    expect(meaningPhrases("bắt đầu (đi, làm việc...); chạy (máy)")).toEqual(["bắt đầu", "chạy"]);
    expect(meaningPhrases("")).toEqual([]);
  });

  it("finds words sharing a meaning, most shared first, and never the word itself", () => {
    expect(confusables(convince, notes).map((c) => [c.word, c.reason])).toEqual([["persuade", "meaning"], ["persuasion", "meaning"]]);
    expect(confusables(resilient, notes)).toEqual([]);
  });

  it("finds similar spelling without a shared meaning", () => {
    const a = vocab("a", "important", "quan trọng");
    const b = vocab("b", "importance", "tầm quan trọng");
    const c = vocab("c", "impose", "áp đặt");
    expect(confusables(a, [a, b, c]).map((x) => [x.word, x.reason])).toEqual([["importance", "spelling"]]);
  });

  it("ignores other note types, duplicates of the same word and empty words", () => {
    const dup = vocab("d", "Convince", "thuyết phục");
    const other = vocab("o", "persuade", "thuyết phục", { type: "toeic" });
    const empty = vocab("e", "", "thuyết phục");
    expect(confusables(convince, [convince, dup, other, empty])).toEqual([]);
  });

  it("recognises a confusable typed as is or inflected", () => {
    const list = confusables(convince, notes);
    expect(matchConfusable("Persuade", list)?.word).toBe("persuade");
    expect(matchConfusable("persuaded", list)?.word).toBe("persuade");
    expect(matchConfusable("persuasions", list)?.word).toBe("persuasion");
    expect(matchConfusable("resilient", list)).toBeNull();
    expect(matchConfusable("  ", list)).toBeNull();
  });

  it("shows the first letters of the answer and never all of them", () => {
    expect(answerHint("convince", 1)).toBe("c_______");
    expect(answerHint("convince", 3)).toBe("con_____");
    expect(answerHint("look after", 1)).toBe("l___ _____");
    expect(answerHint("ox", 5)).toBe("o_");
    expect(answerHint("well-being", 0)).toBe("____-_____");
    expect(letterCount("look after")).toBe(9);
  });

  it("caps a correct answer at Hard when the learner needed help", () => {
    expect(suggestedRatingWith("correct", { extraHints: 0, retried: false })).toBe(3);
    expect(suggestedRatingWith("correct", { extraHints: 1, retried: false })).toBe(2);
    expect(suggestedRatingWith("correct", { extraHints: 0, retried: true })).toBe(2);
    expect(suggestedRatingWith("close", { extraHints: 2, retried: true })).toBe(2);
    expect(suggestedRatingWith("wrong", { extraHints: 0, retried: true })).toBe(1);
  });
});

describe("near-synonyms are introduced apart", () => {
  const mk = (noteId: string, at: number, over: Partial<Card> = {}): Card => ({ ...newCard(noteId, "d1", "recognize", T0), id: `${noteId}.recognize`, createdAt: T0 + at, ...over });
  const base = { eligible: () => true, today: undefined, prefs: DEFAULT_PREFS, now: T0, deckId: null, buried: new Set<string>(), meanings: meaningsByNote(notes) };

  it("convince, persuade and persuasion share 'thuyết phục': only the first starts today", () => {
    const cards = [mk("n1", 1), mk("n2", 2), mk("n3", 3), mk("n4", 4)];
    expect(buildQueue({ ...base, cards }).newCards.map((c) => c.noteId)).toEqual(["n1", "n4"]);
    // Without meanings the old behaviour stays: every new word is queued.
    expect(buildQueue({ ...base, cards, meanings: undefined }).newCards).toHaveLength(4);
  });
  it("the next one starts once the first is on an interval of SETTLE_DAYS days", () => {
    const learning = mk("n1", 1, { state: CardState.Learning, due: T0 + 600_000 });
    const short = mk("n1", 1, { state: CardState.Review, due: T0 + 86_400_000, scheduledDays: SETTLE_DAYS - 1 });
    const settled = mk("n1", 1, { state: CardState.Review, due: T0 + 9 * 86_400_000, scheduledDays: SETTLE_DAYS });
    expect(buildQueue({ ...base, cards: [learning, mk("n2", 2)] }).newCards).toHaveLength(0);
    expect(buildQueue({ ...base, cards: [short, mk("n2", 2)] }).newCards).toHaveLength(0);
    expect(buildQueue({ ...base, cards: [settled, mk("n2", 2)] }).newCards.map((c) => c.noteId)).toEqual(["n2"]);
  });
});

describe("typing hint target (regression: cloze 'sail' showed 6 letters from 'sailed')", () => {
  const vocab = (word: string, examples: string[]): Note =>
    ({ id: "n", type: "vocab", deckId: "d", createdAt: 1, updatedAt: 1, fields: { word, vi: "nghĩa", pos: "verb", examples } }) as Note;
  const hintFor = (tplId: string, word: string, sentence: string) => {
    const t = typingTarget(template("vocab", tplId)!.expected!(vocab(word, [sentence])));
    return { skeleton: answerHint(t.word, 1), letters: letterCount(t.word), note: hintNote(t) };
  };

  it("counts the word being learned on cloze and listen cards, and names the sentence's ending", () => {
    for (const id of ["cloze", "listen"]) {
      expect(hintFor(id, "sail", "We sailed the Atlantic")).toEqual({ skeleton: "s___", letters: 4, note: "4 chữ cái · trong câu thêm -ed" });
    }
    expect(hintFor("cloze", "sail", "Ships sail at dawn.").note).toBe("4 chữ cái");
    expect(hintFor("cloze", "sail", "Sail away.").note).toBe("4 chữ cái");
    expect(hintFor("cloze", "box", "Two boxes.").note).toBe("3 chữ cái · trong câu thêm -es");
  });

  it("says 'another form' when the sentence form is not the word plus an ending", () => {
    expect(hintFor("cloze", "run", "She is running fast.")).toEqual({ skeleton: "r__", letters: 3, note: "3 chữ cái · trong câu ở dạng khác" });
    expect(hintFor("cloze", "study", "They studied hard.").note).toBe("5 chữ cái · trong câu ở dạng khác");
    expect(hintFor("cloze", "complete", "The completion was late.").note).toBe("8 chữ cái · trong câu ở dạng khác");
  });

  it("handles phrases, hyphens, apostrophes and accents", () => {
    expect(hintFor("cloze", "look after", "She looked after the kids.")).toEqual({ skeleton: "l___ _____", letters: 9, note: "2 từ, 9 chữ cái · trong câu thêm -ed" });
    expect(hintFor("cloze", "look after", "Please look after the kids.").note).toBe("2 từ, 9 chữ cái");
    expect(hintFor("cloze", "well-being", "Your well-being matters.")).toEqual({ skeleton: "w___-_____", letters: 9, note: "9 chữ cái" });
    expect(hintFor("cloze", "o'clock", "At five o'clock.")).toEqual({ skeleton: "o'_____", letters: 6, note: "6 chữ cái" });
    expect(hintFor("cloze", "café", "Two cafés here.")).toEqual({ skeleton: "c___", letters: 4, note: "4 chữ cái · trong câu thêm -s" });
  });

  it("still accepts both the word and the sentence form as correct", () => {
    const e = template("vocab", "cloze")!.expected!(vocab("sail", ["We sailed the Atlantic"]));
    expect(e).toEqual(["sail", "sailed"]);
    expect(checkTyped("sail", e)).toBe("correct");
    expect(checkTyped("sailed", e)).toBe("correct");
  });

  it("recall cards are unchanged", () => {
    const t = typingTarget(template("vocab", "recall")!.expected!(vocab("sail", ["We sailed the Atlantic"])));
    expect(t).toEqual({ word: "sail", ending: null });
  });
});
