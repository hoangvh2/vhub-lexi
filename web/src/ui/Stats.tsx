import { useEffect, useMemo, useState } from "preact/hooks";
import { dayId, nextDayStart } from "@shared/model.ts";
import { isMaterial } from "@shared/notetypes.ts";
import { cards, daily, loaded, notes, prefs } from "../data/state.ts";
import { eligibility } from "../lib/select.ts";
import { paceOf, ratingMix, recallNow, wordStatus, type Roadmap, type SimInput } from "../lib/roadmap.ts";
import { runRoadmap } from "../lib/roadmapRun.ts";
import { effortOf, minutes, NEW_WORD_ANSWERS } from "../lib/roadmapView.ts";
import { forecast, overdueCount, retention, streak, weekCompare } from "../lib/stats.ts";
import { useStore } from "../lib/store.ts";
import { ForecastPanel, RoadmapPanel, StatusBars, WeekPanel, type PaceChip } from "./StatsParts.tsx";

const DAY = 86_400_000;
const PRESETS = [10, 15, 20, 25];
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** The forecast for `input`, recomputed off the main thread a moment after it changes. */
function useRoadmap(input: SimInput | null) {
  const [state, setState] = useState<{ rm: Roadmap | null; busy: boolean; error: string | null }>({ rm: null, busy: false, error: null });
  useEffect(() => {
    if (!input) return;
    setState((s) => ({ ...s, busy: true, error: null }));
    let run: ReturnType<typeof runRoadmap> | undefined;
    const t = setTimeout(() => {
      run = runRoadmap(input);
      run.promise.then(
        (rm) => setState({ rm, busy: false, error: null }),
        (e) => setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) })),
      );
    }, 150);
    return () => {
      clearTimeout(t);
      run?.cancel();
    };
  }, [input]);
  return state;
}

