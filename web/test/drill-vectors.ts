/**
 * Inputs and TypeScript outputs of the "Từ hay quên" helpers (shared/drill.ts), replayed by the Kotlin port
 * (android/core DrillVectorsTest). Written to shared/vectors/drill.json by vectors.test.ts.
 */
import type { Note } from "@shared/model.ts";
import { afterAnswer, drillRound, forgotNotes, forgotOf, meaningOptions, shortMeaning, withForgot, type DrillItem } from "@shared/drill.ts";

const v = (id: string, word: string, vi: string, pos = "", extra: Partial<Note> = {}): Note => ({
  id, type: "vocab", deckId: "d1", fields: { word, vi, pos }, createdAt: 1, updatedAt: 1, ...extra,
});

export function drillNotes(): Note[] {
  return [
    v("n01", "postpone", "hoãn lại; trì hoãn", "verb", { forgot: ["meaning"], forgotAt: 500 }),
    v("n02", "delay", "trì hoãn; sự chậm trễ", "verb"),
    v("n03", "receipt", "biên lai, hoá đơn", "noun", { forgot: ["sound"], forgotAt: 900 }),
    v("n04", "invoice", "hoá đơn", "noun"),
    v("n05", "venue", "địa điểm tổ chức", "noun", { forgot: ["meaning", "sound"], forgotAt: 700 }),
    v("n06", "attend", "tham dự", "verb"),
    v("n07", "launch", "ra mắt (sản phẩm)", "verb"),
    v("n08", "budget", "ngân sách", "noun"),
    v("n09", "colleague", "đồng nghiệp", "noun"),
    v("n10", "reimburse", "hoàn tiền; bồi hoàn", "verb", { forgot: ["meaning"], forgotAt: 700 }),
    v("n11", "nomeaning", "", "noun", { forgot: ["meaning"], forgotAt: 100 }),
    v("n12", "seat", "chỗ ngồi; ghế", "noun", { forgot: ["spelling" as "meaning", "sound"], forgotAt: 50 }),
    { id: "g1", type: "grammar", deckId: "d1", fields: { sentence: "x", answer: "y" }, forgot: ["meaning"], forgotAt: 999, createdAt: 1, updatedAt: 1 },
    v("n13", "long", "một nghĩa rất dài ".repeat(6).trim() + "; nghĩa hai", "adj"),
  ];
}

const ids = (items: DrillItem[]) => items.map((i) => `${i.noteId}/${i.mode}${i.options ? ":" + i.options.join(",") : ""}`);

export function drillVectors() {
  const notes = drillNotes();
  const marked = forgotNotes(notes);
  const small = [v("s1", "alpha", "một", "", { forgot: ["meaning"], forgotAt: 1 }), v("s2", "beta", "hai")];
  const queue: DrillItem[] = ["a", "b", "c", "d", "e"].map((noteId) => ({ noteId, mode: "recall" }));
  const toggles: Array<[string, "meaning" | "sound", boolean]> = [["n02", "meaning", true], ["n01", "meaning", false], ["n01", "sound", true], ["n05", "sound", false], ["n05", "meaning", true], ["n03", "sound", true], ["n12", "sound", false]];
  return {
    notes,
    forgotOf: notes.map((n) => forgotOf(n)),
    shortMeaning: notes.map((n) => shortMeaning(n)),
    forgotNotes: marked.map((n) => n.id),
    withForgot: toggles.map(([id, kind, on]) => {
      const n = withForgot(notes.find((x) => x.id === id)!, kind, on, 2000);
      return { id, kind, on, forgot: n.forgot ?? null, forgotAt: n.forgotAt ?? null, updatedAt: n.updatedAt };
    }),
    meaningOptions: ["n01", "n05", "n10", "n02", "n04"].flatMap((id) => ["s", "t"].map((seed) => ({ id, seed, out: meaningOptions(notes.find((x) => x.id === id)!, notes, seed) }))),
    meaningOptionsSmall: meaningOptions(small[0], small, "s"),
    drillRound: ["seed-a", "seed-b", ""].map((seed) => ({ seed, out: ids(drillRound(marked, notes, seed)) })),
    drillRoundSmall: ids(drillRound(forgotNotes(small), small, "s")),
    afterAnswer: [
      { right: true, out: afterAnswer(queue, true).map((i) => i.noteId) },
      { right: false, out: afterAnswer(queue, false).map((i) => i.noteId) },
      { right: false, short: true, out: afterAnswer(queue.slice(0, 2), false).map((i) => i.noteId) },
      { right: false, single: true, out: afterAnswer(queue.slice(0, 1), false).map((i) => i.noteId) },
    ],
  };
}
