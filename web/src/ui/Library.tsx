import { useMemo, useState } from "preact/hooks";
import { CardState, type Card, type Id, type Note } from "@shared/model.ts";
import { noteType } from "@shared/notetypes.ts";
import { createDeck, deleteDeckAndContents, renameDeck, updateNote } from "../data/actions.ts";
import { callEnrich, firebaseConfigured } from "../data/firebase.ts";
import { cards, decks, loaded, notes, prefs } from "../data/state.ts";
import { aiBatch, confirmAndRun, stopBatch, type BatchProgress } from "../lib/batch.ts";
import { hasAi, type Enriched } from "../lib/enrich.ts";
import { dueLabel } from "../lib/format.ts";
import { isLeech } from "../lib/queue.ts";
import { useStore } from "../lib/store.ts";
import { Icon, Modal, confirmDialog, go, toast } from "./common.tsx";
import { NoteEditor } from "./NoteEditor.tsx";

type Filter = "all" | "new" | "learning" | "review" | "suspended" | "leech" | "noai";
type Sort = "recent" | "alpha" | "due";

const FILTERS: Array<[Filter, string]> = [
  ["all", "Tất cả"], ["new", "Mới"], ["learning", "Đang học"], ["review", "Ôn tập"], ["suspended", "Đã ẩn"], ["leech", "Thẻ khó"], ["noai", "Chưa có AI"],
];

function matches(f: Filter, n: Note, cs: Card[]): boolean {
  if (f === "all") return true;
  if (f === "noai") return n.type === "vocab" && !hasAi(n.aiFields);
  if (f === "new") return cs.some((c) => c.state === CardState.New);
  if (f === "learning") return cs.some((c) => c.state === CardState.Learning || c.state === CardState.Relearning);
  if (f === "review") return cs.some((c) => c.state === CardState.Review);
  if (f === "suspended") return cs.some((c) => c.suspended);
  return cs.some(isLeech);
}

