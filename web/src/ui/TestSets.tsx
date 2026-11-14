import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { addNote } from "../data/actions.ts";
import { callExtract, firebaseConfigured } from "../data/firebase.ts";
import { notes, prefs } from "../data/state.ts";
import { deleteTestSet, downloadTestSet, loadMedia, loadTestSets, remoteSets, saveMedia, saveTestSet, setsSync, syncTestSets, testSets } from "../data/testsets.ts";
import type { CloudMeta } from "../lib/testsync.ts";
import { LETTERS, existingSentences, type Extracted, type Letter } from "../lib/import.ts";
import { decodeLevels, findGaps, mmss as clipTime, placeQuestions } from "../lib/audio.ts";
import { openPdf, readPages, renderPage, type PdfDoc } from "../lib/pdf.ts";
import { PARTS, formatScore } from "../lib/practice.ts";
import { useStore } from "../lib/store.ts";
import { LC_LAYOUT, LC_PARTS, attemptOf, canLogScope, findPhotoPages, lettersOf, partStates, partsOf, photoNumbers, photoSlots, parseNumberRange, scopeName, scopeView, sortTracks, withAttempt, type LcLayout, type Scope, type SetTrack } from "../lib/testset.ts";
import { chunkPages, findKey, formatPages, grade, keyNote, keyPairs, mergeExtracted, numbersIn, parsePageRange, reflow, resultFields, summary, wrongDrafts, type Chunk, type PdfPage, type SetQuestion, type TestSet } from "../lib/testset.ts";
import { Icon, confirmDialog, toast } from "./common.tsx";
import { DraftReview, type Review } from "./ImportPanel.tsx";
import type { DeckSink } from "./Practice.tsx";

/** Tests replace the Cloud Function with a canned answer (there is no Gemini in CI); same hook as "Nhập nhanh". */
type Hook = (input: { images: Array<{ mime: string; data: string }>; text: string }) => Promise<Extracted>;
const hook = (): Hook | undefined => (globalThis as unknown as { __lexiExtract?: Hook }).__lexiExtract;

/** Quota units per call (functions/src/config.ts extractTextCost / extractImageCost). */
const COST = { text: 2, images: 3 } as const;
/** A whole book scanned is often 100+ MB; pdf.js reads it page by page, the file itself is held once in memory. */
const MAX_PDF_BYTES = 150 * 1024 * 1024;
/** Photo pages shown small at import (Part 1 has at most 6 photos). */
const PHOTO_THUMBS = 6;
/** AI quota per day (functions/src/config.ts dailyEnrich, shared by every AI call): a choice that costs more cannot finish today. */
const DAILY_QUOTA = 300;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")} MB`);
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * Bộ đề: a whole Reading or Listening test imported from a PDF, taken here with a clock, graded per part; the result
 * goes to "Kết quả bài" and the missed questions become cards. Signed in, the test is in the account too, so every
 * device lists it and continues the attempt (data/testsets.ts).
 */
export function TestSetsTab({ deck, deckPicker, onPassage }: { deck: DeckSink; deckPicker: ComponentChildren; onPassage(text: string): void }) {
  const sets = useStore(testSets);
  const remote = useStore(remoteSets);
  const status = useStore(setsSync);
  const [ready, setReady] = useState(false);
  // The set whose Parts are listed, and what is being taken now: the whole set (scope null) or one Part.
  const [home, setHome] = useState<string | null>(null);
  const [running, setRunning] = useState<{ id: string; scope: Scope } | null>(null);
  useEffect(() => {
    loadTestSets().then(() => setReady(true), () => (setReady(true), toast("Không mở được kho bộ đề trên máy này")));
  }, []);
  // Again once the account is ready: after a reload on this screen, sign-in finishes after the screen is up.
  useEffect(() => {
    if (!status.on) return;
    void syncTestSets();
    const again = () => void syncTestSets();
    addEventListener("online", again);
    return () => removeEventListener("online", again);
  }, [status.on]);
  /** A set with several Parts opens on its Part list; one with a single Part goes straight to the test. */
  function open(s: TestSet) {
    if (partsOf(s).length >= 2) setHome(s.id);
    else setRunning({ id: s.id, scope: null });
  }
  async function openRemote(m: CloudMeta) {
    try {
      await downloadTestSet(m.id);
      const s = testSets.get().find((x) => x.id === m.id);
      if (s) open(s);
      else setRunning({ id: m.id, scope: null });
    } catch {
      toast("Không tải được bộ đề. Kiểm tra mạng rồi thử lại.");
    }
  }
  const current = sets.find((s) => s.id === running?.id);
  if (current && running) return <Runner key={`${running.id}:${running.scope}`} set={current} scope={running.scope} deck={deck} deckPicker={deckPicker} onPassage={onPassage} onExit={() => setRunning(null)} />;
  const homeSet = sets.find((s) => s.id === home);
  if (homeSet) return <SetHome set={homeSet} onBack={() => setHome(null)} onRun={(scope) => setRunning({ id: homeSet.id, scope })} />;
  return (
    <div class="col">
      <PdfImport onSaved={(s) => toast(`Đã lưu bộ đề “${s.name}”`)} />
      <section class="panel col" data-testid="sets">
        <div class="panel-head">
          <h2>Bộ đề của bạn</h2>
          {status.on
            ? <span class="pill ok" data-testid="sets-cloud" title="Nằm trong tài khoản của bạn, chỉ bạn đọc được. Không có trong file Xuất JSON">Đồng bộ · mọi thiết bị của bạn</span>
            : <span class="pill" title="Không đồng bộ lên cloud, không có trong file Xuất JSON">Riêng tư · chỉ trên máy này</span>}
        </div>
        {(status.busy || status.error) && <p class={`small ${status.error && !status.busy ? "warn-text" : "muted"}`} data-testid="sets-status" role="status">{status.busy || status.error}</p>}
        {ready && !sets.length && !remote.length && <p class="muted small" data-testid="sets-empty">Chưa có bộ đề nào. Nhập một file PDF đề Reading hoặc Listening ở trên để làm bài ngay trong Lexi.</p>}
        <ul class="sets">
          {sets.map((s) => <SetRow key={s.id} set={s} cloud={status.on} onOpen={() => open(s)} />)}
          {remote.map((m) => <RemoteRow key={m.id} meta={m} busy={!!status.busy} onOpen={() => void openRemote(m)} />)}
        </ul>
        <p class="muted small">
          {status.on
            ? "Nội dung đề là bản sao để bạn tự học: lưu trong tài khoản của bạn (chỉ bạn đọc được) và trên các máy đã mở nó. Kết quả bài và thẻ tạo từ câu sai đồng bộ như mọi thẻ khác."
            : "Nội dung đề là bản sao để bạn tự học: chỉ nằm trong trình duyệt này. Kết quả bài và thẻ tạo từ câu sai thì đồng bộ như mọi thẻ khác."}
        </p>
      </section>
    </div>
  );
}

