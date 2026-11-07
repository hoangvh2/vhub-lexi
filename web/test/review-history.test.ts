// @vitest-environment node
/**
 * The study screen asks for one word's answer history on every new card (hint lock). The full Firestore SDK runs
 * every query against its persistent cache as well, which without a client-side index scans the whole reviews
 * collection on the main thread: ~2 s per card on a phone-speed CPU with an Anki history of 20,000 logs. The history
 * must come from the server (Firestore Lite), and the study screen must never fall back to the cached query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const full = vi.hoisted(() => ({ getDocs: vi.fn() }));
const lite = vi.hoisted(() => ({ getDocs: vi.fn() }));

vi.mock("firebase/firestore", async (orig) => ({ ...(await orig<typeof import("firebase/firestore")>()), getDocs: full.getDocs }));
vi.mock("firebase/firestore/lite", async (orig) => ({ ...(await orig<typeof import("firebase/firestore/lite")>()), getDocs: lite.getDocs }));
vi.mock("../src/data/fbimpl.ts", () => ({ firebase: () => { throw new Error("not used"); } }));

import { initializeApp } from "firebase/app";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { getFirestore as getLite } from "firebase/firestore/lite";
import { CloudRepo } from "../src/data/cloud.ts";

const app = initializeApp({ apiKey: "fake", projectId: "demo-lexi", appId: "1:1:web:1" }, "history");
const db = initializeFirestore(app, { localCache: memoryLocalCache() });
const repo = new CloudRepo("u1", db, getLite(app));
const snap = (logs: Array<{ id: string; reviewedAt: number }>) => ({ docs: logs.map((l) => ({ data: () => ({ ...l, noteId: "n1" }) })) });

beforeEach(() => {
  full.getDocs.mockReset();
  lite.getDocs.mockReset();
});

describe("CloudRepo.reviewsOfNote", () => {
  it("asks the server through Firestore Lite, never the cached query, and sorts oldest first", async () => {
    lite.getDocs.mockResolvedValue(snap([{ id: "n1.cloze@9", reviewedAt: 9 }, { id: "n1.recognize@3", reviewedAt: 3 }]));
    const logs = await repo.reviewsOfNote("n1", { cache: false });
    expect(logs.map((l) => l.reviewedAt)).toEqual([3, 9]);
    expect(lite.getDocs).toHaveBeenCalledTimes(1);
    expect(full.getDocs).not.toHaveBeenCalled();
  });

  it("study screen (cache: false): an unreachable server fails instead of scanning the cache", async () => {
    lite.getDocs.mockRejectedValue(Object.assign(new Error("offline"), { code: "unavailable" }));
    await expect(repo.reviewsOfNote("n1", { cache: false })).rejects.toThrow("offline");
    expect(full.getDocs).not.toHaveBeenCalled();
  });

  it("card info (default): offline it still answers from the cache", async () => {
    lite.getDocs.mockRejectedValue(new Error("offline"));
    full.getDocs.mockResolvedValue(snap([{ id: "n1.recognize@4", reviewedAt: 4 }]));
    expect((await repo.reviewsOfNote("n1")).map((l) => l.id)).toEqual(["n1.recognize@4"]);
  });

  it("the study screen asks with cache: false", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/ui/Study.tsx", import.meta.url), "utf8");
    const calls = [...src.matchAll(/reviewsOfNote\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(["note.id, { cache: false }"]);
  });
});
