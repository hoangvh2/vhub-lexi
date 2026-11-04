import { useEffect, useState } from "preact/hooks";
import type { Note } from "@shared/model.ts";
import { hintCue, maskHint, type HintLevel } from "@shared/hints.ts";
import { str } from "@shared/notetypes.ts";
import { updateNote } from "../data/actions.ts";
import { callEnrich, firebaseConfigured } from "../data/firebase.ts";
import { prefs } from "../data/state.ts";
import { useStore } from "../lib/store.ts";
import { Icon, Modal, toast } from "./common.tsx";

export type HintKind = "memo" | "notes";
export const HINT_FIELD: Record<HintKind, "mnemonic" | "notes"> = { memo: "mnemonic", notes: "notes" };
const LABEL: Record<HintKind, string> = { memo: "Mẹo", notes: "Ghi chú" };

/**
 * The two hint buttons in the corner of the front. They sleep for `gateMs` (a ring fills meanwhile), and stay locked
 * on a word that leaned on hints lately; tapping a sleeping or locked button says why instead of opening.
 */
export function HintButtons(props: {
  note: Note;
  levels: Record<HintKind, HintLevel>;
  gateMs: number;
  locked: boolean;
  onOpen(kind: HintKind): void;
}) {
  const { note, levels, gateMs, locked, onOpen } = props;
  const [awake, setAwake] = useState(gateMs === 0);
  useEffect(() => {
    if (gateMs === 0) return;
    const t = setTimeout(() => setAwake(true), gateMs);
    return () => clearTimeout(t);
  }, []);
  const tap = (kind: HintKind) => {
    if (locked) return toast("Từ này bạn hay cần gợi ý. Lần này hãy tự nhớ, mẹo và ghi chú có ở mặt sau.");
    if (!awake) return toast("Thử tự nhớ thêm vài giây nhé");
    if (!str(note.fields[HINT_FIELD[kind]])) return toast(kind === "memo" ? "Từ này chưa có mẹo. Lật đáp án rồi bấm Sửa mẹo để thêm." : "Chưa có ghi chú. Lật đáp án rồi bấm Sửa để thêm.");
    onOpen(kind);
  };
  return (
    <div class={`hint-tools${awake ? " awake" : ""}${locked ? " locked" : ""}`} style={{ "--gate": `${gateMs}ms` }} onClick={(e) => e.stopPropagation()}>
      {(["memo", "notes"] as const).map((kind) => {
        const has = !!str(note.fields[HINT_FIELD[kind]]);
        const lvl = levels[kind];
        return (
          <button
            type="button"
            key={kind}
            class={`hint-btn${lvl ? " on" : ""}${has ? "" : " empty"}`}
            onClick={() => tap(kind)}
            aria-label={`${LABEL[kind]}${lvl === 1 ? ": xem đầy đủ" : lvl === 2 ? ": đang mở" : ": gợi ý"}`}
            title={`${LABEL[kind]} (${kind === "memo" ? "H" : "G"})`}
            data-testid={`hint-${kind}`}
            data-level={lvl}
          >
            {gateMs > 0 && !awake && !locked && <i class="hint-ring" />}
            <Icon n={kind === "memo" ? "bulb" : "note"} size={18} />
            {locked && <b class="hint-dot" />}
          </button>
        );
      })}
    </div>
  );
}

/** Opened hints on the front: level 1 shows the cue, level 2 the whole text; the answer is blanked in both. */
export function HintBoxes({ note, templateId, levels }: { note: Note; templateId: string; levels: Record<HintKind, HintLevel> }) {
  const open = (["memo", "notes"] as const).filter((k) => levels[k] > 0);
  if (!open.length) return null;
  return (
    <div class="hint-boxes" onClick={(e) => e.stopPropagation()}>
      {open.map((kind) => {
        const text = str(note.fields[HINT_FIELD[kind]]);
        const shown = levels[kind] === 1 ? hintCue(text) : text;
        return (
          <div key={kind} class={`hint-box ${kind}`} data-testid={`hint-box-${kind}`}>
            <span class="hint-lbl">{LABEL[kind]} · {levels[kind] === 1 ? "gợi ý" : "đầy đủ"}</span>
            <p>
              {maskHint(shown, note, templateId).map((s, i) =>
                s.masked ? <span key={i} class="hint-mask" aria-label="(đáp án bị che)">{s.text}</span> : s.text,
              )}
            </p>
          </div>
        );
      })}
      <p class="hint-note">Đã dùng gợi ý: lần này {Math.max(levels.memo, levels.notes) === 2 ? "tối đa là Khó" : "không chấm Dễ"}.</p>
    </div>
  );
}