/** The Parts of a set: one row each (not started, in progress, submitted with its score), and the whole set as before. */
function SetHome({ set, onBack, onRun }: { set: TestSet; onBack(): void; onRun(scope: Scope): void }) {
  const states = partStates(set);
  const full = set.attempt;
  const fullGraded = full?.finishedAt ? grade(set, full.answers) : null;
  return (
    <div class="col" data-testid="set-home">
      <div class="runner-bar panel row between">
        <button type="button" class="btn ghost sm" onClick={onBack} data-testid="home-back"><Icon n="arrow" size={16} /> Bộ đề</button>
        <b class="grow name">{set.name}</b>
        <span class="pill">{set.questions.length} câu</span>
      </div>
      <section class="panel col">
        <div class="row between">
          <h2>Làm theo Part</h2>
          <span class="muted small">khi rảnh, không cần làm hết một lần</span>
        </div>
        <ul class="part-list">
          {states.map((p) => {
            const pct = p.state === "done" ? 100 : Math.round((p.answered / Math.max(1, p.total)) * 100);
            const a = set.parts?.[String(p.part)];
            return (
              <li key={p.part} class="part-row" data-testid={`home-part-${p.part}`} data-state={p.state}>
                <b class="part-no">Part {p.part}</b>
                <div class="grow col" style={{ gap: "4px", minWidth: 0 }}>
                  <span class="small">
                    {p.state === "done" ? <b>Đã nộp · {p.score ? `${p.score.right}/${p.score.total}` : "chưa có đáp án"}</b> : p.state === "doing" ? <b>Đang làm · {p.answered}/{p.total}</b> : <span>Chưa làm · {p.total} câu</span>}
                    {a && a.elapsedMs > 0 && <span class="muted"> · {clock(a.elapsedMs)}</span>}
                  </span>
                  <div class="meter"><i style={{ width: `${pct}%` }} /></div>
                </div>
                <button type="button" class={`btn sm${p.state === "done" ? "" : " primary"}`} onClick={() => onRun(p.part)} data-testid={`home-run-${p.part}`}>{p.state === "done" ? "Xem" : p.state === "doing" ? "Tiếp" : "Bắt đầu"}</button>
              </li>
            );
          })}
        </ul>
      </section>
      <section class="panel row between" style={{ gap: "10px" }}>
        <div class="col" style={{ gap: "2px" }}>
          <b>Cả bộ</b>
          <span class="muted small">{fullGraded ? `Đã nộp · ${fullGraded.right}/${fullGraded.total}` : full ? `Đang làm · ${Object.keys(full.answers).length}/${set.questions.length} câu` : "Làm liền mọi Part, một đồng hồ"}</span>
        </div>
        <button type="button" class="btn sm" onClick={() => onRun(null)} data-testid="home-full">{fullGraded ? "Xem kết quả" : full ? "Làm tiếp" : "Làm cả bộ"}</button>
      </section>
    </div>
  );
}

async function confirmRemove(name: string, lc: boolean, everywhere: boolean): Promise<boolean> {
  const where = everywhere ? "khỏi tài khoản và mọi thiết bị" : "khỏi máy này";
  return confirmDialog({ title: "Xoá bộ đề?", message: `“${name}”${lc ? ", file nghe" : ""} và bài làm dở sẽ bị xoá ${where}. Kết quả đã lưu và thẻ đã tạo vẫn giữ nguyên.`, confirm: "Xoá", danger: true });
}

function SetRow({ set, cloud, onOpen }: { set: TestSet; cloud: boolean; onOpen(): void }) {
  const sum = summary(set);
  const a = set.attempt;
  const g = a?.finishedAt ? grade(set, a.answers) : null;
  const multi = partsOf(set).length >= 2;
  const states = partStates(set);
  const doneParts = states.filter((p) => p.state === "done").length;
  const doingParts = states.filter((p) => p.state === "doing").length;
  async function remove() {
    if (await confirmRemove(set.name, !!set.tracks?.length, cloud && !!set.syncedAt)) await deleteTestSet(set.id);
  }
  return (
    <li class="set" data-testid="set-row">
      <div class="grow col" style={{ gap: "6px" }}>
        <b class="name">{set.name}</b>
        <div class="chips">
          {set.section === "lc" && <span class="pill ok" data-testid="set-lc">Listening{set.tracks?.length ? ` · ${set.tracks.length} file nghe` : ""}</span>}
          {[...LC_PARTS, ...PARTS].map((p) => sum.byPart[p.key] > 0 && <span class="pill" key={p.key}>{p.label}: {sum.byPart[p.key]}</span>)}
          {sum.byPart.other > 0 && <span class="pill">Khác: {sum.byPart.other}</span>}
          {g ? <span class="pill ok" data-testid="set-score">Đã làm: {g.right}/{g.total}</span> : a ? <span class="pill warn">Đang làm · {Object.keys(a.answers).length}/{sum.total} câu</span> : null}
          {multi && doneParts > 0 && <span class="pill ok" data-testid="set-parts-done">Đã nộp {doneParts}/{states.length} Part</span>}
          {multi && doingParts > 0 && <span class="pill warn">{doingParts} Part đang làm</span>}
          {cloud && !set.syncedAt && <span class="pill warn" data-testid="set-unsynced" title="Sẽ được đưa lên tài khoản khi có mạng">Chưa đồng bộ</span>}
        </div>
      </div>
      <div class="row" style={{ gap: "8px" }}>
        <button type="button" class="btn primary sm" onClick={onOpen} data-testid="set-open">{multi ? "Mở" : g ? "Xem kết quả" : a ? "Làm tiếp" : "Làm bài"}</button>
        <button type="button" class="icon-btn" aria-label={`Xoá ${set.name}`} onClick={() => void remove()} data-testid="set-delete"><Icon n="trash" size={18} /></button>
      </div>
    </li>
  );
}

