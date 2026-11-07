/**
 * "Chẩn đoán độ trễ" (Settings): what one rating costs on the learner's own device, so a slow phone can be diagnosed
 * from numbers instead of a screen recording. Kept in memory only (nothing is stored or sent anywhere).
 *
 * For each rating: time from the tap to the next card on screen (two animation frames after it rendered, so the
 * browser has painted it), the main-thread long tasks in the 5 s after the tap (what makes the page "freeze"), and the
 * Firestore snapshots that arrived meanwhile (which listener, how many documents, how many changed, how long our
 * handler took).
 */
export interface SnapStat {
  name: string;
  docs: number;
  changes: number;
  ms: number;
}
export interface RateTrace {
  at: number;
  /** Tap to the next card painted; null when no card followed (end of session). */
  toCardMs: number | null;
  longTasks: number[];
  snaps: SnapStat[];
}

const WINDOW_MS = 5000;
const KEEP = 30;
const traces: RateTrace[] = [];
let open: { t0: number; trace: RateTrace } | null = null;
let observing = false;

function observe() {
  if (observing || typeof PerformanceObserver === "undefined") return;
  observing = true;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const o = open;
        if (o && e.startTime + e.duration >= o.t0 && e.startTime <= o.t0 + WINDOW_MS) o.trace.longTasks.push(Math.round(e.duration));
      }
    }).observe({ type: "longtask", buffered: false });
  } catch {
    // Long tasks are not reported by this browser (Safari): the card timing still works.
  }
}

/** The learner tapped a rating. */
export function rateStarted() {
  observe();
  const trace: RateTrace = { at: Date.now(), toCardMs: null, longTasks: [], snaps: [] };
  traces.push(trace);
  if (traces.length > KEEP) traces.shift();
  const t0 = performance.now();
  open = { t0, trace };
  setTimeout(() => {
    if (open?.trace === trace) open = null;
  }, WINDOW_MS);
}

/** The next card has rendered (called from an effect); measured once it is painted. */
export function cardShown() {
  const o = open;
  if (!o || o.trace.toCardMs !== null) return;
  requestAnimationFrame(() => requestAnimationFrame(() => (o.trace.toCardMs = Math.round(performance.now() - o.t0))));
}

/** A Firestore snapshot was handled (cloud repo). */
export function snapshotHandled(s: SnapStat) {
  open?.trace.snaps.push({ ...s, ms: Math.round(s.ms * 10) / 10 });
}

export function rateTraces(): readonly RateTrace[] {
  return traces;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Plain text for the learner to copy into a message. */
export function traceReport(build: string, ua: string): string {
  const done = traces.filter((t) => t.toCardMs !== null);
  const lines = [
    `VH Lexi ${build} · ${ua}`,
    `Lần chấm: ${traces.length}, chuyển thẻ trung vị ${median(done.map((t) => t.toCardMs!)) ?? "-"} ms, lâu nhất ${done.length ? Math.max(...done.map((t) => t.toCardMs!)) : "-"} ms`,
  ];
  for (const t of traces) {
    const lt = t.longTasks.reduce((a, b) => a + b, 0);
    const snaps = t.snaps.map((s) => `${s.name}:${s.docs}/${s.changes}/${s.ms}ms`).join(" ");
    lines.push(`${new Date(t.at).toLocaleTimeString("vi-VN")} thẻ ${t.toCardMs ?? "-"} ms · treo ${lt} ms (${t.longTasks.length} lần, lâu nhất ${Math.max(0, ...t.longTasks)} ms) · ${snaps || "không có snapshot"}`);
  }
  return lines.join("\n");
}
