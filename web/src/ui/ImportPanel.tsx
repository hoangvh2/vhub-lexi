import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { GRAMMAR_TOPICS, template } from "@shared/notetypes.ts";
import type { Note } from "@shared/model.ts";
import { addNote } from "../data/actions.ts";
import { callExtract, firebaseConfigured } from "../data/firebase.ts";
import { notes, prefs } from "../data/state.ts";
import { LETTERS, PROBLEM_TEXT, aiFieldsOf, draftsFrom, existingSentences, grammarFields, problems, recommended, type Draft, type Extracted, type ExtractedPassage, type Letter } from "../lib/import.ts";
import { shrink, type Shrunk } from "../lib/image.ts";
import { testTag } from "../lib/practice.ts";
import { useStore } from "../lib/store.ts";
import { Blocks } from "./Blocks.tsx";
import { Icon, toast } from "./common.tsx";

const MAX_IMAGES = 6;

/** Tests replace the Cloud Function with a canned answer (there is no Gemini in CI). */
type Hook = (input: { images: Array<{ mime: string; data: string }>; text: string }) => Promise<Extracted>;
const hook = (): Hook | undefined => (globalThis as unknown as { __lexiExtract?: Hook }).__lexiExtract;

function describeError(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? "");
  if (code.includes("resource-exhausted")) return "Hết lượt AI hôm nay. Bạn vẫn có thể nhập tay ở tab Ngữ pháp và Từ lạ.";
  if (code.includes("permission-denied") || code.includes("unauthenticated")) return "Cần đăng nhập bằng tài khoản được cấp quyền để dùng AI.";
  if (code.includes("invalid-argument")) return (e as Error).message || "Dữ liệu không hợp lệ";
  return "Chưa đọc được. Kiểm tra mạng rồi thử lại, hoặc dán văn bản thay cho ảnh.";
}

/**
 * Nhập nhanh: screenshots of the missed questions (or their pasted text) → AI reads them → the learner reviews each row
 * → grammar cards are saved, and any reading passage goes to the unknown-words check. The AI only proposes.
 */
