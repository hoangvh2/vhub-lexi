import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { dayId, type Card, type Id, type Rating } from "@shared/model.ts";
import { answerHint, confusables, letterCount, matchConfusable, suggestedRatingWith, type Confusable } from "@shared/confusables.ts";
import { checkTyped, str, template, type AnswerVerdict } from "@shared/notetypes.ts";
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
  // Typing cards: hint letters shown beyond the first, and the confusable word typed on the first try (one retry).
  const [extraHints, setExtraHints] = useState(0);
  const [mixedUp, setMixedUp] = useState<Confusable | null>(null);
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
  const similar = useMemo(() => (note ? confusables(note, allNotes) : []), [note, allNotes]);
  const outcomes = useMemo(() => (card && revealed ? preview(sched, card, now) : null), [card?.id, card?.updatedAt, revealed, sched]);

  // New card on screen: reset the answer UI and start the timer. Effects run after paint, so the reset is keyed to
  // a real change of card (the first card is already in its initial state) and cannot wipe an answer that the
  // learner revealed before the effect ran.
  const shownId = useRef<Id | null>(card?.id ?? null);
  useEffect(() => {
    const id = card?.id ?? null;
    if (shownId.current === id) return;
    shownId.current = id;
    setRevealed(false);
    setTyped("");
    setVerdict(null);
    setExtraHints(0);
    setMixedUp(null);
    shownAt.current = Date.now();
  }, [card?.id]);

  // Read the front aloud when a card appears: always on listening cards, otherwise if the learner chose that.
  useEffect(() => {
    if (card && note && tpl && (p.autoSpeak === "front" || tpl.id === "listen")) {
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
    const v = checkTyped(typed, tpl.expected(note));
    // Another word of the learner's with this meaning: not a lapse. Say which word it was and allow one more try.
    const other = v === "wrong" && !mixedUp ? matchConfusable(typed, similar) : null;
    if (other) {
      setMixedUp(other);
      setTyped("");
      return;
    }
    reveal(v);
  };
  const suggested = verdict ? suggestedRatingWith(verdict, { extraHints, retried: !!mixedUp }) : null;

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
  // The handler is swapped in during render (not in an effect) so a key pressed right after the UI changes
  // always sees the latest state; the listener itself is attached once.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    addEventListener("keydown", listener);
    return () => removeEventListener("keydown", listener);
  }, []);
  {
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
        void rate((suggested ?? 3) as Rating);
      } else if (e.key === "r") {
        const t = revealed ? tpl.speak?.back?.(note) ?? tpl.speak?.front?.(note) : tpl.speak?.front?.(note);
        if (t) speak(t);
      }
    };
    onKeyRef.current = onKey;
  }

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
  const answer = note && tpl?.expected ? tpl.expected(note)[0] ?? "" : "";
  const letters = letterCount(answer);
  const words = answer.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div class="page narrow">
      <div class="page-head">
        <div class="counts" aria-label="Số thẻ còn lại" data-testid="counts">
          <span class={`c-new${kind === "new" ? " on" : ""}`}>Mới <b>{queue.counts.new}</b></span>
          <span class={`c-learn${kind === "learn" ? " on" : ""}`}>Đang học <b>{queue.counts.learning}</b></span>
          <span class={`c-rev${kind === "review" ? " on" : ""}`}>Ôn <b>{queue.counts.review}</b></span>
        </div>
        <select class="select deck-pick" value={deckId ?? ""} aria-label="Chọn bộ thẻ" onChange={(e) => go(e.currentTarget.value ? `/study/${e.currentTarget.value}` : "/study")}>
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
            key={card.id}
            class={`scard mode-${tpl.id}${revealed ? " revealed" : ""}`}
            onClick={() => tpl.mode === "flip" && !revealed && reveal()}
            data-testid="study-card"
            data-template={tpl.id}
            data-revealed={revealed}
          >
            {/* What the card asks for; once answered, the space goes to the answer so the rating row stays in view. */}
            {!revealed && (
              <div class="mode-head" data-testid="card-mode">
                <span class={`mode-dot ${tpl.id}`} />
                {MODE_TITLE[tpl.id] ?? tpl.label}
              </div>
            )}
            {!revealed && MODE_Q[tpl.id] && <div class="mode-q">{MODE_Q[tpl.id]}</div>}
            <Blocks blocks={tpl.front(note, p.layout)} cloze={tpl.id === "cloze"} />
            {tpl.mode === "type" && !revealed && answer && (
              <div class="target" data-testid="target">
                <div class="skel" aria-label={`Đáp án có ${letters} chữ cái, bắt đầu bằng ${answer.trim()[0]}`} data-testid="answer-hint">
                  {[...answerHint(answer, 1 + extraHints)].map((ch, i) =>
                    ch === " " ? <i key={i} class="gap" /> : <span key={i} class={ch === "_" ? "" : "on"}>{ch === "_" ? "" : ch}</span>,
                  )}
                </div>
                <div class="skel-note">{words > 1 ? `${words} từ, ` : ""}{letters} chữ cái</div>
                {similar.length > 0 && (
                  <div class="notthis" data-testid="not-these">
                    Trong bộ thẻ của bạn, <b>không phải</b>: {similar.slice(0, 3).map((c, i) => <span key={c.noteId}>{i ? " · " : ""}<s>{c.word}</s></span>)}
                  </div>
                )}
              </div>
            )}
            {mixedUp && !revealed && (
              <div class="mixed" data-testid="mixed-up">
                <span class="verdict close">Đúng nghĩa, nhưng là từ khác: {mixedUp.word}</span>
                <p class="muted">Gõ lại một lần, lần này không tính là quên.</p>
                {mixedUp.en && <p class="mixed-en"><b>{mixedUp.word}</b>{mixedUp.pos ? ` (${mixedUp.pos})` : ""}: {mixedUp.en}</p>}
              </div>
            )}
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
                  {letters - 1 - extraHints > 1 && (
                    <button type="button" class="btn" onClick={() => setExtraHints((n) => n + 1)} data-testid="more-hint" title="Hiện thêm một chữ; gợi ý chấm sẽ hạ xuống Khó">
                      Gợi ý thêm chữ
                    </button>
                  )}
                  <button type="button" class="btn ghost" onClick={() => reveal("wrong")}>Không nhớ</button>
                </div>
              </form>
            )}
            {revealed && (
              <>
                <div class="divider" />
                <div class="answer">
                  {verdict && (
                    <span class={`verdict ${verdict}`} data-testid="verdict">
                      <Icon n={verdict === "wrong" ? "x" : "check"} size={16} />
                      {verdict === "correct" ? "Chính xác" : verdict === "close" ? "Gần đúng" : "Chưa đúng"}
                      {typed && verdict !== "correct" ? ` · bạn gõ “${typed}”` : ""}
                      {mixedUp ? ` · lần đầu gõ “${mixedUp.word}”` : extraHints ? " · có dùng gợi ý" : ""}
                    </span>
                  )}
                  <Blocks blocks={tpl.back(note, p.layout)} />
                </div>
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
                <button type="button" key={r} class={`r${r}${suggested === r ? " suggest" : ""}`} onClick={() => void rate(r)} data-testid={`rate-${r}`}>
                  {["Quên", "Khó", "Tốt", "Dễ"][r - 1]}
                  <small>{outcomes[r].label}</small>
                  <kbd>{r}</kbd>
                </button>
              ))}
            </div>
          ) : null}
          {/* Below the rating row, which must stay reachable without scrolling on a small phone. */}
          {revealed && similar.length > 0 && <Compare word={str(note.fields.word)} pos={str(note.fields.pos)} en={str(note.fields.en)} others={similar.slice(0, 3)} />}

          <div class="study-tools">
            <div class="row">
              <button type="button" class="btn ghost sm" onClick={() => void undo()} disabled={!history.current.length} title="Hoàn tác (U)"><Icon n="undo" size={16} /> Hoàn tác</button>
              <button type="button" class="btn ghost sm" onClick={() => setEditing(note.id)}><Icon n="edit" size={16} /> Sửa</button>
              <button type="button" class="btn ghost sm" onClick={() => void suspend()}><Icon n="pause" size={16} /> Ẩn thẻ</button>
            </div>
            <div class="row">
              {isLeech(card) && <span class="pill bad">Thẻ khó · quên {card.lapses} lần</span>}
            </div>
          </div>
        </div>
      )}
      {editing && byId.get(editing) && <NoteEditor note={byId.get(editing)!} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** What the card asks for, in the learner's words; shown at the top of the card. */
const MODE_TITLE: Record<string, string> = { recognize: "Nhớ nghĩa của từ", recall: "Gõ từ tiếng Anh", cloze: "Điền từ vào câu", listen: "Nghe và gõ từ" };
/** The question under the title, where the mode needs one. */
const MODE_Q: Record<string, string> = { recall: "Từ tiếng Anh nào có nghĩa là…", listen: "Nghe câu, gõ từ còn thiếu. Bấm loa để nghe lại." };

/** After the answer: the word under review next to the learner's words it is easy to mix up with. */
function Compare({ word, pos, en, others }: { word: string; pos: string; en: string; others: Confusable[] }) {
  return (
    <div class="compare" data-testid="compare">
      <div class="compare-head">Dễ nhầm với</div>
      <div class="compare-grid">
        <div class="me">
          <b>{word}</b>
          {pos && <small>{pos}</small>}
          {en && <span>{en}</span>}
        </div>
        {others.map((c) => (
          <div key={c.noteId}>
            <b>{c.word}</b>
            {c.pos && <small>{c.pos}</small>}
            {c.vi && <span class="vi">{c.vi}</span>}
            {c.en && <span>{c.en}</span>}
          </div>
        ))}
      </div>
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
