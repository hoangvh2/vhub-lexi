/**
 * Documents exactly as the app writes them. tests/rules/rules.test.mjs replays these against the
 * Firestore rules, so a change to the data model that the rules would reject fails CI.
 * Regenerate with: UPDATE_FIXTURES=1 npx vitest run test/fixtures.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DEFAULT_PREFS, cardId, dayId, normalizePrefs, reviewId, type Daily, type DailyDelta, type Note, type ReviewLog } from "@shared/model.ts";
import { applyDelta } from "../src/data/local.ts";
import { answer, makeScheduler, newCard } from "../src/lib/scheduler.ts";

const T = Date.UTC(2026, 0, 15, 3, 0, 0);

function build() {
  const sched = makeScheduler(0.9);
  const note: Note = {
    id: "note1", type: "vocab", deckId: "deck1", createdAt: T, updatedAt: T, tags: ["toeic"], aiFields: ["vi"],
    fields: { word: "resilient", ipa: "rɪˈzɪljənt", pos: "adjective", vi: "kiên cường", en: "able to recover quickly", examples: ["Children are resilient."], mnemonic: "re-silient: springs back" },
  };
  const fresh = newCard("note1", "deck1", "recognize", T);
  const learning = answer(sched, fresh, 3, T);
  const review = answer(sched, newCard("note1", "deck1", "cloze", T), 4, T);
  const lapsed = answer(sched, review, 1, review.due);
  const suspended = { ...fresh, id: cardId("note1", "recall"), template: "recall", suspended: true };
  const log: ReviewLog = {
    id: reviewId(fresh.id, T), cardId: fresh.id, noteId: "note1", deckId: "deck1", rating: 3, state: 0,
    stability: learning.stability, difficulty: learning.difficulty, scheduledDays: learning.scheduledDays, reviewedAt: T, durationMs: 4200, device: "web",
  };
  const delta: DailyDelta = { id: dayId(T, 4), newCards: 1, reviews: 0, rating: 3, ms: 4200 };
  const daily: Daily = applyDelta(undefined, delta, 1, T);
  return {
    deck: { id: "deck1", name: "Mặc định", createdAt: T, updatedAt: T },
    note,
    cards: { fresh, learning, review, lapsed, suspended },
    review: log,
    daily,
    delta,
    prefs: normalizePrefs({ ...DEFAULT_PREFS, newPerDay: 10, updatedAt: T }),
  };
}

it("fixtures for the rules tests match what the app produces", () => {
  const file = join(__dirname, "../../tests/rules/fixtures.json");
  const json = JSON.stringify(build(), null, 2) + "\n";
  if (process.env.UPDATE_FIXTURES || !existsSync(file)) writeFileSync(file, json);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(json));
});