export function Stats() {
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const dailies = useStore(daily);
  const p = useStore(prefs);
  const ready = useStore(loaded);
  const [pick, setPick] = useState<string | null>(null);
  const now = Date.now();
  const todayEnd = nextDayStart(now, p.dayStartHour);
  const todayStart = todayEnd - DAY;

  const studied = useMemo(() => {
    const ok = eligibility(allNotes);
    return allCards.filter(ok);
  }, [allCards, allNotes]);
  const vocab = useMemo(() => {
    // The roadmap counts vocabulary words; grammar patterns have cards (they show in the due forecast) but are not "từ".
    const ids = new Set(allNotes.filter((n) => n.type === "vocab").map((n) => n.id));
    return studied.filter((c) => ids.has(c.noteId));
  }, [studied, allNotes]);

  const status = useMemo(() => wordStatus(vocab), [vocab]);
  const recall = useMemo(() => recallNow(vocab, Date.now(), p.fsrsWeights), [vocab, p.fsrsWeights]);
  const fc = useMemo(() => forecast(studied, Date.now(), p.dayStartHour), [studied, p.dayStartHour]);
  const overdue = useMemo(() => overdueCount(studied, Date.now(), p.dayStartHour), [studied, p.dayStartHour]);
  const pace = useMemo(() => paceOf(dailies, Date.now(), p.dayStartHour), [dailies, p.dayStartHour]);
  const mix = useMemo(() => ratingMix(dailies, Date.now(), p.dayStartHour), [dailies, p.dayStartHour]);
  const effort = useMemo(() => effortOf(dailies, Date.now(), p.dayStartHour), [dailies, p.dayStartHour]);
  const week = useMemo(() => weekCompare(dailies, Date.now(), p.dayStartHour), [dailies, p.dayStartHour]);
  const today = dailies.find((d) => d.id === dayId(now, p.dayStartHour));
  const ret = retention(dailies, now, p.dayStartHour);
  const st = streak(dailies, now, p.dayStartHour);

  const realKnown = pace.observedDays >= 7 && pace.perDay > 0;
  const chips: PaceChip[] = useMemo(() => {
    const vals = [...new Set([...PRESETS, p.newPerDay].filter((v) => v > 0))].sort((a, b) => a - b);
    const out: PaceChip[] = vals.map((v) => ({ key: String(v), label: `${v} từ/ngày${v === p.newPerDay ? " (đang đặt)" : ""}`, value: v }));
    if (realKnown) out.unshift({ key: "real", label: `Thực tế ${fmt(pace.perDay)}/ngày`, value: "real" });
    return out;
  }, [p.newPerDay, realKnown, pace.perDay]);
  const selected = chips.find((c) => c.key === pick) ?? chips.find((c) => c.key === (realKnown ? "real" : String(p.newPerDay))) ?? chips[0];
  const effective = selected.value === "real" ? pace.perDay : selected.value;

  const input = useMemo<SimInput | null>(() => {
    if (!ready || status.total === 0) return null;
    const t = Date.now();
    return {
      cards: vocab, now: t, todayEnd: nextDayStart(t, p.dayStartHour), pace: effective, maxReviewsPerDay: p.maxReviewsPerDay,
      desiredRetention: p.desiredRetention, w: p.fsrsWeights, mix, doneToday: { newWords: today?.newCards ?? 0, reviews: today?.reviews ?? 0 },
    };
    // `today` is read for its counters only; the forecast is not redone for every answer on this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, vocab, effective, p.dayStartHour, p.maxReviewsPerDay, p.desiredRetention, p.fsrsWeights, mix, today?.newCards, today?.reviews]);
  const { rm, busy, error } = useRoadmap(input);

  if (!ready) return <div class="page"><p class="muted">Đang tải…</p></div>;

  const newLeft = Math.min(status.unseen, Math.max(0, p.newPerDay - (today?.newCards ?? 0)));
  const dueToday = fc[0];
  const todayMin = minutes(dueToday + newLeft * NEW_WORD_ANSWERS, effort.secPerCard);
  const target = Math.round(p.desiredRetention * 100);
  const recalledPct = recall.started ? Math.round((recall.recalled / recall.started) * 100) : 0;

  return (
    <div class="page">
      <div class="page-head"><h1>Thống kê</h1></div>
      <div class="stat-grid">
        <div class="stat"><span>Hôm nay còn</span><b>{dueToday} <small class="unit">ôn</small> + {newLeft} <small class="unit">mới</small></b><span>{todayMin !== null ? `≈ ${todayMin} phút` : "chưa đủ dữ liệu để ước tính thời gian"}</span></div>
        <div class="stat"><span>Nhớ được lúc này (ước tính)</span><b>{Math.round(recall.recalled)}<small class="unit">/{recall.started} từ</small></b><span>{recall.started ? `${recalledPct}% từ đã học` : "chưa học từ nào"}</span></div>
        <div class="stat"><span>Nhớ đúng 30 ngày</span><b>{ret === null ? "–" : `${Math.round(ret * 100)}%`}</b><span class={ret !== null && ret * 100 < target - 2 ? "warn" : "muted"}>{ret === null ? "chưa có dữ liệu" : ret * 100 < target - 2 ? `thấp hơn mục tiêu ${target}%` : `đạt mục tiêu ${target}%`}</span></div>
        <div class="stat"><span>Chuỗi ngày học</span><b>{st} <small class="unit">ngày</small></b><span>{pace.observedDays ? `${pace.activeDays}/${pace.observedDays} ngày gần đây` : "bắt đầu hôm nay"}</span></div>
      </div>

      {status.total === 0 ? (
        <section class="panel">
          <h2><b data-testid="stat-words">0</b> từ trong thư viện</h2>
          <p class="muted">Thêm từ để thấy lộ trình học và dự báo.</p>
        </section>
      ) : (
        <>
          <div class="roadmap-grid">
            <div class="col" style={{ gap: "16px", minWidth: 0 }}>
              <RoadmapPanel
                status={status} rm={rm} busy={busy} error={error} todayStart={todayStart} pace={effective} chips={chips} selected={selected.key}
                onPick={setPick} realKnown={realKnown} observedDays={pace.observedDays} secPerCard={effort.secPerCard}
              />
              <section class="panel flat">
                <h3><b data-testid="stat-words">{allNotes.filter(isMaterial).length}</b> từ trong thư viện</h3>
                <StatusBars s={status} />
              </section>
            </div>
            <div class="col" style={{ gap: "16px", minWidth: 0 }}>
              <ForecastPanel fc={fc} overdue={overdue} newPerDay={effective} unseen={status.unseen} todayStart={todayStart} effort={effort} />
              <WeekPanel w={week} daily={dailies} now={now} dayStartHour={p.dayStartHour} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
