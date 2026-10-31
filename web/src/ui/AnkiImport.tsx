import { useMemo, useState } from "preact/hooks";
import { NOTE_TYPES } from "@shared/notetypes.ts";
import { currentRepo, daily, decks, notes, prefs } from "../data/state.ts";
import { VOCAB_KEYS, convertAnki, defaultPlan, guessFields, guessTemplates, type ImportPlan } from "../lib/anki/convert.ts";
import { AnkiFormatError, readApkg, type AnkiCollection } from "../lib/anki/read.ts";
import { useStore } from "../lib/store.ts";
import { Modal, toast } from "./common.tsx";

/** Reads an .apkg the learner picked; resolves null (after telling them why) when it cannot be used. */
export async function loadApkg(f: File): Promise<AnkiCollection | null> {
  try {
    const col = await readApkg(new Uint8Array(await f.arrayBuffer()));
    if (!defaultPlan(col)) {
      toast("Gói Anki không có ghi chú nào");
      return null;
    }
    return col;
  } catch (e) {
    toast(e instanceof AnkiFormatError ? e.message : "Không đọc được gói Anki");
    console.error("[anki]", e);
    return null;
  }
}

const FIELD_LABEL = Object.fromEntries(NOTE_TYPES.vocab.fields.map((f) => [f.key, f.label]));
const n = (x: number) => x.toLocaleString("vi-VN");

