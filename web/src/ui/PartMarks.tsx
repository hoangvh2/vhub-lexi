import { useEffect, useMemo, useState } from "preact/hooks";
import { saveTestSet, testSets } from "../data/testsets.ts";
import { useStore } from "../lib/store.ts";
import { clearMark, formatClock, markParts, parseClock, partWindow, setMark, trackOf, type Field, type MarkError, type PartCuts } from "../lib/partmarks.ts";
import type { TestSet } from "../lib/testset.ts";
import { Icon, confirmDialog, toast } from "./common.tsx";
import { usePlayer, type Player } from "./listen.tsx";

/** One mark change at a time, on the stored set (not the copy a screen started with). */
let cutsQueue: Promise<void> = Promise.resolve();
function updateCuts(id: string, fn: (c: PartCuts) => PartCuts): Promise<void> {
  cutsQueue = cutsQueue.then(async () => {
    const stored = testSets.get().find((x) => x.id === id);
    if (!stored) return;
    const cuts = fn(stored.cuts ?? {});
    if (cuts === (stored.cuts ?? {})) return;
    const { cuts: _old, ...rest } = stored;
    await saveTestSet(Object.keys(cuts).length ? { ...rest, cuts } : rest);
  }).catch(() => toast("Không lưu được trên máy này"));
  return cutsQueue;
}

const ERRORS: Record<MarkError, string> = {
  negative: "Thời gian không hợp lệ.",
  order: "Mốc phải tăng dần: Part sau không được nằm trước Part trước, và Part phải kết thúc sau khi bắt đầu.",
};

/** A row of the editor: one moment to set. A boundary is the end of one Part and the start of the next. */
type Row =
  | { id: string; kind: "start"; part: number; label: string; note: string }
  | { id: string; kind: "end"; part: number; label: string; note: string }
  | { id: string; kind: "bound"; a: number; b: number; label: string; note: string };

/** The rows for a set's Parts: the first start, a boundary between each pair (two rows once the learner pulled them apart), the last end. */
function rowsOf(cuts: PartCuts, order: readonly number[]): Row[] {
  const rows: Row[] = [];
  const first = order[0];
  rows.push({ id: `s${first}`, kind: "start", part: first, label: `Bắt đầu Part ${first}`, note: "mặc định 0:00" });
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i];
    const b = order[i + 1];
    const e = cuts[String(a)]?.end;
    const s = cuts[String(b)]?.start;
    if (e !== undefined && s !== undefined && e !== s) {
      rows.push({ id: `e${a}`, kind: "end", part: a, label: `Kết thúc Part ${a}`, note: "" });
      rows.push({ id: `s${b}`, kind: "start", part: b, label: `Bắt đầu Part ${b}`, note: "" });
    } else rows.push({ id: `b${a}`, kind: "bound", a, b, label: `Part ${a} | Part ${b}`, note: "kết thúc Part " + a + " cũng là bắt đầu Part " + b });
  }
  const last = order[order.length - 1];
  rows.push({ id: `e${last}`, kind: "end", part: last, label: `Kết thúc Part ${last}`, note: "mặc định hết file" });
  return rows;
}

/** The time a row holds, if it is set. */
function valueOf(cuts: PartCuts, r: Row): number | undefined {
  if (r.kind === "start") return cuts[String(r.part)]?.start;
  if (r.kind === "end") return cuts[String(r.part)]?.end;
  return cuts[String(r.a)]?.end ?? cuts[String(r.b)]?.start;
}

const SKIPS = [-10_000, -5_000, -1_000, 1_000, 5_000, 10_000];
const skipLabel = (ms: number) => `${ms < 0 ? "−" : "+"}${Math.abs(ms) / 1000}`;

/**
 * Where each Part of a Listening test is in its audio: the learner plays the file, taps "Đặt tại đây" at the moment a Part
 * begins or ends (or types the time), and nudges it second by second. Saved with the set, so it is done once.
 */
export function PartMarksEditor({ setId, part, onClose }: { setId: string; part?: number; onClose(): void }) {
  const sets = useStore(testSets);
  const set = sets.find((s) => s.id === setId);
  if (!set) return <div class="panel"><p class="muted">Bộ đề không còn trên máy này.</p><button type="button" class="btn" onClick={onClose}>Quay lại</button></div>;
  return <Editor key={set.id} set={set} part={part} onClose={onClose} />;
}

