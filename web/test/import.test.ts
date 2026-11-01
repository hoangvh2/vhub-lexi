import { describe, expect, it } from "vitest";
import { aiFieldsOf, answerOf, draftsFrom, grammarFields, problems, recommended, type Extracted, type ExtractedQuestion } from "../src/lib/import.ts";

const q = (o: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  number: 132, part: 6, kind: "fill", stem: "Many fans are already _____ that it will be a sequel.",
  options: { A: "requesting", B: "analyzing", C: "confirming", D: "speculating" }, correct: "D", result: "wrong", passage: 1,
  topic: "Khác", rule: "speculating that: đoán rằng.", translation: "Nhiều người hâm mộ đã suy đoán.", flags: [], ...o,
});
const none = new Set<string>();
const one = (o?: Partial<ExtractedQuestion>, ex: ReadonlySet<string> = none) => draftsFrom({ passages: [], questions: [q(o)] }, ex).drafts[0];

describe("rows from the function's answer", () => {
  it("builds the grammar note a row becomes: the answer fills the blank", () => {
    const d = one();
    expect(answerOf(d)).toBe("speculating");
    expect(grammarFields(d)).toEqual({ sentence: "Many fans are already speculating that it will be a sequel.", answer: "speculating", topic: "Khác", translation: "Nhiều người hâm mộ đã suy đoán.", rule: "speculating that: đoán rằng." });
    expect(problems(d, none)).toEqual({ block: [], warn: [] });
    expect(d.include).toBe(true);
  });
  it("selects only questions the learner missed or has no result for, that pass every check", () => {
    expect(one({ result: "right" }).include).toBe(false);
    expect(one({ result: "unknown" }).include).toBe(true);
    expect(one({ flags: ["unsure"] }).include).toBe(false);
    expect(one({ correct: null }).include).toBe(false);
    expect(one({ stem: "No blank in this sentence." }).include).toBe(false);
  });
  it("blocks a row without an answer or blank, and flags duplicates", () => {
    expect(problems(one({ correct: null }), none).block).toEqual(["no-answer"]);
    expect(problems(one({ stem: "No blank in this sentence." }), none).block).toEqual(["no-blank"]);
    const full = "many fans are already speculating that it will be a sequel.";
    expect(problems(one({}, new Set([full])), new Set([full])).warn).toEqual(["duplicate"]);
    expect(one({}, new Set([full])).include).toBe(false);
  });
  it("an answer that is not an option is dropped; a Part 7 or insert question is counted, not carded", () => {
    expect(one({ correct: "B", options: { A: "a", B: "", C: "c", D: "d" } }).correct).toBeNull();
    const r: Extracted = { passages: [], questions: [q(), q({ kind: "reading", stem: "What is the email about?" }), q({ kind: "insert", stem: "" })] };
    const { drafts, skipped } = draftsFrom(r, none);
    expect(drafts).toHaveLength(1);
    expect(skipped).toBe(2);
  });
  it("changing the answer by hand re-evaluates the row", () => {
    const d = { ...one({ correct: null }), correct: "C" as const };
    expect(recommended(d, none)).toBe(true);
    expect(grammarFields(d).sentence).toBe("Many fans are already confirming that it will be a sequel.");
  });
  it("labels as AI only what the learner did not edit", () => {
    const d = one();
    expect(aiFieldsOf(d)).toEqual(["topic", "rule", "translation"]);
    expect(aiFieldsOf({ ...d, edited: ["rule"], translation: "" })).toEqual(["topic"]);
  });
});
