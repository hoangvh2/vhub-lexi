import { useEffect, useMemo, useState } from "preact/hooks";
import { CardState, type Card, type Note, type ReviewLog } from "@shared/model.ts";
import { noteType, noteView, template } from "@shared/notetypes.ts";
import { cards, currentRepo, decks, prefs } from "../data/state.ts";
import { dateLabel, dueLabel } from "../lib/format.ts";
import { isLeech } from "../lib/queue.ts";
import { makeScheduler, retrievability } from "../lib/scheduler.ts";
import { useStore } from "../lib/store.ts";
import { ForgotButton } from "./Forgot.tsx";
import { Blocks } from "./Blocks.tsx";
import { Icon } from "./common.tsx";

const COVER_KEY = "lexi.view.cover";

function loadCover(): boolean {
  try {
    return localStorage.getItem(COVER_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCover(on: boolean) {
  try {
    localStorage.setItem(COVER_KEY, on ? "1" : "0");
  } catch {
    // Private mode: the toggle still works for this session.
  }
}

const RATING_LABEL: Record<number, string> = { 1: "Quên", 2: "Khó", 3: "Tốt", 4: "Dễ" };

interface Props {
  note: Note;
  /** Position in the library's current list (0-based), -1 when the note is no longer in it. */
  index: number;
  total: number;
  /** Side panel next to the list (wide screens) instead of a full-screen sheet. */
  docked: boolean;
  onPrev(): void;
  onNext(): void;
  onEdit(): void;
  onClose(): void;
  /** True while another dialog (the editor) is on top: the view leaves the keyboard to it. */
  paused?: boolean;
}

/**
 * The library's read view of one note ("Xem"): the whole note laid out like the answer side of a card, the review
 * schedule of each of its cards, and a cover switch that hides meanings / answers for a quick self-test.
 * Reads nothing from the server until the learner asks for the review history.
 */
export function NoteView({ note, index, total, docked, onPrev, onNext, onEdit, onClose, paused }: Props) {
  const def = noteType(note.type);
  const [covered, setCovered] = useState(loadCover);
  const allDecks = useStore(decks);
  const noteCards = useStore(cards).filter((c) => c.noteId === note.id);
  const p = useStore(prefs);
  const blocks = useMemo(() => noteView(note, covered), [note, covered]);
  const deckName = allDecks.find((d) => d.id === note.deckId)?.name ?? "";

  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || document.querySelector(".scrim"))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), onNext());
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), onPrev());
      else if (e.key === "Escape") onClose();
      else if (e.key === "e" || e.key === "E") (e.preventDefault(), onEdit());
      else if ((e.key === "q" || e.key === "Q") && note.type === "vocab") (document.querySelector('[data-testid="note-view"] [data-testid="forgot-btn"]') as HTMLButtonElement | null)?.click();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paused, onNext, onPrev, onClose, onEdit, note.type]);

  const toggleCover = () => {
    setCovered(!covered);
    saveCover(!covered);
  };

  const order = def?.templates.map((t) => t.id) ?? [];
  const sorted = [...noteCards].sort((a, b) => order.indexOf(a.template) - order.indexOf(b.template));
  const coverLabel = note.type === "vocab" ? "Che nghĩa" : "Che đáp án";

  return (
    <div class={docked ? "nv nv-docked" : "nv nv-sheet"} role={docked ? "region" : "dialog"} aria-modal={docked ? undefined : true} aria-label="Xem chi tiết" data-testid="note-view">
      <div class="nv-top">
        {!docked && (
          <button type="button" class="nv-ib" onClick={onClose} aria-label="Đóng" data-testid="view-close">
            <Icon n="x" size={18} />
          </button>
        )}
        <button type="button" class="nv-ib" onClick={onPrev} disabled={total === 0 || index === 0} aria-label="Từ trước" data-testid="view-prev">
          <Icon n="chevL" size={18} />
        </button>
        <span class="nv-pos" data-testid="view-pos">{index >= 0 ? `${index + 1} / ${total}` : `– / ${total}`}</span>
        <button type="button" class="nv-ib" onClick={onNext} disabled={total === 0 || index === total - 1} aria-label="Từ sau" data-testid="view-next">
          <Icon n="chevR" size={18} />
        </button>
        {/* "Hay quên" mark, as on the study card: a word met before can join the practice list without waiting for its next review. */}
        {note.type === "vocab" && <ForgotButton key={note.id} note={note} />}
        <button type="button" class="btn primary sm" onClick={onEdit} data-testid="view-edit">
          <Icon n="edit" size={15} /> Sửa
        </button>
        {docked && (
          <button type="button" class="nv-ib" onClick={onClose} aria-label="Đóng" data-testid="view-close">
            <Icon n="x" size={18} />
          </button>
        )}
      </div>
      <div class="nv-body" key={note.id}>
        <div class={`nv-card nv-${note.type}`}>
          <div class="nv-meta">
            {deckName && <span class="chip">{deckName}</span>}
            {(note.tags ?? []).map((t) => <span class="chip" key={t}>#{t}</span>)}
            <span class="spacer" />
            <button type="button" class="nv-cover" role="switch" aria-checked={covered} onClick={toggleCover} data-testid="view-cover">
              <Icon n={covered ? "eyeOff" : "eye"} size={16} /> {coverLabel}
            </button>
          </div>
          <Blocks blocks={blocks} memoOpen />
        </div>
        {sorted.length > 0 && <Schedule note={note} cards={sorted} retention={p.desiredRetention} weights={p.fsrsWeights} />}
      </div>
    </div>
  );
}

/** Each card's place in the review schedule, from what is already on the device; the answer history loads on request. */
function Schedule({ note, cards: cs, retention, weights }: { note: Note; cards: Card[]; retention: number; weights?: number[] }) {
  const [history, setHistory] = useState<ReviewLog[] | null | "loading">(null);
  const now = Date.now();
  const sched = useMemo(() => makeScheduler(retention, weights), [retention, weights]);
  const loadHistory = () => {
    setHistory("loading");
    currentRepo().reviewsOfNote(note.id).then(setHistory, () => setHistory([]));
  };
  return (
    <section class="nv-sched" data-testid="view-schedule">
      <div class="b-label">Lịch ôn</div>
      {cs.map((c) => {
        const r = c.state === CardState.New ? null : retrievability(sched, c, now);
        const meta =
          c.state === CardState.New
            ? "Chưa học lần nào"
            : [
                r !== null ? `Nhớ ${Math.round(r * 100)}%` : "",
                c.scheduledDays >= 1 ? `khoảng ôn ${Math.round(c.scheduledDays)} ngày` : "ôn trong ngày",
                `${c.reps} lượt, quên ${c.lapses}`,
                `đến hạn ${dateLabel(c.due)}`,
              ].filter(Boolean).join(" · ");
        const kind = c.suspended ? "" : c.state === CardState.New ? "new" : c.due <= now ? "warn" : "ok";
        const mine = history && history !== "loading" ? history.filter((h) => h.cardId === c.id) : null;
        return (
          <div class="nv-srow" key={c.id} data-testid="view-card">
            <span class="nv-sname">{template(note.type, c.template)?.label ?? c.template}</span>
            <span class="row" style={{ gap: "6px", flexWrap: "nowrap" }}>
              {isLeech(c) && <span class="pill bad">Khó</span>}
              <span class={`pill ${kind}`}>{dueLabel(c, now)}</span>
            </span>
            <span class="nv-smeta">{meta}</span>
            {mine && mine.length > 0 && (
              <ol class="card-history" data-testid="view-history">
                {mine.slice(-10).reverse().map((h) => (
                  <li key={h.id}>
                    <span>{dateLabel(h.reviewedAt)}</span>
                    <span class={`rate r${h.rating}`}>{RATING_LABEL[h.rating]}</span>
                    <span class="muted">{h.scheduledDays >= 1 ? `→ ${Math.round(h.scheduledDays)} ngày` : "→ trong ngày"}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
      {history === null && cs.some((c) => c.reps > 0) && (
        <button type="button" class="btn ghost sm" onClick={loadHistory} data-testid="view-history-load">
          Xem lịch sử ôn
        </button>
      )}
      {history === "loading" && <p class="muted">Đang tải lịch sử…</p>}
      {Array.isArray(history) && history.length === 0 && <p class="muted">Chưa có lượt ôn nào được lưu.</p>}
    </section>
  );
}