function Editor({ set, part, onClose }: { set: TestSet; part?: number; onClose(): void }) {
  const player = usePlayer(set);
  const cuts = set.cuts ?? {};
  const order = useMemo(() => markParts(set), [set.questions]);
  const rows = useMemo(() => rowsOf(cuts, order), [cuts, order]);
  const firstRow = rows.find((r) => (r.kind === "bound" ? r.b === part || r.a === part : r.part === part)) ?? rows[0];
  const [sel, setSel] = useState(firstRow.id);
  const row = rows.find((r) => r.id === sel) ?? rows[0];
  const [typed, setTyped] = useState(() => {
    const v = valueOf(cuts, firstRow);
    return v !== undefined ? formatClock(v) : "";
  });
  const tracks = set.tracks ?? [];
  const trackNow = player?.track ?? (row.kind === "bound" ? trackOf(cuts, order, row.a) : trackOf(cuts, order, row.part));
  // The playhead is shown (and set as a mark) in whole seconds: what is read is what is saved.
  const atMs = player && player.track !== null ? Math.floor(player.at) * 1000 : 0;

  // The row being edited is where "Đặt tại đây" goes; its time is shown in the box so it can be typed over.
  function pick(r: Row) {
    setSel(r.id);
    const v = valueOf(cuts, r);
    setTyped(v !== undefined ? formatClock(v) : "");
    // The playhead goes to the mark, so nudging starts from it.
    if (v !== undefined) void player?.seekTo(r.kind === "bound" ? trackOf(cuts, order, r.a) : trackOf(cuts, order, r.part), v);
  }

  /** Sets the selected moment to `ms`; false (and says why) when it would put the Parts out of order. */
  function apply(ms: number): boolean {
    const [p, f]: [number, Field] = row.kind === "bound" ? [row.a, "end"] : [row.part, row.kind];
    const check = setMark(cuts, order, p, f, ms, trackNow, true);
    if (check.error) {
      toast(ERRORS[check.error]);
      return false;
    }
    void updateCuts(set.id, (c) => setMark(c, order, p, f, ms, trackNow, true).cuts);
    setTyped(formatClock(ms));
    return true;
  }

  function applyTyped() {
    const ms = parseClock(typed);
    if (ms === null) return toast("Nhập dạng mm:ss, ví dụ 21:34 (hoặc 1:02:03, hoặc số giây).");
    if (apply(ms)) void player?.seekTo(trackNow, ms);
  }

  async function nudgeBy(ms: number) {
    if (!player) return;
    if (player.track === null) await player.seekTo(trackNow, Math.max(0, (valueOf(cuts, row) ?? 0) + ms));
    else player.skip(ms);
  }

  async function listenFrom(ms: number | undefined, back = 0) {
    if (!player) return;
    await player.playWindow(trackNow, Math.max(0, (ms ?? 0) - back), null);
  }

  function togglePlay() {
    if (!player) return;
    if (player.track === null) void listenFrom(valueOf(cuts, row));
    else player.toggle();
  }

  async function removeRow() {
    const v = valueOf(cuts, row);
    if (v === undefined) return;
    const ok = await confirmDialog({ title: "Xoá mốc này?", message: `${row.label} (${formatClock(v)}) sẽ bị xoá, Part này lại chưa có điểm ${row.kind === "start" ? "bắt đầu" : "kết thúc"}. Âm thanh và bài làm không bị ảnh hưởng.`, confirm: "Xoá mốc", danger: true });
    if (!ok) return;
    updateCuts(set.id, (c) => {
      if (row.kind === "bound") return clearMark(clearMark(c, row.b, "start"), row.a, "end");
      return clearMark(c, row.part, row.kind);
    });
  }

  /** Pull a boundary into two moments (to skip the directions, say) or join them again. */
  function split() {
    if (row.kind !== "bound") return;
    const v = valueOf(cuts, row);
    if (v === undefined) return toast("Đặt mốc trước, rồi tách.");
    updateCuts(set.id, (c) => setMark(c, order, row.b, "start", v + 1000, trackNow, false).cuts);
  }

  // Keys for hands on the keyboard: Space plays, arrows move 1 s (Shift 5 s, Alt 10 s), M sets the mark.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === " ") (e.preventDefault(), togglePlay());
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        void nudgeBy((e.key === "ArrowLeft" ? -1 : 1) * (e.altKey ? 10_000 : e.shiftKey ? 5_000 : 1_000));
      } else if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey) apply(atMs);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!player) return null;
  const duration = Math.round(player.duration * 1000);
  const filled = order.filter((p) => partWindow(cuts, order, p).ok).length;

  return (
    <div class="col marks" data-testid="marks-editor">
      <div class="runner-bar panel row between">
        <button type="button" class="btn ghost sm" onClick={onClose} data-testid="marks-close"><Icon n="arrow" size={16} /> Quay lại</button>
        <b class="grow name" title={set.name}>Mốc Part · {set.name}</b>
        <span class={`pill ${filled === order.length ? "ok" : "warn"}`} data-testid="marks-count">{filled}/{order.length} Part</span>
      </div>

      <section class="panel col" data-testid="marks-player">
        <div class="marks-time tnum" data-testid="marks-at" aria-live="off">{formatClock(atMs)}</div>
        <input
          type="range" class="marks-seek" min={0} max={Math.max(1, duration)} step={100} value={Math.min(atMs, Math.max(1, duration))}
          aria-label="Vị trí trong file nghe" onInput={(e) => void player.seekTo(trackNow, Number((e.currentTarget as HTMLInputElement).value))}
          data-testid="marks-seek"
        />
        <div class="row between muted small"><span>0:00</span><span>{duration ? `tổng ${formatClock(Math.floor(duration / 1000) * 1000)}` : tracks.length > 1 ? `File ${trackNow + 1}/${tracks.length}` : ""}</span></div>
        <div class="skip-row" role="group" aria-label="Tua">
          {SKIPS.slice(0, 3).map((ms) => <button type="button" key={ms} class="btn skip" onClick={() => void nudgeBy(ms)} data-testid={`skip${ms}`}>{skipLabel(ms)}</button>)}
          <button type="button" class="btn primary skip play" onClick={togglePlay} aria-label={player.playing ? "Tạm dừng" : "Phát"} data-testid="marks-play"><Icon n={player.playing ? "pause" : "play"} size={18} /></button>
          {SKIPS.slice(3).map((ms) => <button type="button" key={ms} class="btn skip" onClick={() => void nudgeBy(ms)} data-testid={`skip+${ms}`}>{skipLabel(ms)}</button>)}
        </div>
        <button type="button" class="btn primary" onClick={() => apply(atMs)} data-testid="marks-here">Đặt “{row.label}” tại {formatClock(atMs)}</button>
        <p class="muted small">Nghe tới lúc Part bắt đầu (hoặc kết thúc), tua từng giây cho đúng, rồi bấm đặt. Phím tắt: Space phát/dừng, ←/→ 1 giây, Shift 5 giây, Alt 10 giây, M đặt mốc.</p>
      </section>

      <section class="panel col" data-testid="marks-rows">
        <ul class="part-list">
          {rows.map((r) => {
            const v = valueOf(cuts, r);
            const on = r.id === row.id;
            return (
              <li key={r.id} class={`mark-row${on ? " on" : ""}`} data-testid={`mark-${r.id}`} data-set={v !== undefined ? "1" : "0"}>
                <button type="button" class="mark-pick grow" onClick={() => pick(r)} aria-pressed={on} data-testid={`mark-pick-${r.id}`}>
                  <b>{r.label}</b>
                  <span class="small tnum" data-testid={`mark-time-${r.id}`}>{v !== undefined ? formatClock(v) : r.note.startsWith("mặc định") ? <span class="muted">{r.note}</span> : <span class="warn-text">chưa đặt</span>}</span>
                </button>
                <button type="button" class="btn ghost sm" disabled={v === undefined && !r.note.startsWith("mặc định")} onClick={() => void listenFrom(v ?? 0, v ? 3000 : 0)} aria-label={`Nghe thử ${r.label}`} data-testid={`mark-listen-${r.id}`}><Icon n="play" size={16} /></button>
              </li>
            );
          })}
        </ul>
        <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
          <label class="row" style={{ gap: "6px" }}>
            <span class="small muted">{row.label}</span>
            <input class="time-input tnum" value={typed} onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && applyTyped()} placeholder="mm:ss" inputMode="numeric" aria-label="Nhập thời gian" data-testid="marks-typed" />
          </label>
          <button type="button" class="btn sm" onClick={applyTyped} data-testid="marks-apply">Đặt</button>
          {row.kind === "bound" && <button type="button" class="btn ghost sm" onClick={split} title="Bắt đầu Part sau khác điểm kết thúc Part trước (bỏ phần hướng dẫn)" data-testid="marks-split">Tách</button>}
          {row.kind === "start" && cuts[String(row.part - 1)]?.end !== undefined && cuts[String(row.part - 1)]!.end !== cuts[String(row.part)]?.start && (
            <button type="button" class="btn ghost sm" onClick={() => updateCuts(set.id, (c) => setMark(c, order, row.part, "start", c[String(row.part - 1)]!.end!, trackNow, true).cuts)} data-testid="marks-join">Nối với Part trước</button>
          )}
          <button type="button" class="btn ghost sm" disabled={valueOf(cuts, row) === undefined} onClick={() => void removeRow()} data-testid="marks-clear">Xoá mốc</button>
        </div>
      </section>
    </div>
  );
}

