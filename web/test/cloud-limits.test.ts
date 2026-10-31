// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIMITS, REVIEW_PAGE } from "../src/data/cloud.ts";

// Production Firestore refuses a query whose limit is over 10,000 ("Limit value in the structured query is over the
// maximum value of 10000"); the emulator does not, so the integration tests cannot catch it.
const FIRESTORE_MAX = 10_000;

describe("Firestore query limits", () => {
  it("every query asks for at most 10,000 documents", () => {
    for (const [k, v] of Object.entries(LIMITS)) expect(v, k).toBeLessThanOrEqual(FIRESTORE_MAX);
    expect(REVIEW_PAGE).toBeLessThanOrEqual(FIRESTORE_MAX);
    const src = readFileSync(new URL("../src/data/cloud.ts", import.meta.url), "utf8");
    const limits = [...src.matchAll(/limit\(([^)]+)\)/g)].map((m) => m[1].trim());
    expect(limits.length).toBeGreaterThan(0);
    for (const l of limits) {
      const n = /^\d[\d_]*$/.test(l) ? Number(l.replaceAll("_", "")) : /^LIMITS\.(\w+)$/.test(l) ? LIMITS[l.slice(7) as keyof typeof LIMITS] : l === "REVIEW_PAGE" ? REVIEW_PAGE : l === "n" ? 0 : NaN;
      expect(n, `limit(${l})`).toBeLessThanOrEqual(FIRESTORE_MAX);
    }
  });
});