/** After the answer: the tip and the learner's notes, each with a way to edit them right here. */
export function MemoryPanel({ note, showMemo, onEdit }: { note: Note; showMemo: boolean; onEdit(): void }) {
  const memo = showMemo ? str(note.fields.mnemonic) : "";
  const notes = str(note.fields.notes);
  if (!memo && !notes) {
    return (
      <button type="button" class="btn ghost sm memory-add" onClick={(e) => (e.stopPropagation(), onEdit())} data-testid="memory-add">
        <Icon n="plus" size={16} /> Thêm mẹo hoặc ghi chú
      </button>
    );
  }
  return (
    <div class="memory" data-testid="memory" onClick={(e) => e.stopPropagation()}>
      {memo && (
        <div class="hint-box memo">
          <span class="hint-lbl">Mẹo nhớ</span>
          <p>{memo}</p>
        </div>
      )}
      {notes && (
        <div class="hint-box notes">
          <span class="hint-lbl">Ghi chú của tôi</span>
          <p>{notes}</p>
        </div>
      )}
      <button type="button" class="btn ghost sm memory-edit" onClick={onEdit} data-testid="memory-edit">
        <Icon n="edit" size={15} /> Sửa mẹo và ghi chú
      </button>
    </div>
  );
}

/**
 * Edit the tip and the notes of one word without leaving the session. "AI gợi ý mẹo" asks for a tip for this word only
 * (one AI use) and puts it in the box; nothing is saved until "Lưu". Scheduling is not touched.
 */
export function MemoryEditor({ note, onClose }: { note: Note; onClose(): void }) {
  const [memo, setMemo] = useState(str(note.fields.mnemonic));
  const [notes, setNotes] = useState(str(note.fields.notes));
  const [aiMemo, setAiMemo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const word = str(note.fields.word);
  const aiAvailable = firebaseConfigured && useStore(prefs).aiEnabled;

  const askAi = async () => {
    setBusy(true);
    try {
      const r = (await callEnrich(word, { pos: str(note.fields.pos) || undefined, vi: str(note.fields.vi) || undefined, only: "memo" })) as { mnemonic?: string };
      const m = (r.mnemonic ?? "").trim();
      if (!m) return toast("AI chưa nghĩ ra mẹo ngắn cho từ này. Hãy thử lại hoặc tự viết.");
      setMemo(m);
      setAiMemo(m);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Không gọi được AI, thử lại sau");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const fields = { ...note.fields };
    const m = memo.trim();
    const n = notes.trim();
    if (m) fields.mnemonic = m;
    else delete fields.mnemonic;
    if (n) fields.notes = n;
    else delete fields.notes;
    // The AI label stays only on a tip the learner did not change (just written by AI here, or untouched before).
    const ai = new Set(note.aiFields ?? []);
    if (aiMemo !== null && m === aiMemo) ai.add("mnemonic");
    else if (m !== str(note.fields.mnemonic)) ai.delete("mnemonic");
    if (!m) ai.delete("mnemonic");
    await updateNote(note, { fields, aiFields: [...ai] });
    toast("Đã lưu mẹo và ghi chú");
    onClose();
  };

  return (
    <Modal title={`${word} · mẹo và ghi chú`} onClose={onClose}>
      <div class="col">
        <div class="field">
          <label for="me-memo">Mẹo nhớ {aiMemo !== null && memo === aiMemo && <span class="ai-tag">AI</span>}</label>
          <textarea id="me-memo" class="textarea" rows={3} maxLength={300} value={memo} onInput={(e) => setMemo(e.currentTarget.value)} placeholder='Ví dụ: Đọc như "con vịt": cố thuyết phục một con vịt biết nói tiếng Anh.' data-testid="memo-input" />
          {aiAvailable && (
            <button type="button" class="btn ghost sm ai-memo" onClick={() => void askAi()} disabled={busy} data-testid="ai-memo">
              <Icon n="sparkle" size={15} /> {busy ? "AI đang nghĩ…" : memo ? "AI gợi ý mẹo khác (1 lượt)" : "AI gợi ý mẹo (1 lượt)"}
            </button>
          )}
        </div>
        <div class="field">
          <label for="me-notes">Ghi chú của tôi</label>
          <textarea id="me-notes" class="textarea" rows={4} maxLength={500} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} placeholder="Điều bạn hay nhầm, cách dùng, từ hay đi kèm…" data-testid="notes-input" />
        </div>
        <div class="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" class="btn ghost" onClick={onClose}>Huỷ</button>
          <button type="button" class="btn primary" onClick={() => void save()} disabled={busy} data-testid="memory-save">Lưu</button>
        </div>
      </div>
    </Modal>
  );
}
