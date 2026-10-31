import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { meaningsByNote } from "@shared/confusables.ts";
import { CardState, dayId, nextDayStart } from "@shared/model.ts";
import { str } from "@shared/notetypes.ts";
import { cards, daily, loaded, notes, prefs } from "../data/state.ts";
import { isLesson, lessonName } from "../lib/lessons.ts";
import { buildQueue, tagCounts } from "../lib/queue.ts";
import { eligibility } from "../lib/select.ts";
import { enter, orb } from "../lib/motion.ts";
import { forecast, heatmap, level, streak } from "../lib/stats.ts";
import { useStore } from "../lib/store.ts";
import { Icon, go } from "./common.tsx";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const WEEKDAY_LONG = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
/** Lessons shown before "Xem tất cả": the current one and its neighbours. */
const PATH_WINDOW = 8;

function greeting(hour: number): string {
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 14) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

/** Home of the study tab: what today asks for, one button to start, the streak, the lesson path and words to watch. */
export function Today() {
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const dailies = useStore(daily);
  const p = useStore(prefs);
  const ready = useStore(loaded);
  const [allLessons, setAllLessons] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const hasNotes = allNotes.length > 0;
  useEffect(() => {
    const stops = [enter(root.current), orb(root.current?.querySelector(".orb") ?? null)];
    return () => stops.forEach((s) => s());
  }, [ready, hasNotes]);

  const queue = useMemo(
    () => buildQueue({ cards: allCards, eligible: eligibility(allNotes), today: dailies.find((d) => d.id === dayId(now, p.dayStartHour)), prefs: p, now, deckId: null, buried: new Set(), meanings: meaningsByNote(allNotes) }),
    [allCards, allNotes, dailies, p],
  );
  const lessons = useMemo(() => {
    const studied = new Set(allCards.filter((c) => c.state !== CardState.New).map((c) => c.noteId));
    const started = new Map<string, number>();
    for (const n of allNotes) if (studied.has(n.id)) for (const t of n.tags ?? []) started.set(t, (started.get(t) ?? 0) + 1);
    return tagCounts(allNotes).filter((t) => isLesson(t.tag)).map((t) => ({ ...t, started: started.get(t.tag) ?? 0 }));
  }, [allCards, allNotes]);
  // Words to watch: forgotten most often, recently forgotten first.
  const watch = useMemo(() => {
    const byNote = new Map<string, { lapses: number; last: number }>();
    for (const c of allCards) {
      if (c.suspended || c.lapses === 0) continue;
      const w = byNote.get(c.noteId) ?? { lapses: 0, last: 0 };
      w.lapses += c.lapses;
      w.last = Math.max(w.last, c.state === CardState.Relearning ? Number.MAX_SAFE_INTEGER : (c.lastReview ?? 0));
      byNote.set(c.noteId, w);
    }
    const noteById = new Map(allNotes.map((n) => [n.id, n]));
    return [...byNote.entries()]
      .filter(([id]) => noteById.has(id))
      .sort((a, b) => b[1].lapses - a[1].lapses || b[1].last - a[1].last)
      .slice(0, 5)
      .map(([id, w]) => ({ note: noteById.get(id)!, lapses: w.lapses }));
  }, [allCards, allNotes]);
  const heat = useMemo(() => heatmap(dailies, now, p.dayStartHour, 18), [dailies, p.dayStartHour]);

  if (!ready) return <div class="page"><p class="muted">Đang tải dữ liệu…</p></div>;

  if (allNotes.length === 0) {
    return (
      <div class="page narrow">
        <div class="empty">
          <h2>Chưa có từ nào</h2>
          <p>Thêm từ đầu tiên, hoặc nhập bộ thẻ Anki trong Cài đặt.</p>
          <button type="button" class="btn primary" onClick={() => go("/add")} data-testid="empty-add"><Icon n="plus" /> Thêm từ</button>
        </div>
      </div>
    );
  }

  // Cards, not answers: a card answered today and not waiting again is done; one in the queue is left.
  const waiting = new Set([...queue.learning, ...queue.review, ...queue.newCards].map((c) => c.id));
  const dayStart = nextDayStart(now, p.dayStartHour) - DAY_MS;
  const done = allCards.filter((c) => (c.lastReview ?? 0) >= dayStart && !waiting.has(c.id)).length;
  const left = waiting.size;
  const total = done + left;
  const frac = total === 0 ? 0 : done / total;
  const finished = left === 0 && done > 0;
  const st = streak(dailies, now, p.dayStartHour);
  const today = dailies.find((d) => d.id === dayId(now, p.dayStartHour));
  const newToday = today?.newCards ?? 0;
  const tomorrow = forecast(allCards, now, p.dayStartHour, 2)[1] ?? 0;
  const active = new Set(dailies.filter((d) => d.newCards + d.reviews > 0).map((d) => d.id));
  // Monday of this study week, then seven days.
  const todayStart = now - p.dayStartHour * 3_600_000;
  const monday = todayStart - ((new Date(todayStart).getDay() + 6) % 7) * DAY_MS;
  const week = WEEKDAYS.map((label, i) => {
    const t = monday + i * DAY_MS + p.dayStartHour * 3_600_000;
    const id = dayId(t, p.dayStartHour);
    return { label, on: active.has(id), future: t > now && id !== dayId(now, p.dayStartHour), today: id === dayId(now, p.dayStartHour) };
  });
  const currentIdx = lessons.findIndex((l) => l.started < l.count);
  const current = currentIdx >= 0 ? lessons[currentIdx] : null;
  const lessonsDone = lessons.filter((l) => l.started >= l.count).length;
  const from = Math.max(0, Math.min(currentIdx - 2, lessons.length - PATH_WINDOW));
  const shown = allLessons ? lessons : lessons.slice(from, from + PATH_WINDOW);
  // Time estimate from the learner's own pace (all recorded days), 10 s per card until there is any.
  const answers = dailies.reduce((n, d) => n + d.newCards + d.reviews, 0);
  const perCardMs = answers ? dailies.reduce((n, d) => n + d.ms, 0) / answers : 10_000;
  const minutes = Math.max(1, Math.round((left * perCardMs) / 60_000));
  const heatMax = Math.max(1, ...heat.map((c) => c.count));
  const date = new Date(now);
  const curName = current ? lessonName(current.tag) : null;
  // Water level in the orb; a sliver stays visible once anything is done.
  const fill = finished ? 1 : frac > 0 ? Math.max(0.06, frac) : 0;
  const dueNow = queue.counts.review + queue.counts.learning;

  return (
    <div class="page wide today" data-testid="today" ref={root}>
      <header class="today-head" data-in>
        <p class="eyebrow">{WEEKDAY_LONG[date.getDay()]}, {date.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" })}</p>
        <h1 class="hello">{finished ? "Xong phần hôm nay" : greeting(date.getHours())}</h1>
        <p class="hero-sub">
          {left > 0
            ? `Hôm nay còn ${left} thẻ, khoảng ${minutes} phút.`
            : finished
              ? tomorrow > 0 ? `Bạn đã ôn ${done} thẻ. Ngày mai có ${tomorrow} thẻ đang chờ.` : `Bạn đã ôn ${done} thẻ. Ngày mai chưa có thẻ nào đến hạn.`
              : "Hôm nay không có thẻ đến hạn."}
        </p>
      </header>

      <section class={`hero${finished ? " finished" : ""}`} data-in>
        <div class={`orb${fill === 0 ? " empty" : ""}${fill >= 0.55 ? " deep" : ""}`} style={{ "--fill": fill }} role="img" aria-label={`Đã học ${done} trên ${total} thẻ hôm nay`} data-testid="today-ring">
          <span class="orb-water2" />
          <span class="orb-water" />
          <span class="orb-num"><b>{done}/{total}</b><small>thẻ hôm nay</small></span>
        </div>
        <ul class="mini">
          <li class="m-due">
            <span class="blob"><Icon n="calendar" /></span>
            <b data-testid="today-due">{dueNow}</b>
            <span class="lbl2">Đến hạn<small>{queue.counts.learning > 0 ? `${queue.counts.learning} thẻ đang học` : queue.counts.review > 0 ? "Cần ôn hôm nay" : tomorrow > 0 ? `Ngày mai ${tomorrow}` : "Đã ôn hết"}</small></span>
          </li>
          <li class="m-new">
            <span class="blob"><Icon n="star" /></span>
            <b data-testid="today-new">{queue.counts.new}</b>
            <span class="lbl2">Từ mới<small>{queue.counts.new === 0 && newToday >= p.newPerDay ? `Đủ ${p.newPerDay} từ hôm nay` : `Đã học ${newToday}/${p.newPerDay} hôm nay`}</small></span>
          </li>
          <li class="m-fire" data-testid="today-streak">
            <span class="blob"><Icon n="flame" /></span>
            <b>{st}</b>
            <span class="lbl2">ngày liên tiếp<small>Chuỗi học của bạn</small></span>
          </li>
        </ul>
        <div class="hero-side">
          <div class="week" aria-label="Tuần này">
            {week.map((d) => (
              <span key={d.label} class={`day${d.on ? " on" : ""}${d.future ? " future" : ""}${d.today ? " today" : ""}`} title={d.label}>
                <i>{d.on && <Icon n="check" />}</i>
                <small>{d.label}</small>
              </span>
            ))}
          </div>
          <div class="hero-cta">
            <button type="button" class={`btn ${left > 0 ? "primary" : "soft"} start-btn`} onClick={() => go("/study")} data-testid="start-study">
              {left === 0 ? "Học thêm hoặc ôn trước" : done === 0 ? "Bắt đầu học" : "Học tiếp"} <Icon n="arrow" size={20} />
            </button>
            {current && curName && (
              <button type="button" class="btn ghost" onClick={() => go(`/study?tag=${encodeURIComponent(current.tag)}`)}>
                Bài {curName.num ?? ""} · {curName.title}
              </button>
            )}
          </div>
        </div>
      </section>

      <div class="today-grid">
        {lessons.length > 0 && (
          <section class="panel path" data-testid="today-lesson" data-in>
            <div class="panel-head">
              <h2>Lộ trình bài học</h2>
              <span class="muted">{lessonsDone}/{lessons.length} bài xong</span>
            </div>
            {current && curName && (
              <div class="lesson-now">
                <span class="num-badge big">{curName.num ?? "•"}</span>
                <div class="grow">
                  <span class="muted small">Bài đang học</span>
                  <b class="lesson-name">{curName.title}</b>
                  <div class="progress"><i style={{ width: `${(current.started / current.count) * 100}%` }} /></div>
                  <span class="muted small">{current.started}/{current.count} từ đã bắt đầu</span>
                </div>
                <button type="button" class="btn primary" onClick={() => go(`/study?tag=${encodeURIComponent(current.tag)}`)} data-testid="study-lesson">Học bài này</button>
              </div>
            )}
            <div class="lesson-list">
              {shown.map((l) => {
                const n = lessonName(l.tag);
                const state = l.started >= l.count ? "full" : l.started > 0 ? "part" : "";
                return (
                  <button type="button" key={l.tag} class={`lesson ${state}${l === current ? " current" : ""}`} onClick={() => go(`/study?tag=${encodeURIComponent(l.tag)}`)} title={l.tag}>
                    <span class="num-badge">{state === "full" ? <Icon n="check" size={15} /> : (n.num ?? "•")}</span>
                    <span class="lesson-title">{n.title}</span>
                    <span class="lesson-meter"><i style={{ width: `${(l.started / l.count) * 100}%` }} /></span>
                    <small>{l.started}/{l.count} từ</small>
                  </button>
                );
              })}
            </div>
            {lessons.length > PATH_WINDOW && (
              <button type="button" class="btn ghost sm more" onClick={() => setAllLessons(!allLessons)} data-testid="all-lessons">
                {allLessons ? "Thu gọn" : `Xem tất cả ${lessons.length} bài`}
              </button>
            )}
          </section>
        )}

        <div class="today-side">
          <section class="panel" data-in>
            <div class="panel-head">
              <h2>Hoạt động</h2>
              <span class="muted">{answers.toLocaleString("vi-VN")} lượt ôn</span>
            </div>
            <svg class="heat" viewBox={`0 0 ${18 * 15} 100`} role="img" aria-label="Số thẻ học mỗi ngày trong 18 tuần qua">
              {heat.map((c) => (
                <rect key={c.id} x={c.week * 15} y={c.dow * 14} width="12" height="12" rx="4" class={`l${level(c.count, heatMax)}`}>
                  <title>{`${c.id}: ${c.count} thẻ`}</title>
                </rect>
              ))}
            </svg>
          </section>
          {watch.length > 0 && (
            <section class="panel" data-testid="today-watch" data-in>
              <div class="panel-head">
                <h2>Từ hay quên</h2>
                <button type="button" class="btn ghost sm" onClick={() => go("/library")}>Thư viện</button>
              </div>
              <ul class="watch">
                {watch.map(({ note, lapses }) => (
                  <li key={note.id}>
                    <b>{str(note.fields.word)}</b>
                    <span class="muted">{str(note.fields.vi)}</span>
                    <span class="pill bad">quên {lapses}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
