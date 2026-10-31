import { useMemo } from "preact/hooks";
import { meaningsByNote } from "@shared/confusables.ts";
import { dayId, nextDayStart } from "@shared/model.ts";
import { cards, daily, loaded, notes, prefs } from "../data/state.ts";
import { buildQueue, tagCounts } from "../lib/queue.ts";
import { eligibility } from "../lib/select.ts";
import { streak } from "../lib/stats.ts";
import { useStore } from "../lib/store.ts";
import { Icon, go } from "./common.tsx";
import { isLesson } from "./Study.tsx";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function greeting(hour: number): string {
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 14) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

/** Home of the study tab: what today asks for, one button to start, the streak and the lesson path. */
export function Today() {
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const dailies = useStore(daily);
  const p = useStore(prefs);
  const ready = useStore(loaded);
  const now = Date.now();

  const queue = useMemo(
    () => buildQueue({ cards: allCards, eligible: eligibility(allNotes), today: dailies.find((d) => d.id === dayId(now, p.dayStartHour)), prefs: p, now, deckId: null, buried: new Set(), meanings: meaningsByNote(allNotes) }),
    [allCards, allNotes, dailies, p],
  );
  const lessons = useMemo(() => {
    const studied = new Set(allCards.filter((c) => c.state !== 0).map((c) => c.noteId));
    const started = new Map<string, number>();
    for (const n of allNotes) if (studied.has(n.id)) for (const t of n.tags ?? []) started.set(t, (started.get(t) ?? 0) + 1);
    return tagCounts(allNotes).filter((t) => isLesson(t.tag)).map((t) => ({ ...t, started: started.get(t.tag) ?? 0 }));
  }, [allCards, allNotes]);

  if (!ready) return <div class="page"><p class="muted">Đang tải dữ liệu…</p></div>;

  // Cards, not answers: a card answered today and not waiting again is done; one in the queue is left.
  const waiting = new Set([...queue.learning, ...queue.review, ...queue.newCards].map((c) => c.id));
  const dayStart = nextDayStart(now, p.dayStartHour) - DAY_MS;
  const done = allCards.filter((c) => (c.lastReview ?? 0) >= dayStart && !waiting.has(c.id)).length;
  const left = waiting.size;
  const frac = done + left === 0 ? 0 : done / (done + left);
  const st = streak(dailies, now, p.dayStartHour);
  const active = new Set(dailies.filter((d) => d.newCards + d.reviews > 0).map((d) => d.id));
  // Monday of this study week, then seven days.
  const todayStart = now - p.dayStartHour * 3_600_000;
  const monday = todayStart - ((new Date(todayStart).getDay() + 6) % 7) * DAY_MS;
  const week = WEEKDAYS.map((label, i) => {
    const t = monday + i * DAY_MS + p.dayStartHour * 3_600_000;
    const id = dayId(t, p.dayStartHour);
    return { label, on: active.has(id), future: t > now && id !== dayId(now, p.dayStartHour), today: id === dayId(now, p.dayStartHour) };
  });
  const current = lessons.find((l) => l.started < l.count) ?? null;
  // Time estimate from the learner's own pace (all recorded days), 10 s per card until there is any.
  const answers = dailies.reduce((n, d) => n + d.newCards + d.reviews, 0);
  const perCardMs = answers ? dailies.reduce((n, d) => n + d.ms, 0) / answers : 10_000;
  const minutes = Math.max(1, Math.round((left * perCardMs) / 60_000));
  const R = 52;
  const C = 2 * Math.PI * R;

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

  return (
    <div class="page narrow today" data-testid="today">
      <div>
        <h1 class="hello">{greeting(new Date(now).getHours())}</h1>
        <p class="muted">{left > 0 ? `Hôm nay còn ${left} thẻ, khoảng ${minutes} phút.` : done > 0 ? "Bạn đã học xong phần hôm nay." : "Hôm nay không có thẻ đến hạn."}</p>
      </div>

      <div class="panel today-main">
        <svg class="ring" viewBox="0 0 120 120" role="img" aria-label={`Đã học ${done} trên ${done + left} thẻ hôm nay`} data-testid="today-ring">
          <circle cx="60" cy="60" r={R} class="ring-track" />
          {frac > 0 && <circle cx="60" cy="60" r={R} class="ring-fill" stroke-dasharray={`${C * frac} ${C}`} transform="rotate(-90 60 60)" />}
          <text x="60" y="58" text-anchor="middle" class="ring-num">{done}/{done + left}</text>
          <text x="60" y="78" text-anchor="middle" class="ring-sub">thẻ hôm nay</text>
        </svg>
        <button type="button" class="btn primary start-btn" onClick={() => go("/study")} data-testid="start-study">
          {left === 0 ? "Xem buổi học" : done === 0 ? "Bắt đầu học" : "Học tiếp"}
        </button>
        <div class="today-tiles">
          <div class="tile due"><Icon n="study" size={18} /><span>Đến hạn</span><b data-testid="today-due">{queue.counts.review + queue.counts.learning}</b></div>
          <div class="tile fresh"><Icon n="plus" size={18} /><span>Từ mới</span><b data-testid="today-new">{queue.counts.new}</b></div>
        </div>
      </div>

      <div class="panel streak" data-testid="today-streak">
        <div class="row" style={{ justifyContent: "space-between" }}>
          <b>🔥 Chuỗi học</b>
          <b>{st} ngày</b>
        </div>
        <div class="week">
          {week.map((d) => (
            <div key={d.label} class={`day${d.on ? " on" : ""}${d.future ? " future" : ""}${d.today ? " today" : ""}`}>
              <small>{d.label}</small>
              <i>{d.on ? "✓" : ""}</i>
            </div>
          ))}
        </div>
      </div>

      {current && (
        <div class="panel lesson-now" data-testid="today-lesson">
          <div class="row" style={{ justifyContent: "space-between" }}>
            <span class="muted">Bài đang học</span>
            <span class="muted">{current.started}/{current.count} từ</span>
          </div>
          <b class="lesson-name">{current.tag}</b>
          <div class="progress"><i style={{ width: `${(current.started / current.count) * 100}%` }} /></div>
          <button type="button" class="btn" onClick={() => go(`/study?tag=${encodeURIComponent(current.tag)}`)} data-testid="study-lesson">Học bài này</button>
          <details class="lessons">
            <summary>Tất cả {lessons.length} bài</summary>
            <div class="lesson-grid">
              {lessons.map((l) => (
                <button type="button" key={l.tag} class={`lesson${l.started >= l.count ? " full" : l.started > 0 ? " part" : ""}`} onClick={() => go(`/study?tag=${encodeURIComponent(l.tag)}`)}>
                  <span>{l.tag}</span>
                  <small>{l.started}/{l.count}</small>
                </button>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
