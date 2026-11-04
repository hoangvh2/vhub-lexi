import { describe, expect, it } from "vitest";
import type { Note } from "@shared/model.ts";
import type { Block } from "@shared/notetypes.ts";
import { hintCue, hintDependent, hintGateMs, maskHint, maxRating, meaningTerms, rotateExamples, type Seg } from "@shared/hints.ts";

const note = (fields: Record<string, string>): Note => ({ id: "n", type: "vocab", deckId: "d", fields, createdAt: 0, updatedAt: 0 });
const shown = (segs: Seg[]) => segs.map((s) => (s.masked ? "▢" : s.text)).join("");

describe("hint gate and rating cap", () => {
  it("waits only on review cards, longer when the memory is strong", () => {
    expect(hintGateMs({ state: 0, stability: 0 })).toBe(0);
    expect(hintGateMs({ state: 1, stability: 0.4 })).toBe(0);
    expect(hintGateMs({ state: 3, stability: 30 })).toBe(0);
    expect(hintGateMs({ state: 2, stability: 5 })).toBe(4000);
    expect(hintGateMs({ state: 2, stability: 21 })).toBe(6000);
  });
  it("level 1 takes away Easy, level 2 everything above Hard", () => {
    expect([0, 1, 2].map((l) => maxRating(l as 0 | 1 | 2))).toEqual([4, 3, 2]);
  });
});

describe("masking the answer", () => {
  const protect = note({ word: "protect", vi: "bảo vệ, sự bảo vệ, che chở" });
  it("splits meanings, drops context labels and tiny pieces, longest first", () => {
    expect(meaningTerms("(cốt lõi) cho thấy rõ; (công việc) trình diễn, hướng dẫn; có")).toEqual(["cho thấy rõ", "trình diễn", "hướng dẫn"]);
    expect(meaningTerms("bảo vệ, sự bảo vệ, che chở")).toEqual(["sự bảo vệ", "che chở", "bảo vệ"]);
  });
  it("recognize cards hide the Vietnamese meaning, whole words only, any case", () => {
    expect(shown(maskHint('Đọc như "pờ-rô tếch": thủ môn Tếch lao ra Bảo vệ khung thành.', protect, "recognize"))).toBe('Đọc như "pờ-rô tếch": thủ môn Tếch lao ra ▢ khung thành.');
    expect(shown(maskHint("Khác prevent; protect A from B, che chở ai đó.", protect, "recognize"))).toBe("Khác prevent; protect A from B, ▢ ai đó.");
    // "bảo vệt" is not the word "bảo vệ".
    expect(shown(maskHint("bảo vệt", protect, "recognize"))).toBe("bảo vệt");
  });
  it("cards that ask for the English word hide every form of it instead", () => {
    expect(shown(maskHint("protect A from B; protected, protecting. Che chở.", protect, "recall"))).toBe("▢ A from B; ▢, ▢. Che chở.");
  });
  it("leaves a text without the answer as one plain part", () => {
    expect(maskHint("Thủ môn lao ra.", protect, "recognize")).toEqual([{ text: "Thủ môn lao ra.", masked: false }]);
    expect(maskHint("", protect, "recognize")).toEqual([]);
  });
});

describe("cue (level 1)", () => {
  it("keeps only the sound of a sound-alike tip", () => {
    expect(hintCue('Đọc như "con vịt": Cố thuyết phục một con vịt biết nói tiếng Anh.')).toBe('Đọc như "con vịt"…');
  });
  it("keeps the first clause, at most six words", () => {
    expect(hintCue("rely (dựa vào) + able (được): dựa vào được, tức đáng tin cậy.")).toBe("rely (dựa vào) + able (được)…");
    expect(hintCue("Một hai ba bốn năm sáu bảy tám chín")).toBe("Một hai ba bốn năm sáu…");
    expect(hintCue("Ngắn gọn")).toBe("Ngắn gọn");
    expect(hintCue("Dòng một\nDòng hai")).toBe("Dòng một…");
    expect(hintCue("Khác prevent. Dùng protect A from B.")).toBe("Khác prevent…");
  });
});

describe("leaning on hints", () => {
  const log = (t: number, rating: number, hint = 0) => ({ reviewedAt: t, rating, hint });
  it("3 of the last 5 answers with a hint", () => {
    expect(hintDependent([log(1, 3, 1), log(2, 3, 2), log(3, 2, 1)])).toBe(true);
    expect(hintDependent([log(1, 3, 1), log(2, 3, 2), log(3, 2)])).toBe(false);
    // Older answers fall out of the window.
    expect(hintDependent([log(1, 3, 1), log(2, 3, 1), log(3, 3, 1), log(4, 2), log(5, 1), log(6, 2), log(7, 1), log(8, 2)])).toBe(false);
  });
  it("two clean Good answers in a row clear it at once", () => {
    expect(hintDependent([log(1, 3, 1), log(2, 3, 1), log(3, 3, 1), log(4, 3), log(5, 4)])).toBe(false);
    expect(hintDependent([log(1, 3, 1), log(2, 3, 1), log(3, 3, 1), log(4, 3), log(5, 2)])).toBe(true);
  });
  it("logs from before hints existed count as no hint", () => {
    expect(hintDependent([{ reviewedAt: 1, rating: 3 }, { reviewedAt: 2, rating: 1 }])).toBe(false);
  });
});

describe("rotating examples", () => {
  const ex = (t: string): Block => ({ k: "example", text: t });
  const blocks: Block[] = [{ k: "text", text: "bảo vệ" }, ex("A"), ex("B"), ex("C"), { k: "memo", text: "m" }];
  it("starts the list at a different example each review, keeping other blocks in place", () => {
    expect(rotateExamples(blocks, 0)).toBe(blocks);
    expect(rotateExamples(blocks, 1).map((b) => b.text)).toEqual(["bảo vệ", "B", "C", "A", "m"]);
    expect(rotateExamples(blocks, 5).map((b) => b.text)).toEqual(["bảo vệ", "C", "A", "B", "m"]);
    expect(rotateExamples([ex("A")], 3)).toEqual([ex("A")]);
  });
});