export function Library() {
  const allNotes = useStore(notes);
  const allCards = useStore(cards);
  const allDecks = useStore(decks);
  const ready = useStore(loaded);
  const [q, setQ] = useState("");
  const [deck, setDeck] = useState<Id | "">("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [editing, setEditing] = useState<Id | null>(null);
  const [deckDlg, setDeckDlg] = useState<{ id?: Id; name: string } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<Id>>(new Set());
  const [aiDlg, setAiDlg] = useState<{ skipDone: boolean; overwriteVi: boolean } | null>(null);
  const batch = useStore(aiBatch);
  const p = useStore(prefs);
  const aiAvailable = firebaseConfigured && p.aiEnabled;
  const now = Date.now();

  const cardsByNote = useMemo(() => {
    const m = new Map<Id, Card[]>();
    for (const c of allCards) (m.get(c.noteId) ?? m.set(c.noteId, []).get(c.noteId)!).push(c);
    return m;
  }, [allCards]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = allNotes.filter((n) => {
      const def = noteType(n.type);
      if (!def) return false;
      if (deck && n.deckId !== deck) return false;
      if (needle && !def.searchText(n).includes(needle)) return false;
      return matches(filter, n, cardsByNote.get(n.id) ?? []);
    });
    const nextDue = (n: Note) => Math.min(...(cardsByNote.get(n.id) ?? []).filter((c) => c.state !== CardState.New).map((c) => c.due), Infinity);
    list.sort((a, b) =>
      sort === "alpha" ? (noteType(a.type)!.title(a) < noteType(b.type)!.title(b) ? -1 : 1) : sort === "due" ? nextDue(a) - nextDue(b) : b.createdAt - a.createdAt,
    );
    return list;
  }, [allNotes, cardsByNote, q, deck, filter, sort]);

  const deckName = (id: Id) => allDecks.find((d) => d.id === id)?.name ?? "";
  const editingNote = editing ? allNotes.find((n) => n.id === editing) : undefined;

  async function saveDeck() {
    if (!deckDlg || !deckDlg.name.trim()) return;
    if (deckDlg.id) {
      const d = allDecks.find((x) => x.id === deckDlg.id);
      if (d) await renameDeck(d, deckDlg.name);
    } else await createDeck(deckDlg.name);
    setDeckDlg(null);
  }

  async function removeDeck(d: { id: Id; name: string }) {
    const count = allNotes.filter((n) => n.deckId === d.id).length;
    const ok = await confirmDialog({
      title: `Xoá bộ “${d.name}”?`,
      message: count ? `${count} từ trong bộ này và toàn bộ thẻ ôn tập của chúng sẽ bị xoá khỏi mọi thiết bị.` : "Bộ thẻ trống sẽ bị xoá.",
      confirm: "Xoá bộ thẻ",
      danger: true,
    });
    if (!ok) return;
    await deleteDeckAndContents(d.id);
    setDeckDlg(null);
    if (deck === d.id) setDeck("");
    toast("Đã xoá bộ thẻ");
  }

  const toggle = (id: Id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedNotes = allNotes.filter((n) => selected.has(n.id) && n.type === "vocab");
  const runIds = (skipDone: boolean) => selectedNotes.filter((n) => !skipDone || !hasAi(n.aiFields)).map((n) => n.id);

  async function startAi() {
    if (!aiDlg) return;
    const ids = runIds(aiDlg.skipDone);
    const opts = { overwriteVi: aiDlg.overwriteVi };
    setAiDlg(null);
    if (!ids.length) return toast("Các từ đã chọn đều đã có AI");
    const res = await confirmAndRun(ids, opts, {
      call: async (word, hints) => (await callEnrich(word, hints)) as Enriched,
      getNote: (id) => notes.get().find((n) => n.id === id),
      save: (n, fields, aiFields) => updateNote(n, { fields, aiFields }),
      confirm: confirmDialog,
    });
    if (!res) return;
    setSelecting(false);
    setSelected(new Set());
    toast(batchSummary(res));
  }

  if (!ready) return <div class="page"><p class="muted">Đang tải…</p></div>;

  return (
    <div class="page">
      <div class="page-head">
        <h1>Thư viện</h1>
        <span class="pill">{allNotes.length} từ</span>
        <span class="spacer" />
        {aiAvailable && (
          <button type="button" class="btn sm" aria-pressed={selecting} onClick={() => (setSelecting(!selecting), setSelected(new Set()))} data-testid="lib-select">
            {selecting ? "Xong" : "Chọn"}
          </button>
        )}
        <button type="button" class="btn sm" onClick={() => setDeckDlg({ name: "" })}>+ Bộ thẻ</button>
        <button type="button" class="btn primary sm" onClick={() => go("/add")}><Icon n="plus" size={16} /> Thêm từ</button>
      </div>

      <div class="row">
        <div class="grow" style={{ minWidth: "200px" }}>
          <label class="sr" for="lib-q">Tìm từ</label>
          <input id="lib-q" class="input" type="search" placeholder="Tìm từ, nghĩa, ví dụ…" value={q} onInput={(e) => setQ(e.currentTarget.value)} data-testid="lib-search" />
        </div>
        <select class="select" style={{ width: "auto" }} value={deck} aria-label="Bộ thẻ" onChange={(e) => setDeck(e.currentTarget.value)}>
          <option value="">Tất cả bộ thẻ</option>
          {allDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select class="select" style={{ width: "auto" }} value={sort} aria-label="Sắp xếp" onChange={(e) => setSort(e.currentTarget.value as Sort)}>
          <option value="recent">Mới thêm</option>
          <option value="alpha">A → Z</option>
          <option value="due">Sắp đến hạn</option>
        </select>
        {deck && <button type="button" class="btn sm" onClick={() => setDeckDlg({ id: deck, name: deckName(deck) })}>Sửa bộ thẻ</button>}
      </div>
      <div class="seg" role="group" aria-label="Lọc theo trạng thái">
        {FILTERS.filter(([k]) => k !== "noai" || aiAvailable).map(([k, label]) => <button type="button" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
      </div>

      {batch && <BatchCard b={batch} />}
      {selecting && (
        <div class="bulk" data-testid="bulk-bar">
          <span><b>{selected.size}</b> từ đã chọn</span>
          <button type="button" class="btn ghost sm" onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((n) => n.id)))}>
            {selected.size === rows.length && rows.length ? "Bỏ chọn" : `Chọn hết ${rows.length}`}
          </button>
          <span class="spacer" />
          <button
            type="button"
            class="btn primary sm"
            disabled={!selectedNotes.length || !!batch?.running}
            onClick={() => setAiDlg({ skipDone: true, overwriteVi: false })}
            data-testid="bulk-ai"
          >
            <Icon n="sparkle" size={16} /> Điền bằng AI
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div class="empty">
          <h2>{allNotes.length ? "Không có kết quả" : "Thư viện trống"}</h2>
          <p>{allNotes.length ? "Thử đổi từ khoá hoặc bộ lọc." : "Thêm từ đầu tiên để bắt đầu."}</p>
        </div>
      ) : (
        <div class="list" data-testid="lib-list">
          {rows.map((n) => {
            const def = noteType(n.type)!;
            const cs = cardsByNote.get(n.id) ?? [];
            const soon = cs.filter((c) => c.state !== CardState.New).sort((a, b) => a.due - b.due)[0];
            return (
              <button
                type="button"
                class={`li${selecting ? " pick" : ""}`}
                key={n.id}
                onClick={() => (selecting ? toggle(n.id) : setEditing(n.id))}
                aria-pressed={selecting ? selected.has(n.id) : undefined}
                data-testid="lib-item"
              >
                {selecting && <span class="tick" aria-hidden="true">{selected.has(n.id) && <Icon n="check" size={14} />}</span>}
                <span class="grow" style={{ minWidth: "0px" }}>
                  <span class="t">{def.title(n)}</span> <span class="muted" style={{ fontSize: "12px" }}>{deckName(n.deckId)}</span>
                  <span class="s" style={{ display: "block" }}>{def.subtitle(n)}</span>
                </span>
                <span class="row" style={{ gap: "6px", flexWrap: "nowrap" }}>
                  {hasAi(n.aiFields) && <span class="ai-tag">AI</span>}
                  {cs.some(isLeech) && <span class="pill bad">Khó</span>}
                  <span class="pill">{soon ? dueLabel(soon, now) : cs.every((c) => c.suspended) && cs.length ? "Đã ẩn" : "Mới"}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {aiDlg && (
        <Modal title={`Điền bằng AI cho ${runIds(aiDlg.skipDone).length} từ`} onClose={() => setAiDlg(null)}>
          <p>Mỗi từ có tối đa 3 nghĩa theo ngữ cảnh, câu ví dụ kèm bản dịch và một truyện chêm. AI chạy nền, bạn có thể ôn bài hay thêm từ trong lúc chờ. Mỗi từ dùng 1 lượt AI, tối đa 300 lượt mỗi ngày.</p>
          <label class="switch">
            <span>Bỏ qua từ đã điền bằng AI</span>
            <input type="checkbox" checked={aiDlg.skipDone} onChange={(e) => setAiDlg({ ...aiDlg, skipDone: e.currentTarget.checked })} />
          </label>
          <label class="switch">
            <span>
              Thay nghĩa tiếng Việt đang có
              <br />
              <span class="muted" style={{ fontSize: "13px" }}>Tắt: chỉ điền chỗ trống, giữ nghĩa bạn đã ghi.</span>
            </span>
            <input type="checkbox" checked={aiDlg.overwriteVi} onChange={(e) => setAiDlg({ ...aiDlg, overwriteVi: e.currentTarget.checked })} data-testid="bulk-overwrite" />
          </label>
          <div class="modal-actions">
            <button type="button" class="btn" onClick={() => setAiDlg(null)}>Huỷ</button>
            <button type="button" class="btn primary" onClick={() => void startAi()} disabled={!runIds(aiDlg.skipDone).length} data-testid="bulk-start">Bắt đầu</button>
          </div>
        </Modal>
      )}
      {editingNote && <NoteEditor note={editingNote} onClose={() => setEditing(null)} />}
      {deckDlg && (
        <Modal title={deckDlg.id ? "Sửa bộ thẻ" : "Bộ thẻ mới"} onClose={() => setDeckDlg(null)}>
          <div class="field">
            <label for="deck-name">Tên bộ thẻ</label>
            <input id="deck-name" class="input" value={deckDlg.name} onInput={(e) => setDeckDlg({ ...deckDlg, name: e.currentTarget.value })} onKeyDown={(e) => e.key === "Enter" && void saveDeck()} data-testid="deck-name" autofocus />
          </div>
          <div class="modal-actions split">
            {deckDlg.id ? <button type="button" class="btn danger" onClick={() => void removeDeck({ id: deckDlg.id!, name: deckDlg.name })}>Xoá bộ thẻ</button> : <span />}
            <div class="row">
              <button type="button" class="btn" onClick={() => setDeckDlg(null)}>Huỷ</button>
              <button type="button" class="btn primary" onClick={() => void saveDeck()} disabled={!deckDlg.name.trim()} data-testid="deck-save">Lưu</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function batchSummary(b: BatchProgress): string {
  const tail = b.failed ? `, ${b.failed} từ lỗi` : "";
  if (b.stopped === "quota") return `Hết lượt AI hôm nay: đã điền ${b.done}/${b.total} từ${tail}. Mai lọc “Chưa có AI” để chạy tiếp.`;
  if (b.stopped === "auth") return "AI cần đăng nhập Google bằng tài khoản được cấp quyền.";
  if (b.stopped === "cancel") return `Đã dừng: điền xong ${b.done}/${b.total} từ${tail}.`;
  return `Đã điền AI cho ${b.done}/${b.total} từ${tail}.`;
}

/** Progress of the AI batch, shown while it runs and until dismissed. */
function BatchCard({ b }: { b: BatchProgress }) {
  const pct = b.total ? Math.round(((b.done + b.failed) / b.total) * 100) : 0;
  return (
    <div class="batch" role="status" data-testid="batch">
      <div class="row" style={{ flexWrap: "nowrap" }}>
        <Icon n="sparkle" size={18} />
        <span class="grow">{b.running ? `Đang điền AI ${b.done + b.failed}/${b.total} từ${b.failed ? ` · ${b.failed} lỗi` : ""}` : batchSummary(b)}</span>
        {b.running ? (
          <button type="button" class="btn sm" onClick={stopBatch} data-testid="batch-stop">Dừng</button>
        ) : (
          <button type="button" class="btn ghost sm" onClick={() => aiBatch.set(null)}>Đóng</button>
        )}
      </div>
      <div class="bar"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
