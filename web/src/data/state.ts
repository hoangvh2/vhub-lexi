import { DEFAULT_PREFS, normalizePrefs, type Card, type Daily, type Deck, type Note, type Prefs } from "@shared/model.ts";
import { createStore } from "../lib/store.ts";
import type { Repo, Snapshot, SyncState } from "./repo.ts";

export const decks = createStore<Deck[]>([]);
export const notes = createStore<Note[]>([]);
export const cards = createStore<Card[]>([]);
export const daily = createStore<Daily[]>([]);
export const prefs = createStore<Prefs>(DEFAULT_PREFS);
export const sync = createStore<SyncState>("loading");
/** False until the repo delivered its first data (so screens do not flash "empty"). */
export const loaded = createStore(false);
/** Latest sync problem for the UI to show once (a toast). */
export const warnings = createStore<string | null>(null);

let repo: Repo | null = null;

export function currentRepo(): Repo {
  if (!repo) throw new Error("Repo not started");
  return repo;
}

export async function startRepo(r: Repo): Promise<void> {
  repo?.stop();
  repo = r;
  loaded.set(false);
  let first = 0;
  await r.start({
    data(p: Partial<Snapshot>) {
      if (p.decks) decks.set(p.decks);
      if (p.notes) notes.set(p.notes);
      if (p.cards) cards.set(p.cards);
      if (p.daily) daily.set(p.daily);
      if ("prefs" in p) prefs.set(normalizePrefs(p.prefs));
      first |= (p.decks ? 1 : 0) | (p.notes ? 2 : 0) | (p.cards ? 4 : 0);
      if (first === 7) loaded.set(true);
    },
    sync: (s) => sync.set(s),
    warn: (m, e) => {
      console.error("[sync]", m, e);
      warnings.set(m);
    },
  });
}

export function stopRepo() {
  repo?.stop();
  repo = null;
  decks.set([]);
  notes.set([]);
  cards.set([]);
  daily.set([]);
  loaded.set(false);
}