/** A set in the account that this device has not downloaded yet. */
function RemoteRow({ meta, busy, onOpen }: { meta: CloudMeta; busy: boolean; onOpen(): void }) {
  async function remove() {
    if (await confirmRemove(meta.name, meta.section === "lc", true)) await deleteTestSet(meta.id);
  }
  return (
    <li class="set" data-testid="set-remote">
      <div class="grow col" style={{ gap: "6px" }}>
        <b class="name">{meta.name}</b>
        <div class="chips">
          {meta.section === "lc" && <span class="pill ok">Listening</span>}
          <span class="pill">{meta.questions} câu</span>
          <span class="pill" data-testid="set-remote-size">Trên tài khoản · {mb(meta.bytes)}</span>
        </div>
      </div>
      <div class="row" style={{ gap: "8px" }}>
        <button type="button" class="btn primary sm" disabled={busy} onClick={onOpen} data-testid="set-download">Tải về và mở</button>
        <button type="button" class="icon-btn" aria-label={`Xoá ${meta.name}`} onClick={() => void remove()} data-testid="set-remote-delete"><Icon n="trash" size={18} /></button>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ import

interface Picked {
  fileName: string;
  doc: PdfDoc;
  pages: PdfPage[];
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
  const [range, setRange] = useState("");
  // Listening: the parts printed with nothing but their numbers, the pages kept as photos, and the audio files.
  const [section, setSection] = useState<"rc" | "lc">("rc");
  const [p1, setP1] = useState(`${LC_LAYOUT.p1![0]}-${LC_LAYOUT.p1![1]}`);
  const [p2, setP2] = useState(`${LC_LAYOUT.p2![0]}-${LC_LAYOUT.p2![1]}`);
  const [photoRange, setPhotoRange] = useState("");
  /** The learner typed the photo pages: Lexi's own guess no longer fills them in. */
  const [photosTyped, setPhotosTyped] = useState(false);
  const [photoThumbs, setPhotoThumbs] = useState<Record<string, string>>({});
  const [audio, setAudio] = useState<File[]>([]);
  const audioInput = useRef<HTMLInputElement>(null);
  /** Extra turn for scans fed into the copier upside down: 0 or 180. */
  const [turn, setTurn] = useState(0);
  const [thumb, setThumb] = useState<{ n: number; turn: number; src: string } | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ set: Pick<TestSet, "passages" | "questions">; failed: number[]; stopped: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const available = !!hook() || (firebaseConfigured && p.aiEnabled);

  // Only the chosen pages are read, and the answer key is looked for among them: a book's key at the back numbers
  // every unit from 1 again, so the learner includes the key page that belongs to the pages chosen.
  const chosen = useMemo(() => (picked ? parsePageRange(range, picked.pages.length) : null), [picked, range]);
  const pages = useMemo(() => (picked && chosen ? chosen.map((n) => picked.pages[n - 1]) : []), [picked, chosen]);
  const found = useMemo(() => findKey(pages), [pages]);
  const key = useMemo(() => {
    const k = new Map(found.key);
    for (const [n, l] of keyPairs(pastedKey)) k.set(n, l);
    return k;
  }, [found, pastedKey]);
  const layout: LcLayout | null = useMemo(() => {
    const a = parseNumberRange(p1);
    const b = parseNumberRange(p2);
    return a === undefined || b === undefined ? null : { p1: a, p2: b };
  }, [p1, p2]);
  const photos = useMemo(() => (picked && photoRange.trim() ? parsePageRange(photoRange, picked.pages.length) : []), [picked, photoRange]);
  // Part 1 is answered by looking at its photos: without their pages the test cannot be taken, so they are asked for.
  const needPhotos = section === "lc" && !!layout?.p1 && photos !== null && photos.length === 0;
  const detected = useMemo(() => (picked ? findPhotoPages(picked.pages) : []), [picked]);
  useEffect(() => {
    if (section === "lc" && !photosTyped && detected.length) setPhotoRange(formatPages(detected));
  }, [section, detected, photosTyped]);
  const lcReady = section === "rc" || (!!layout && photos !== null && !needPhotos);
  // Photo pages are kept as pictures, not read: a Part 1 page has nothing but photos and numbers on it.
  const chunks: Chunk[] = useMemo(
    () => chunkPages(pages, new Set([...found.keyPages, ...(section === "lc" ? photos ?? [] : [])])),
    [pages, found, section, photos],
  );
  const cost = chunks.reduce((a, c) => a + COST[c.kind], 0);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError("");
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) return setError("Chọn một file PDF.");
    if (f.size > MAX_PDF_BYTES) return setError("File lớn quá 150 MB. Tách file thành vài phần rồi thử lại.");
    setLoading("Đang mở PDF…");
    try {
      const doc = await openPdf(new Uint8Array(await f.arrayBuffer()));
      const pages = await readPages(doc, (n) => setLoading(`Đang đọc trang ${n}/${doc.numPages}…`));
      picked?.doc.close().catch(() => undefined);
      setPicked({ fileName: f.name, doc, pages });
      setRange("");
      setTurn(0);
      setThumb(null);
      setPhotoRange("");
      setPhotosTyped(false);
      setPhotoThumbs({});
      setName(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 60) || "Bộ đề");
      setDraft(null);
    } catch {
      setError("Không mở được file này. File có thể bị khoá mật khẩu hoặc hỏng.");
    } finally {
      setLoading("");
    }
  }

  async function read() {
    if (!picked || progress || !lcReady) return;
    // Listening with only Part 1–2 chosen: nothing for the AI, the questions come from their numbers.
    if (!chunks.length && section === "lc") {
      const set = mergeExtracted([], key, layout!);
      if (!set.questions.length) return setError("Chưa có câu nào: điền khoảng số câu Part 1–2 hoặc chọn trang Part 3–4.");
      return setDraft({ set, failed: [], stopped: "" });
    }
    if (!chunks.length) return;
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
          : { images: await Promise.all(c.pages.map((n) => renderPage(picked.doc, n, { turn }))), text: keyNote(key, "all").trim() };
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
    const set = mergeExtracted(results, key, section === "lc" ? layout! : undefined);
    if (!set.questions.length) setError(stopped || "Không thấy câu hỏi nào trong file này.");
    else setDraft({ set, failed: [...new Set(failed)].sort((a, b) => a - b), stopped });
  }

  function setAnswer(i: number, l: Letter) {
    setDraft((d) => d && { ...d, set: { ...d.set, questions: d.set.questions.map((q) => (q.i === i ? { ...q, correct: l } : q)) } });
  }

  async function save() {
    if (!picked || !draft || saving) return;
    const now = Date.now();
    const id = crypto.randomUUID();
    let lc: Pick<TestSet, "section" | "tracks" | "pictures"> & { questions?: SetQuestion[] } = {};
    setSaving(true);
    try {
      if (section === "lc") {
        const tracks: SetTrack[] = audio.map((f, i) => ({ key: `${id}:a${i}`, name: f.name.slice(0, 120), bytes: f.size }));
        const pictures = await Promise.all((photos ?? []).map(async (n) => {
          const r = await renderPage(picked.doc, n, { turn });
          // Decoded here, not with fetch(data:): the site's CSP connect-src has no data:.
          // The Part 1 numbers printed on the page place it above its own questions in the test.
          const numbers = photoNumbers(picked.pages[n - 1]?.text ?? "", layout?.p1 ?? null);
          return { part: 1 as const, page: n, key: `${id}:p${n}`, ...(numbers.length ? { numbers } : {}), blob: new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: r.mime }) };
        }));
        await saveMedia([...audio.map((f, i) => ({ key: tracks[i].key, blob: f as Blob })), ...pictures.map((p) => ({ key: p.key, blob: p.blob }))]);
        // As many files as questions (a book with one file per question): each question plays its own.
        const perQuestion = tracks.length > 1 && tracks.length === draft.set.questions.length;
        lc = {
          section: "lc",
          tracks,
          pictures: pictures.map(({ blob: _, ...p }) => p),
          ...(perQuestion ? { questions: draft.set.questions.map((q, i) => ({ ...q, track: i })) } : {}),
        };
      }
      const set: TestSet = {
        id,
        name: name.trim().slice(0, 60) || "Bộ đề",
        createdAt: now,
        updatedAt: now,
        source: { fileName: picked.fileName.slice(0, 120), pages: pages.length, ...(range.trim() && chosen ? { range: formatPages(chosen) } : {}) },
        ...draft.set,
        ...lc,
      };
      await saveTestSet(set);
      onSaved(set);
      reset();
    } catch (e) {
      console.warn("save test set", e);
      setError("Không lưu được: bộ nhớ của trình duyệt có thể đã đầy. Thử bớt file nghe hoặc trang ảnh.");
    } finally {
      setSaving(false);
    }
  }

  function pickAudio(list: FileList | null | undefined) {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|aac)$/i.test(f.name));
    setAudio(sortTracks(files));
  }

  function reset() {
    picked?.doc.close().catch(() => undefined);
    setPicked(null);
    setDraft(null);
    setPastedKey("");
    setRange("");
    setTurn(0);
    setThumb(null);
    setSection("rc");
    setPhotoRange("");
    setPhotosTyped(false);
    setPhotoThumbs({});
    setAudio([]);
    setError("");
    setOpen(false);
  }

  const scanned = pages.filter((x) => x.scanned).length;
  const firstScan = pages.find((x) => x.scanned)?.n ?? null;

  // The first scanned page of the choice, small, the way the AI will see it: upside down shows at a glance.
  useEffect(() => {
    if (!picked || firstScan === null || draft) return;
    let live = true;
    renderPage(picked.doc, firstScan, { turn, px: 420, quality: 0.7 })
      .then((r) => live && setThumb({ n: firstScan, turn, src: `data:${r.mime};base64,${r.data}` }))
      .catch(() => live && setThumb(null));
    return () => void (live = false);
  }, [picked, firstScan, turn, draft]);
  // The photo pages, small, as they will show in the test: the learner sees at once whether they are the right ones.
  const shownPhotos = section === "lc" && photos ? photos.slice(0, PHOTO_THUMBS) : [];
  useEffect(() => {
    if (!picked || draft) return;
    let live = true;
    void (async () => {
      for (const n of shownPhotos) {
        const k = `${n}:${turn}`;
        if (photoThumbs[k] || !live) continue;
        try {
          const r = await renderPage(picked.doc, n, { turn, px: 360, quality: 0.7 });
          if (live) setPhotoThumbs((x) => ({ ...x, [k]: `data:${r.mime};base64,${r.data}` }));
        } catch {
          /* the page shows its number only */
        }
      }
    })();
    return () => void (live = false);
  }, [picked, shownPhotos.join(","), turn, draft]);
  const whole = !!picked && pages.length === picked.pages.length;
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
            <span class="pill" data-testid="pdf-pages">{whole ? `${picked.pages.length} trang` : `${pages.length}/${picked.pages.length} trang`}</span>
            {scanned > 0 && <span class="pill warn" data-testid="pdf-scanned">{scanned} trang scan: AI đọc từ ảnh</span>}
            {found.key.size > 0
              ? <span class="pill ok" data-testid="pdf-key">Bảng đáp án: {found.key.size} câu (trang {found.keyPages.join(", ")})</span>
              : <span class="pill warn" data-testid="pdf-nokey">{whole ? "Không thấy bảng đáp án trong file" : "Không thấy bảng đáp án trong các trang đã chọn"}</span>}
          </div>
          <div class="seg" role="radiogroup" aria-label="Loại đề" data-testid="set-section">
            {(["rc", "lc"] as const).map((x) => (
              <label key={x} class={`opt${section === x ? " on" : ""}`}>
                <input type="radio" name="set-section" checked={section === x} onChange={() => setSection(x)} data-testid={`set-section-${x}`} />
                {x === "rc" ? "Reading (Part 5–7)" : "Listening (Part 1–4)"}
              </label>
            ))}
          </div>
          <div class="field">
            <label for="set-range">Trang cần đọc {picked.pages.length > 12 ? "(nên chọn: một bài hoặc một đề, kèm trang đáp án)" : "(để trống = cả file)"}</label>
            <input id="set-range" class="input" value={range} placeholder={`vd: 45-60, ${Math.max(1, picked.pages.length - 2)}-${picked.pages.length}`} onInput={(e) => setRange(e.currentTarget.value)} data-testid="set-range" />
            {!chosen && <span class="pill bad wrap" role="alert" data-testid="set-range-bad">Trang không hợp lệ: file có {picked.pages.length} trang, viết như “45-60, 290”.</span>}
          </div>
          {firstScan !== null && (
            <div class="scan-check" data-testid="pdf-thumb">
              {thumb && thumb.n === firstScan && thumb.turn === turn
                ? <img src={thumb.src} alt={`Trang ${firstScan} như AI sẽ đọc`} data-testid="pdf-thumb-img" data-turn={turn} />
                : <div class="scan-ph muted small">Đang dựng trang {firstScan}…</div>}
              <div class="col" style={{ gap: "8px" }}>
                <span class="small">Trang {firstScan} như AI sẽ đọc. Chữ bị ngược thì xoay lại cho đúng chiều.</span>
                <button type="button" class="btn ghost sm" aria-pressed={turn === 180} onClick={() => setTurn(turn ? 0 : 180)} data-testid="pdf-turn"><Icon n="undo" size={16} /> {turn ? "Đã xoay 180°: bỏ xoay" : "Xoay 180°"}</button>
              </div>
            </div>
          )}
          {section === "lc" && (
            <div class="col lc-setup" data-testid="lc-setup">
              <p class="muted small">Part 1–2 chỉ in số câu: Lexi tạo sẵn các câu này, AI chỉ đọc trang Part 3–4. Ở “Trang cần đọc” nên chọn trang Part 3–4 và trang đáp án.</p>
              <p class="muted small" data-testid="lc-parts-help">Part 1: mỗi câu một ảnh, nghe 4 câu mô tả (A–D), nên cần trang ảnh bên dưới. Part 2: không có ảnh, không in câu hỏi, chỉ nghe một câu hỏi và 3 câu đáp (A–C).</p>
              <div class="row lc-ranges">
                <div class="field">
                  <label for="lc-p1">Part 1: câu</label>
                  <input id="lc-p1" class="input" value={p1} placeholder="để trống nếu không có" onInput={(e) => setP1(e.currentTarget.value)} data-testid="lc-p1" />
                </div>
                <div class="field">
                  <label for="lc-p2">Part 2: câu</label>
                  <input id="lc-p2" class="input" value={p2} placeholder="để trống nếu không có" onInput={(e) => setP2(e.currentTarget.value)} data-testid="lc-p2" />
                </div>
              </div>
              {!layout && <span class="pill bad wrap" role="alert" data-testid="lc-layout-bad">Khoảng số câu viết như “1-6”, hoặc để trống.</span>}
              <div class="field">
                <label for="lc-photos">Trang ảnh Part 1 (số trang trong file PDF, giữ nguyên ảnh để xem khi làm bài)</label>
                <input id="lc-photos" class="input" value={photoRange} placeholder="vd: 3-4" onInput={(e) => { setPhotosTyped(true); setPhotoRange(e.currentTarget.value); }} data-testid="lc-photos" />
                {photos === null && <span class="pill bad wrap" role="alert">Trang không hợp lệ: file có {picked.pages.length} trang.</span>}
                {needPhotos && <span class="pill bad wrap" role="alert" data-testid="lc-photos-need">Part 1 cần trang ảnh: ghi số trang có ảnh (vd 3-4). Đề không có Part 1 thì xoá ô “Part 1: câu”.</span>}
                {!photosTyped && detected.length > 0 && photoRange === formatPages(detected) && <span class="pill ok wrap" data-testid="lc-photos-found">Lexi thấy ảnh Part 1 ở trang {formatPages(detected)}. Xem ảnh dưới đây, sai thì sửa lại.</span>}
                {shownPhotos.length > 0 && (
                  <div class="photo-thumbs" data-testid="lc-photo-thumbs">
                    {shownPhotos.map((n) => (photoThumbs[`${n}:${turn}`]
                      ? <figure key={n}><img src={photoThumbs[`${n}:${turn}`]} alt={`Trang ${n}`} data-testid="lc-photo-thumb" /><figcaption class="muted small">Trang {n}</figcaption></figure>
                      : <div key={n} class="scan-ph muted small">Trang {n}…</div>))}
                  </div>
                )}
              </div>
              <div class="field">
                <span class="lbl">File nghe</span>
                <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
                  <button type="button" class="btn sm" onClick={() => audioInput.current?.click()} data-testid="lc-audio-pick"><Icon n="plus" size={16} /> {audio.length ? "Chọn lại file nghe" : "Chọn file mp3"}</button>
                  {audio.length > 0 && <span class="pill" data-testid="lc-audio-count">{audio.length} file · {mb(audio.reduce((a, f) => a + f.size, 0))}</span>}
                </div>
                <input ref={audioInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" multiple hidden onChange={(e) => { pickAudio(e.currentTarget.files); e.currentTarget.value = ""; }} data-testid="lc-audio" />
                {audio.length > 0 && <ol class="tracks small muted" data-testid="lc-audio-list">{audio.slice(0, 8).map((f) => <li key={f.name}>{f.name}</li>)}{audio.length > 8 && <li>… {audio.length - 8} file nữa</li>}</ol>}
                <span class="muted small">Phát theo thứ tự số trong tên file. Số file bằng số câu thì mỗi câu có file nghe riêng.</span>
              </div>
            </div>
          )}
          <div class="field">
            <label for="set-name">Tên bộ đề</label>
            <input id="set-name" class="input" maxLength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} data-testid="set-name" />
          </div>
          <div class="field">
            <label for="set-key">Dán bảng đáp án {found.key.size ? "(bổ sung, không bắt buộc)" : "(nên có để chấm điểm)"}</label>
            <textarea id="set-key" class="textarea" rows={2} value={pastedKey} placeholder="vd: 101 A 102 C 103 B …" onInput={(e) => setPastedKey(e.currentTarget.value)} data-testid="set-key" />
            {pastedKey.trim() && <span class="muted small" data-testid="set-key-count">Đọc được {keyPairs(pastedKey).size} đáp án</span>}
          </div>
          {cost > DAILY_QUOTA && <p class="pill warn wrap" data-testid="pdf-over-quota">Chừng này trang cần ≈ {cost} lượt AI, quá hạn mức {DAILY_QUOTA} lượt/ngày: chọn ít trang hơn (vd một bài), phần còn lại nhập ngày sau.</p>}
          {!available && <p class="muted small" data-testid="pdf-off">Cần đăng nhập Google và bật “Điền bằng AI” trong Cài đặt để AI tách câu hỏi.</p>}
          {progress ? (
            <div class="col" style={{ gap: "6px" }} data-testid="pdf-progress">
              <span class="muted small">Đang đọc phần {Math.min(progress.done + 1, progress.total)}/{progress.total}…</span>
              <div class="progress"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
            </div>
          ) : (
            <div class="row">
              {section === "lc" && !chunks.length
                ? <button type="button" class="btn primary" disabled={!lcReady} onClick={() => void read()} data-testid="pdf-read"><Icon n="check" /> Tạo câu Part 1–2 (không cần AI)</button>
                : <button type="button" class="btn primary" disabled={!available || !chunks.length || cost > DAILY_QUOTA || !lcReady} onClick={() => void read()} data-testid="pdf-read"><Icon n="sparkle" /> Tách câu hỏi ({chunks.length} phần, ≈ {cost} lượt AI)</button>}
              <button type="button" class="btn ghost" onClick={reset}>Huỷ</button>
            </div>
          )}
        </div>
      )}

      {draft && sum && (
        <div class="col" data-testid="pdf-preview">
          <div class="chips">
            <span class="pill ok" data-testid="pdf-total">{sum.total} câu</span>
            {[...LC_PARTS, ...PARTS].map((x) => sum.byPart[x.key] > 0 && <span class="pill" key={x.key} data-testid={`pdf-total-${x.key}`}>{x.label}: {sum.byPart[x.key]}</span>)}
            {draft.set.passages.length > 0 && <span class="pill">{draft.set.passages.length} đoạn đọc</span>}
            {section === "lc" && <span class="pill" data-testid="pdf-audio">{audio.length ? `${audio.length} file nghe${audio.length > 1 && audio.length === sum.total ? ", mỗi câu một file" : ""}` : "Chưa có file nghe"}</span>}
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
                      <input type="radio" name={`fix-${q.i}`} checked={q.correct === l} disabled={!lettersOf(q).includes(l)} onChange={() => setAnswer(q.i, l)} />
                      <b>{l}</b> <span lang="en">{q.options[l] || (q.kind === "listen" ? "" : "—")}</span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div class="row">
            <button type="button" class="btn primary" disabled={saving} onClick={() => void save()} data-testid="pdf-save"><Icon n="check" /> {saving ? "Đang lưu…" : "Lưu bộ đề"}</button>
            <button type="button" class="btn ghost" onClick={reset}>Bỏ</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ taking the test

interface Player {
  /** The track playing or paused on, null before the first play. */
  track: number | null;
  playing: boolean;
  at: number;
  duration: number;
  play(track: number, chain?: boolean): Promise<void>;
  /** Plays one stretch of a file (ms), then stops: a question heard again. */
  playRange(track: number, from: number, to: number): Promise<void>;
  toggle(): void;
  pause(): void;
}

/**
 * One audio element for the set. `chain` plays the next file when one ends (a test whose Part is split over files);
 * a file is read from the device store once and kept as an object URL while the test is open.
 */
function usePlayer(set: TestSet): Player | null {
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<number, string>());
  const chain = useRef(false);
  const stopAt = useRef<number | null>(null);
  const [state, setState] = useState({ track: null as number | null, playing: false, at: 0, duration: 0 });
  const tracks = set.tracks ?? [];

  useEffect(() => {
    const a = new Audio();
    a.preload = "auto";
    audio.current = a;
    const sync = () => setState((s) => ({ ...s, playing: !a.paused, at: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0 }));
    for (const ev of ["play", "pause", "timeupdate", "loadedmetadata"]) a.addEventListener(ev, sync);
    a.addEventListener("timeupdate", () => {
      if (stopAt.current !== null && a.currentTime * 1000 >= stopAt.current) {
        stopAt.current = null;
        a.pause();
      }
    });
    a.addEventListener("ended", () => {
      const i = Number(a.dataset.track);
      if (chain.current && i + 1 < tracks.length) void play(i + 1, true);
      else sync();
    });
    const onHide = () => document.visibilityState === "hidden" && a.pause();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      a.pause();
      document.removeEventListener("visibilitychange", onHide);
      for (const u of urls.current.values()) URL.revokeObjectURL(u);
      urls.current.clear();
    };
  }, [set.id]);

  async function play(track: number, keepGoing = false, from?: number, to?: number) {
    const a = audio.current;
    const t = tracks[track];
    if (!a || !t) return;
    chain.current = keepGoing;
    stopAt.current = to ?? null;
    let url = urls.current.get(track);
    if (!url) {
      const blob = await loadMedia(t.key);
      if (!blob) return toast(`Không thấy file nghe “${t.name}” trên máy này`);
      url = URL.createObjectURL(blob);
      urls.current.set(track, url);
    }
    if (a.dataset.track !== String(track)) {
      a.src = url;
      a.dataset.track = String(track);
    } else if (a.ended) a.currentTime = 0;
    if (from !== undefined) {
      if (a.readyState < 1) await new Promise((r) => a.addEventListener("loadedmetadata", r, { once: true }));
      a.currentTime = from / 1000;
    }
    setState((s) => ({ ...s, track }));
    await a.play().catch(() => toast("Trình duyệt chặn phát âm thanh: bấm phát lại"));
  }

  if (!tracks.length) return null;
  return {
    ...state,
    play: (track, keepGoing) => play(track, keepGoing),
    playRange: (track, from, to) => play(track, false, from, to),
    toggle: () => {
      const a = audio.current;
      if (!a) return;
      if (state.track === null) void play(0, true);
      else if (a.paused) void a.play();
      else a.pause();
    },
    pause: () => audio.current?.pause(),
  };
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** The test's audio played straight through, as in the exam room: play and pause, no seeking. */
function ListenBar({ set, player }: { set: TestSet; player: Player }) {
  const n = set.tracks!.length;
  return (
    <div class="listen-bar row" data-testid="listen-bar">
      <button type="button" class="btn primary sm" onClick={player.toggle} aria-label={player.playing ? "Tạm dừng" : "Phát"} data-testid="listen-toggle">
        <Icon n={player.playing ? "pause" : "play"} size={16} /> {player.playing ? "Tạm dừng" : player.track === null ? "Bắt đầu nghe" : "Nghe tiếp"}
      </button>
      <span class="muted small" data-testid="listen-pos">
        {player.track === null ? `${n} file nghe` : `File ${player.track + 1}/${n} · ${mmss(player.at)} / ${mmss(player.duration)}`}
      </span>
    </div>
  );
}

/** What a Part 1–2 question asks of the learner, said where the part starts (nothing of it is printed in the test). */
function PartHelp({ set, part }: { set: TestSet; part: number | null }) {
  if (part === 1) {
    const photos = (set.pictures ?? []).some((p) => p.part === 1);
    return (
      <>
        <p class="muted small part-help" data-testid="part-help-1">Mỗi câu một ảnh: nhìn ảnh, nghe 4 câu mô tả (A–D), chọn câu đúng với ảnh nhất.</p>
        {!photos && <p class="pill warn wrap" role="note" data-testid="part1-no-photos">Bộ đề này lưu khi chưa có trang ảnh Part 1 nên không có ảnh. Nhập lại file PDF và điền “Trang ảnh Part 1” để có ảnh.</p>}
      </>
    );
  }
  if (part === 2) return <p class="muted small part-help" data-testid="part-help-2">Part 2 không có ảnh và không in câu hỏi: nghe một câu hỏi rồi 3 câu đáp (A–C), chọn câu đáp hợp nhất.</p>;
  return null;
}

/** Part 1 photos (pages kept as pictures at import), read from the device store as data URLs (CSP img-src data:). */
function Pictures({ set, part, keys }: { set: TestSet; part: number; keys?: readonly string[] }) {
  const list = (set.pictures ?? []).filter((p) => p.part === part && (!keys || keys.includes(p.key)));
  const [srcs, setSrcs] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    for (const p of list) {
      void loadMedia(p.key).then((b) => {
        if (!b || !live) return;
        const r = new FileReader();
        r.onload = () => live && setSrcs((x) => ({ ...x, [p.key]: String(r.result) }));
        r.readAsDataURL(b);
      });
    }
    return () => void (live = false);
  }, [set.id, part, keys?.join(",")]);
  if (!list.length) return null;
  return (
    <div class="pictures" data-testid="runner-pictures">
      {list.map((p) => (srcs[p.key]
        ? <img key={p.key} src={srcs[p.key]} alt={`Trang ${p.page}`} loading="lazy" data-testid="runner-picture" />
        : <div key={p.key} class="scan-ph muted small">Trang {p.page}…</div>))}
    </div>
  );
}

