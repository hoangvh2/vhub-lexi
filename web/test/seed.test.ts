import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CardState } from "@shared/model.ts";
import { parsePatternItem, patternItems } from "@shared/notetypes.ts";
import { planSeed, seedProblems } from "@shared/seed.ts";
import { reviewCard, removeNote, updateNote } from "../src/data/actions.ts";
import { LocalRepo } from "../src/data/local.ts";
import { applySeed, grammarPack } from "../src/data/seed.ts";
import { cards, currentRepo, decks, notes, startRepo, stopRepo } from "../src/data/state.ts";
import { GRAMMAR_PACK, buildPack } from "../../tools/seed/pack.ts";

const SEED_DIR = join(process.cwd(), "..", "shared", "seed");
let n = 0;
async function fresh(name = `seed-${++n}`) {
  stopRepo();
  await startRepo(new LocalRepo(name));
}

describe("built-in TOEIC grammar pack", () => {
  beforeEach(() => fresh());

  it("the shipped JSON is what the text compiles to, and has no problems", async () => {
    const text = readFileSync(join(SEED_DIR, GRAMMAR_PACK.text), "utf8");
    const json = readFileSync(join(SEED_DIR, GRAMMAR_PACK.json), "utf8");
    const built = buildPack(text);
    expect(built.problems).toEqual([]);
    expect(built.json).toBe(json);
    const pack = await grammarPack();
    expect(seedProblems(pack)).toEqual([]);
    expect(pack.notes.length).toBeGreaterThanOrEqual(50);
    for (const s of pack.notes) for (const line of patternItems({ id: s.id, type: s.type, deckId: "d", fields: s.fields, createdAt: 0, updatedAt: 0 }).map((i) => i.sentence)) expect(line).not.toMatch(/\[|\]/);
    expect(parsePatternItem(String((pack.notes[0].fields.items as string[])[0]))).not.toBeNull();
  });

  it("first start adds the deck, every note and its fill + rule cards; a second start adds nothing", async () => {
    const pack = await grammarPack();
    expect(await applySeed(currentRepo(), pack)).toBe(pack.notes.length);
    expect(decks.get().map((d) => d.name)).toEqual(["Ngữ pháp TOEIC"]);
    expect(notes.get()).toHaveLength(pack.notes.length);
    expect(cards.get()).toHaveLength(pack.notes.length * 2);
    expect(new Set(cards.get().map((c) => c.template))).toEqual(new Set(["fill", "rule"]));
    expect(await applySeed(currentRepo(), pack)).toBe(0);
    expect(notes.get()).toHaveLength(pack.notes.length);
    expect(cards.get()).toHaveLength(pack.notes.length * 2);
  });

  it("keeps the learner's progress, edits and deletions across restarts; Restore brings back only what is missing", async () => {
    const pack = await grammarPack();
    const name = `seed-keep-${++n}`;
    await fresh(name);
    await applySeed(currentRepo(), pack);
    const card = cards.get().find((c) => c.template === "fill")!;
    await reviewCard(card, 3, 1000, Date.now());
    const edited = notes.get().find((x) => x.id === pack.notes[1].id)!;
    await updateNote(edited, { fields: { ...edited.fields, tip: "Mẹo của tôi" } });
    const gone = pack.notes[2].id;
    await removeNote(notes.get().find((x) => x.id === gone)!);
    // Reinstall / another start on the same data.
    await fresh(name);
    expect(await applySeed(currentRepo(), pack)).toBe(0);
    expect(notes.get().some((x) => x.id === gone)).toBe(false);
    expect(cards.get().find((c) => c.id === card.id)!.state).not.toBe(CardState.New);
    expect(notes.get().find((x) => x.id === edited.id)!.fields.tip).toBe("Mẹo của tôi");
    // Restore ignores the marker: only the deleted note comes back, the rest stays as the learner left it.
    expect(await applySeed(currentRepo(), pack, { restore: true })).toBe(1);
    expect(notes.get().some((x) => x.id === gone)).toBe(true);
    expect(cards.get().find((c) => c.id === card.id)!.reps).toBe(1);
    expect(notes.get().find((x) => x.id === edited.id)!.fields.tip).toBe("Mẹo của tôi");
  });

  it("a later version adds only the notes marked since that version", async () => {
    const pack = await grammarPack();
    await applySeed(currentRepo(), pack);
    const extra = { ...pack.notes[0], id: `${pack.prefix}new-trap`, since: pack.version + 1 };
    const v2 = { ...pack, version: pack.version + 1, notes: [...pack.notes, extra] };
    const plan = planSeed(v2, (await currentRepo().seedState(v2))!.state)!;
    expect(plan.notes.map((x) => x.id)).toEqual([extra.id]);
    expect(plan.deck).toBeNull();
  });
});