/**
 * What the test shows in place of the listening bar when one Part of a one-file test is taken on its own: the Part's
 * stretch of the audio, with play, ±10 s to hear a bit again, "from the start of the Part", and a way to fix the marks.
 */
export function PartPlayer({ set, part, player, onEdit }: { set: TestSet; part: number; player: Player; onEdit(): void }) {
  const order = markParts(set);
  const w = partWindow(set.cuts ?? {}, order, part);
  if (!w.ok) {
    return (
      <section class="panel col" data-testid="part-gate">
        <b>Part {part} chưa có điểm {w.missing === "start" ? "bắt đầu" : "kết thúc"}</b>
        <p class="muted small">File nghe là một file dài: cho Lexi biết Part này nằm ở đâu để chỉ phát đúng đoạn của nó. Chỉ cần làm một lần cho bộ đề.</p>
        <button type="button" class="btn primary" onClick={onEdit} data-testid="part-gate-set">Đặt mốc Part</button>
      </section>
    );
  }
  const from = w.from;
  const to = w.to;
  const atMs = Math.round(player.at * 1000);
  const inside = player.track === w.track && atMs >= from - 300 && (to === null || atMs < to - 300);
  const total = to !== null ? to - from : Math.max(0, Math.round(player.duration * 1000) - from);
  const rel = inside ? Math.max(0, atMs - from) : 0;
  const bounds = { min: from, max: to };

  function play() {
    if (inside && player.track !== null) player.toggle();
    else void player.playWindow(w.ok ? w.track : 0, from, to);
  }
  return (
    <section class="panel col" data-testid="part-player">
      <div class="row between">
        <b>Nghe Part {part}</b>
        <span class="pill ok" data-testid="part-window">{formatClock(from)} → {to === null ? "hết file" : formatClock(to)}</span>
      </div>
      <div class="meter"><i style={{ width: `${total ? Math.min(100, (rel / total) * 100) : 0}%` }} /></div>
      <div class="row between muted small tnum"><span data-testid="part-pos">{formatClock(Math.floor(rel / 1000) * 1000)}</span><span>{total ? formatClock(Math.floor(total / 1000) * 1000) : ""}</span></div>
      <div class="skip-row part" role="group" aria-label="Nghe Part">
        <button type="button" class="btn skip" onClick={() => player.skip(-10_000, bounds)} data-testid="part-back10">⟲10</button>
        <button type="button" class="btn skip" onClick={() => player.skip(-5_000, bounds)} data-testid="part-back5">−5</button>
        <button type="button" class="btn primary skip play" onClick={play} aria-label={player.playing && inside ? "Tạm dừng" : "Phát"} data-testid="part-play"><Icon n={player.playing && inside ? "pause" : "play"} size={18} /></button>
        <button type="button" class="btn skip" onClick={() => player.skip(5_000, bounds)} data-testid="part-fwd5">+5</button>
        <button type="button" class="btn skip" onClick={() => player.skip(10_000, bounds)} data-testid="part-fwd10">⟳10</button>
      </div>
      <div class="row between">
        <button type="button" class="btn ghost sm" onClick={() => void player.playWindow(w.track, from, to)} data-testid="part-restart">Nghe lại từ đầu Part</button>
        <button type="button" class="btn ghost sm" onClick={onEdit} data-testid="part-edit">Chỉnh mốc</button>
      </div>
    </section>
  );
}
