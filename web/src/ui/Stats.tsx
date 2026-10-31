import { useMemo } from "preact/hooks";
import { dayId } from "@shared/model.ts";
import { cards, daily, loaded, notes, prefs } from "../data/state.ts";
import { cardCounts, forecast, heatmap, level, retention, streak } from "../lib/stats.ts";
import { useStore } from "../lib/store.ts";

export function Stats() {
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const dailies = useStore(daily);
  const p = useStore(prefs);
  const ready = useStore(loaded);
  const now = Date.now();

  const counts = useMemo(() => cardCounts(allCards), [allCards]);
  const fc = useMemo(() => forecast(allCards, now, p.dayStartHour), [allCards, p.dayStartHour]);
  const heat = useMemo(() => heatmap(dailies, now, p.dayStartHour), [dailies, p.dayStartHour]);
  const today = dailies.find((d) => d.id === dayId(now, p.dayStartHour));
  const ret = retention(dailies, now, p.dayStartHour);
  const st = streak(dailies, now, p.dayStartHour);
  const total30 = dailies.filter((d) => d.id >= dayId(now - 30 * 86_400_000, p.dayStartHour)).reduce((a, d) => a + d.newCards + d.reviews, 0);

  if (!ready) return <div class="page"><p class="muted">Đang tải…</p></div>;
  const fcMax = Math.max(1, ...fc);
  const heatMax = Math.max(1, ...heat.map((c) => c.count));
  const seg = [
    ["Mới", counts.new, "var(--accent-2)"],
    ["Đang học", counts.learning, "var(--rose)"],
    ["Mới ôn (<21 ngày)", counts.young, "var(--butter)"],
    ["Thuộc (≥21 ngày)", counts.mature, "var(--mint)"],
  ] as const;
  const segTotal = Math.max(1, seg.reduce((a, s) => a + s[1], 0));

  return (
    <div class="page">
      <div class="page-head"><h1>Thống kê</h1></div>
      <div class="stat-grid">
        <div class="stat"><b data-testid="stat-words">{allNotes.length}</b><span>từ trong thư viện</span></div>
        <div class="stat"><b>{(today?.newCards ?? 0) + (today?.reviews ?? 0)}</b><span>thẻ đã học hôm nay</span></div>
        <div class="stat"><b>{st}</b><span>ngày liên tiếp</span></div>
        <div class="stat"><b>{ret === null ? "–" : `${Math.round(ret * 100)}%`}</b><span>nhớ đúng (30 ngày)</span></div>
        <div class="stat"><b>{total30}</b><span>lượt học 30 ngày</span></div>
      </div>

      <div class="charts">
        <section class="panel">
          <h3>Sắp đến hạn · 14 ngày tới</h3>
          {fc.every((n) => n === 0) && <p class="muted" style={{ fontSize: "13px" }}>Chưa có thẻ nào đang chờ ôn.</p>}
          <svg class="chart" viewBox="0 0 320 140" role="img" aria-label="Số thẻ đến hạn mỗi ngày trong 14 ngày tới">
            {fc.map((n, i) => {
              const h = (n / fcMax) * 96;
              return (
                <g key={i}>
                  <rect x={8 + i * 22} y={110 - h} width="16" height={Math.max(h, n ? 2 : 0)} rx="5" fill={i === 0 ? "var(--peach)" : "var(--accent-2)"} />
                  {n > 0 && <text x={16 + i * 22} y={106 - h} text-anchor="middle">{n}</text>}
                  <text x={16 + i * 22} y="126" text-anchor="middle">{i === 0 ? "Nay" : `+${i}`}</text>
                </g>
              );
            })}
            <line x1="4" x2="316" y1="110" y2="110" stroke="var(--line)" />
          </svg>
        </section>

        <section class="panel">
          <h3>Tình trạng thẻ</h3>
          <div style={{ display: "flex", height: "14px", borderRadius: "7px", overflow: "hidden", margin: "14px 0 12px", background: "var(--surface-2)" }} role="img" aria-label="Tỷ lệ thẻ theo trạng thái">
            {seg.map(([label, n, color]) => <i key={label} style={{ width: `${(n / segTotal) * 100}%`, background: color }} />)}
          </div>
          <div class="col" style={{ gap: "6px" }}>
            {seg.map(([label, n, color]) => (
              <div class="row" key={label} style={{ justifyContent: "space-between" }}>
                <span class="row" style={{ gap: "8px" }}><i style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, display: "inline-block" }} />{label}</span>
                <b>{n}</b>
              </div>
            ))}
            {counts.suspended > 0 && <div class="row" style={{ justifyContent: "space-between" }}><span class="muted">Đã ẩn</span><b>{counts.suspended}</b></div>}
          </div>
        </section>
      </div>

      <section class="panel">
        <h3>Hoạt động · 26 tuần</h3>
        <div style={{ overflowX: "auto", paddingTop: "10px" }}>
          <svg class="heat" viewBox="0 0 390 100" style={{ minWidth: "390px", width: "100%" }} role="img" aria-label="Biểu đồ nhiệt số thẻ học mỗi ngày">
            {heat.map((c) => (
              <rect key={c.id} x={c.week * 15} y={c.dow * 14} width="12" height="12" rx="3" class={`l${level(c.count, heatMax)}`}>
                <title>{`${c.id}: ${c.count} thẻ`}</title>
              </rect>
            ))}
          </svg>
        </div>
      </section>
    </div>
  );
}
