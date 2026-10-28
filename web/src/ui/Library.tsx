import { useMemo, useState } from "preact/hooks";
import { CardState, type Card, type Id, type Note } from "@shared/model.ts";
import { noteType } from "@shared/notetypes.ts";
import { createDeck, deleteDeckAndContents, renameDeck } from "../data/actions.ts";
import { cards, decks, loaded, notes } from "../data/state.ts";
import { dueLabel } from "../lib/format.ts";
import { isLeech } from "../lib/queue.ts";
import { useStore } from "../lib/store.ts";
import { Icon, Modal, confirmDialog, go, toast } from "./common.tsx";
import { NoteEditor } from "./NoteEditor.tsx";

type Filter = "all" | "new" | "learning" | "review" | "suspended" | "leech";
type Sort = "recent" | "alpha" | "due";

const FILTERS: Array<[Filter, string]> = [
  ["all", "Tất cả"], ["new", "Mới"], ["learning", "Đang học"], ["review", "Ôn tập"], ["suspended", "Đã ẩn"], ["leech", "Thẻ khó"],
];

function matches(f: Filter, cs: Card[]): boolean {
  if (f === "all") return true;
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
      return matches(filter, cardsByNote.get(n.id) ?? []);
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

  if (!ready) return <div class="page"><p class="muted">Đang tải…</p></div>;

  return (
    <div class="page">
      <div class="page-head">
        <h1>Thư viện</h1>
        <span class="pill">{allNotes.length} từ</span>
        <span class="spacer" />
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
        {FILTERS.map(([k, label]) => <button type="button" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>)}
      </div>

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
              <button type="button" class="li" key={n.id} onClick={() => setEditing(n.id)} data-testid="lib-item">
                <span style={{ minWidth: "0px" }}>
                  <span class="t">{def.title(n)}</span> <span class="muted" style={{ fontSize: "12px" }}>{deckName(n.deckId)}</span>
                  <span class="s" style={{ display: "block" }}>{def.subtitle(n)}</span>
                </span>
                <span class="row" style={{ gap: "6px", flexWrap: "nowrap" }}>
                  {cs.some(isLeech) && <span class="pill bad">Khó</span>}
                  <span class="pill">{soon ? dueLabel(soon, now) : cs.every((c) => c.suspended) && cs.length ? "Đã ẩn" : "Mới"}</span>
                </span>
              </button>
            );
          })}
        </div>
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
