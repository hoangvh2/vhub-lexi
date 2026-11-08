/**
 * Loads the built-in study packs (shared/seed.ts) into the signed-in account. Safe to call on every start: the plan
 * asks the server what already exists, only adds what is missing and never rewrites a note or card the learner has.
 */
import type { Card } from "@shared/model.ts";
import { wantedTemplates } from "@shared/notetypes.ts";
import { planSeed, type SeedPack } from "@shared/seed.ts";
import { newCard } from "../lib/scheduler.ts";
import type { Repo } from "./repo.ts";
import { cards, currentRepo, decks, notes, prefs } from "./state.ts";

export const grammarPack = async (): Promise<SeedPack> => (await import("@shared/seed/grammar-toeic.json")).default as SeedPack;

/**
 * Writes what `pack` still lacks. `restore` ignores the "already loaded" marker, so notes the learner deleted come
 * back (Settings button). Returns the number of notes added, or null when the server could not be asked.
 */
export async function applySeed(repo: Repo, pack: SeedPack, opts: { restore?: boolean } = {}): Promise<number | null> {
  const server = await repo.seedState(pack, { ignoreMarker: opts.restore });
  if (!server) return null;
  const plan = planSeed(pack, server.state);
  if (!plan) return 0;
  // Also skip what this device already shows (written by another device, not yet on the server's answer).
  const localNotes = new Set(notes.get().map((n) => n.id));
  const localCards = new Set(cards.get().map((c) => c.id));
  const add = plan.notes.filter((n) => !localNotes.has(n.id));
  const newCards: Card[] = [];
  for (const n of add) {
    for (const t of wantedTemplates(n, prefs.get().templates)) {
      const c = newCard(n.id, n.deckId, t, n.createdAt);
      if (!server.cardIds.has(c.id) && !localCards.has(c.id)) newCards.push(c);
    }
  }
  if (add.length && plan.deck && !decks.get().some((d) => d.id === plan.deck!.id)) await repo.saveDeck(plan.deck);
  if (add.length) await repo.saveMany(add, newCards);
  await repo.markSeed(pack.id, plan.version);
  return add.length;
}

let running: Promise<number | null> | null = null;

/** Loads every built-in pack once at a time (a second call while one runs gets the same answer). */
export function loadSeeds(opts: { restore?: boolean } = {}): Promise<number | null> {
  running ??= (async () => {
    try {
      return await applySeed(currentRepo(), await grammarPack(), opts);
    } catch (e) {
      console.warn("[seed] not loaded", e);
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}