function Runner({ set, scope, deck, deckPicker, onPassage, onExit }: { set: TestSet; scope: Scope; deck: DeckSink; deckPicker: ComponentChildren; onPassage(text: string): void; onExit(): void }) {
  // One Part on its own sees only its questions; its attempt is kept apart from the whole-set attempt.
  const view = useMemo(() => scopeView(set, scope), [set, scope]);
  const [attempt, setAttempt] = useState(() => attemptOf(set, scope) ?? { startedAt: Date.now(), elapsedMs: 0, answers: {} });
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
    // The stored set, not the one this render started with: another Part's attempt or the replay clips may have changed meanwhile.
    void saveTestSet(withAttempt(testSets.get().find((x) => x.id === set.id) ?? set, scope, a));
  }

  const choose = (q: SetQuestion, l: Letter) => persist({ ...attempt, answers: { ...attempt.answers, [q.i]: l } });
  const player = usePlayer(set);
  const perQuestion = view.questions.some((q) => q.track !== undefined);
  const answered = Object.keys(attempt.answers).length;

  async function submit() {
    const left = view.questions.length - answered;
    const ok = await confirmDialog({ title: "Nộp bài?", message: left ? `Còn ${left} câu chưa làm, sẽ tính là sai.` : "Lexi chấm ngay theo bảng đáp án.", confirm: "Nộp bài" });
    if (!ok) return;
    player?.pause();
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
        <b class="grow name" title={set.name} data-testid="runner-name">{scope === null ? set.name : `Part ${scope}`}</b>
        <span class="pill" data-testid="runner-clock">{clock(elapsed)}</span>
        {!finished && <span class="pill" data-testid="runner-count">{answered}/{view.questions.length}</span>}
        {!finished && <button type="button" class="btn primary sm" onClick={() => void submit()} data-testid="runner-submit">Nộp bài</button>}
      </div>
      {player && !perQuestion && <ListenBar set={set} player={player} />}
      {finished ? (
        <Result set={set} scope={scope} attempt={attempt} deck={deck} deckPicker={deckPicker} onPassage={onPassage} onAgain={() => void again()} onSaved={(id) => persist({ ...attempt, resultNoteId: id })} player={player} />
      ) : (
        <Questions set={view} answers={attempt.answers} onChoose={choose} player={player} />
      )}
    </div>
  );
}

