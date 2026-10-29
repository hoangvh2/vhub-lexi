import { describe, expect, it } from "vitest";
import type { Note } from "@shared/model.ts";
import { answerHint, confusables, letterCount, matchConfusable, meaningPhrases, suggestedRatingWith } from "@shared/confusables.ts";

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
