import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { dayId, type Card, type Id, type Rating } from "@shared/model.ts";
import { answerHint, confusables, letterCount, matchConfusable, meaningsByNote, suggestedRatingWith, type Confusable } from "@shared/confusables.ts";
import { checkTyped, str, template, type AnswerVerdict } from "@shared/notetypes.ts";
import { reviewCard, setSuspended, undoReview, type Reviewed } from "../data/actions.ts";
import { cards, daily, decks, loaded, notes, prefs } from "../data/state.ts";
import { LEARN_AHEAD_MS, buildQueue, dueWithin, isLeech, pickNext, tagCounts, type Queue } from "../lib/queue.ts";
import { celebrate } from "../lib/motion.ts";
import { streak } from "../lib/stats.ts";
import { isLesson, lessonTitle } from "../lib/lessons.ts";
import { formatInterval, makeScheduler, preview } from "../lib/scheduler.ts";
import { eligibility, notesById } from "../lib/select.ts";
import { speak, stopSpeaking } from "../lib/speech.ts";
import { useStore } from "../lib/store.ts";
import { Blocks } from "./Blocks.tsx";
import { Icon, go, toast } from "./common.tsx";
import { NoteEditor } from "./NoteEditor.tsx";

/** One answer of this session, for the summary at the end. */
interface Answered {
  noteId: Id;
  word: string;
  vi: string;
  rating: Rating;
}
interface Session {
  answered: number;
  again: number;
  ms: number;
  shown: number;
  shownNew: number;
  log: Answered[];
}
const EMPTY: Session = { answered: 0, again: 0, ms: 0, shown: 0, shownNew: 0, log: [] };
const DAY_MS = 86_400_000;

