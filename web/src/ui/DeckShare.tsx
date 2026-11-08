import { useState } from "preact/hooks";
import { CardState, type Id } from "@shared/model.ts";
import { setDeckWeights } from "../data/actions.ts";
import { cards, decks, notes, prefs } from "../data/state.ts";
import { percents, rankWeights, setPercent, shareMode, type ShareMode } from "../lib/deckshare.ts";
import { awaitingRecognize, dailyShares, introducible, isFreeNew, liveRecognize } from "../lib/queue.ts";
import { eligibility } from "../lib/select.ts";
import { useStore } from "../lib/store.ts";

const MODES: Array<[ShareMode, string]> = [["equal", "Đều"], ["rank", "Theo thứ tự ưu tiên"], ["custom", "Tùy chỉnh"]];

/** Settings: how many of the day's new words each deck gives. Weights live on the decks; the queue reads them. */
export function DeckShare() {
  const p = useStore(prefs);
  const list = useStore(decks);
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const [forced, setForced] = useState<ShareMode | null>(null);
  if (list.length < 2) return null;

  const weightOf = (d: { newWeight?: number }) => d.newWeight ?? 1;
  // Highest share first; equal shares keep the order the decks were made in.
  const rows = [...list].sort((a, b) => weightOf(b) - weightOf(a) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const weights = rows.map(weightOf);
  const mode = forced ?? shareMode(weights);
  const pct = percents(weights);

  // Words each deck still has (notes with a new card), so the preview shows what a full day would really give.
  const eligible = eligibility(allNotes);
  const waiting = awaitingRecognize(allCards, eligible);
  const live = liveRecognize(allCards, eligible);
  const left = new Map<Id, Set<Id>>();
  for (const c of allCards) {
    if (c.state !== CardState.New || c.suspended || !eligible(c) || !introducible(c, waiting) || isFreeNew(c, live)) continue;
    const s = left.get(c.deckId) ?? new Set<Id>();
    s.add(c.noteId);
    left.set(c.deckId, s);
  }
  const words = dailyShares(p.newPerDay, rows.map((d) => ({ id: d.id, weight: weightOf(d), cap: left.get(d.id)?.size ?? 0 })));

  const save = (next: number[] | "equal") => {
    const m = new Map<Id, number | undefined>();
    rows.forEach((d, k) => m.set(d.id, next === "equal" ? undefined : next[k]));
    void setDeckWeights(m);
  };
  const choose = (m: ShareMode) => {
    setForced(m === "custom" ? "custom" : null);
    if (m === "equal") save("equal");
    else if (m === "rank") save(rankWeights(rows.length));
  };
  const edit = (k: number, v: number) => {
    setForced("custom");
    save(setPercent(weights.map((w, j) => pct[j] ?? w), k, v));
  };
  const swap = (k: number, to: number) => {
    const next = pct.slice();
    [next[k], next[to]] = [next[to], next[k]];
    save(next);
  };

  return (
    <section class="panel col deckshare" data-testid="deck-share">
      <div class="panel-head">
        <h2>Từ mới theo bộ</h2>
        <span class="muted">Tổng {p.newPerDay} từ/ngày</span>
      </div>
      <div class="seg" role="group" aria-label="Cách chia từ mới giữa các bộ">
        {MODES.map(([k, l]) => <button type="button" key={k} aria-pressed={mode === k} onClick={() => choose(k)} data-testid={`share-${k}`}>{l}</button>)}
      </div>
      <ul class="shares">
        {rows.map((d, k) => {
          const paused = weightOf(d) === 0;
          const n = left.get(d.id)?.size ?? 0;
          return (
            <li key={d.id} class={paused ? "paused" : ""} data-testid="share-row">
              {mode !== "equal" && (
                <span class="order">
                  <button type="button" class="icon-btn sm" aria-label={`Đưa ${d.name} lên`} disabled={k === 0} onClick={() => swap(k, k - 1)}>▲</button>
                  <button type="button" class="icon-btn sm" aria-label={`Đưa ${d.name} xuống`} disabled={k === rows.length - 1} onClick={() => swap(k, k + 1)}>▼</button>
                </span>
              )}
              <div class="main">
                <div class="top">
                  <b class="name">{mode !== "equal" && <span class="rank">{k + 1}</span>}{d.name}</b>
                  {mode !== "equal" && <button type="button" class="link" onClick={() => edit(k, paused ? 10 : 0)}>{paused ? "Bật lại" : "Tạm dừng"}</button>}
                </div>
                <input
                  type="range" min={0} max={100} step={1} value={pct[k]} aria-label={`Tỷ lệ từ mới của ${d.name}`}
                  disabled={mode === "equal"}
                  onChange={(e) => edit(k, Number(e.currentTarget.value))}
                />
              </div>
              <span class="side">
                <b class="pct">{paused ? "Dừng" : `${pct[k]}%`}</b>
                <small class="cnt" data-testid="share-words">{n === 0 ? "hết từ" : `${words.get(d.id) ?? 0} từ`}</small>
              </span>
            </li>
          );
        })}
      </ul>
      <p class="muted" style={{ fontSize: "13px" }}>
        {mode === "equal" ? "Mỗi bộ cho số từ mới như nhau." : "Kéo thanh trượt hoặc đổi vị trí ưu tiên; các bộ còn lại tự cân lại để tổng là 100%."}
        {" "}Bộ nào trên 0% luôn có ít nhất 1 từ mỗi ngày. Bộ hết từ mới thì phần của nó chia cho các bộ còn lại.
      </p>
    </section>
  );
}
