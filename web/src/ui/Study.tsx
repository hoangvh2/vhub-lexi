import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { dayId, type Card, type Id, type Rating } from "@shared/model.ts";
import { checkTyped, suggestedRating, template, type AnswerVerdict } from "@shared/notetypes.ts";
import { reviewCard, setSuspended, undoReview, type Reviewed } from "../data/actions.ts";
import { cards, daily, decks, loaded, notes, prefs } from "../data/state.ts";
import { LEARN_AHEAD_MS, buildQueue, isLeech, pickNext, type Queue } from "../lib/queue.ts";
import { formatInterval, makeScheduler, preview } from "../lib/scheduler.ts";
import { eligibility, notesById } from "../lib/select.ts";
import { speak, stopSpeaking } from "../lib/speech.ts";
import { useStore } from "../lib/store.ts";
import { Blocks } from "./Blocks.tsx";
import { Icon, go, toast } from "./common.tsx";
import { NoteEditor } from "./NoteEditor.tsx";

interface Session {
  answered: number;
  again: number;
  ms: number;
  shown: number;
  shownNew: number;
}
const EMPTY: Session = { answered: 0, again: 0, ms: 0, shown: 0, shownNew: 0 };

export function Study({ deckId }: { deckId: Id | null }) {
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const allDecks = useStore(decks);
  const dailies = useStore(daily);
  const p = useStore(prefs);
  const ready = useStore(loaded);

  const [buried, setBuried] = useState<ReadonlySet<Id>>(new Set());
  const [session, setSession] = useState<Session>(EMPTY);
  const [extraNew, setExtraNew] = useState(0);
  const [ahead, setAhead] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<AnswerVerdict | null>(null);
  const [editing, setEditing] = useState<Id | null>(null);
  const history = useRef<Reviewed[]>([]);
  const currentId = useRef<Id | null>(null);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  const eligible = useMemo(() => eligibility(allNotes), [allNotes]);
  const byId = useMemo(() => notesById(allNotes), [allNotes]);
  const sched = useMemo(() => makeScheduler(p.desiredRetention), [p.desiredRetention]);

  const queue: Queue = useMemo(
    () =>
      buildQueue({
        cards: allCards,
        eligible,
        today: dailies.find((d) => d.id === dayId(now, p.dayStartHour)),
        prefs: { ...p, newPerDay: p.newPerDay + extraNew },
        now,
        deckId,
        buried,
        learnAheadMs: ahead,
      }),
    [allCards, eligible, dailies, p, now, deckId, buried, extraNew, ahead],
  );

  // Keep showing the same card until it is answered, even if the queue changes underneath.
  let card: Card | null = null;
  if (currentId.current) {
    card = [...queue.learning, ...queue.review, ...queue.newCards].find((c) => c.id === currentId.current) ?? null;
  }
  if (!card) {
    card = pickNext(queue, session, now);
    currentId.current = card?.id ?? null;
  }

  const note = card ? byId.get(card.noteId) : undefined;
  const tpl = card && note ? template(note.type, card.template) : undefined;
  const outcomes = useMemo(() => (card && revealed ? preview(sched, card, now) : null), [card?.id, card?.updatedAt, revealed, sched]);

  // New card on screen: reset the answer UI, start the timer, maybe read it aloud.
  useEffect(() => {
    setRevealed(false);
    setTyped("");
    setVerdict(null);
    shownAt.current = Date.now();
    if (card && note && tpl && p.autoSpeak === "front") {
      const t = tpl.speak?.front?.(note);
      if (t) speak(t);
    }
    return () => stopSpeaking();
  }, [card?.id]);

  const reveal = (v?: AnswerVerdict) => {
    if (!card || !note || !tpl || revealed) return;
    setRevealed(true);
    if (v) setVerdict(v);
    if (p.autoSpeak !== "off") {
      const t = tpl.speak?.back?.(note);
      if (t) speak(t);
    }
  };

  const submitTyped = () => {
    if (!note || !tpl?.expected) return;
    reveal(checkTyped(typed, tpl.expected(note)));
  };

  const rate = async (r: Rating) => {
    if (!card || !revealed || busy.current) return;
    busy.current = true;
    const dur = Date.now() - shownAt.current;
    const wasNew = card.state === 0;
    try {
      const res = await reviewCard(card, r, dur);
      history.current = [...history.current.slice(-9), res];
      setBuried((b) => new Set(b).add(card!.noteId));
      setSession((s) => ({
        answered: s.answered + 1,
        again: s.again + (r === 1 ? 1 : 0),
        ms: s.ms + Math.min(dur, 120_000),
        shown: s.shown + 1,
        shownNew: s.shownNew + (wasNew ? 1 : 0),
      }));
      currentId.current = null;
      setNow(Date.now());
    } finally {
      busy.current = false;
    }
  };

  const undo = async () => {
    const last = history.current.pop();
    if (!last || busy.current) return;
    busy.current = true;
    try {
      await undoReview(last);
      setBuried((b) => {
        const n = new Set(b);
        n.delete(last.prev.noteId);
        return n;
      });
      setSession((s) => ({ ...s, answered: Math.max(0, s.answered - 1), again: Math.max(0, s.again - (last.delta.rating === 1 ? 1 : 0)), shown: Math.max(0, s.shown - 1), shownNew: Math.max(0, s.shownNew - last.delta.newCards) }));
      currentId.current = last.prev.id;
      setNow(Date.now());
      toast("Đã hoàn tác lần trả lời trước");
    } finally {
      busy.current = false;
    }
  };

  const suspend = async () => {
    if (!card) return;
    await setSuspended(card, true);
    currentId.current = null;
    toast("Đã tạm ẩn thẻ này", { label: "Hoàn tác", run: () => void setSuspended(card!, false) });
  };

  // Keyboard: Space/Enter reveal, 1-4 rate, U undo, R replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".scrim")) return;
      if (typing) return;
      if (e.key === "u" || e.key === "z") {
        void undo();
        return;
      }
      if (!card || !tpl || !note) return;
      if (!revealed && tpl.mode === "flip" && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal();
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(Number(e.key) as Rating);
      } else if (revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        void rate((verdict ? suggestedRating(verdict) : 3) as Rating);
      } else if (e.key === "r") {
        const t = revealed ? tpl.speak?.back?.(note) ?? tpl.speak?.front?.(note) : tpl.speak?.front?.(note);
        if (t) speak(t);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!ready) return <div class="page"><p class="muted">Đang tải dữ liệu…</p></div>;

  if (allNotes.length === 0) {
    return (
      <div class="page narrow">
        <div class="empty">
          <h2>Chưa có từ nào</h2>
          <p>Thêm từ đầu tiên: chỉ cần gõ từ tiếng Anh, thẻ sẽ tự điền phiên âm, nghĩa và ví dụ.</p>
          <button type="button" class="btn primary" onClick={() => go("/add")} data-testid="empty-add">
            <Icon n="plus" /> Thêm từ
          </button>
        </div>
      </div>
    );
  }

  // Learning cards that are not due yet: tell the learner when the next one comes back.
  const nextLearn = allCards
    .filter((c) => (c.state === 1 || c.state === 3) && !c.suspended && eligible(c) && (!deckId || c.deckId === deckId) && c.due > now)
    .reduce((m, c) => Math.min(m, c.due), Infinity);
  const waitingMs = Number.isFinite(nextLearn) ? nextLearn - now : null;
  const total = queue.counts.new + queue.counts.learning + queue.counts.review;
  const doneFrac = session.answered + total === 0 ? 1 : session.answered / (session.answered + total);
  const kind = card ? (card.state === 0 ? "new" : card.state === 2 ? "review" : "learn") : null;

  return (
    <div class="page narrow">
      <div class="page-head">
        <div class="counts" aria-label="Số thẻ còn lại" data-testid="counts">
          <span class={`c-new${kind === "new" ? " on" : ""}`}>Mới <b>{queue.counts.new}</b></span>
          <span class={`c-learn${kind === "learn" ? " on" : ""}`}>Đang học <b>{queue.counts.learning}</b></span>
          <span class={`c-rev${kind === "review" ? " on" : ""}`}>Ôn <b>{queue.counts.review}</b></span>
        </div>
        <span class="spacer" />
        <select class="select" style={{ width: "auto", minHeight: "36px", padding: "4px 10px" }} value={deckId ?? ""} aria-label="Chọn bộ thẻ" onChange={(e) => go(e.currentTarget.value ? `/study/${e.currentTarget.value}` : "/study")}>
          <option value="">Tất cả bộ thẻ</option>
          {allDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div class="progress" role="progressbar" aria-valuenow={Math.round(doneFrac * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${doneFrac * 100}%` }} /></div>

      {!card || !note || !tpl ? (
        <Done session={session} waitingMs={waitingMs} onContinue={() => setAhead(LEARN_AHEAD_MS)} onMore={() => setExtraNew((n) => n + 5)} onUndo={history.current.length ? undo : undefined} hasMoreNew={allCards.some((c) => c.state === 0 && !c.suspended && eligible(c))} />
      ) : (
        <div class="study">
          <div
            class={`scard${revealed ? " revealed" : ""}`}
            onClick={() => tpl.mode === "flip" && !revealed && reveal()}
            data-testid="study-card"
            data-template={tpl.id}
            data-revealed={revealed}
          >
            <Blocks blocks={tpl.front(note, p.layout)} cloze={tpl.id === "cloze"} />
            {tpl.mode === "type" && !revealed && (
              <form
                class="typebox"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitTyped();
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  class="input"
                  value={typed}
                  onInput={(e) => setTyped(e.currentTarget.value)}
                  placeholder="Gõ đáp án…"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  aria-label="Đáp án của bạn"
                  data-testid="type-input"
                  autofocus
                />
                <div class="row" style={{ justifyContent: "center" }}>
                  <button type="submit" class="btn primary" data-testid="type-check">Kiểm tra</button>
                  <button type="button" class="btn ghost" onClick={() => reveal("wrong")}>Không nhớ</button>
                </div>
              </form>
            )}
            {revealed && (
              <>
                <div class="divider" />
                {verdict && (
                  <span class={`verdict ${verdict}`} data-testid="verdict">
                    {verdict === "correct" ? "Chính xác" : verdict === "close" ? "Gần đúng" : "Chưa đúng"}
                    {typed && verdict !== "correct" ? ` · bạn gõ “${typed}”` : ""}
                  </span>
                )}
                <Blocks blocks={tpl.back(note, p.layout)} />
              </>
            )}
            {!revealed && tpl.mode === "flip" && <div class="hint">Bấm thẻ hoặc nhấn Space để xem đáp án</div>}
          </div>

          {!revealed && tpl.mode === "flip" ? (
            <button type="button" class="btn primary show-btn" onClick={() => reveal()} data-testid="show-answer">
              Hiện đáp án
            </button>
          ) : revealed && outcomes ? (
            <div class="rate" role="group" aria-label="Bạn nhớ thế nào?">
              {([1, 2, 3, 4] as const).map((r) => (
                <button type="button" key={r} class={`r${r}${verdict && suggestedRating(verdict) === r ? " suggest" : ""}`} onClick={() => void rate(r)} data-testid={`rate-${r}`}>
                  {["Quên", "Khó", "Tốt", "Dễ"][r - 1]}
                  <small>{outcomes[r].label}</small>
                  <kbd>{r}</kbd>
                </button>
              ))}
            </div>
          ) : null}

          <div class="study-tools">
            <div class="row">
              <button type="button" class="btn ghost sm" onClick={() => void undo()} disabled={!history.current.length} title="Hoàn tác (U)"><Icon n="undo" size={16} /> Hoàn tác</button>
              <button type="button" class="btn ghost sm" onClick={() => setEditing(note.id)}><Icon n="edit" size={16} /> Sửa</button>
              <button type="button" class="btn ghost sm" onClick={() => void suspend()}><Icon n="pause" size={16} /> Ẩn thẻ</button>
            </div>
            <div class="row">
              {isLeech(card) && <span class="pill bad">Thẻ khó · quên {card.lapses} lần</span>}
              <span class="pill">{tpl.label}</span>
            </div>
          </div>
        </div>
      )}
      {editing && byId.get(editing) && <NoteEditor note={byId.get(editing)!} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Done({ session, waitingMs, onContinue, onMore, onUndo, hasMoreNew }: { session: Session; waitingMs: number | null; onContinue(): void; onMore(): void; onUndo?: () => void; hasMoreNew: boolean }) {
  const mins = Math.max(1, Math.round(session.ms / 60_000));
  const acc = session.answered ? Math.round(((session.answered - session.again) / session.answered) * 100) : 0;
  return (
    <div class="panel done" data-testid="session-done">
      <div class="big">{session.answered ? "Xong!" : "Hết thẻ hôm nay"}</div>
      {session.answered > 0 ? (
        <div class="stat-grid">
          <div class="stat"><b>{session.answered}</b><span>thẻ đã trả lời</span></div>
          <div class="stat"><b>{acc}%</b><span>nhớ đúng</span></div>
          <div class="stat"><b>{mins}p</b><span>thời gian</span></div>
        </div>
      ) : (
        <p class="muted">Không có thẻ đến hạn. Quay lại sau, hoặc thêm từ mới.</p>
      )}
      {waitingMs !== null && (
        <p class="muted" data-testid="waiting">
          Còn thẻ đang học, thẻ kế tiếp quay lại sau {formatInterval(waitingMs)}.
        </p>
      )}
      <div class="row" style={{ justifyContent: "center" }}>
        {waitingMs !== null && <button type="button" class="btn primary" onClick={onContinue} data-testid="continue-early">Học tiếp ngay</button>}
        <button type="button" class={`btn${waitingMs === null ? " primary" : ""}`} onClick={() => go("/add")}><Icon n="plus" /> Thêm từ</button>
        {hasMoreNew && <button type="button" class="btn" onClick={onMore} data-testid="more-new">Học thêm 5 từ mới</button>}
        {onUndo && <button type="button" class="btn ghost" onClick={onUndo}><Icon n="undo" /> Hoàn tác</button>}
      </div>
    </div>
  );
}