export function Study({ deckId, initialTag = "" }: { deckId: Id | null; initialTag?: string }) {
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const allDecks = useStore(decks);
  const dailies = useStore(daily);
  const p = useStore(prefs);
  const ready = useStore(loaded);

  const [buried, setBuried] = useState<ReadonlySet<Id>>(new Set());
  const [session, setSession] = useState<Session>(EMPTY);
  const [extraNew, setExtraNew] = useState(0);
  // Like Anki's "learn ahead limit": when nothing else is left, a learning card due within 20 minutes is shown
  // now instead of ending the session with a "come back in 3 minutes".
  const [ahead, setAhead] = useState(LEARN_AHEAD_MS);
  // Custom study: one lesson/topic tag, and review cards due in the next N days.
  const [tag, setTag] = useState(initialTag);
  const [aheadDays, setAheadDays] = useState(0);
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
  const meanings = useMemo(() => meaningsByNote(allNotes), [allNotes]);
  const sched = useMemo(() => makeScheduler(p.desiredRetention, p.fsrsWeights), [p.desiredRetention, p.fsrsWeights]);
  const tags = useMemo(() => tagCounts(allNotes), [allNotes]);
  const tagDone = (t: string) => (started.get(t) ?? 0) >= (tags.find((x) => x.tag === t)?.count ?? 0);
  const nextTag = (t: string) => {
    const i = tags.findIndex((x) => x.tag === t);
    return tags.slice(i + 1).find((x) => isLesson(x.tag) && (started.get(x.tag) ?? 0) < x.count)?.tag ?? null;
  };
  // Per lesson tag: notes started (any card past "new"), for "01-contract · 8/12" in the lesson picker.
  const started = useMemo(() => {
    const studied = new Set(allCards.filter((c) => c.state !== 0).map((c) => c.noteId));
    const m = new Map<string, number>();
    for (const n of allNotes) if (studied.has(n.id)) for (const t of n.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [allCards, allNotes]);
  const tagNotes = useMemo(() => (tag ? new Set(allNotes.filter((x) => x.tags?.includes(tag)).map((x) => x.id)) : undefined), [allNotes, tag]);

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
        meanings,
        noteIds: tagNotes,
        reviewAheadDays: aheadDays,
      }),
    [allCards, eligible, dailies, p, now, deckId, buried, extraNew, ahead, meanings, tagNotes, aheadDays],
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
  // Keyed by card and turn: a learning card can come straight back (learn-ahead) and must start unanswered again.
  const turn = card ? `${card.id}#${session.shown}` : null;
  const shownId = useRef<string | null>(turn);
  useEffect(() => {
    if (shownId.current === turn) return;
    shownId.current = turn;
    setRevealed(false);
    setTyped("");
    setVerdict(null);
    setExtraHints(0);
    setMixedUp(null);
    shownAt.current = Date.now();
  }, [turn]);

  // Read the front aloud when a card appears: always on listening cards, otherwise if the learner chose that.
  useEffect(() => {
    if (card && note && tpl && (p.autoSpeak === "front" || tpl.id === "listen")) {
      const t = tpl.speak?.front?.(note);
      if (t) speak(t);
    }
    return () => stopSpeaking();
  }, [turn]);

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
    const answered: Answered | null = note ? { noteId: note.id, word: str(note.fields.word) || tpl?.label || "", vi: str(note.fields.vi), rating: r } : null;
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
        log: answered ? [...s.log, answered] : s.log,
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
      setSession((s) => ({ ...s, answered: Math.max(0, s.answered - 1), again: Math.max(0, s.again - (last.delta.rating === 1 ? 1 : 0)), shown: Math.max(0, s.shown - 1), shownNew: Math.max(0, s.shownNew - last.delta.newCards), log: s.log.slice(0, -1) }));
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

  const pickTag = (t: string) => {
    setTag(t);
    setAheadDays(0);
    currentId.current = null;
  };

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
      <div class="study-head">
        <div class="pickers">
          <select class="select" value={deckId ?? ""} aria-label="Chọn bộ thẻ" onChange={(e) => go(e.currentTarget.value ? `/study/${e.currentTarget.value}` : "/study")}>
            <option value="">Tất cả bộ thẻ</option>
            {allDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {tags.length > 0 && (
            <select class="select" value={tag} aria-label="Chọn bài" data-testid="tag-pick" onChange={(e) => pickTag(e.currentTarget.value)}>
              <option value="">Tất cả bài</option>
              {tags.map((t) => <option key={t.tag} value={t.tag}>{lessonLabel(t.tag, started.get(t.tag) ?? 0, t.count)}</option>)}
            </select>
          )}
        </div>
        <div class="counts" aria-label="Số thẻ còn lại" data-testid="counts">
          <span class={`c-new${kind === "new" ? " on" : ""}`}>Mới <b>{queue.counts.new}</b></span>
          <span class={`c-learn${kind === "learn" ? " on" : ""}`}>Đang học <b>{queue.counts.learning}</b></span>
          <span class={`c-rev${kind === "review" ? " on" : ""}`}>Ôn <b>{queue.counts.review}</b></span>
        </div>
      </div>
      <div class="progress" role="progressbar" aria-valuenow={Math.round(doneFrac * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${doneFrac * 100}%` }} /></div>

      {!card || !note || !tpl ? (
        <Done
          session={session}
          waitingMs={waitingMs}
          streak={streak(dailies, now, p.dayStartHour)}
          dueTomorrow={dueWithin(allCards, eligible, now, p.dayStartHour, 1, deckId, tagNotes)}
          nextLesson={tag && tagDone(tag) ? nextTag(tag) : null}
          onLesson={pickTag}
          onContinue={() => setAhead(DAY_MS)}
          onMore={() => setExtraNew((n) => n + 5)}
          onUndo={history.current.length ? undo : undefined}
          hasMoreNew={allCards.some((c) => c.state === 0 && !c.suspended && eligible(c) && (!deckId || c.deckId === deckId) && (!tagNotes || tagNotes.has(c.noteId)))}
          tomorrow={dueWithin(allCards, eligible, now, p.dayStartHour, aheadDays + 1, deckId, tagNotes) - dueWithin(allCards, eligible, now, p.dayStartHour, aheadDays, deckId, tagNotes)}
          onAhead={() => setAheadDays((d) => d + 1)}
        />
      ) : (
        <div class="study">
          <div
            key={turn}
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

          {/* Pinned to the bottom of the screen: a long answer (two examples with translations) must not push the
              rating row out of reach on a phone. */}
          {!revealed && tpl.mode === "flip" ? (
            <div class="actbar">
              <button type="button" class="btn primary show-btn" onClick={() => reveal()} data-testid="show-answer">
                Hiện đáp án
              </button>
            </div>
          ) : revealed && outcomes ? (
            <div class="actbar rate" role="group" aria-label="Bạn nhớ thế nào?">
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

const aheadLabel = (n: number) => `Ôn trước ${n} thẻ sắp đến hạn`;

/** Lesson-like tags (sub-decks of an Anki deck such as "01-contract", "lesson-02", "bai-3"), as opposed to topic tags. */
export const lessonLabel = (t: string, started: number, total: number) => `${lessonTitle(t)} · ${started}/${total}${started >= total ? " ✓" : ""}`;

const RATING_NAME = ["", "Quên", "Khó", "Tốt", "Dễ"];

interface DoneProps {
  session: Session;
  waitingMs: number | null;
  streak: number;
  dueTomorrow: number;
  nextLesson: string | null;
  onLesson(tag: string): void;
  onContinue(): void;
  onMore(): void;
  onUndo?: () => void;
  hasMoreNew: boolean;
  tomorrow: number;
  onAhead(): void;
}

function Done({ session, waitingMs, streak, dueTomorrow, nextLesson, onLesson, onContinue, onMore, onUndo, hasMoreNew, tomorrow, onAhead }: DoneProps) {
  const mins = Math.max(1, Math.round(session.ms / 60_000));
  const acc = session.answered ? Math.round(((session.answered - session.again) / session.answered) * 100) : 0;
  // Last answer per word: a word forgotten then got right in its learning step counts as forgotten.
  const words = new Map<Id, Answered>();
  for (const a of session.log) {
    const prev = words.get(a.noteId);
    words.set(a.noteId, prev && prev.rating < a.rating ? prev : a);
  }
  const list = [...words.values()].sort((a, b) => a.rating - b.rating);
  const forgot = list.filter((a) => a.rating === 1);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (session.answered > 0 ? celebrate(root.current) : undefined), []);
  return (
    <div class="panel done" data-testid="session-done" ref={root}>
      {session.answered > 0 && (
        <div class="bubble" role="img" aria-label={streak > 0 ? `${streak} ngày học liên tiếp` : "Đã xong"}>
          {streak > 0 ? <b>{streak}<small>ngày liền</small></b> : <Icon n="check" />}
        </div>
      )}
      <div class="big">{session.answered ? "Xong phần này!" : "Hết thẻ hôm nay"}</div>
      {session.answered > 0 ? (
        <div class="stat-grid">
          <div class="stat"><b>{words.size}</b><span>từ đã ôn</span></div>
          <div class="stat"><b>{acc}%</b><span>nhớ đúng</span></div>
          <div class="stat"><b>{mins}p</b><span>thời gian</span></div>
        </div>
      ) : (
        <p class="muted">Không có thẻ đến hạn. Quay lại sau, hoặc thêm từ mới.</p>
      )}
      {forgot.length > 0 && (
        <div class="recap-forgot" data-testid="recap-forgot">
          <b>Cần chú ý</b>
          {forgot.slice(0, 6).map((a) => <div key={a.noteId}><span>{a.word}</span><span class="muted">{a.vi}</span></div>)}
        </div>
      )}
      {list.length > 0 && (
        <div class="recap" data-testid="recap">
          {list.map((a) => <span key={a.noteId} class={`chip r${a.rating}`} title={RATING_NAME[a.rating]}>{a.word}</span>)}
        </div>
      )}
      {waitingMs !== null && (
        <p class="muted" data-testid="waiting">
          Còn thẻ đang học, thẻ kế tiếp quay lại sau {formatInterval(waitingMs)}.
        </p>
      )}
      {session.answered > 0 && waitingMs === null && <p class="muted" data-testid="due-tomorrow">{dueTomorrow > 0 ? `Ngày mai có ${dueTomorrow} thẻ cần ôn.` : "Ngày mai chưa có thẻ nào đến hạn."}</p>}
      <div class="row" style={{ justifyContent: "center" }}>
        {nextLesson && <button type="button" class="btn primary" onClick={() => onLesson(nextLesson)} data-testid="next-lesson">Sang bài tiếp: {lessonTitle(nextLesson)}</button>}
        {waitingMs !== null && <button type="button" class={`btn${nextLesson ? "" : " primary"}`} onClick={onContinue} data-testid="continue-early">Học tiếp ngay</button>}
        {hasMoreNew && <button type="button" class="btn" onClick={onMore} data-testid="more-new">Học thêm 5 từ mới</button>}
        {tomorrow > 0 && <button type="button" class="btn" onClick={onAhead} data-testid="review-ahead">{aheadLabel(tomorrow)}</button>}
        <button type="button" class="btn" onClick={() => go("/add")}><Icon n="plus" /> Thêm từ</button>
        {onUndo && <button type="button" class="btn ghost" onClick={onUndo}><Icon n="undo" /> Hoàn tác</button>}
      </div>
    </div>
  );
}