/** The test in order: a part heading where the part changes, each passage once above its first question. */
function Questions({ set, answers, onChoose, review, player, onNudge, all }: {
  set: TestSet;
  answers: Record<number, Letter>;
  onChoose?(q: SetQuestion, l: Letter): void;
  review?: boolean;
  player?: Player | null;
  onNudge?(q: SetQuestion, ms: number): void;
  /** Every question of the set, when `set` shows only some (a Part 3 question replays from its group's first). */
  all?: readonly SetQuestion[];
}) {
  let lastPart: number | null | undefined;
  let lastPassage: number | null = null;
  // Part 1 photos above their own questions while taking the test; a review of some questions shows them all at the top.
  const photos1 = (set.pictures ?? []).filter((p) => p.part === 1);
  const part1 = set.questions.filter((q) => q.part === 1);
  const slots = !all && photos1.length && part1.length ? photoSlots(photos1, part1.map((q) => q.number)) : null;
  const photosAbove = (q: SetQuestion) => {
    const k = slots ? part1.indexOf(q) : -1;
    return k < 0 ? [] : photos1.filter((_, i) => slots![i] === k).map((p) => p.key);
  };
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
            {head !== undefined && q.kind === "listen" && !review && <PartHelp set={set} part={head} />}
            {head !== undefined && head !== null && head <= 4 && !(head === 1 && slots) && <Pictures set={set} part={head} />}
            {slots && photosAbove(q).length > 0 && <Pictures set={set} part={1} keys={photosAbove(q)} />}
            {showPassage && (
              <article class="panel passage" data-testid="runner-passage">
                {set.passages[q.passage!].label && <b class="muted small">{set.passages[q.passage!].label}</b>}
                <p lang="en">{reflow(set.passages[q.passage!].text)}</p>
              </article>
            )}
            <QuestionCard q={q} pick={answers[q.i]} onChoose={onChoose} review={review} player={player} replay={review ? replayOf(all ?? set.questions, q) : null} onNudge={onNudge} />
          </div>
        );
      })}
    </div>
  );
}