export function ImportPanel({ testName, onPassage }: { testName: string | null; onPassage(text: string): void }) {
  const allNotes = useStore(notes);
  const p = useStore(prefs);
  const [open, setOpen] = useState(false);
  const [imgs, setImgs] = useState<Shrunk[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ drafts: Draft[]; passages: ExtractedPassage[]; skipped: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const available = !!hook() || (firebaseConfigured && p.aiEnabled);
  const existing = useMemo(() => existingSentences(allNotes), [allNotes]);

  async function addFiles(files: Iterable<File>) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setError("");
    try {
      const made: Shrunk[] = [];
      for (const f of list.slice(0, MAX_IMAGES - imgs.length)) made.push(await shrink(f));
      setImgs((cur) => [...cur, ...made].slice(0, MAX_IMAGES));
      if (list.length > made.length) toast(`Tối đa ${MAX_IMAGES} ảnh mỗi lần`);
    } catch {
      setError("Không đọc được ảnh này. Thử ảnh PNG hoặc JPEG khác.");
    }
  }

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) (e.preventDefault(), void addFiles(files));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  async function run() {
    if (busy || (!imgs.length && text.trim().length < 20)) return;
    setBusy(true);
    setError("");
    try {
      const payload = { images: imgs.map((i) => ({ mime: i.mime, data: i.data })), text: text.trim() };
      const r = (await (hook() ?? callExtract)(payload)) as Extracted;
      const { drafts, skipped } = draftsFrom(r, existing);
      if (!drafts.length && !r.passages?.length) setError("Không thấy câu hỏi nào trong nội dung này. Thử ảnh rõ hơn hoặc dán văn bản.");
      else setResult({ drafts, passages: r.passages ?? [], skipped });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function patch(key: string, change: Partial<Draft>, edit?: string) {
    setResult((r) => r && { ...r, drafts: r.drafts.map((d) => (d.key === key ? { ...d, ...change, edited: edit && !d.edited.includes(edit) ? [...d.edited, edit] : d.edited } : d)) });
  }

  const chosen = result?.drafts.filter((d) => d.include && problems(d, existing).block.length === 0) ?? [];

  async function saveChosen() {
    if (!result || !chosen.length || saving) return;
    setSaving(true);
    try {
      const tags = ["ngu-phap", ...(testName ? [testTag(testName)] : [])];
      const done = new Set<string>();
      for (const d of chosen) {
        await addNote({ type: "grammar", fields: grammarFields(d), tags, aiFields: aiFieldsOf(d) });
        done.add(d.key);
      }
      toast(`Đã thêm ${done.size} thẻ ngữ pháp${testName ? ` · ${testName}` : ""}`);
      const left = result.drafts.filter((d) => !done.has(d.key));
      if (!left.length && !result.passages.length) reset();
      else setResult({ ...result, drafts: left });
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setResult(null);
    setImgs([]);
    setText("");
    setError("");
  }

  return (
    <section class="panel col import" data-testid="import">
      <div class="panel-head">
        <h2><Icon n="sparkle" size={18} /> Nhập nhanh từ đề</h2>
        <button type="button" class="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="import-toggle">{open ? "Thu gọn" : "Mở"}</button>
      </div>
      {!open && !result && <p class="muted small">Chụp màn hình câu sai (hoặc dán văn bản): AI đọc câu hỏi, đáp án đúng và đoạn đọc, bạn kiểm tra rồi mới lưu.</p>}
      {open && !result && (
        <>
          <p class="muted small">Ảnh chụp cả đáp án đúng (màu xanh) và lựa chọn sai của bạn (màu đỏ) thì AI tự nhận ra. Đoạn đọc dài: chụp nhiều ảnh nối tiếp, AI ghép lại. Mỗi lần dùng khoảng 2–3 lượt AI trong 300 lượt/ngày; ảnh chỉ dùng cho lần đọc này, không được lưu.</p>
          <div class="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer?.files ?? []); }}>
            <button type="button" class="btn" disabled={imgs.length >= MAX_IMAGES} onClick={() => input.current?.click()} data-testid="import-pick"><Icon n="plus" /> Chọn ảnh</button>
            <span class="muted small">hoặc kéo thả, hoặc dán ảnh (Ctrl+V) · {imgs.length}/{MAX_IMAGES}</span>
            <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.currentTarget.files ?? []); e.currentTarget.value = ""; }} data-testid="import-file" />
          </div>
          {imgs.length > 0 && (
            <div class="thumbs">
              {imgs.map((im, i) => (
                <div class="thumb" key={i}>
                  <img src={im.url} alt={`Ảnh ${i + 1}`} />
                  <button type="button" class="x" aria-label={`Bỏ ảnh ${i + 1}`} onClick={() => setImgs(imgs.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          <div class="field">
            <label for="imp-text">Hoặc dán văn bản của câu hỏi</label>
            <textarea id="imp-text" class="textarea" rows={4} value={text} maxLength={12000} placeholder={"vd: 101. ___ you need any help, please call us.\n(A) Should (B) Because (C) Despite (D) Unless  Đáp án: A"} onInput={(e) => setText(e.currentTarget.value)} data-testid="import-text" />
          </div>
          {error && <p class="pill bad" role="alert" data-testid="import-error">{error}</p>}
          {!available && <p class="muted small" data-testid="import-off">Cần đăng nhập Google và bật “Điền bằng AI” trong Cài đặt để dùng tính năng này. Bạn vẫn nhập tay được ở các tab bên dưới.</p>}
          <div class="row">
            <button type="button" class="btn primary" disabled={!available || busy || (!imgs.length && text.trim().length < 20)} onClick={() => void run()} data-testid="import-run">
              <Icon n="sparkle" /> {busy ? "Đang đọc…" : "Đọc câu hỏi"}
            </button>
          </div>
        </>
      )}

      {result && (
        <div class="col" data-testid="import-review">
          {result.drafts.length > 0 && (
            <>
              <div class="row between">
                <b>Câu ngữ pháp ({result.drafts.length})</b>
                <span class="muted small">Kiểm tra từng câu với đề gốc. Câu có cảnh báo được bỏ chọn sẵn.</span>
              </div>
              <ul class="drafts">
                {result.drafts.map((d) => <DraftRow key={d.key} d={d} existing={existing} onChange={patch} />)}
              </ul>
              <div class="row">
                <button type="button" class="btn primary" disabled={!chosen.length || saving} onClick={() => void saveChosen()} data-testid="import-save"><Icon n="check" /> Lưu {chosen.length} thẻ</button>
                <button type="button" class="btn ghost" onClick={reset}>Làm lại</button>
              </div>
            </>
          )}
          {result.skipped > 0 && <p class="muted small" data-testid="import-skipped">{result.skipped} câu hiểu bài / chèn câu không thành thẻ ngữ pháp. Ghi nhận trong “Kết quả bài”; đoạn đọc của chúng ở bên dưới.</p>}
          {result.passages.length > 0 && (
            <>
              <b>Đoạn đọc ({result.passages.length})</b>
              <ul class="drafts">
                {result.passages.map((ps) => (
                  <li key={ps.id} class="draft" data-testid="import-passage">
                    <div class="row between">
                      <b>{ps.label || `Đoạn ${ps.id}`}</b>
                      {ps.truncated && <span class="pill warn" data-testid="import-truncated">Có thể bị cắt, chụp thêm phần còn lại</span>}
                    </div>
                    <p class="muted small clamp">{ps.text}</p>
                    <button type="button" class="btn sm" onClick={() => (onPassage(ps.text), toast("Đã đưa đoạn vào tab Từ lạ"))} data-testid="import-use-passage">Tìm từ lạ trong đoạn này</button>
                  </li>
                ))}
              </ul>
              {!result.drafts.length && <button type="button" class="btn ghost" onClick={reset}>Xong</button>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DraftRow({ d, existing, onChange }: { d: Draft; existing: ReadonlySet<string>; onChange(key: string, change: Partial<Draft>, edit?: string): void }) {
  const [look, setLook] = useState(false);
  const pr = problems(d, existing);
  const f = grammarFields(d);
  const p = useStore(prefs);
  const tpl = template("grammar", "fill")!;
  const draft: Note = { id: "preview", type: "grammar", deckId: "", fields: f, createdAt: 0, updatedAt: 0 };
  const blocked = pr.block.length > 0;
  const set = (change: Partial<Draft>, edit?: string) => {
    const next = { ...d, ...change };
    // A rule and a translation written for one answer are wrong for another, unless the learner wrote them.
    if ("correct" in change) {
      if (!d.edited.includes("rule")) next.rule = "";
      if (!d.edited.includes("translation")) next.translation = "";
    }
    const structural = "correct" in change || "stem" in change;
    onChange(d.key, { ...change, ...(structural ? { rule: next.rule, translation: next.translation, include: recommended(next, existing) } : {}) }, edit);
  };
  return (
    <li class={`draft${blocked ? " blocked" : ""}`} data-testid="import-draft">
      <label class="row" style={{ alignItems: "flex-start", gap: "10px" }}>
        <input type="checkbox" checked={d.include && !blocked} disabled={blocked} onChange={(e) => onChange(d.key, { include: e.currentTarget.checked })} data-testid="draft-include" />
        <span class="grow">{d.number ? <b>Câu {d.number}. </b> : null}<span lang="en">{f.sentence || d.stem}</span></span>
      </label>
      <div class="chips">
        {pr.block.map((k) => <span class="pill bad" key={k}>{PROBLEM_TEXT[k]}</span>)}
        {pr.warn.map((k) => <span class={`pill ${k === "right" ? "" : "warn"}`} key={k}>{PROBLEM_TEXT[k]}</span>)}
      </div>
      <div class="opts" role="radiogroup" aria-label="Đáp án đúng">
        {LETTERS.map((l: Letter) => (
          <label key={l} class={`opt${d.correct === l ? " on" : ""}${d.result === "wrong" && false ? " bad" : ""}`}>
            <input type="radio" name={`ans-${d.key}`} checked={d.correct === l} disabled={!d.options[l]} onChange={() => set({ correct: l })} />
            <b>{l}</b> <span lang="en">{d.options[l] || "—"}</span>
          </label>
        ))}
      </div>
      <button type="button" class="btn ghost sm" aria-expanded={look} onClick={() => setLook(!look)} data-testid="draft-edit">{look ? "Ẩn chi tiết" : "Sửa và xem thẻ"}</button>
      {look && (
        <div class="col">
          <div class="field">
            <label>Câu (chỗ trống là _____)</label>
            <textarea class="textarea" rows={2} value={d.stem} onInput={(e) => set({ stem: e.currentTarget.value })} />
          </div>
          <div class="chips">
            {GRAMMAR_TOPICS.map((t) => <button type="button" key={t} class={`wchip${d.topic === t ? " on" : ""}`} aria-pressed={d.topic === t} onClick={() => set({ topic: d.topic === t ? "" : t }, "topic")}>{t}</button>)}
          </div>
          <div class="field">
            <label>Quy tắc {aiFieldsOf(d).includes("rule") && <span class="ai-tag">AI</span>}</label>
            <textarea class="textarea" rows={2} maxLength={300} value={d.rule} onInput={(e) => set({ rule: e.currentTarget.value }, "rule")} data-testid="draft-rule" />
          </div>
          <div class="field">
            <label>Nghĩa của câu {aiFieldsOf(d).includes("translation") && <span class="ai-tag">AI</span>}</label>
            <input class="input" maxLength={300} value={d.translation} onInput={(e) => set({ translation: e.currentTarget.value }, "translation")} />
          </div>
          {!blocked && (
            <div class="panel" data-testid="draft-preview">
              <Blocks blocks={tpl.front(draft, p.layout)} cloze />
              <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
              <Blocks blocks={tpl.back(draft, p.layout)} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
