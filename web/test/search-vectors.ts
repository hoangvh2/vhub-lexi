/**
 * Inputs and TypeScript outputs of the library search ranking (shared/search.ts), replayed by the Kotlin port
 * (android/core SearchVectorsTest). Written to shared/vectors/search.json by vectors.test.ts.
 */
import type { Note } from "@shared/model.ts";
import { compareHits, foldSearch, searchHit } from "@shared/search.ts";

const v = (id: string, word: string, vi: string, en = "", examples: string[] = [], createdAt = 1): Note => ({
  id, type: "vocab", deckId: "d1", fields: { word, vi, en, examples }, createdAt, updatedAt: 1,
});

/** VH's library as it looked when "determine" came last: newer words that only mention it in an example or definition. */
export function searchNotes(): Note[] {
  return [
    v("n1", "research", "sự nghiên cứu", "a careful study", ["Research helps us determine the cause."], 9),
    v("n2", "experiment", "(v) làm thí nghiệm", "a test to determine something", [], 8),
    v("n3", "bargain", "mặc cả, thỏa thuận", "", ["The price was determined by bargaining."], 7),
    v("n4", "success", "thành công", "", ["Hard work determines success."], 6),
    v("n5", "evaluate", "ước lượng, định giá", "to determine the value of", [], 5),
    v("n6", "resolve", "quyết tâm, giải quyết", "", ["She resolved to determine the truth."], 4),
    v("n7", "determine", "định, xác định, định rõ", "to find out", [], 3),
    v("n8", "determination", "sự quyết tâm", "", [], 2),
    v("n9", "predetermine", "định trước", "", [], 1),
    v("n10", "Determined", "kiên quyết", "", [], 10),
    v("n11", "identify", "nhận dạng, xác định", "", [], 11),
    { id: "g1", type: "grammar", deckId: "d1", fields: { sentence: "We need to [determine] the budget.", answer: "determine", translation: "Chúng ta cần xác định ngân sách." }, createdAt: 12, updatedAt: 1 },
    { id: "p1", type: "pattern", deckId: "d1", fields: { title: "Đại từ quan hệ", topic: "Mệnh đề quan hệ", items: [] }, createdAt: 13, updatedAt: 1 },
  ];
}

export function searchVectors() {
  const notes = searchNotes();
  const queries = ["determine", "  DETERMINE ", "determ", "xac dinh", "XÁC  ĐỊNH", "dai tu", "quan he", "nghiên", "zzz", "", "đ"];
  return {
    notes,
    fold: ["Xác Định", "ĐẠI  TỪ  ", "café au lait", "Ước lượng", "naïve"].map((s) => [s, foldSearch(s)]),
    queries: queries.map((q) => {
      const hits = notes.map((n) => ({ id: n.id, hit: searchHit(n, q) })).filter((x) => x.hit);
      // Newest first, as the library lists by default, then ranked (stable sort).
      hits.sort((a, b) => notes.find((n) => n.id === b.id)!.createdAt - notes.find((n) => n.id === a.id)!.createdAt);
      hits.sort((a, b) => compareHits(a.hit!, b.hit!));
      return { q, order: hits.map((x) => x.id), ranks: hits.map((x) => x.hit!.rank), lens: hits.map((x) => x.hit!.len) };
    }),
  };
}
