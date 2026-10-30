import type { FieldValue, Id, Note } from "@shared/model.ts";
import { list, str } from "@shared/notetypes.ts";
import { mergeEnrich, type Enriched, type MergeOptions } from "./enrich.ts";
import { createStore } from "./store.ts";

/** Why a batch ended early. */
export type StopReason = "cancel" | "quota" | "auth";

export interface BatchProgress {
  running: boolean;
  total: number;
  /** Notes filled. */
  done: number;
  /** Notes that failed after a retry, or were not vocab notes with a word. */
  failed: number;
  stopped?: StopReason;
}

/** The batch on screen. Lives outside any component, so it keeps running while the learner switches tabs. */
export const aiBatch = createStore<BatchProgress | null>(null);

export interface BatchDeps {
  call(word: string, hints: { pos?: string; en?: string; examples?: string[] }): Promise<Enriched>;
  /** The note as it is now (the learner may have edited it while the batch ran). */
  getNote(id: Id): Note | undefined;
  save(note: Note, fields: Record<string, FieldValue>, aiFields: string[]): Promise<void>;
  /** Parallel calls. The function allows 3 instances × 8; Gemini's free tier allows about 15 a minute. */
  concurrency?: number;
  retryDelayMs?: number;
}

let cancelled = false;

/** Stops after the calls already in flight; their answers are still saved. */
export function stopBatch() {
  cancelled = true;
}

const codeOf = (e: unknown) => String((e as { code?: string })?.code ?? "");

/**
 * Fills the selected notes with AI, a few at a time, saving each note as soon as its answer arrives.
 * Ends early, keeping what was saved, when the learner stops it, the daily allowance runs out, or the
 * account is refused. A note that fails twice is counted and skipped.
 */
export async function runBatch(ids: readonly Id[], deps: BatchDeps, opts: MergeOptions = {}): Promise<BatchProgress> {
  if (aiBatch.get()?.running) throw new Error("A batch is already running");
  cancelled = false;
  let p: BatchProgress = { running: true, total: ids.length, done: 0, failed: 0 };
  const publish = (patch: Partial<BatchProgress>) => aiBatch.set((p = { ...p, ...patch }));
  publish({});
  const queue = [...ids];
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function one(id: Id): Promise<void> {
    const before = deps.getNote(id);
    const word = before && before.type === "vocab" ? str(before.fields.word) : "";
    if (!before || !word) return publish({ failed: p.failed + 1 });
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await deps.call(word, { pos: str(before.fields.pos) || undefined, en: str(before.fields.en) || undefined, examples: list(before.fields.examples) });
        const now = deps.getNote(id);
        if (!now) return publish({ failed: p.failed + 1 });
        const m = mergeEnrich(now.fields, now.aiFields ?? [], r, opts);
        await deps.save(now, m.fields, m.aiFields);
        return publish({ done: p.done + 1 });
      } catch (e) {
        const code = codeOf(e);
        if (code.includes("resource-exhausted")) return publish({ stopped: "quota" });
        if (code.includes("permission-denied") || code.includes("unauthenticated")) return publish({ stopped: "auth" });
        if (attempt >= 1 || code.includes("invalid-argument") || cancelled) return publish({ failed: p.failed + 1 });
        await wait(deps.retryDelayMs ?? 4_000);
      }
    }
  }

  async function worker() {
    while (queue.length && !cancelled && !p.stopped) await one(queue.shift()!);
  }
  await Promise.all(Array.from({ length: Math.max(1, deps.concurrency ?? 3) }, worker));
  publish({ running: false, ...(cancelled && queue.length && !p.stopped ? { stopped: "cancel" as const } : {}) });
  return p;
}

/**
 * Replacing meanings the learner or a dictionary wrote cannot be undone, so that choice asks first
 * (CLAUDE.md); filling only empty or AI-written fields starts straight away. Null when the learner says no.
 */
export async function confirmAndRun(
  ids: readonly Id[],
  opts: MergeOptions,
  deps: BatchDeps & { confirm(o: { title: string; message: string; confirm: string; danger: boolean }): Promise<boolean> },
): Promise<BatchProgress | null> {
  if (opts.overwriteVi) {
    const ok = await deps.confirm({
      title: `Thay nghĩa tiếng Việt của ${ids.length} từ?`,
      message: "Nghĩa bạn hoặc từ điển đã ghi sẽ bị thay bằng nghĩa theo ngữ cảnh do AI viết. Không hoàn tác được.",
      confirm: "Thay và chạy",
      danger: true,
    });
    if (!ok) return null;
  }
  return runBatch(ids, deps, opts);
}
