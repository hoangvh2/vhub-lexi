/// <reference lib="webworker" />
/** Runs the roadmap simulation off the main thread (about a second for a library of 600 words). */
import { simulate, type Roadmap, type SimInput } from "./roadmap.ts";

export type RoadmapRequest = SimInput;
export type RoadmapReply = { result: Roadmap | null } | { error: string };

self.onmessage = (e: MessageEvent<RoadmapRequest>) => {
  const post = (m: RoadmapReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
  try {
    post({ result: simulate(e.data) });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