function QuestionCard({ q, pick, onChoose, review, player, replay, onNudge }: {
  q: SetQuestion;
  pick: Letter | undefined;
  onChoose?(q: SetQuestion, l: Letter): void;
  review?: boolean;
  player?: Player | null;
  /** In review: the stretch to hear again (a Part 3–4 question starts with its conversation). */
  replay?: { track: number; from: number; to: number } | null;
  onNudge?(q: SetQuestion, ms: number): void;
}) {
  const wrong = review && q.correct && pick !== q.correct;
  const letters = lettersOf(q);
  const own = player && q.track !== undefined;
  const mine = own && player.track === q.track;
  return (
    <section class={`panel col qcard${wrong ? " missed" : ""}${q.kind === "listen" ? " listen" : ""}`} data-testid="runner-q">
      <div class="row between" style={{ gap: "10px" }}>
        <p class="stem"><b>{q.number ?? q.i + 1}.</b> {q.stem ? <span lang="en">{q.stem}</span> : <span class="muted">Nghe và chọn đáp án</span>}</p>
        {own && (
          <button type="button" class="btn ghost sm" onClick={() => (mine && player.playing ? player.pause() : void player.play(q.track!))} data-testid="q-play">
            <Icon n={mine && player.playing ? "pause" : "play"} size={16} /> {mine && player.playing ? "Dừng" : "Nghe"}
          </button>
        )}
      </div>
      <div class={`opts${q.kind === "listen" ? " letters" : ""}`} role="radiogroup" aria-label={`Câu ${q.number ?? q.i + 1}`}>
        {letters.map((l) => {
          const cls = review ? (l === q.correct ? " right" : l === pick ? " bad" : "") : pick === l ? " on" : "";
          return (
            <label key={l} class={`opt${cls}`}>
              <input type="radio" name={`q-${q.i}`} checked={pick === l} disabled={review} onChange={() => onChoose?.(q, l)} />
              <b>{l}</b> {q.options[l] && <span lang="en">{q.options[l]}</span>}
            </label>
          );
        })}
      </div>
      {review && player && replay && q.track === undefined && (
        <div class="row replay" data-testid="q-replay">
          <button type="button" class="btn ghost sm" onClick={() => void player.playRange(replay.track, replay.from, replay.to)} data-testid="q-replay-play"><Icon n="play" size={16} /> Nghe lại câu {q.number ?? q.i + 1}</button>
          <span class="muted small" data-testid="q-replay-range">File {replay.track + 1} · {clipTime(replay.from)}–{clipTime(replay.to)}</span>
          {onNudge && (
            <span class="row nudge" role="group" aria-label="Chỉnh điểm bắt đầu">
              <button type="button" class="btn ghost sm" title="Bắt đầu sớm hơn 2 giây" onClick={() => onNudge(q, -2000)} data-testid="q-replay-earlier">−2s</button>
              <button type="button" class="btn ghost sm" title="Bắt đầu muộn hơn 2 giây" onClick={() => onNudge(q, 2000)} data-testid="q-replay-later">+2s</button>
            </span>
          )}
        </div>
      )}
      {review && !q.correct && <span class="pill">Chưa có đáp án, không chấm</span>}
      {review && wrong && !pick && <span class="pill bad">Bỏ trống</span>}
      {review && q.rule && <p class="muted small"><span class="ai-tag">AI</span> {q.rule}</p>}
    </section>
  );
}

