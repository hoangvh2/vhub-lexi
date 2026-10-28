import type { Card, Id, Note } from "@shared/model.ts";
import { template } from "@shared/notetypes.ts";

/** Builds the `eligible` predicate for the queue from the current notes. */
export function eligibility(notes: readonly Note[]): (c: Card) => boolean {
  const byId = new Map<Id, Note>(notes.map((n) => [n.id, n]));
  return (c) => {
    const n = byId.get(c.noteId);
    if (!n) return false;
    const t = template(n.type, c.template);
    return !!t && t.applies(n);
  };
}

export function notesById(notes: readonly Note[]): Map<Id, Note> {
  return new Map(notes.map((n) => [n.id, n]));
}
