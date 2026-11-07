import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, type Note } from "@shared/model.ts";
import { rotateExamples } from "@shared/hints.ts";
import { typingTarget } from "@shared/confusables.ts";
import { checkTyped, parsePhrase, phraseBlocks, phrasesOf, studyNote, template, type Block } from "@shared/notetypes.ts";

const L = DEFAULT_PREFS.layout;
const note = (fields: Note["fields"]): Note => ({ id: "n1", type: "vocab", deckId: "d", createdAt: 0, updatedAt: 0, fields });
const acc = note({
  word: "accommodate",
  pos: "verb",
  vi: "(chứa) chứa được; (dịch vụ) đáp ứng; (công việc) tạo điều kiện",
  phrases: ["accommodate 200 guests | chứa được 200 khách", "accommodate a request | đáp ứng một yêu cầu", "She accommodates new staff | tạo điều kiện cho nhân viên mới"],
  examples: ["The hotel can accommodate a large group of tourists."],
  examplesVi: ["Khách sạn có thể chứa một đoàn du khách lớn."],
});
const cloze = template("vocab", "cloze")!;

describe("phrases", () => {
  it("parses `phrase | meaning`, the meaning being optional", () => {
    expect(parsePhrase("  accommodate   200 guests | chứa được   200 khách ")).toEqual({ text: "accommodate 200 guests", vi: "chứa được 200 khách" });
    expect(parsePhrase("accommodate a request")).toEqual({ text: "accommodate a request", vi: "" });
    expect(parsePhrase("   |  chỉ có nghĩa")).toBeNull();
  });
  it("keeps only phrases that contain the word, so every card can be blanked", () => {
    const n = note({ word: "accommodate", phrases: ["welcome 200 guests | chào đón", "accommodates 200 guests | chứa", "", "accommodate"] });
    expect(phrasesOf(n).map((p) => p.text)).toEqual(["accommodates 200 guests", "accommodate"]);
    expect(phrasesOf(note({ word: "accommodate" }))).toEqual([]);
  });
});

describe("the fill-in-the-blank card asks one meaning at a time", () => {
  const front = (reps: number) => cloze.front(studyNote(acc, "cloze", reps), L);

  it("turns the phrases one review after another, by the card's review count, and wraps around", () => {
    expect(front(0)).toContainEqual({ k: "quote", text: "_____ 200 guests" });
    expect(front(1)).toContainEqual({ k: "quote", text: "_____ a request" });
    expect(front(2)).toContainEqual({ k: "quote", text: "She _____ new staff" });
    expect(front(3)).toEqual(front(0));
  });
  it("points at the meaning of that phrase, not at every meaning of the word", () => {
    expect(front(1)).toContainEqual({ k: "text", text: "đáp ứng một yêu cầu" });
    expect(front(1).some((b) => b.k === "text" && b.text.includes("công việc"))).toBe(false);
  });
  it("accepts the headword and the form the phrase uses; the hint spells the headword", () => {
    const n = studyNote(acc, "cloze", 2);
    const exp = cloze.expected!(n);
    expect(exp).toEqual(["accommodate", "accommodates"]);
    expect(checkTyped("accommodates", exp)).toBe("correct");
    expect(checkTyped("accommodate", exp)).toBe("correct");
    expect(typingTarget(exp)).toEqual({ word: "accommodate", ending: "s" });
  });
  it("the answer side lists every phrase, then the full example", () => {
    const back = cloze.back(studyNote(acc, "cloze", 1), L);
    const ex = back.filter((b): b is Extract<Block, { k: "example" }> => b.k === "example");
    expect(ex.map((b) => [b.text, !!b.phrase])).toEqual([
      ["accommodate 200 guests", true], ["accommodate a request", true], ["She accommodates new staff", true],
    ]);
    expect(ex[1].vi).toBe("đáp ứng một yêu cầu");
    expect(ex[0].at).toEqual([0, 11]);
  });
  it("the recognize and recall answers show the phrases too, before the full examples", () => {
    for (const id of ["recognize", "recall"]) {
      const back = template("vocab", id)!.back(acc, L);
      const kinds = back.filter((b) => b.k === "example").map((b) => (b as { phrase?: true }).phrase === true);
      expect(kinds, id).toEqual([true, true, true, false]);
    }
  });
  it("other templates and notes without phrases are shown as they are", () => {
    expect(studyNote(acc, "listen", 1)).toBe(acc);
    expect(studyNote(acc, "recall", 1)).toBe(acc);
    const plain = note({ word: "accommodate", examples: ["We accommodate guests."] });
    expect(studyNote(plain, "cloze", 4)).toBe(plain);
    expect(studyNote({ ...acc, type: "grammar" }, "cloze", 1).fields).toBe(acc.fields);
    expect(cloze.front(plain, L)).toEqual(cloze.front(studyNote(plain, "cloze", 4), L));
  });
  it("a phrase without a meaning never lets old translations slide onto it", () => {
    const n = note({ word: "accommodate", phrases: ["accommodate 200 guests"], vi: "chứa được", examples: ["Rooms accommodate guests."], examplesVi: ["Phòng chứa khách."] });
    const v = studyNote(n, "cloze", 0);
    expect(cloze.front(v, L)).toContainEqual({ k: "text", text: "chứa được", tone: "muted" });
    expect(v.fields.examplesVi).toEqual([]);
  });
  it("the stored note is not changed", () => {
    studyNote(acc, "cloze", 1);
    expect(acc.fields.examples).toEqual(["The hotel can accommodate a large group of tourists."]);
  });
});

describe("rotating the answer's examples", () => {
  it("leaves the phrases where they are and turns only the full sentences", () => {
    const blocks: Block[] = [
      ...phraseBlocks(acc),
      { k: "example", text: "S1" }, { k: "example", text: "S2" }, { k: "memo", text: "m" },
    ];
    const out = rotateExamples(blocks, 1).map((b) => (b.k === "memo" ? "m" : b.text));
    expect(out).toEqual(["accommodate 200 guests", "accommodate a request", "She accommodates new staff", "S2", "S1", "m"]);
  });
});