/**
 * The stretch to replay for a question: its own clip; for Part 3–4, from the start of the first question of its group
 * of three (32–34, 35–37 …), where the conversation or talk is, to the end of its own.
 */
function replayOf(all: readonly SetQuestion[], q: SetQuestion): { track: number; from: number; to: number } | null {
  if (!q.clip) return null;
  if ((q.part === 3 || q.part === 4) && q.number !== null) {
    const first = q.number - ((q.number - 32) % 3);
    const head = all.find((x) => x.number === first && x.clip?.track === q.clip!.track);
    if (head?.clip && head.clip.from <= q.clip.from) return { ...q.clip, from: head.clip.from };
  }
  return q.clip;
}

/** Splits the set's long files into questions from their answer pauses and stores where each one is. */
async function splitAudio(set: TestSet): Promise<number> {
  const tracks = set.tracks ?? [];
  const levels = [];
  for (const t of tracks) {
    const blob = await loadMedia(t.key);
    if (!blob) throw new Error("missing audio");
    const { levels: l, durationMs } = await decodeLevels(blob);
    levels.push({ gaps: findGaps(l), durationMs });
  }
  const placed = placeQuestions(levels, set.questions.map((q) => q.part));
  const found = placed.filter(Boolean).length;
  if (found) await saveTestSet({ ...set, questions: set.questions.map((q, i) => (placed[i] ? { ...q, clip: placed[i]! } : q)) });
  return found;
}

