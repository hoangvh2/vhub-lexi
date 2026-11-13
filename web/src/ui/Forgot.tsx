import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Note } from "@shared/model.ts";
import { answerHint } from "@shared/confusables.ts";
import { DRILL_ROUND, FORGOT_KINDS, FORGOT_LABEL, afterAnswer, drillRound, forgotNotes, forgotOf, shortMeaning, wordsToWatch, type DrillItem, type ForgotKind } from "@shared/drill.ts";
import { checkTyped, list, str, type AnswerVerdict } from "@shared/notetypes.ts";
import { setForgot } from "../data/actions.ts";
import { cards, loaded, notes } from "../data/state.ts";
import { speak } from "../lib/speech.ts";
import { useStore } from "../lib/store.ts";
import { Icon, go, toast } from "./common.tsx";

const SHORT: Record<ForgotKind, string> = { meaning: "Nghĩa", sound: "Phát âm" };

/**
 * The "hay quên" mark on a study card, next to the hint buttons: one tap opens two toggles (meaning, sound). Each
 * toggle is one write of the note; the card's FSRS state and the answer being given are not touched.
 */
export function ForgotButton({ note }: { note: Note }) {
  const live = useStore(notes).find((n) => n.id === note.id) ?? note;
  const kinds = forgotOf(live);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);
  const toggle = async (k: ForgotKind) => {
    const on = !kinds.includes(k);
    await setForgot(live, k, on);
    // Once per word, when it joins the list; the ticks in the menu say the rest.
    if (on && !kinds.length) toast("Đã thêm vào Từ hay quên", { label: "Xem", run: () => go("/forgot") }, 2500);
  };
  return (
    <div class="forgot" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        class={`hint-btn forgot-btn${kinds.length ? " on" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={kinds.length ? `Hay quên: ${kinds.map((k) => SHORT[k].toLowerCase()).join(", ")}` : "Đánh dấu hay quên"}
        title="Đánh dấu hay quên (Q)"
        data-testid="forgot-btn"
        data-marked={kinds.join(",")}
      >
        <Icon n="bookmark" size={18} />
      </button>
      {open && (
        <div class="forgot-pop" role="group" aria-label="Đánh dấu hay quên" data-testid="forgot-pop">
          <b>Từ này hay quên…</b>
          {FORGOT_KINDS.map((k) => (
            <button type="button" key={k} class="forgot-opt" aria-pressed={kinds.includes(k)} onClick={() => void toggle(k)} data-testid={`forgot-${k}`}>
              <span class="tick">{kinds.includes(k) && <Icon n="check" size={14} />}</span>
              {FORGOT_LABEL[k]}
            </button>
          ))}
          <small class="muted">Chỉ để luyện thêm, không đổi lịch ôn.</small>
        </div>
      )}
    </div>
  );
}

type Filter = "all" | ForgotKind;

/** Its own screen: the marked words, FSRS's most-forgotten words as suggestions, and a practice round. */
export function ForgotPage() {
  const ready = useStore(loaded);
  const allNotes = useStore(notes);
  const allCards = useStore(cards);
  const marked = useMemo(() => forgotNotes(allNotes), [allNotes]);
  const suggested = useMemo(() => wordsToWatch(allCards, allNotes, 40).filter((w) => w.note.type === "vocab" && !forgotOf(w.note).length).slice(0, 10), [allCards, allNotes]);
  const [filter, setFilter] = useState<Filter>("all");
  const [round, setRound] = useState<DrillItem[] | null>(null);
  const shown = filter === "all" ? marked : marked.filter((n) => forgotOf(n).includes(filter));
  const count = (k: ForgotKind) => marked.filter((n) => forgotOf(n).includes(k)).length;

  if (!ready) return <div class="page"><p class="muted">Đang tải dữ liệu…</p></div>;

  if (round) {
    return (
      <div class="page narrow drill-page" data-testid="forgot-page">
        <DrillRun items={round} pool={allNotes} onExit={() => setRound(null)} onAgain={() => setRound(drillRound(shown, allNotes, String(Date.now())))} />
      </div>
    );
  }

  const start = () => {
    const items = drillRound(shown, allNotes, String(Date.now()));
    if (!items.length) return toast("Chưa có bài luyện cho các từ này: thêm nghĩa tiếng Việt cho từ quên nghĩa.");
    setRound(items);
  };

  return (
    <div class="page narrow forgot-page" data-testid="forgot-page">
      <div class="page-head">
        <button type="button" class="btn ghost sm" onClick={() => go("/today")}><Icon n="arrow" size={16} /> Hôm nay</button>
        <h1>Từ hay quên</h1>
      </div>
      <p class="muted">Luyện thêm những từ bạn hay quên nghĩa hoặc cách đọc, ngoài lịch ôn. Không tính vào FSRS: lịch ôn, độ khó và lịch sử ôn của thẻ giữ nguyên.</p>

      <section class="panel drill-hero" data-testid="forgot-hero">
        <div class="grow">
          <b class="big">{marked.length} từ</b>
          <span class="muted">{count("meaning")} quên nghĩa · {count("sound")} quên phát âm</span>
        </div>
        <button type="button" class="btn primary" disabled={!shown.length} onClick={start} data-testid="drill-start">
          <Icon n="bolt" size={18} /> Luyện {Math.min(shown.length, DRILL_ROUND)} từ
        </button>
      </section>

      {marked.length > 0 && (
        <div class="seg" role="group" aria-label="Lọc">
          {(["all", "meaning", "sound"] as const).map((f) => (
            <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`forgot-filter-${f}`}>
              {f === "all" ? `Tất cả ${marked.length}` : `${SHORT[f]} ${count(f)}`}
            </button>
          ))}
        </div>
      )}

      {marked.length === 0 ? (
        <div class="empty small" data-testid="forgot-empty">
          <Icon n="bookmark" size={28} />
          <p>Chưa có từ nào. Khi học hoặc ôn, bấm biểu tượng <b>đánh dấu</b> cạnh nút Mẹo để thêm từ vào đây.</p>
        </div>
      ) : (
        <ul class="forgot-list" data-testid="forgot-list">
          {shown.map((n) => <ForgotRow key={n.id} note={n} />)}
        </ul>
      )}

      {suggested.length > 0 && (
        <section class="panel" data-testid="forgot-suggested">
          <div class="panel-head">
            <h2>Quên nhiều trong lịch ôn</h2>
          </div>
          <p class="muted small sub">Theo số lần bạn chấm Quên. Bấm + để thêm vào danh sách luyện.</p>
          <ul class="watch">
            {suggested.map(({ note, lapses }) => (
              <li key={note.id}>
                <b>{str(note.fields.word)}</b>
                <span class="muted">{shortMeaning(note)}</span>
                <span class="row nowrap">
                  <span class="pill bad">quên {lapses}</span>
                  <button type="button" class="btn ghost sm" onClick={() => void setForgot(note, "meaning", true)} data-testid="forgot-suggest-add" aria-label={`Đánh dấu ${str(note.fields.word)}`}>
                    <Icon n="plus" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ForgotRow({ note }: { note: Note }) {
  const kinds = forgotOf(note);
  const word = str(note.fields.word);
  return (
    <li class="forgot-row" data-testid="forgot-row" data-word={word}>
      <button type="button" class="icon-btn" onClick={() => speak(word)} aria-label={`Nghe ${word}`}><Icon n="speaker" size={18} /></button>
      <div class="grow">
        <b>{word}</b> {str(note.fields.ipa) && <span class="muted ipa">{str(note.fields.ipa)}</span>}
        <span class="muted meaning">{shortMeaning(note) || "Chưa có nghĩa"}</span>
      </div>
      <div class="kinds">
        {FORGOT_KINDS.map((k) => (
          <button
            type="button"
            key={k}
            class={`kind ${k}`}
            aria-pressed={kinds.includes(k)}
            onClick={() => void setForgot(note, k, !kinds.includes(k))}
            title={kinds.includes(k) ? `Bỏ đánh dấu ${FORGOT_LABEL[k].toLowerCase()}` : `Đánh dấu ${FORGOT_LABEL[k].toLowerCase()}`}
            data-testid={`row-${k}`}
          >
            {SHORT[k]}
          </button>
        ))}
      </div>
    </li>
  );
}

const MODE_TITLE: Record<DrillItem["mode"], string> = {
  meaning: "Chọn nghĩa đúng",
  recall: "Gõ từ tiếng Anh",
  say: "Đọc to từ này",
  listen: "Nghe và gõ từ",
};

/**
 * One practice round. Answers live in this component only: nothing is written anywhere, so FSRS (cards, review log,
 * day counters) stays as it was. A missed exercise comes back three exercises later until it is right.
 */
function DrillRun({ items, pool, onExit, onAgain }: { items: DrillItem[]; pool: readonly Note[]; onExit(): void; onAgain(): void }) {
  const byId = useMemo(() => new Map(pool.map((n) => [n.id, n])), [pool]);
  const [queue, setQueue] = useState(items.filter((i) => byId.has(i.noteId)));
  const total = useRef(queue.length).current;
  const [missed, setMissed] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState(0);
  const [answer, setAnswer] = useState<null | { right: boolean; verdict?: AnswerVerdict; picked?: string; typed?: string }>(null);
  const [typed, setTyped] = useState("");
  const [heard, setHeard] = useState(false);
  const [turn, setTurn] = useState(0);
  const item = queue[0];
  const note = item ? byId.get(item.noteId) : undefined;
  const word = note ? str(note.fields.word) : "";

  useEffect(() => {
    if (item?.mode === "listen") speak(word, 0.85);
  }, [turn]);
  // Enter goes on once an answer is shown (the typing field is gone by then).
  const nextRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !answerRef.current || (e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      nextRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const answerRef = useRef(false);
  answerRef.current = !!answer;

  if (!item || !note) {
    const words = [...new Set([...missed].map((k) => k.split("/")[0]))].map((id) => byId.get(id)).filter((n): n is Note => !!n);
    return (
      <div class="panel drill-done" data-testid="drill-done">
        <Icon n="check" size={30} />
        <h2>Xong vòng luyện</h2>
        <p data-testid="drill-score">{total} bài, đúng ngay lần đầu {total - missed.size}/{total}.</p>
        {words.length > 0 && (
          <p data-testid="drill-missed">Cần luyện thêm: {words.map((n, i) => <span key={n.id}>{i ? ", " : ""}<b>{str(n.fields.word)}</b></span>)}</p>
        )}
        <p class="muted small">Lịch ôn FSRS không đổi: vòng luyện này không ghi lượt ôn nào.</p>
        <div class="row" style={{ justifyContent: "center" }}>
          <button type="button" class="btn" onClick={onExit} data-testid="drill-exit">Về danh sách</button>
          <button type="button" class="btn primary" onClick={onAgain} data-testid="drill-again">Luyện vòng nữa</button>
        </div>
      </div>
    );
  }

  const finish = (right: boolean, extra: { verdict?: AnswerVerdict; picked?: string; typed?: string } = {}) => {
    setAnswer({ right, ...extra });
    if (!right) setMissed((m) => new Set(m).add(`${item.noteId}/${item.mode}`));
    if (item.mode !== "listen" && item.mode !== "say") speak(word);
  };
  const next = () => {
    setQueue((q) => afterAnswer(q, !!answer?.right));
    if (answer?.right) setDone((d) => d + 1);
    setAnswer(null);
    setTyped("");
    setHeard(false);
    setTurn((t) => t + 1);
  };
  nextRef.current = next;
  const check = () => {
    if (!typed.trim()) return;
    const v = checkTyped(typed, [word]);
    finish(v !== "wrong", { verdict: v, typed });
  };
  const ipa = str(note.fields.ipa);
  const example = list(note.fields.examples)[0];

  return (
    <div class="drill" data-testid="drill" data-mode={item.mode}>
      <div class="drill-top">
        <button type="button" class="btn ghost sm" onClick={onExit} data-testid="drill-quit"><Icon n="x" size={16} /> Dừng</button>
        <span class="muted small" data-testid="drill-left">Còn {queue.length} · đã đúng {done}/{total}</span>
      </div>
      <div class="progress"><i style={{ width: `${(done / Math.max(1, total)) * 100}%` }} /></div>
      <div class="scard drill-card" key={turn} data-testid="drill-card">
        <div class="mode-head"><span class={`mode-dot ${item.mode === "say" || item.mode === "listen" ? "listen" : item.mode === "meaning" ? "recognize" : "recall"}`} />{MODE_TITLE[item.mode]}</div>

        {(item.mode === "meaning" || item.mode === "say") && (
          <div class="drill-word">
            <b data-testid="drill-word">{word}</b>
            {item.mode === "meaning" && ipa && <span class="ipa muted">{ipa}</span>}
            {item.mode === "say" && (answer || heard) && ipa && <span class="ipa muted" data-testid="drill-ipa">{ipa}</span>}
          </div>
        )}
        {item.mode === "recall" && (
          <div class="drill-word">
            <b class="vi" data-testid="drill-meaning">{shortMeaning(note)}</b>
            {str(note.fields.pos) && <span class="muted">{str(note.fields.pos)}</span>}
            {!answer && (
              <div class="skel" aria-label={`Đáp án có ${word.replace(/\s/g, "").length} chữ cái`}>
                {[...answerHint(word, 1)].map((ch, i) => (ch === " " ? <i key={i} class="gap" /> : <span key={i} class={ch === "_" ? "" : "on"}>{ch === "_" ? "" : ch}</span>))}
              </div>
            )}
          </div>
        )}
        {item.mode === "listen" && (
          <div class="drill-word">
            <div class="row" style={{ justifyContent: "center" }}>
              <button type="button" class="btn speak-big" onClick={() => speak(word, 0.85)} data-testid="drill-play"><Icon n="speaker" size={22} /> Nghe lại</button>
              <button type="button" class="btn ghost sm" onClick={() => speak(word, 0.6)}>Chậm</button>
            </div>
          </div>
        )}

        {item.mode === "meaning" && (
          <div class="drill-options" role="group" aria-label="Nghĩa">
            {item.options!.map((id) => {
              const o = byId.get(id);
              const state = !answer ? "" : id === item.noteId ? " right" : id === answer.picked ? " wrong" : " dim";
              return (
                <button type="button" key={id} class={`drill-opt${state}`} disabled={!!answer} onClick={() => finish(id === item.noteId, { picked: id })} data-testid="drill-opt" data-right={id === item.noteId}>
                  {o ? shortMeaning(o) : ""}
                </button>
              );
            })}
          </div>
        )}

        {(item.mode === "recall" || item.mode === "listen") && !answer && (
          <form class="typebox" onSubmit={(e) => { e.preventDefault(); check(); }}>
            <input class="input" value={typed} onInput={(e) => setTyped(e.currentTarget.value)} placeholder="Gõ từ…" autocomplete="off" autocapitalize="off" spellcheck={false} aria-label="Từ bạn gõ" data-testid="drill-input" autofocus />
            <div class="row" style={{ justifyContent: "center" }}>
              <button type="submit" class="btn primary" data-testid="drill-check">Kiểm tra</button>
              <button type="button" class="btn ghost" onClick={() => finish(false, { verdict: "wrong" })} data-testid="drill-giveup">Không nhớ</button>
            </div>
          </form>
        )}

        {item.mode === "say" && !answer && (
          !heard ? (
            <div class="drill-say">
              <p class="muted">Đọc thành tiếng trước, rồi bấm nghe để so.</p>
              <button type="button" class="btn primary" onClick={() => { setHeard(true); speak(word); }} data-testid="drill-hear"><Icon n="speaker" size={18} /> Nghe cách đọc</button>
            </div>
          ) : (
            <div class="drill-say">
              <button type="button" class="btn ghost sm" onClick={() => speak(word, 0.6)}><Icon n="speaker" size={16} /> Nghe chậm</button>
              <p class="muted">Bạn đọc có giống không?</p>
              <div class="row" style={{ justifyContent: "center" }}>
                <button type="button" class="btn" onClick={() => finish(false)} data-testid="drill-say-no">Chưa giống</button>
                <button type="button" class="btn primary" onClick={() => finish(true)} data-testid="drill-say-yes">Đọc đúng</button>
              </div>
            </div>
          )
        )}

        {answer && (
          <div class="drill-answer" data-testid="drill-answer">
            <span class={`verdict ${answer.right ? (answer.verdict === "close" ? "close" : "correct") : "wrong"}`} data-testid="drill-verdict">
              <Icon n={answer.right ? "check" : "x"} size={16} />
              {answer.right ? (answer.verdict === "close" ? "Gần đúng" : "Đúng rồi") : "Chưa đúng, sẽ hỏi lại"}
              {answer.typed && answer.verdict !== "correct" ? ` · bạn gõ “${answer.typed}”` : ""}
            </span>
            {item.mode !== "say" && (
              <p class="drill-reveal">
                <b>{word}</b> {ipa && <span class="ipa muted">{ipa}</span>}
                <button type="button" class="icon-btn" onClick={() => speak(word)} aria-label={`Nghe ${word}`}><Icon n="speaker" size={16} /></button>
              </p>
            )}
            {str(note.fields.vi) && <p class="drill-vi">{str(note.fields.vi)}</p>}
            {example && <p class="muted drill-ex">{example}</p>}
          </div>
        )}
      </div>
      {answer && (
        <div class="actbar">
          <button type="button" class="btn primary show-btn" onClick={next} data-testid="drill-next" autofocus>Tiếp</button>
        </div>
      )}
    </div>
  );
}