/** Preview + mapping dialog for one Anki package; writes nothing until "Nhập". */
export function AnkiImport({ col, name, onClose }: { col: AnkiCollection; name: string; onClose: () => void }) {
  const p = useStore(prefs);
  const existing = { decks: useStore(decks), notes: useStore(notes), daily: useStore(daily), prefs: p };
  const [plan, setPlan] = useState<ImportPlan>(() => defaultPlan(col)!);
  const [busy, setBusy] = useState(false);
  const nt = col.notetypes.get(plan.notetypeId)!;
  const usedTypes = useMemo(() => {
    const count = new Map<string, number>();
    for (const x of col.notes) count.set(x.mid, (count.get(x.mid) ?? 0) + 1);
    return [...count.entries()].map(([id, c]) => ({ id, name: col.notetypes.get(id)?.name ?? id, count: c }));
  }, [col]);
  const { file, report } = useMemo(() => convertAnki(col, plan, existing, Date.now()), [col, plan, existing.notes, existing.decks]);
  const sample = file.notes[0];
  const skipped = report.skippedExisting + report.skippedDuplicates.length;

  async function run() {
    setBusy(true);
    try {
      const r = await currentRepo().importAll(file);
      toast(`Đã nhập ${n(r.notes)} từ từ Anki`);
      onClose();
    } catch (e) {
      console.error("[anki]", e);
      toast("Nhập thất bại, chưa có gì thay đổi lớn. Thử lại sau.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Nhập từ Anki" onClose={onClose} wide>
      <p class="muted" style={{ fontSize: "13px" }}>
        {name}: {n(col.notes.length)} ghi chú, {n(col.cards.length)} thẻ, {n(col.revlog.length)} lượt ôn. Ảnh và âm thanh không được nhập; Lexi đọc bằng giọng của máy.
      </p>

      {sample && (
        <div class="anki-sample" data-testid="anki-sample">
          <b>{String(sample.fields.word)}</b>
          {sample.fields.pos && <span class="pill">{String(sample.fields.pos)}</span>}
          {sample.fields.ipa && <span class="muted"> {String(sample.fields.ipa)}</span>}
          {sample.fields.vi && <div>{String(sample.fields.vi)}</div>}
          {Array.isArray(sample.fields.examples) && <div class="muted">{sample.fields.examples[0]}</div>}
          {sample.tags?.length ? <div class="muted" style={{ fontSize: "12px" }}>Nhãn: {sample.tags.join(", ")}</div> : null}
        </div>
      )}

      <ul class="anki-report" data-testid="anki-report">
        <li><b>{n(report.notes)}</b> từ mới vào {file.decks.length ? `bộ thẻ mới “${file.decks.map((d) => d.name).join(", ")}”` : "bộ thẻ đã có cùng tên"}{report.lessons.length > 1 ? `, chia theo ${n(report.lessons.length)} bài (nhãn ${report.lessons[0]} …)` : ""}</li>
        <li><b>{n(report.studied)}</b> thẻ giữ tiến độ ôn từ Anki, <b>{n(report.dueToday)}</b> đến hạn hôm nay, {n(report.reviews)} lượt ôn vào thống kê</li>
        {report.suspended > 0 && <li>{n(report.suspended)} thẻ vẫn tạm dừng như trong Anki</li>}
        {skipped > 0 && <li>Bỏ qua {n(skipped)} từ đã có trong Lexi{report.skippedDuplicates.length ? ` (${report.skippedDuplicates.slice(0, 5).join(", ")}${report.skippedDuplicates.length > 5 ? "…" : ""})` : ""}, tiến độ của chúng giữ nguyên</li>}
        {report.droppedCards > 0 && <li>{n(report.droppedCards)} thẻ Anki không có mẫu thẻ tương ứng, bị bỏ</li>}
        {report.truncated > 0 && <li>{n(report.truncated)} ô quá dài, được cắt bớt</li>}
        {report.skippedEmpty > 0 && <li>{n(report.skippedEmpty)} ghi chú không có từ, bị bỏ</li>}
        {report.writes > 15000 && <li class="warn">Cần khoảng {n(report.writes)} lượt ghi lên Firebase (miễn phí 20.000 lượt/ngày)</li>}
      </ul>

      <details class="anki-details" open={!plan.fields.word}>
        <summary>Ánh xạ trường (đã tự đoán, sửa nếu sai)</summary>
        {usedTypes.length > 1 && (
          <div class="field">
            <label for="anki-nt">Loại ghi chú</label>
            <select id="anki-nt" class="select" value={plan.notetypeId} onChange={(e) => {
              const m = col.notetypes.get(e.currentTarget.value)!;
              setPlan({ notetypeId: m.id, fields: guessFields(m), templates: guessTemplates(m) });
            }}>
              {usedTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({n(t.count)})</option>)}
            </select>
          </div>
        )}

        <div class="anki-map" data-testid="anki-map">
          {VOCAB_KEYS.map((k) => (
            <label class="anki-row" key={k}>
              <span>{FIELD_LABEL[k]}</span>
              <select class="select" value={plan.fields[k]} data-testid={`anki-field-${k}`} onChange={(e) => setPlan({ ...plan, fields: { ...plan.fields, [k]: e.currentTarget.value } })}>
                <option value="">Không lấy</option>
                {nt.fields.map((f) => <option key={f.ord} value={f.name}>{f.name}</option>)}
              </select>
            </label>
          ))}
          {nt.templates.map((t) => (
            <label class="anki-row" key={`t${t.ord}`}>
              <span>Thẻ Anki “{t.name}”</span>
              <select class="select" value={plan.templates[t.ord] ?? ""} onChange={(e) => setPlan({ ...plan, templates: { ...plan.templates, [t.ord]: e.currentTarget.value } })}>
                <option value="">Bỏ (không giữ tiến độ)</option>
                {NOTE_TYPES.vocab.templates.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </details>

      <p class="muted" style={{ fontSize: "13px" }}>Muốn gỡ lại thì xoá bộ thẻ vừa nhập trong Thư viện.</p>

      <div class="modal-actions">
        <button type="button" class="btn" onClick={onClose} data-testid="anki-cancel">Huỷ</button>
        <button type="button" class="btn primary" disabled={busy || report.notes === 0 || !plan.fields.word} onClick={() => void run()} data-testid="anki-run">
          {busy ? "Đang nhập…" : `Nhập ${n(report.notes)} từ`}
        </button>
      </div>
    </Modal>
  );
}
