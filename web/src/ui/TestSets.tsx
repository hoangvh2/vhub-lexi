import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { addNote } from "../data/actions.ts";
import { callExtract, firebaseConfigured } from "../data/firebase.ts";
import { notes, prefs } from "../data/state.ts";
import { deleteTestSet, loadTestSets, saveTestSet, testSets } from "../data/testsets.ts";
import { LETTERS, existingSentences, type Extracted, type Letter } from "../lib/import.ts";
import { openPdf, readPages, renderPage, type PdfDoc } from "../lib/pdf.ts";
import { PARTS, formatScore } from "../lib/practice.ts";
import { useStore } from "../lib/store.ts";
import { chunkPages, findKey, grade, keyNote, keyPairs, mergeExtracted, numbersIn, reflow, resultFields, summary, wrongDrafts, type Chunk, type PdfPage, type SetQuestion, type TestSet } from "../lib/testset.ts";
import { Icon, confirmDialog, toast } from "./common.tsx";
import { DraftReview, type Review } from "./ImportPanel.tsx";
import type { DeckSink } from "./Practice.tsx";

/** Tests replace the Cloud Function with a canned answer (there is no Gemini in CI); same hook as "Nhập nhanh". */
type Hook = (input: { images: Array<{ mime: string; data: string }>; text: string }) => Promise<Extracted>;
const hook = (): Hook | undefined => (globalThis as unknown as { __lexiExtract?: Hook }).__lexiExtract;

/** Quota units per call (functions/src/config.ts extractTextCost / extractImageCost). */
const COST = { text: 2, images: 3 } as const;
const MAX_PDF_BYTES = 60 * 1024 * 1024;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * Bộ đề: a whole Reading test imported from a PDF, taken here with a clock, graded per part; the result goes to
 * "Kết quả bài" and the missed questions become cards. The test itself stays on this device.
 */
export function TestSetsTab({ deck, deckPicker, onPassage }: { deck: DeckSink; deckPicker: ComponentChildren; onPassage(text: string): void }) {
  const sets = useStore(testSets);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  useEffect(() => {
    loadTestSets().then(() => setReady(true), () => (setReady(true), toast("Không mở được kho bộ đề trên máy này")));
  }, []);
  const current = sets.find((s) => s.id === running);
  if (current) return <Runner set={current} deck={deck} deckPicker={deckPicker} onPassage={onPassage} onExit={() => setRunning(null)} />;
  return (
    <div class="col">
      <PdfImport onSaved={(s) => toast(`Đã lưu bộ đề “${s.name}”`)} />
      <section class="panel col" data-testid="sets">
        <div class="panel-head">
          <h2>Bộ đề của bạn</h2>
          <span class="pill" title="Không đồng bộ lên cloud, không có trong file Xuất JSON">Riêng tư · chỉ trên máy này</span>
        </div>
        {ready && !sets.length && <p class="muted small" data-testid="sets-empty">Chưa có bộ đề nào. Nhập một file PDF đề Reading ở trên để làm bài ngay trong Lexi.</p>}
        <ul class="sets">
          {sets.map((s) => <SetRow key={s.id} set={s} onOpen={() => setRunning(s.id)} />)}
        </ul>
        <p class="muted small">Nội dung đề là bản sao để bạn tự học: chỉ nằm trong trình duyệt này. Kết quả bài và thẻ tạo từ câu sai thì đồng bộ như mọi thẻ khác.</p>
      </section>
    </div>
  );
}

