import { useMemo } from "preact/hooks";
import { CardState } from "@shared/model.ts";
import { cards, notes } from "../data/state.ts";
import { CAUSES, PARTS, PART_TARGET, RC_TARGET, notesByTestTag, testResults, topCause, wrongTotal } from "../lib/practice.ts";
import { useStore } from "../lib/store.ts";
import { Icon, go } from "./common.tsx";

/** What to do next for each reason a question was missed (the reason with the most misses is shown). */
const ADVICE = {
  v: "Phần lớn câu sai vì thiếu từ. Biến từ lạ của bài này thành thẻ rồi ôn mỗi ngày.",
  g: "Phần lớn câu sai vì ngữ pháp. Biến mỗi câu sai thành thẻ điền từ, kèm quy tắc.",
  p: "Phần lớn câu sai vì không nhận ra cách diễn đạt lại. Đọc câu hỏi trước, gạch dòng chứa bằng chứng rồi mới chọn.",
  t: "Phần lớn câu sai vì vội hoặc hết giờ. Chia giờ cố định cho từng Part khi làm bài kế tiếp.",
} as const;

/** The Today screen's link between practice and study: the latest result against the target, and the next step. */
export function TargetPanel() {
  const allNotes = useStore(notes);
  const allCards = useStore(cards);
  const tests = useMemo(() => testResults(allNotes), [allNotes]);
  const bySource = useMemo(() => notesByTestTag(allNotes), [allNotes]);
  const grammarCount = useMemo(() => allNotes.filter((n) => n.type === "grammar").length, [allNotes]);
  const grammarWaiting = useMemo(() => {
    const ids = new Set(allNotes.filter((n) => n.type === "grammar").map((n) => n.id));
    return allCards.filter((c) => ids.has(c.noteId) && !c.suspended && c.state !== CardState.Review).length;
  }, [allNotes, allCards]);

  if (tests.length === 0) {
    return (
      <section class="panel target empty-target" data-testid="target-empty" data-in>
        <div class="panel-head"><h2>Mục tiêu TOEIC</h2></div>
        <p class="muted">Ghi kết quả bài làm thử đầu tiên để thấy bạn đang ở đâu và lấy từ lạ, câu ngữ pháp sai từ chính bài đó thành thẻ.</p>
        <div class="row">
          <button type="button" class="btn primary" onClick={() => go("/practice?tab=result")} data-testid="target-log"><Icon n="plus" /> Ghi kết quả bài làm</button>
          <button type="button" class="btn ghost" onClick={() => go("/practice?tab=words")}>Dán đoạn đọc</button>
        </div>
      </section>
    );
  }

  const last = tests[tests.length - 1];
  const full = tests.filter((t) => t.fullRc);
  const prev = full.length >= 2 && last.fullRc ? full[full.length - 2] : null;
  const delta = prev ? last.rcRight - prev.rcRight : null;
  const cause = topCause(last);
  const source = bySource.get(last.tag) ?? { vocab: 0, grammar: 0 };
  const wrong = wrongTotal(last);
  const spark = full.slice(-8);

  return (
    <section class="panel target" data-testid="target" data-in>
      <div class="panel-head">
        <h2>Mục tiêu TOEIC</h2>
        <span class="muted">{last.name} · {last.date}</span>
      </div>
      <div class="t-grid">
        <div class="t-main">
          <div class="t-score" data-testid="target-score">
            <b>{last.rcRight}</b><span>/{last.rcTotal || 100}</span>
            <small>câu RC đúng{last.fullRc ? `, mục tiêu ${RC_TARGET}` : " (chưa đủ 3 Part)"}</small>
          </div>
          {last.fullRc && <div class="progress meter"><i style={{ width: `${Math.min(100, (last.rcRight / RC_TARGET) * 100)}%` }} /></div>}
          {delta !== null && <span class={`pill ${delta >= 0 ? "ok" : "bad"}`} data-testid="target-delta">{delta >= 0 ? "+" : ""}{delta} so với {prev!.name}</span>}
          {spark.length >= 2 && <Spark values={spark.map((t) => t.rcRight)} target={RC_TARGET} />}
        </div>
        <ul class="t-parts">
          {PARTS.map((p) => {
            const s = last.parts[p.key];
            if (!s) return null;
            const pct = (s.right / s.total) * 100;
            const goal = (PART_TARGET[p.key] / p.total) * 100;
            return (
              <li key={p.key}>
                <span>{p.label}</span>
                <span class="t-bar"><i style={{ width: `${pct}%` }} /><em style={{ left: `${goal}%` }} title={`Mục tiêu ${PART_TARGET[p.key]}/${p.total}`} /></span>
                <b>{Math.round(pct)}%</b>
              </li>
            );
          })}
        </ul>
      </div>

      {wrong > 0 && (
        <div class="t-why">
          <div class="chips">
            {CAUSES.filter((c) => last.causes[c.key] > 0).map((c) => <span key={c.key} class={`pill ${c.key === cause ? "warn" : ""}`}>{c.label} {last.causes[c.key]}</span>)}
          </div>
          {cause && <p class="muted" data-testid="target-advice">{ADVICE[cause]}</p>}
        </div>
      )}

      <div class="row t-actions">
        {source.vocab > 0 && <button type="button" class="btn soft" onClick={() => go(`/study?tag=${encodeURIComponent(last.tag)}`)} data-testid="target-study-words">Học {source.vocab} từ của bài này</button>}
        {grammarCount > 0 && <button type="button" class="btn soft" onClick={() => go("/study?tag=ngu-phap")} data-testid="target-study-grammar">Ôn ngữ pháp · {grammarWaiting > 0 ? `${grammarWaiting} thẻ chưa thuộc` : `${grammarCount} thẻ`}</button>}
        <button type="button" class="btn" onClick={() => go("/practice")} data-testid="target-practice"><Icon n="plus" /> Luyện đề</button>
      </div>
    </section>
  );
}

function Spark({ values, target }: { values: number[]; target: number }) {
  const w = 120;
  const h = 34;
  const lo = Math.min(...values, target - 20);
  const hi = Math.max(...values, target);
  const y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);
  const x = (i: number) => 4 + (i / (values.length - 1)) * (w - 8);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg class="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`RC đúng qua ${values.length} bài: ${values.join(", ")}`}>
      <line x1="0" x2={w} y1={y(target)} y2={y(target)} class="goal" />
      <polyline points={pts} fill="none" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.6" />)}
    </svg>
  );
}
