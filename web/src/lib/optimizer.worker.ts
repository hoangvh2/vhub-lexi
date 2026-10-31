/// <reference lib="webworker" />
/** Runs the FSRS optimizer off the main thread: the threadless WASI build trains synchronously. */
import { fit, type Answer, type FitOptions, type OptimizerBinding } from "./optimizer.ts";

export type WorkerRequest = { answers: Answer[]; options: Omit<FitOptions, "progress"> };
export type WorkerReply = { progress: [number, number] } | { result: Awaited<ReturnType<typeof fit>> } | { error: string };

const post = (m: WorkerReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

// The handler is registered first and the binding imported inside it: the binding fetches its WebAssembly with a
// top-level await, and a message that arrives while a static import is still pending has no handler to go to.
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const binding = (await import("@open-spaced-repetition/binding-wasm32-wasip1")) as unknown as OptimizerBinding;
    const result = await fit(binding, e.data.answers, { ...e.data.options, progress: (c, t) => post({ progress: [c, t] }) });
    post({ result });
  } catch (err) {
    post({ error: err instanceof Error ? err.message : String(err) });
  }
};
