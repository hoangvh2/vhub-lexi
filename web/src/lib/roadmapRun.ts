import { simulate, type Roadmap, type SimInput } from "./roadmap.ts";
import type { RoadmapReply } from "./roadmap.worker.ts";

export interface Run {
  promise: Promise<Roadmap | null>;
  cancel(): void;
}

/** Runs `simulate` in a Worker; without Worker support (tests) it runs on the next tick. Cancelling drops the result. */
export function runRoadmap(input: SimInput): Run {
  if (typeof Worker === "undefined") {
    let dead = false;
    const promise = new Promise<Roadmap | null>((resolve, reject) =>
      setTimeout(() => {
        if (dead) return;
        try {
          resolve(simulate(input));
        } catch (e) {
          reject(e);
        }
      }, 0),
    );
    return { promise, cancel: () => (dead = true) };
  }
  const worker = new Worker(new URL("./roadmap.worker.ts", import.meta.url), { type: "module" });
  const promise = new Promise<Roadmap | null>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<RoadmapReply>) => {
      worker.terminate();
      if ("result" in e.data) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Không tính được dự báo"));
    };
    worker.postMessage(input);
  });
  return { promise, cancel: () => worker.terminate() };
}
