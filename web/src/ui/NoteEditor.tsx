import { useState } from "preact/hooks";
import type { FieldValue, Note } from "@shared/model.ts";
import { noteType, template } from "@shared/notetypes.ts";
import { removeNote, setSuspended, updateNote } from "../data/actions.ts";
import { cards, decks } from "../data/state.ts";
import { dueLabel } from "../lib/format.ts";
import { isLeech } from "../lib/queue.ts";
import { useStore } from "../lib/store.ts";
import { Modal, confirmDialog, toast } from "./common.tsx";

/** Edits any note through its registered field list, so new note types need no new editor. */
export function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const def = noteType(note.type);
  const allDecks = useStore(decks);
  const allCards = useStore(cards).filter((c) => c.noteId === note.id);
  const [fields, setFields] = useState<Record<string, FieldValue>>(note.fields);
  const [deckId, setDeckId] = useState(note.deckId);
  const [tags, setTags] = useState((note.tags ?? []).join(", "));
  if (!def) return null;

  const ai = new Set(note.aiFields ?? []);
  const valid = def.fields.filter((f) => f.required).every((f) => typeof fields[f.key] === "string" && (fields[f.key] as string).trim());

  const save = async () => {
    // A field the user edited is no longer "AI": keep the label only on untouched values.
    const stillAi = (note.aiFields ?? []).filter((k) => JSON.stringify(fields[k]) === JSON.stringify(note.fields[k]));
    await updateNote(note, {
      fields,
      deckId,
      aiFields: stillAi,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10),
    });
    toast("Đã lưu");
    onClose();
  };

  const del = async () => {
    const ok = await confirmDialog({
      title: "Xoá từ này?",
      message: `“${def.title(note)}” và các thẻ ôn tập của nó sẽ bị xoá khỏi mọi thiết bị. Lịch sử ôn tập vẫn được giữ.`,
      confirm: "Xoá",
      danger: true,
    });
    if (!ok) return;
    await removeNote(note);
    toast("Đã xoá từ");
    onClose();
  };

  return (
    <Modal title="Sửa từ" onClose={onClose} wide>
      <div class="col">
        {def.fields.map((f) => (
          <div class="field" key={f.key}>
            <label for={`f-${f.key}`}>
              {f.label}
              {ai.has(f.key) && <span class="ai-tag">AI</span>}
            </label>
            {f.kind === "text" ? (
              <input
                id={`f-${f.key}`}
                class="input"
                value={(fields[f.key] as string) ?? ""}
                maxLength={f.maxLength}
                onInput={(e) => setFields({ ...fields, [f.key]: e.currentTarget.value })}
              />
            ) : (
              <textarea
                id={`f-${f.key}`}
                class="textarea"
                value={f.kind === "list" ? ((fields[f.key] as string[]) ?? []).join("\n") : ((fields[f.key] as string) ?? "")}
                placeholder={f.placeholder ?? (f.kind === "list" ? "Mỗi dòng một ví dụ" : "")}
                onInput={(e) =>
                  setFields({ ...fields, [f.key]: f.kind === "list" ? e.currentTarget.value.split("\n") : e.currentTarget.value })
                }
              />
            )}
          </div>
        ))}
        <div class="row">
          <div class="field grow">
            <label for="f-deck">Bộ thẻ</label>
            <select id="f-deck" class="select" value={deckId} onChange={(e) => setDeckId(e.currentTarget.value)}>
              {allDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div class="field grow">
            <label for="f-tags">Thẻ gắn (phân cách bằng dấu phẩy)</label>
            <input id="f-tags" class="input" value={tags} onInput={(e) => setTags(e.currentTarget.value)} placeholder="toeic, công việc" />
          </div>
        </div>
        {allCards.length > 0 && (
          <div class="col" style={{ gap: "6px" }}>
            <span class="lbl">Thẻ ôn tập</span>
            {allCards.map((c) => (
              <div class="row" key={c.id} style={{ justifyContent: "space-between" }}>
                <span>{template(note.type, c.template)?.label ?? c.template}</span>
                <span class="row" style={{ gap: "8px" }}>
                  {isLeech(c) && <span class="pill bad">Khó · quên {c.lapses}</span>}
                  <span class="pill">{dueLabel(c, Date.now())}</span>
                  <button type="button" class="btn sm" onClick={() => void setSuspended(c, !c.suspended)}>{c.suspended ? "Hiện lại" : "Ẩn"}</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="modal-actions split">
        <button type="button" class="btn danger" onClick={() => void del()} data-testid="note-delete">Xoá từ</button>
        <div class="row">
          <button type="button" class="btn" onClick={onClose}>Huỷ</button>
          <button type="button" class="btn primary" disabled={!valid} onClick={() => void save()} data-testid="note-save">Lưu</button>
        </div>
      </div>
    </Modal>
  );
}
