// The recall ladder under a typing card (shared/ladder.ts): more help, a lower best rating, and the word is always
// typed. Only the newest rung is open; older rungs fold into one line so the card still fits a phone.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FLASH_ANSWER_MS, FLASH_WORDS_MS, LETTER_STEP_MS, flashWords, nextRung, otherPhrase, type Rung } from "@shared/ladder.ts";
import { letterCount } from "@shared/confusables.ts";
import type { Note } from "@shared/model.ts";
import { Icon, toast } from "./common.tsx";

const NEXT_LABEL: Record<number, string> = {
  1: "Cụm ở nghĩa khác",
  2: "Hiện dần chữ cái",
  3: "Chớp 4 từ",
  4: "Chớp đáp án",
};
const CAP_LABEL: Record<number, string> = { 1: "tối đa Tốt", 2: "tối đa Khó", 3: "tối đa Khó", 4: "tính là Lại" };
const USED: Record<number, string> = { 1: "cụm nghĩa khác", 2: "chữ cái", 3: "4 từ chớp", 4: "đáp án chớp" };

export function Ladder(props: {
  note: Note;
  reps: number;
  word: string;
  /** Words to flash among on rung 3, best first (the learner's confusable words, then same part of speech). */
  pool(): string[];
  seed: string;
  gateMs: number;
  readLocked(): Promise<boolean>;
  /** The rung reached and how many letters beyond the first the skeleton shows. */
  onChange(rung: Rung, extraLetters: number): void;
}) {
  const { note, reps, word, gateMs, onChange } = props;
  const [rung, setRung] = useState<Rung>(0);
  const [awake, setAwake] = useState(gateMs === 0);
  const [locked, setLocked] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [flash, setFlash] = useState<string[] | null>(null);
  const other = useMemo(() => otherPhrase(note, reps), [note, reps]);
  const letters = letterCount(word);
  const extra = useRef(0);

  useEffect(() => {
    if (gateMs === 0) return;
    const t = setTimeout(() => setAwake(true), gateMs);
    return () => clearTimeout(t);
  }, []);

  // Rung 2: a new letter every 2 s, until one is left.
  useEffect(() => {
    if (rung !== 2) return;
    const max = Math.max(0, letters - 2);
    const id = setInterval(() => {
      if (extra.current >= max) return clearInterval(id);
      extra.current += 1;
      onChange(2, extra.current);
    }, LETTER_STEP_MS);
    return () => clearInterval(id);
  }, [rung]);

  // Rungs 3 and 4: a flash that goes away by itself.
  useEffect(() => {
    if (rung !== 3 && rung !== 4) return;
    const words = rung === 4 ? [word] : flashWords(word, props.pool(), props.seed) ?? [word];
    setFlash(words);
    const t = setTimeout(() => setFlash(null), rung === 4 ? FLASH_ANSWER_MS : FLASH_WORDS_MS);
    return () => clearTimeout(t);
  }, [rung]);

  const next = nextRung(rung, !!other);
  const press = async () => {
    if (next === null || flash) return;
    if (locked) return toast("Từ này bạn hay cần gợi ý. Lần này hãy tự nhớ.");
    if (!awake) return toast("Thử tự nhớ thêm vài giây nhé");
    if (locked === null) {
      if (asking) return;
      setAsking(true);
      const l = await props.readLocked();
      setLocked(l);
      setAsking(false);
      if (l) return toast("Từ này bạn hay cần gợi ý. Lần này hãy tự nhớ.");
    }
    setRung(next);
    onChange(next, extra.current);
  };

  const used = [1, 2, 3, 4].filter((r) => r < rung && (r !== 1 || other));
  return (
    <div class={`ladder${awake ? " awake" : ""}`} onClick={(e) => e.stopPropagation()} data-testid="ladder" data-rung={rung}>
      {used.length > 0 && <div class="lad-used" data-testid="ladder-used">Đã dùng: {used.map((r) => USED[r]).join(" · ")}</div>}
      {rung === 1 && other && (
        <div class="lad-phrase" data-testid="ladder-phrase" key="p">
          <span class="lad-tag">Nghĩa khác</span>
          <div class="lad-text">
            {other.segs.map((s, i) => (s.masked ? <i key={i} class="lad-blank" /> : <span key={i}>{s.text}</span>))}
          </div>
          {other.vi && <div class="lad-vi">{other.vi}</div>}
        </div>
      )}
      {(rung === 3 || rung === 4) && (
        <div class={`lad-stage${flash ? " live" : ""}`} aria-live="polite">
          {flash ? (
            <div class={`lad-flash n${flash.length}`} aria-hidden="true" data-testid="ladder-flash" key={rung}>
              {flash.map((w) => <b key={w}>{w}</b>)}
            </div>
          ) : (
            <span class="lad-gone">{rung === 4 ? "Đáp án đã ẩn, hãy gõ lại" : "Bạn đã thấy 4 từ, hãy gõ lại"}</span>
          )}
        </div>
      )}
      {next !== null && (
        <button type="button" class="btn ghost lad-btn" onClick={() => void press()} disabled={!!flash} aria-busy={asking} data-testid="ladder-btn">
          <Icon n="bulb" size={16} />
          {NEXT_LABEL[next]}
          <small>{CAP_LABEL[next]}</small>
        </button>
      )}
    </div>
  );
}
