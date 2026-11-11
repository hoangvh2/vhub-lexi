import { dayId, type Daily } from "@shared/model.ts";
import type { Roadmap, WordStatus } from "../lib/roadmap.ts";
import { heatmap, heatLevelFixed, HEAT_STEPS, type WeekCompare } from "../lib/stats.ts";
import { dm, minutes, NEW_WORD_ANSWERS, span, weekdayOf, WEEKDAYS, type Effort } from "../lib/roadmapView.ts";

const fmt = (n: number, digits = 1) => String(Math.round(n * 10 ** digits) / 10 ** digits).replace(".", ",");

// ---------------------------------------------------------------- word status

export function StatusBars({ s }: { s: WordStatus }) {
  const seg = [
    ["Chưa học", s.unseen, "var(--accent-soft)"],
    ["Đang học", s.learning, "var(--rose)"],
    ["Đang ôn (<21 ngày)", s.young, "var(--butter)"],
    ["Thuộc (≥21 ngày)", s.mature, "var(--mint)"],
  ] as const;
  const total = Math.max(1, s.total);
  return (
    <>
      <div class="statusbar" role="img" aria-label="Tỉ lệ từ theo trạng thái">
        {seg.map(([label, n, color]) => <i key={label} style={{ width: `${(n / total) * 100}%`, background: color }} />)}
      </div>
      <div class="statusrows">
        {seg.map(([label, n, color]) => (
          <div key={label}>
            <span><i style={{ background: color }} />{label}</span>
            <b>{n} từ · {Math.round((n / total) * 100)}%</b>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- roadmap

export interface PaceChip {
  key: string;
  label: string;
  value: number | "real";
}

interface RoadmapProps {
  status: WordStatus;
  rm: Roadmap | null;
  busy: boolean;
  error: string | null;
  todayStart: number;
  pace: number;
  chips: PaceChip[];
  selected: string;
  onPick(key: string): void;
  realKnown: boolean;
  observedDays: number;
  secPerCard: number | null;
}

function Eta({ title, day, todayStart, done, sub }: { title: string; day: number | null; todayStart: number; done: boolean; sub: string }) {
  return (
    <div>
      <span>{title}</span>
      <b>{done ? "Đã xong" : day === null ? "Chưa rõ" : dm(todayStart, day)}</b>
      <small>{done ? sub : day === null ? "xa hơn 8 tháng với nhịp này" : `${day === 0 ? "trong hôm nay" : `sau ${span(day)}`} · ${sub}`}</small>
    </div>
  );
}

function RoadmapChart({ rm, todayStart }: { rm: Roadmap; todayStart: number }) {
  const W = 340, H = 150, L = 4, R = 336, T = 12, B = 118, n = rm.unseen.length;
  const x = (i: number) => L + ((R - L) * i) / (n - 1);
  const y = (v: number) => B - ((B - T) * v) / Math.max(1, rm.words);
  const pts = (f: (i: number) => number) => rm.unseen.map((_, i) => `${x(i)},${y(f(i))}`);
  const rev = (a: string[]) => [...a].reverse();
  const top = rm.unseen.map((u) => rm.words - u);
  const matureArea = `M${x(0)},${B} L${pts((i) => rm.mature[i]).join(" L")} L${x(n - 1)},${B} Z`;
  const reviewArea = `M${pts((i) => rm.mature[i]).join(" L")} L${rev(pts((i) => top[i])).join(" L")} Z`;
  const unseenArea = `M${pts((i) => top[i]).join(" L")} L${x(n - 1)},${y(rm.words)} L${x(0)},${y(rm.words)} Z`;
  const y80 = y(rm.matureTarget);
  const marker = (day: number | null, label: string, sub: string | null, anchor: "start" | "end", yText: number) => {
    if (day === null || day / 7 > n - 1) return null;
    const mx = x(day / 7);
    return (
      <g>
        <line x1={mx} x2={mx} y1={T} y2={B} stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="2 2" />
        <text x={anchor === "start" ? mx + 4 : mx - 4} y={yText} text-anchor={anchor} class="v">{label}</text>
        {sub && <text x={anchor === "start" ? mx + 4 : mx - 4} y={yText + 11} text-anchor={anchor} class="v">{sub}</text>}
      </g>
    );
  };
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Dự báo số từ theo trạng thái trong 13 tuần tới">
      <path d={unseenArea} fill="var(--accent-soft)" />
      <path d={reviewArea} fill="var(--butter)" opacity=".8" />
      <path d={matureArea} fill="var(--mint)" />
      <line x1={L} x2={R} y1={y80} y2={y80} stroke="var(--mint-deep)" stroke-dasharray="3 3" />
      <text x={L + 2} y={y80 - 4} class="v">80% = {rm.matureTarget} từ</text>
      {marker(rm.introDay, `Hết từ mới ${dm(todayStart, rm.introDay ?? 0)}`, null, "start", T + 10)}
      {marker(rm.matureDay, "Thuộc 80%", dm(todayStart, rm.matureDay ?? 0), "end", B - 30)}
      <line x1={L} x2={R} y1={B} y2={B} stroke="var(--line)" />
      {[0, 4, 8, n - 1].map((i) => <text key={i} x={x(i)} y={B + 14} text-anchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{dm(todayStart, 7 * i)}</text>)}
    </svg>
  );
}

export function RoadmapPanel(p: RoadmapProps) {
  const { status: s, rm } = p;
  const introDone = s.unseen === 0;
  const matureDone = rm ? s.mature >= rm.matureTarget : false;
  const peakMin = rm ? minutes(rm.peakLoad + p.pace * NEW_WORD_ANSWERS, p.secPerCard) : null;
  return (
    <section class="panel">
      <div class="panel-head"><h2>Lộ trình</h2><span class="muted">ước tính từ dữ liệu của anh</span></div>
      <div class="rm-eta">
        <Eta title="Học hết từ mới" day={rm?.introDay ?? null} todayStart={p.todayStart} done={introDone} sub={`còn ${s.unseen} từ · ${fmt(p.pace)} từ/ngày`} />
        <Eta title="Thuộc 80% thư viện" day={rm?.matureDay ?? null} todayStart={p.todayStart} done={matureDone} sub={`hiện thuộc ${s.mature}/${s.total} từ (${Math.round((s.mature / Math.max(1, s.total)) * 100)}%)`} />
      </div>
      {p.busy && !rm && <p class="muted small" role="status">Đang tính dự báo…</p>}
      {p.error && <p class="muted small" role="alert">Không tính được dự báo: {p.error}</p>}
      {rm && <div style={{ opacity: p.busy ? 0.55 : 1, transition: "opacity .2s" }}><RoadmapChart rm={rm} todayStart={p.todayStart} /></div>}
      {rm && (
        <div class="legend">
          <span><i style={{ background: "var(--mint)" }} />Thuộc</span>
          <span><i style={{ background: "var(--butter)" }} />Đang học + đang ôn</span>
          <span><i style={{ background: "var(--accent-soft)" }} />Chưa học</span>
        </div>
      )}
      <div class="chips" role="group" aria-label="Thử số từ mới mỗi ngày">
        <span class="small muted">Thử:</span>
        {p.chips.map((c) => <button key={c.key} class="chip" aria-pressed={p.selected === c.key} onClick={() => p.onPick(c.key)}>{c.label}</button>)}
      </div>
      {!p.realKnown && <p class="small muted">Mới có {p.observedDays} ngày dữ liệu nên chưa dùng nhịp thật (cần ít nhất 7 ngày). Đang tính theo mức đã chọn.</p>}
      {rm && (
        <p class="whatif">
          Với <b>{fmt(p.pace)} từ/ngày</b>: {introDone ? "đã học hết từ mới" : rm.introDay === null ? "chưa hết từ mới trong 8 tháng tới" : <>hết từ mới <b>{dm(p.todayStart, rm.introDay)}</b></>}, lúc cao điểm ôn khoảng <b>{rm.peakLoad} thẻ/ngày{peakMin !== null ? ` (~${peakMin} phút, kể cả từ mới)` : ""}</b>.
        </p>
      )}
      <details class="how">
        <summary>Cách đọc và độ tin cậy</summary>
        <ul>
          <li>Máy chạy thử 12 lần việc học trong 8 tháng tới với bộ lập lịch FSRS thật trên thẻ của anh, rồi lấy trung vị.</li>
          <li>Giả định anh giữ nhịp từ mới như đang chọn, trả lời theo tỉ lệ Quên/Khó/Tốt/Dễ của 30 ngày qua, không nghỉ dài, không thêm từ mới vào thư viện, không đổi cài đặt.</li>
          <li>"Thuộc" = mọi thẻ của từ có khoảng ôn từ 21 ngày trở lên. Thẻ gõ của từ mới chỉ mở sau khi nhận diện đã sang Ôn, nên từ chưa thuộc ngay cả khi thẻ đầu đã dài.</li>
          <li>Độ chính xác chưa được đo. Ngày hết từ mới phụ thuộc chủ yếu vào việc anh có giữ nhịp không, không phụ thuộc FSRS.</li>
        </ul>
      </details>
      <details class="how">
        <summary>Tình trạng từ chi tiết</summary>
        <div style={{ marginTop: "8px" }}><StatusBars s={s} /></div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------- forecast

export function ForecastPanel({ fc, overdue, newPerDay, unseen, todayStart, effort }: { fc: number[]; overdue: number; newPerDay: number; unseen: number; todayStart: number; effort: Effort }) {
  const n = fc.length, slot = 24, L = 4, B = 112, Hmax = 78;
  const news: number[] = [];
  let left = unseen;
  for (let i = 0; i < n; i++) {
    const t = Math.min(left, Math.round(newPerDay));
    news.push(t);
    left -= t;
  }
  const loads = fc.map((v, i) => v + news[i]);
  const max = Math.max(1, ...loads, effort.usual ?? 0);
  const h = (v: number) => (v / max) * Hmax;
  const sum = fc.reduce((a, b) => a + b, 0);
  const sumMin = minutes(fc.reduce((a, v, i) => a + v + news[i] * NEW_WORD_ANSWERS, 0), effort.secPerCard);
  const heavy = fc.reduce((best, v, i) => (i > 0 && v > fc[best] ? i : best), 1);
  const empty = sum === 0;
  const hasMin = effort.secPerCard !== null;
  const H2 = B + (hasMin ? 44 : 30);
  return (
    <section class="panel">
      <div class="panel-head"><h2>Sắp đến hạn · 14 ngày</h2><span class="muted">{sum} lượt ôn{sumMin !== null ? ` · ≈ ${sumMin} phút` : ""}</span></div>
      {empty && <p class="muted small">Chưa có thẻ nào đang chờ ôn.</p>}
      <svg class="chart" viewBox={`0 0 ${L * 2 + n * slot} ${H2}`} role="img" aria-label="Số thẻ đến hạn mỗi ngày trong 14 ngày tới">
        {effort.usual !== null && <line x1={L} x2={L + n * slot} y1={B - h(effort.usual)} y2={B - h(effort.usual)} stroke="var(--muted)" stroke-dasharray="4 3" />}
        {fc.map((v, i) => {
          const x = L + i * slot, bw = 16, bx = x + (slot - bw) / 2, hr = h(v), hn = h(news[i]);
          const od = i === 0 ? Math.min(v, overdue) : 0;
          return (
            <g key={i}>
              <rect x={bx} y={B - hr} width={bw} height={hr} rx="4" fill="var(--accent-2)" />
              {od > 0 && <rect x={bx} y={B - hr} width={bw} height={h(od)} rx="4" fill="var(--rose)" />}
              {hn > 0 && <rect x={bx} y={B - hr - hn - 1} width={bw} height={hn} rx="4" fill="var(--accent-soft)" stroke="var(--accent-2)" stroke-dasharray="2 2" />}
              <text x={x + slot / 2} y={B - hr - hn - 4} text-anchor="middle" class={i === 0 ? "v today" : "v"}>{v}</text>
              <text x={x + slot / 2} y={B + 13} text-anchor="middle" class={i === 0 ? "today" : ""}>{i === 0 ? "Nay" : weekdayOf(todayStart, i)}</text>
              <text x={x + slot / 2} y={B + 25} text-anchor="middle">{dm(todayStart, i).slice(0, 2)}</text>
              {hasMin && <text x={x + slot / 2} y={B + 38} text-anchor="middle">{minutes(v + news[i] * NEW_WORD_ANSWERS, effort.secPerCard)}′</text>}
            </g>
          );
        })}
        <line x1={L} x2={L + n * slot} y1={B} y2={B} stroke="var(--line)" />
      </svg>
      <div class="legend">
        <span><i style={{ background: "var(--accent-2)" }} />Ôn đến hạn</span>
        {overdue > 0 && <span><i style={{ background: "var(--rose)" }} />Quá hạn ({overdue})</span>}
        {news.some((v) => v > 0) && <span><i style={{ background: "var(--accent-soft)", outline: "1px dashed var(--accent-2)" }} />Từ mới (~{Math.round(newPerDay)}/ngày)</span>}
        {effort.usual !== null && <span><i class="dash" />mức anh thường làm ({effort.usual}/ngày)</span>}
        {hasMin && <span>′ = phút ước tính</span>}
      </div>
      {!empty && fc[heavy] > 0 && (
        <p class="callout">{weekdayOf(todayStart, heavy)} {dm(todayStart, heavy)} nặng nhất trong 2 tuần tới: {fc[heavy]} thẻ ôn{effort.usual !== null && loads[heavy] > effort.usual ? `, cao hơn mức anh thường làm (${effort.usual}).` : "."}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- week

const sign = (n: number) => (n > 0 ? "↑" : n < 0 ? "↓" : "=");
const tone = (n: number, goodWhenUp = true) => (n === 0 ? "muted" : (n > 0) === goodWhenUp ? "up" : "down");

export function WeekPanel({ w, daily, now, dayStartHour }: { w: WeekCompare; daily: readonly Daily[]; now: number; dayStartHour: number }) {
  const slot = 44, B = 96, Hm = 70;
  const max = Math.max(10, ...w.prev, ...w.now.map((v) => v ?? 0));
  const A = w.thisWeek, P = w.lastWeek;
  const pct = P.answers > 0 ? Math.round(((A.answers - P.answers) / P.answers) * 100) : null;
  const dMin = Math.round((A.ms - P.ms) / 60_000);
  const dRet = A.retention !== null && P.retention !== null ? Math.round((A.retention - P.retention) * 100) : null;
  const heat = heatmap(daily, now, dayStartHour, 12);
  const cell = 15, gap = 3, Lp = 22, Tp = 14;
  const byWeek = heat.length ? Math.max(...heat.map((c) => c.week)) + 1 : 12;
  const month = (id: string) => `Th${Number(id.slice(5, 7))}`;
  const labels: Array<[number, string]> = [];
  for (const c of heat) if (c.dow === 0 && (c.week === 0 || month(heat.find((x) => x.week === c.week - 1 && x.dow === 0)?.id ?? c.id) !== month(c.id))) labels.push([c.week, month(c.id)]);
  return (
    <section class="panel">
      <div class="panel-head"><h2>Tuần này</h2><span class="muted small">{w.days === 7 ? "cả tuần" : `${w.days} ngày đầu`} so với tuần trước</span></div>
      <div class="kpis">
        <div><b>{A.activeDays}/{w.days}</b><span>ngày có học <em class={tone(A.activeDays - P.activeDays)}>tuần trước {P.activeDays}/{w.days}</em></span></div>
        <div><b>{A.answers}</b><span>lượt trả lời {pct !== null && <em class={tone(pct)}>{sign(pct)} {Math.abs(pct)}% ({P.answers})</em>}</span></div>
        <div><b>{Math.round(A.ms / 60_000)}′</b><span>thời gian {P.ms > 0 && <em class={tone(dMin)}>{sign(dMin)} {Math.abs(dMin)} phút</em>}</span></div>
        <div><b>{A.retention === null ? "–" : `${Math.round(A.retention * 100)}%`}</b><span>nhớ đúng {dRet !== null && <em class={tone(dRet)}>{sign(dRet)} {Math.abs(dRet)} điểm</em>}</span></div>
      </div>
      <svg class="chart" viewBox="0 0 316 116" role="img" aria-label="Lượt học mỗi ngày, tuần này so với tuần trước">
        {WEEKDAYS.map((t, i) => {
          const x = 6 + i * slot, p = w.prev[i], c = w.now[i];
          const hp = (p / max) * Hm, hc = ((c ?? 0) / max) * Hm;
          return (
            <g key={t}>
              <rect x={x + 4} y={B - hp} width="16" height={Math.max(hp, 1)} rx="4" fill="var(--surface-2)" stroke="var(--line)" />
              {p > 0 && <text x={x + 12} y={B - hp - 4} text-anchor="middle">{p}</text>}
              {c !== null && <rect x={x + 20} y={B - hc} width="16" height={Math.max(hc, 2)} rx="4" fill="var(--accent)" />}
              {c !== null && <text x={x + 28} y={B - hc - 4} text-anchor="middle" class="v">{c}</text>}
              <text x={x + 20} y={B + 14} text-anchor="middle" class={i === w.days - 1 ? "today" : ""}>{i === w.days - 1 ? "Nay" : t}</text>
            </g>
          );
        })}
        <line x1="0" x2="316" y1={B} y2={B} stroke="var(--line)" />
      </svg>
      <div class="legend">
        <span><i style={{ background: "var(--accent)" }} />Tuần này</span>
        <span><i style={{ background: "var(--surface-2)", outline: "1px solid var(--line)" }} />Tuần trước</span>
        <span>số = lượt trả lời thẻ</span>
      </div>
      <details class="how">
        <summary>Lịch 12 tuần</summary>
        <div style={{ overflowX: "auto", marginTop: "8px" }}>
          <svg class="heat" viewBox={`0 0 ${Lp + byWeek * (cell + gap)} ${Tp + 7 * (cell + gap)}`} style={{ minWidth: "300px", width: "100%" }} role="img" aria-label="Lịch hoạt động 12 tuần">
            {labels.map(([wk, t]) => <text key={wk} x={Lp + wk * (cell + gap)} y="9">{t}</text>)}
            {WEEKDAYS.map((t, d) => (d % 2 === 0 || d === 6 ? <text key={t} x="0" y={Tp + d * (cell + gap) + cell - 3}>{t}</text> : null))}
            {heat.map((c) => (
              <rect key={c.id} x={Lp + c.week * (cell + gap)} y={Tp + c.dow * (cell + gap)} width={cell} height={cell} rx="3" class={`l${heatLevelFixed(c.count)}`} stroke={c.id === dayId(now, dayStartHour) ? "var(--peach-deep)" : "none"} stroke-width="1.5">
                <title>{`${c.id}: ${c.count} lượt`}</title>
              </rect>
            ))}
          </svg>
        </div>
        <div class="legend" style={{ marginTop: "6px" }}>
          <span>Lượt/ngày:</span>
          {[`0`, `${HEAT_STEPS[0]}–${HEAT_STEPS[1] - 1}`, `${HEAT_STEPS[1]}–${HEAT_STEPS[2] - 1}`, `${HEAT_STEPS[2]}–${HEAT_STEPS[3] - 1}`, `${HEAT_STEPS[3]}+`].map((t, i) => <span key={t}><svg class="heat sw" viewBox="0 0 12 12" width="12" height="12"><rect width="12" height="12" rx="3" class={`l${i}`} /></svg>{t}</span>)}
        </div>
        <p>Mỗi ô là một ngày, mỗi cột là một tuần (T2 ở trên cùng, cột phải nhất là tuần này, viền cam là hôm nay). Thang màu cố định nên tuần nào cũng so được với nhau.</p>
      </details>
    </section>
  );
}