function SetRow({ set, onOpen }: { set: TestSet; onOpen(): void }) {
  const sum = summary(set);
  const a = set.attempt;
  const g = a?.finishedAt ? grade(set, a.answers) : null;
  async function remove() {
    const ok = await confirmDialog({ title: "Xoá bộ đề?", message: `“${set.name}” và bài làm dở sẽ bị xoá khỏi máy này. Kết quả đã lưu và thẻ đã tạo vẫn giữ nguyên.`, confirm: "Xoá", danger: true });
    if (ok) await deleteTestSet(set.id);
  }
  return (
    <li class="set" data-testid="set-row">
      <div class="grow col" style={{ gap: "6px" }}>
        <b class="name">{set.name}</b>
        <div class="chips">
          {PARTS.map((p) => sum.byPart[p.key] > 0 && <span class="pill" key={p.key}>{p.label}: {sum.byPart[p.key]}</span>)}
          {sum.byPart.other > 0 && <span class="pill">Khác: {sum.byPart.other}</span>}
          {g ? <span class="pill ok" data-testid="set-score">Đã làm: {g.right}/{g.total}</span> : a ? <span class="pill warn">Đang làm · {Object.keys(a.answers).length}/{sum.total} câu</span> : null}
        </div>
      </div>
      <div class="row" style={{ gap: "8px" }}>
        <button type="button" class="btn primary sm" onClick={onOpen} data-testid="set-open">{g ? "Xem kết quả" : a ? "Làm tiếp" : "Làm bài"}</button>
        <button type="button" class="icon-btn" aria-label={`Xoá ${set.name}`} onClick={() => void remove()} data-testid="set-delete"><Icon n="trash" size={18} /></button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ import

interface Picked {
  fileName: string;
  doc: PdfDoc;
  pages: PdfPage[];
  key: Map<number, Letter>;
  keyPages: number[];
}

function describeError(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? "");
  if (code.includes("resource-exhausted")) return "Hết lượt AI hôm nay. Phần đã đọc được giữ lại, ngày mai đọc tiếp phần còn thiếu.";
  if (code.includes("permission-denied") || code.includes("unauthenticated")) return "Cần đăng nhập bằng tài khoản được cấp quyền để dùng AI.";
  return "";
}

function PdfImport({ onSaved }: { onSaved(s: TestSet): void }) {
  const p = useStore(prefs);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [loading, setLoading] = useState("");
  const [name, setName] = useState("");
  const [pastedKey, setPastedKey] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [draft, setDraft] = useState<{ set: Pick<TestSet, "passages" | "questions">; failed: number[]; stopped: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const available = !!hook() || (firebaseConfigured && p.aiEnabled);

  const key = useMemo(() => {
    const k = new Map(picked?.key ?? []);
    for (const [n, l] of keyPairs(pastedKey)) k.set(n, l);
    return k;
  }, [picked, pastedKey]);
  const chunks: Chunk[] = useMemo(() => (picked ? chunkPages(picked.pages, new Set(picked.keyPages)) : []), [picked]);
  const cost = chunks.reduce((a, c) => a + COST[c.kind], 0);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError("");
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) return setError("Chọn một file PDF.");
    if (f.size > MAX_PDF_BYTES) return setError("File lớn quá 60 MB. Tách riêng phần Reading rồi thử lại.");
    setLoading("Đang mở PDF…");
    try {
      const doc = await openPdf(new Uint8Array(await f.arrayBuffer()));
      const pages = await readPages(doc, (n) => setLoading(`Đang đọc trang ${n}/${doc.numPages}…`));
      const { key: k, keyPages } = findKey(pages);
      picked?.doc.close().catch(() => undefined);
      setPicked({ fileName: f.name, doc, pages, key: k, keyPages });
      setName(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 60) || "Bộ đề");
      setDraft(null);
    } catch {
      setError("Không mở được file này. File có thể bị khoá mật khẩu hoặc hỏng.");
    } finally {
      setLoading("");
    }
  }

  async function read() {
    if (!picked || progress || !chunks.length) return;
    setError("");
    const call = hook() ?? ((i: { images: Array<{ mime: string; data: string }>; text: string }) => callExtract(i) as Promise<Extracted>);
    const results: Extracted[] = [];
    const failed: number[] = [];
    let stopped = "";
    setProgress({ done: 0, total: chunks.length });
    for (const [i, c] of chunks.entries()) {
      try {
        const payload = c.kind === "text"
          ? { images: [], text: (c.text + keyNote(key, numbersIn(c.text))).slice(0, 12000) }
          : { images: await Promise.all(c.pages.map((n) => renderPage(picked.doc, n))), text: keyNote(key, "all").trim() };
        let r: Extracted | null = null;
        for (let attempt = 0; attempt < 2 && !r; attempt++) {
          try {
            r = await call(payload);
          } catch (e) {
            if (describeError(e) || attempt === 1) throw e;
          }
        }
        results.push(r!);
      } catch (e) {
        failed.push(...c.pages);
        const why = describeError(e);
        if (why) {
          stopped = why;
          failed.push(...chunks.slice(i + 1).flatMap((x) => x.pages));
          break;
        }
      }
      setProgress({ done: i + 1, total: chunks.length });
    }
    setProgress(null);
    const set = mergeExtracted(results, key);
    if (!set.questions.length) setError(stopped || "Không thấy câu hỏi nào trong file này.");
    else setDraft({ set, failed: [...new Set(failed)].sort((a, b) => a - b), stopped });
  }

  function setAnswer(i: number, l: Letter) {
    setDraft((d) => d && { ...d, set: { ...d.set, questions: d.set.questions.map((q) => (q.i === i ? { ...q, correct: l } : q)) } });
  }

  async function save() {
    if (!picked || !draft) return;
    const now = Date.now();
    const set: TestSet = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 60) || "Bộ đề",
      createdAt: now,
      updatedAt: now,
      source: { fileName: picked.fileName.slice(0, 120), pages: picked.pages.length },
      ...draft.set,
    };
    await saveTestSet(set);
    onSaved(set);
    reset();
  }

  function reset() {
    picked?.doc.close().catch(() => undefined);
    setPicked(null);
    setDraft(null);
    setPastedKey("");
    setError("");
    setOpen(false);
  }

  const scanned = picked?.pages.filter((x) => x.scanned).length ?? 0;
  const sum = draft ? summary(draft.set) : null;

  return (
    <section class="panel col import" data-testid="pdf-import">
      <div class="panel-head">
        <h2><Icon n="upload" size={18} /> Nhập đề từ PDF</h2>
        {!picked && <button type="button" class="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="pdf-toggle">{open ? "Thu gọn" : "Mở"}</button>}
      </div>
      {!open && !picked && <p class="muted small">Một file PDF đề Reading (Part 5–7): Lexi đọc chữ ngay trên máy, AI tách từng câu hỏi, bảng đáp án ở cuối file được dò tự động. Xong là làm bài được ngay.</p>}
      {open && !picked && (
        <div class="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void pick(e.dataTransfer?.files?.[0]); }}>
          <button type="button" class="btn" disabled={!!loading} onClick={() => input.current?.click()} data-testid="pdf-pick"><Icon n="plus" /> Chọn file PDF</button>
          <span class="muted small">{loading || "hoặc kéo thả file vào đây"}</span>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { void pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} data-testid="pdf-file" />
        </div>
      )}
      {error && <p class="pill bad wrap" role="alert" data-testid="pdf-error">{error}</p>}

      {picked && !draft && (
        <div class="col">
          <div class="chips" data-testid="pdf-facts">
            <span class="pill">{picked.fileName}</span>
            <span class="pill">{picked.pages.length} trang</span>
            {scanned > 0 && <span class="pill warn" data-testid="pdf-scanned">{scanned} trang scan: AI đọc từ ảnh</span>}
            {picked.key.size > 0
              ? <span class="pill ok" data-testid="pdf-key">Bảng đáp án: {picked.key.size} câu (trang {picked.keyPages.join(", ")})</span>
              : <span class="pill warn" data-testid="pdf-nokey">Không thấy bảng đáp án trong file</span>}
          </div>
          <div class="field">
            <label for="set-name">Tên bộ đề</label>
            <input id="set-name" class="input" maxLength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} data-testid="set-name" />
          </div>
          <div class="field">
            <label for="set-key">Dán bảng đáp án {picked.key.size ? "(bổ sung, không bắt buộc)" : "(nên có để chấm điểm)"}</label>
            <textarea id="set-key" class="textarea" rows={2} value={pastedKey} placeholder="vd: 101 A 102 C 103 B …" onInput={(e) => setPastedKey(e.currentTarget.value)} data-testid="set-key" />
            {pastedKey.trim() && <span class="muted small" data-testid="set-key-count">Đọc được {keyPairs(pastedKey).size} đáp án</span>}
          </div>
          {!available && <p class="muted small" data-testid="pdf-off">Cần đăng nhập Google và bật “Điền bằng AI” trong Cài đặt để AI tách câu hỏi.</p>}
          {progress ? (
            <div class="col" style={{ gap: "6px" }} data-testid="pdf-progress">
              <span class="muted small">Đang đọc phần {Math.min(progress.done + 1, progress.total)}/{progress.total}…</span>
              <div class="progress"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            </div>
          ) : (
            <div class="row">
              <button type="button" class="btn primary" disabled={!available || !chunks.length} onClick={() => void read()} data-testid="pdf-read"><Icon n="sparkle" /> Tách câu hỏi ({chunks.length} phần, ≈ {cost} lượt AI)</button>
              <button type="button" class="btn ghost" onClick={reset}>Huỷ</button>
            </div>
          )}
        </div>
      )}

      {draft && sum && (
        <div class="col" data-testid="pdf-preview">
          <div class="chips">
            <span class="pill ok" data-testid="pdf-total">{sum.total} câu</span>
            {PARTS.map((x) => sum.byPart[x.key] > 0 && <span class="pill" key={x.key}>{x.label}: {sum.byPart[x.key]}</span>)}
            <span class="pill">{draft.set.passages.length} đoạn đọc</span>
          </div>
          {draft.stopped && <p class="pill warn wrap" role="alert">{draft.stopped}</p>}
          {draft.failed.length > 0 && <p class="pill warn wrap" data-testid="pdf-failed">Chưa đọc được trang {draft.failed.join(", ")}. Có thể lưu phần đã có rồi nhập lại các trang này sau.</p>}
          {sum.missing.length > 0 && <p class="pill warn wrap" data-testid="pdf-missing">Thiếu câu {sum.missing.slice(0, 12).join(", ")}{sum.missing.length > 12 ? "…" : ""}: đối chiếu với đề gốc</p>}
          {sum.noAnswer > 0 && <p class="muted small" data-testid="pdf-noanswer">{sum.noAnswer} câu chưa có đáp án: chọn bên dưới, hoặc để trống (câu đó không được chấm).</p>}
          <ul class="drafts compact">
            {draft.set.questions.filter((q) => !q.correct || q.flags.includes("key-differs")).slice(0, 40).map((q) => (
              <li key={q.i} class="draft" data-testid="pdf-fix">
                <span><b>Câu {q.number ?? q.i + 1}.</b> <span lang="en">{q.stem}</span></span>
                {q.flags.includes("key-differs") && <span class="pill warn">AI đọc khác bảng đáp án, Lexi dùng bảng đáp án</span>}
                <div class="opts" role="radiogroup" aria-label={`Đáp án câu ${q.number ?? q.i + 1}`}>
                  {LETTERS.map((l) => (
                    <label key={l} class={`opt${q.correct === l ? " on" : ""}`}>
                      <input type="radio" name={`fix-${q.i}`} checked={q.correct === l} disabled={!q.options[l]} onChange={() => setAnswer(q.i, l)} />
                      <b>{l}</b> <span lang="en">{q.options[l] || "—"}</span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div class="row">
            <button type="button" class="btn primary" onClick={() => void save()} data-testid="pdf-save"><Icon n="check" /> Lưu bộ đề</button>
            <button type="button" class="btn ghost" onClick={reset}>Bỏ</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ taking the test

function Runner({ set, deck, deckPicker, onPassage, onExit }: { set: TestSet; deck: DeckSink; deckPicker: ComponentChildren; onPassage(text: string): void; onExit(): void }) {
  const [attempt, setAttempt] = useState(() => set.attempt ?? { startedAt: Date.now(), elapsedMs: 0, answers: {} });
  const resumed = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const finished = !!attempt.finishedAt;
  const elapsed = attempt.elapsedMs + (finished ? 0 : now - resumed.current);

  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    // Leaving the screen (or the tab) pauses the clock and keeps the answers.
    const pause = () => {
      if (!latest.current.finishedAt) persist({ ...latest.current, elapsedMs: latest.current.elapsedMs + (Date.now() - resumed.current) }, true);
    };
    const onHide = () => (document.visibilityState === "hidden" ? pause() : (resumed.current = Date.now()));
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      pause();
    };
  }, [finished]);

  const latest = useRef(attempt);
  latest.current = attempt;

  function persist(a: typeof attempt, rebase = false) {
    if (rebase) resumed.current = Date.now();
    latest.current = a;
    setAttempt(a);
    void saveTestSet({ ...set, attempt: a });
  }

  const choose = (q: SetQuestion, l: Letter) => persist({ ...attempt, answers: { ...attempt.answers, [q.i]: l } });
  const answered = Object.keys(attempt.answers).length;

  async function submit() {
    const left = set.questions.length - answered;
    const ok = await confirmDialog({ title: "Nộp bài?", message: left ? `Còn ${left} câu chưa làm, sẽ tính là sai.` : "Lexi chấm ngay theo bảng đáp án.", confirm: "Nộp bài" });
    if (!ok) return;
    persist({ ...attempt, elapsedMs: elapsed, finishedAt: Date.now() }, true);
    window.scrollTo?.({ top: 0 });
  }

  async function again() {
    const ok = await confirmDialog({ title: "Làm lại từ đầu?", message: "Các lựa chọn của lần này bị xoá. Kết quả đã lưu vào “Kết quả bài” vẫn giữ.", confirm: "Làm lại", danger: true });
    if (!ok) return;
    persist({ startedAt: Date.now(), elapsedMs: 0, answers: {} }, true);
  }

  return (
    <div class="col runner" data-testid="runner">
      <div class="runner-bar panel row between">
        <button type="button" class="btn ghost sm" onClick={onExit} data-testid="runner-exit"><Icon n="arrow" size={16} /> Bộ đề</button>
        <b class="grow name">{set.name}</b>
        <span class="pill" data-testid="runner-clock">{clock(elapsed)}</span>
        {!finished && <span class="pill" data-testid="runner-count">{answered}/{set.questions.length}</span>}
        {!finished && <button type="button" class="btn primary sm" onClick={() => void submit()} data-testid="runner-submit">Nộp bài</button>}
      </div>
      {finished ? (
        <Result set={set} attempt={attempt} deck={deck} deckPicker={deckPicker} onPassage={onPassage} onAgain={() => void again()} onSaved={(id) => persist({ ...attempt, resultNoteId: id })} />
      ) : (
        <Questions set={set} answers={attempt.answers} onChoose={choose} />
      )}
    </div>
  );
}

/** The test in order: a part heading where the part changes, each passage once above its first question. */
function Questions({ set, answers, onChoose, review }: { set: TestSet; answers: Record<number, Letter>; onChoose?(q: SetQuestion, l: Letter): void; review?: boolean }) {
  let lastPart: number | null | undefined;
  let lastPassage: number | null = null;
  return (
    <div class="col">
      {set.questions.map((q) => {
        const head = q.part !== lastPart ? q.part : undefined;
        const showPassage = q.passage !== null && q.passage !== lastPassage;
        lastPart = q.part;
        lastPassage = q.passage;
        return (
          <div key={q.i} class="col" style={{ gap: "10px" }}>
            {head !== undefined && <h3 class="part-head">{head ? `Part ${head}` : "Câu khác"}</h3>}
            {showPassage && (
              <article class="panel passage" data-testid="runner-passage">
                {set.passages[q.passage!].label && <b class="muted small">{set.passages[q.passage!].label}</b>}
                <p lang="en">{reflow(set.passages[q.passage!].text)}</p>
              </article>
            )}
            <QuestionCard q={q} pick={answers[q.i]} onChoose={onChoose} review={review} />
          </div>
        );
      })}
    </div>
  );
}

function QuestionCard({ q, pick, onChoose, review }: { q: SetQuestion; pick: Letter | undefined; onChoose?(q: SetQuestion, l: Letter): void; review?: boolean }) {
  const wrong = review && q.correct && pick !== q.correct;
  return (
    <section class={`panel col qcard${wrong ? " missed" : ""}`} data-testid="runner-q">
      <p class="stem"><b>{q.number ?? q.i + 1}.</b> <span lang="en">{q.stem}</span></p>
      <div class="opts" role="radiogroup" aria-label={`Câu ${q.number ?? q.i + 1}`}>
        {LETTERS.map((l) => {
          if (!q.options[l]) return null;
          const cls = review ? (l === q.correct ? " right" : l === pick ? " bad" : "") : pick === l ? " on" : "";
          return (
            <label key={l} class={`opt${cls}`}>
              <input type="radio" name={`q-${q.i}`} checked={pick === l} disabled={review} onChange={() => onChoose?.(q, l)} />
              <b>{l}</b> <span lang="en">{q.options[l]}</span>
            </label>
          );
        })}
      </div>
      {review && !q.correct && <span class="pill">Chưa có đáp án, không chấm</span>}
      {review && wrong && !pick && <span class="pill bad">Bỏ trống</span>}
      {review && q.rule && <p class="muted small"><span class="ai-tag">AI</span> {q.rule}</p>}
    </section>
  );
}

function Result({ set, attempt, deck, deckPicker, onPassage, onAgain, onSaved }: {
  set: TestSet;
  deckPicker: ComponentChildren;
  attempt: NonNullable<TestSet["attempt"]>;
  deck: DeckSink;
  onPassage(text: string): void;
  onAgain(): void;
  onSaved(noteId: string): void;
}) {
  const allNotes = useStore(notes);
  const g = useMemo(() => grade(set, attempt.answers), [set, attempt]);
  const existing = useMemo(() => existingSentences(allNotes), [allNotes]);
  const [review, setReview] = useState<Review | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(true);
  const saved = !!attempt.resultNoteId && allNotes.some((n) => n.id === attempt.resultNoteId);

  async function saveResult() {
    const date = new Date(attempt.finishedAt ?? Date.now());
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const n = await addNote({ type: "test", fields: resultFields(set.name, iso || todayIso(), g, attempt.elapsedMs) });
    onSaved(n.id);
    toast("Đã lưu vào Kết quả bài");
  }

  function makeCards() {
    const w = wrongDrafts(set, g, existing);
    if (!w.drafts.length && !w.passages.length) return toast("Không có câu sai nào để tạo thẻ");
    setReview({ drafts: w.drafts, passages: w.passages, skipped: w.skipped });
  }

  const shown = onlyWrong ? { ...set, questions: set.questions.filter((q) => g.wrong.includes(q.i)) } : set;

  return (
    <div class="col" data-testid="runner-result">
      <section class="panel col">
        <div class="row between">
          <div class="col" style={{ gap: "2px" }}>
            <span class="muted small">Đúng</span>
            <b class="big-score" data-testid="result-score">{g.right}/{g.total}</b>
          </div>
          <span class="pill" data-testid="result-time">{clock(attempt.elapsedMs)}</span>
        </div>
        <div class="chips">
          {PARTS.map((p) => g.parts[p.key] && <span class="pill" key={p.key} data-testid={`result-${p.key}`}>{p.label}: {formatScore(g.parts[p.key]!)}</span>)}
          {g.ungraded > 0 && <span class="pill">{g.ungraded} câu không chấm</span>}
        </div>
        <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
          <button type="button" class="btn primary" disabled={saved} onClick={() => void saveResult()} data-testid="result-save">{saved ? <><Icon n="check" /> Đã lưu vào Kết quả bài</> : "Lưu vào Kết quả bài"}</button>
          <button type="button" class="btn" disabled={!g.wrong.length} onClick={makeCards} data-testid="result-cards"><Icon n="sparkle" /> Tạo thẻ từ {g.wrong.length} câu sai</button>
          <button type="button" class="btn ghost" onClick={onAgain} data-testid="result-again">Làm lại</button>
        </div>
      </section>
      {review && (
        <section class="panel col">
          {deckPicker}
          <DraftReview
            result={review}
            setResult={setReview}
            existing={existing}
            deck={deck}
            testName={set.name}
            onPassage={onPassage}
            onDone={() => setReview(null)}
            skippedText={review.skipped ? `${review.skipped} câu sai là câu đọc hiểu / chèn câu: xem đoạn đọc của chúng bên dưới để tìm từ lạ.` : undefined}
          />
        </section>
      )}
      <div class="row between">
        <h3 class="part-head">{onlyWrong ? `Câu sai (${g.wrong.length})` : `Tất cả (${set.questions.length})`}</h3>
        <button type="button" class="btn ghost sm" onClick={() => setOnlyWrong(!onlyWrong)} data-testid="result-toggle">{onlyWrong ? "Xem cả bài" : "Chỉ câu sai"}</button>
      </div>
      <Questions set={shown} answers={attempt.answers} review />
    </div>
  );
}