function Result({ set, scope, attempt, deck, deckPicker, onPassage, onAgain, onSaved, player }: {
  set: TestSet;
  scope: Scope;
  player: Player | null;
  deckPicker: ComponentChildren;
  attempt: NonNullable<TestSet["attempt"]>;
  deck: DeckSink;
  onPassage(text: string): void;
  onAgain(): void;
  onSaved(noteId: string): void;
}) {
  const allNotes = useStore(notes);
  const view = useMemo(() => scopeView(set, scope), [set, scope]);
  const g = useMemo(() => grade(view, attempt.answers), [view, attempt]);
  const existing = useMemo(() => existingSentences(allNotes), [allNotes]);
  const [review, setReview] = useState<Review | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(true);
  const saved = !!attempt.resultNoteId && allNotes.some((n) => n.id === attempt.resultNoteId);

  async function saveResult() {
    const date = new Date(attempt.finishedAt ?? Date.now());
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const n = await addNote({ type: "test", fields: resultFields(scopeName(set.name, scope), iso || todayIso(), g, attempt.elapsedMs) });
    onSaved(n.id);
    toast("Đã lưu vào Kết quả bài");
  }

  function makeCards() {
    const w = wrongDrafts(view, g, existing);
    if (!w.drafts.length && !w.passages.length) return toast("Không có câu sai nào để tạo thẻ");
    setReview({ drafts: w.drafts, passages: w.passages, skipped: w.skipped });
  }

  const shown = onlyWrong ? { ...view, questions: view.questions.filter((q) => g.wrong.includes(q.i)) } : view;
  // Long files (a whole Part per file): found once on request, kept with the set.
  const splittable = !!set.tracks?.length && !set.questions.some((q) => q.track !== undefined);
  const split = set.questions.some((q) => q.clip);
  const [splitting, setSplitting] = useState(false);
  async function runSplit() {
    setSplitting(true);
    try {
      const n = await splitAudio(set);
      toast(n ? `Đã tách ${n}/${set.questions.length} câu trong file nghe` : "Không tách được: file nghe không có khoảng nghỉ rõ sau mỗi câu");
    } catch {
      toast("Không đọc được file nghe trên máy này");
    } finally {
      setSplitting(false);
    }
  }
  async function nudge(q: SetQuestion, ms: number) {
    if (!q.clip) return;
    const clip = { ...q.clip, from: Math.max(0, Math.min(q.clip.to - 500, q.clip.from + ms)) };
    await saveTestSet({ ...set, questions: set.questions.map((x) => (x.i === q.i ? { ...x, clip } : x)) });
  }

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
          {scope === null && g.lc && <span class="pill ok" data-testid="result-lc">LC: {formatScore(g.lc)}</span>}
          {LC_PARTS.map((p) => g.lcParts[p.key] && <span class="pill" key={p.key} data-testid={`result-${p.key}`}>{p.label}: {formatScore(g.lcParts[p.key]!)}</span>)}
          {PARTS.map((p) => g.parts[p.key] && <span class="pill" key={p.key} data-testid={`result-${p.key}`}>{p.label}: {formatScore(g.parts[p.key]!)}</span>)}
          {g.ungraded > 0 && <span class="pill">{g.ungraded} câu không chấm</span>}
        </div>
        <div class="row" style={{ flexWrap: "wrap", gap: "8px" }}>
          {canLogScope(scope) && <button type="button" class="btn primary" disabled={saved} onClick={() => void saveResult()} data-testid="result-save">{saved ? <><Icon n="check" /> Đã lưu vào Kết quả bài</> : "Lưu vào Kết quả bài"}</button>}
          <button type="button" class="btn" disabled={!g.wrong.length} onClick={makeCards} data-testid="result-cards"><Icon n="sparkle" /> Tạo thẻ từ {g.wrong.length} câu sai</button>
          <button type="button" class="btn ghost" onClick={onAgain} data-testid="result-again">Làm lại</button>
          {splittable && !split && (
            <button type="button" class="btn" disabled={splitting} onClick={() => void runSplit()} data-testid="result-split">
              <Icon n="speaker" /> {splitting ? "Đang dò từng câu…" : "Dò từng câu để nghe lại"}
            </button>
          )}
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
        <h3 class="part-head">{onlyWrong ? `Câu sai (${g.wrong.length})` : `Tất cả (${view.questions.length})`}</h3>
        <button type="button" class="btn ghost sm" onClick={() => setOnlyWrong(!onlyWrong)} data-testid="result-toggle">{onlyWrong ? "Xem cả bài" : "Chỉ câu sai"}</button>
      </div>
      <Questions set={shown} answers={attempt.answers} review player={player} all={set.questions} onNudge={(q, ms) => void nudge(q, ms)} />
    </div>
  );
}
