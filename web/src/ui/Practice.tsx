import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Note } from "@shared/model.ts";
import { GRAMMAR_TOPICS, findExact, list, str, template, wantedTemplates } from "@shared/notetypes.ts";
import { addNote, createDeck, removeNote, updateNote } from "../data/actions.ts";
import { callEnrich, firebaseConfigured } from "../data/firebase.ts";
import { cards, decks, notes, prefs } from "../data/state.ts";
import { dictionary, normalizeWord, viFor, POS_NAMES, type Lookup } from "../lib/dict.ts";
import { mergeEnrich, type Enriched } from "../lib/enrich.ts";
import { CAUSES, PARTS, PART_TARGET, RC_TARGET, completeSentence, formatScore, parseScore, testResults, testTag, wrongTotal, type CauseKey, type PartKey, type TestResult } from "../lib/practice.ts";
import { analyze, buildIndex, sentenceAround, type Tok } from "../lib/readcheck.ts";
import { useStore } from "../lib/store.ts";
import { Blocks } from "./Blocks.tsx";
import { Icon, confirmDialog, go, toast } from "./common.tsx";
import { ImportPanel } from "./ImportPanel.tsx";
import { TestSetsTab } from "./TestSets.tsx";

type Tab = "sets" | "result" | "words" | "grammar";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "sets", label: "Bộ đề" },
  { id: "words", label: "Từ lạ" },
  { id: "grammar", label: "Ngữ pháp" },
  { id: "result", label: "Kết quả bài" },
];

/** Where cards made on this screen go. The default is a deck of their own, so they do not land among unrelated words. */
export const PRACTICE_DECK = "Luyện đề TOEIC";

/** The deck choice: an existing deck (`id`), or a new one to create on first save (`newName`). */
export interface DeckTarget {
  id: string;
  newName: string | null;
}
export interface DeckSink {
  /** The id to save into, creating the deck first when a new one was named. Undefined means the app's default deck. */
  resolve(): Promise<string | undefined>;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Luyện đề: where a practice test turns into study. Log the result of a test, paste the passage of a question you
 * missed to see which words you lack (one tap makes a card), or turn a missed grammar question into a fill-in card.
 * Cards carry the test's tag, so "learn the words from this test" is one button on the Today screen.
 */
export function Practice({ initialTab }: { initialTab: string }) {
  const allNotes = useStore(notes);
  const tests = useMemo(() => testResults(allNotes), [allNotes]);
  const [tab, setTab] = useState<Tab>(initialTab === "result" || initialTab === "grammar" || initialTab === "words" || initialTab === "sets" ? initialTab : tests.length ? "words" : "result");
  // The test new cards are tagged with: the latest one unless the learner picks another.
  const [pick, setPick] = useState<string>("");
  const current = tests.find((t) => t.id === pick) ?? tests[tests.length - 1] ?? null;
  // The passage under analysis lives here so "Nhập nhanh" can hand one over and the tab keeps it while the learner moves around.
  const [passage, setPassage] = useState("");
  const allDecks = useStore(decks);
  const [picked, setPicked] = useState<DeckTarget | null>(null);
  const own = allDecks.find((d) => d.name === PRACTICE_DECK);
  const target: DeckTarget = picked && (picked.newName !== null || allDecks.some((d) => d.id === picked.id)) ? picked : own ? { id: own.id, newName: null } : { id: "", newName: PRACTICE_DECK };
  const sink: DeckSink = {
    async resolve() {
      if (target.newName === null) return target.id || undefined;
      const name = target.newName.trim();
      if (!name) return undefined;
      const d = await createDeck(name);
      setPicked({ id: d.id, newName: null });
      return d.id;
    },
  };

  return (
    <div class="page narrow practice" data-testid="practice">
      <div class="page-head">
        <button type="button" class="btn ghost sm" onClick={() => go("/today")}><Icon n="arrow" size={16} /> Hôm nay</button>
        <h1>Luyện đề</h1>
      </div>
      <p class="muted">Làm đề ngay trong Lexi (nhập file PDF ở “Bộ đề”), hoặc làm ở nơi bạn quen rồi mang câu sai về đây: mỗi câu sai thành một thẻ để Lexi nhắc lại đúng lúc.</p>

      <div class="row between">
        <div class="seg" role="tablist" aria-label="Luyện đề">
          {TABS.map((t) => (
            <button type="button" key={t.id} role="tab" aria-pressed={tab === t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>
          ))}
        </div>
        {tests.length > 0 && tab !== "result" && tab !== "sets" && (
          <label class="inline-pick">
            <span class="muted small">Câu sai thuộc bài</span>
            <select class="select" value={current?.id ?? ""} onChange={(e) => setPick(e.currentTarget.value)} data-testid="test-pick">
              {[...tests].reverse().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {tab !== "result" && tab !== "sets" && <DeckPick target={target} decks={allDecks} onChange={setPicked} />}
      {tab !== "result" && tab !== "sets" && <ImportPanel deck={sink} testName={current?.name ?? null} onPassage={(t) => (setPassage(t), setTab("words"))} />}
      {tab === "sets" && <TestSetsTab deck={sink} deckPicker={<DeckPick target={target} decks={allDecks} onChange={setPicked} />} onPassage={(t) => (setPassage(t), setTab("words"))} />}
      {tab === "result" && <ResultTab tests={tests} onSaved={(t) => (setPick(t.id), setTab("words"))} />}
      {tab === "words" && <WordsTab deck={sink} testName={current?.name ?? null} text={passage} setText={setPassage} />}
      {tab === "grammar" && <GrammarTab deck={sink} testName={current?.name ?? null} />}
    </div>
  );
}

// ------------------------------------------------------------------ result

interface Form {
  name: string;
  date: string;
  right: Record<PartKey, string>;
  lc: string;
  minutes: string;
  causes: Record<CauseKey, string>;
}

function blankForm(n: number): Form {
  return { name: `Test ${n}`, date: todayIso(), right: { p5: "", p6: "", p7: "" }, lc: "", minutes: "", causes: { v: "", g: "", p: "", t: "" } };
}

function formOf(t: TestResult): Form {
  const right = { p5: "", p6: "", p7: "" } as Record<PartKey, string>;
  for (const p of PARTS) right[p.key] = t.parts[p.key] ? String(t.parts[p.key]!.right) : "";
  return {
    name: t.name,
    date: t.date,
    right,
    lc: t.lc ? String(t.lc.right) : "",
    minutes: t.minutes ? String(t.minutes) : "",
    causes: { v: String(t.causes.v || ""), g: String(t.causes.g || ""), p: String(t.causes.p || ""), t: String(t.causes.t || "") },
  };
}

const num = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s) : 0);

function ResultTab({ tests, onSaved }: { tests: TestResult[]; onSaved(t: TestResult): void }) {
  const allNotes = useStore(notes);
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState<Form>(() => blankForm(tests.length + 1));
  const [busy, setBusy] = useState(false);

  const wrong = PARTS.reduce((a, p) => a + (f.right[p.key] === "" ? 0 : p.total - num(f.right[p.key])), 0);
  const sorted = CAUSES.reduce((a, c) => a + num(f.causes[c.key]), 0);
  const overPart = PARTS.find((p) => f.right[p.key] !== "" && num(f.right[p.key]) > p.total);
  const canSave = !!f.name.trim() && PARTS.some((p) => f.right[p.key] !== "") && !overPart && (f.lc === "" || num(f.lc) <= 100);

  function edit(t: TestResult | null) {
    setEditing(t?.id ?? null);
    setF(t ? formOf(t) : blankForm(tests.length + 1));
  }

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      const fields: Note["fields"] = { name: f.name.trim(), date: f.date };
      for (const p of PARTS) if (f.right[p.key] !== "") fields[p.key] = formatScore({ right: num(f.right[p.key]), total: p.total });
      if (f.lc !== "") fields.lc = formatScore({ right: num(f.lc), total: 100 });
      if (f.minutes !== "") fields.minutes = String(num(f.minutes));
      for (const c of CAUSES) if (f.causes[c.key] !== "") fields[c.key] = String(num(f.causes[c.key]));
      const existing = editing ? allNotes.find((n) => n.id === editing) : undefined;
      if (existing) await updateNote(existing, { fields });
      else await addNote({ type: "test", fields });
      toast(existing ? "Đã cập nhật kết quả" : "Đã lưu kết quả bài làm");
      const saved = testResults(notes.get()).find((t) => t.name === f.name.trim() && t.date === f.date);
      edit(null);
      if (saved) onSaved(saved);
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: TestResult) {
    const n = allNotes.find((x) => x.id === t.id);
    if (!n) return;
    const ok = await confirmDialog({
      title: `Xoá kết quả “${t.name}”?`,
      message: "Chỉ xoá dòng kết quả. Từ và câu ngữ pháp đã tạo từ bài này vẫn còn trong thư viện.",
      confirm: "Xoá kết quả",
      danger: true,
    });
    if (!ok) return;
    await removeNote(n);
    if (editing === t.id) edit(null);
    toast("Đã xoá kết quả");
  }

  return (
    <>
      <section class="panel col" data-testid="result-form">
        <div class="panel-head"><h2>{editing ? "Sửa kết quả" : "Kết quả bài vừa làm"}</h2>{editing && <button type="button" class="btn ghost sm" onClick={() => edit(null)}>Bài mới</button>}</div>
        <div class="row" style={{ alignItems: "flex-end" }}>
          <div class="field grow">
            <label for="t-name">Tên bài</label>
            <input id="t-name" class="input" value={f.name} maxLength={80} onInput={(e) => setF({ ...f, name: e.currentTarget.value })} data-testid="t-name" />
          </div>
          <div class="field">
            <label for="t-date">Ngày làm</label>
            <input id="t-date" class="input" type="date" value={f.date} onInput={(e) => setF({ ...f, date: e.currentTarget.value })} />
          </div>
        </div>

        <span class="lbl">Số câu đúng</span>
        <div class="parts">
          {PARTS.map((p) => (
            <label key={p.key} class="part">
              <span>{p.label} <small class="muted">/{p.total} · mục tiêu {PART_TARGET[p.key]}</small></span>
              <input class="input" inputMode="numeric" value={f.right[p.key]} placeholder="0" aria-invalid={f.right[p.key] !== "" && num(f.right[p.key]) > p.total} onInput={(e) => setF({ ...f, right: { ...f.right, [p.key]: e.currentTarget.value.replace(/\D/g, "").slice(0, 2) } })} data-testid={`t-${p.key}`} />
            </label>
          ))}
          <label class="part">
            <span>Listening <small class="muted">/100 · nếu có</small></span>
            <input class="input" inputMode="numeric" value={f.lc} placeholder="0" onInput={(e) => setF({ ...f, lc: e.currentTarget.value.replace(/\D/g, "").slice(0, 3) })} data-testid="t-lc" />
          </label>
          <label class="part">
            <span>Phút làm RC <small class="muted">/75</small></span>
            <input class="input" inputMode="numeric" value={f.minutes} placeholder="0" onInput={(e) => setF({ ...f, minutes: e.currentTarget.value.replace(/\D/g, "").slice(0, 3) })} data-testid="t-min" />
          </label>
        </div>

        <span class="lbl">Câu sai vì lý do gì {wrong > 0 && <small class={sorted === wrong ? "ok-text" : "muted"}>· đã phân loại {sorted}/{wrong}</small>}</span>
        <div class="parts">
          {CAUSES.map((c) => (
            <label key={c.key} class="part">
              <span>{c.label} <small class="muted">{c.hint}</small></span>
              <input class="input" inputMode="numeric" value={f.causes[c.key]} placeholder="0" onInput={(e) => setF({ ...f, causes: { ...f.causes, [c.key]: e.currentTarget.value.replace(/\D/g, "").slice(0, 2) } })} data-testid={`t-c-${c.key}`} />
            </label>
          ))}
        </div>
        <p class="muted small">Gợi ý: xem từng câu sai, chọn lý do chính. Câu nào chỉ vì không biết một từ là “Từ vựng”; câu hiểu hết nghĩa nhưng chọn sai cấu trúc là “Ngữ pháp”.</p>
        <div class="row">
          <button type="button" class="btn primary" disabled={!canSave || busy} onClick={() => void save()} data-testid="t-save"><Icon n="check" /> {editing ? "Cập nhật" : "Lưu kết quả"}</button>
          {overPart && <span class="muted small">{overPart.label} chỉ có {overPart.total} câu.</span>}
        </div>
      </section>

      {tests.length > 0 && (
        <section class="panel" data-testid="test-history">
          <div class="panel-head"><h2>Các bài đã làm</h2><span class="muted">Mục tiêu RC khoảng {RC_TARGET}/100</span></div>
          <ul class="test-list">
            {[...tests].reverse().map((t) => (
              <li key={t.id}>
                <button type="button" class="test-row" onClick={() => edit(t)}>
                  <b>{t.name}</b>
                  <span class="muted">{t.date}</span>
                  <span class={`pill ${t.fullRc && t.rcRight >= RC_TARGET ? "ok" : ""}`}>RC {t.rcRight}/{t.rcTotal || "?"}</span>
                  {wrongTotal(t) > 0 && <span class="muted small">{CAUSES.filter((c) => t.causes[c.key]).map((c) => `${c.label} ${t.causes[c.key]}`).join(" · ")}</span>}
                </button>
                <button type="button" class="btn ghost sm" onClick={() => void remove(t)} aria-label={`Xoá ${t.name}`}>Xoá</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ unknown words

function WordsTab({ deck, testName, text, setText }: { deck: DeckSink; testName: string | null; text: string; setText(t: string): void }) {
  const allNotes = useStore(notes);
  const allCards = useStore(cards);
  const p = useStore(prefs);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const [sel, setSel] = useState<Tok | null>(null);
  const index = useMemo(() => buildIndex(allNotes, allCards), [allNotes, allCards]);
  const a = useMemo(() => analyze(text, index, ignored), [text, index, ignored]);
  const tag = testName ? testTag(testName) : null;
  const pct = a.coverage === null ? null : Math.round(a.coverage * 100);

  function pickKey(key: string) {
    const u = a.unknown.find((x) => x.key === key);
    setSel(u ? u.first : null);
  }

  return (
    <>
      <section class="panel col" data-testid="words-tab">
        <div class="field">
          <label for="passage">Dán đoạn đọc của câu sai</label>
          <textarea id="passage" class="textarea" rows={7} value={text} placeholder="Dán email, thông báo, tin nhắn hoặc đoạn Part 7 vào đây…" onInput={(e) => (setText(e.currentTarget.value), setSel(null))} data-testid="passage" />
        </div>
        {pct !== null && (
          <div class="cover" data-testid="coverage">
            <div class="row between"><b>Bạn quen khoảng {pct}% số từ trong đoạn</b><span class="muted small">{a.covered}/{a.counted} từ · {a.unknown.length} từ lạ{a.pending > 0 ? ` · ${a.pending} từ chưa thuộc` : ""}</span></div>
            <div class="progress meter"><i style={{ width: `${pct}%` }} /><span class="mark" style={{ left: "95%" }} title="95%: mức tối thiểu để đọc hiểu" /></div>
            <p class="muted small">{pct >= 95 ? "Từ vựng không phải vấn đề chính của đoạn này; xem lại cấu trúc câu và cách đối chiếu đáp án." : "Dưới 95% thì cứ khoảng 20 từ lại gặp 1 từ lạ nên đọc chậm và dễ hiểu sai. Học các từ lạ bên dưới trước."}</p>
          </div>
        )}
      </section>

      {a.tokens.length > 0 && (
        <section class="panel col" data-testid="passage-view">
          <div class="panel-head"><h2>Từ lạ trong đoạn</h2><div class="legend"><span class="k-unknown">chưa có</span><span class="k-deck">đã có thẻ, chưa thuộc</span></div></div>
          <div class="passage" lang="en">
            {renderPassage(text, a.tokens, sel, (t) => setSel(t))}
          </div>
          {a.unknown.length > 0 && (
            <div class="chips" aria-label="Danh sách từ lạ">
              {[...a.unknown].sort((x, y) => y.count - x.count || x.key.localeCompare(y.key)).map((u) => (
                <button type="button" key={u.key} class={`wchip${sel?.key === u.key ? " on" : ""}`} onClick={() => pickKey(u.key)} data-testid="unknown-chip">{u.key}{u.count > 1 ? ` ×${u.count}` : ""}</button>
              ))}
            </div>
          )}
          {a.unknown.length === 0 && <p class="muted">Không còn từ lạ nào trong đoạn này.</p>}
        </section>
      )}

      {sel && (
        <WordPanel
          key={sel.key}
          tok={sel}
          sentence={sentenceAround(text, sel.start)}
          tag={tag}
          deck={deck}
          aiAvailable={firebaseConfigured && p.aiEnabled}
          onKnow={() => (setIgnored(new Set(ignored).add(sel.key)), setSel(null))}
          onClose={() => setSel(null)}
          onAdded={() => setSel(null)}
        />
      )}
    </>
  );
}

function renderPassage(text: string, tokens: Tok[], sel: Tok | null, onPick: (t: Tok) => void) {
  const out: preact.ComponentChildren[] = [];
  let at = 0;
  for (const t of tokens) {
    if (t.kind !== "unknown" && t.kind !== "deck") continue;
    if (t.start > at) out.push(text.slice(at, t.start));
    out.push(
      t.kind === "deck"
        ? <span key={t.start} class="w k-deck" title="Đã có trong thư viện, chưa thuộc" data-testid="pending-word">{t.raw}</span>
        : <button type="button" key={t.start} class={`w k-unknown${sel?.key === t.key ? " on" : ""}`} onClick={() => onPick(t)} data-testid="unknown-word">{t.raw}</button>,
    );
    at = t.end;
  }
  out.push(text.slice(at));
  return out;
}

function WordPanel({ tok, sentence, tag, deck, aiAvailable, onKnow, onClose, onAdded }: {
  tok: Tok;
  sentence: string;
  tag: string | null;
  deck: DeckSink;
  aiAvailable: boolean;
  onKnow(): void;
  onClose(): void;
  onAdded(): void;
}) {
  const [look, setLook] = useState<Lookup | null | undefined>(undefined);
  const [vi, setVi] = useState("");
  const [ex, setEx] = useState(sentence);
  const [busy, setBusy] = useState(false);
  const viEdited = useRef(false);

  useEffect(() => {
    let live = true;
    void dictionary.lookup(normalizeWord(tok.key)).then((l) => {
      if (!live) return;
      setLook(l);
      const first = l?.entry.pos[0];
      if (l && first && !viEdited.current) setVi(viFor(l.entry, POS_NAMES[first.pos]));
    });
    return () => { live = false; };
  }, [tok.key]);

  const entry = look?.entry ?? null;
  const first = entry?.pos[0];
  const word = entry?.word ?? normalizeWord(tok.key);
  const pos = first ? POS_NAMES[first.pos] : "";
  const en = first?.senses[0]?.def ?? "";
  const canAdd = !!word && !!(vi.trim() || en) && !busy;

  async function add(withAi: boolean) {
    if (!canAdd) return;
    setBusy(true);
    try {
      const fields: Note["fields"] = { word, ipa: entry?.ipa ?? "", pos, vi: vi.trim(), en, examples: ex.trim() ? [ex.trim()] : [] };
      const note = await addNote({ type: "vocab", fields, deckId: await deck.resolve(), ...(tag ? { tags: [tag] } : {}) });
      toast(`Đã thêm “${word}” · ${wantedTemplates(note, prefs.get().templates).length} thẻ`);
      onAdded();
      if (withAi) {
        try {
          const r = (await callEnrich(word, { pos, en, examples: list(fields.examples) })) as Enriched;
          const m = mergeEnrich(note.fields, note.aiFields ?? [], r, { overwriteVi: !!vi.trim() && !viEdited.current });
          await updateNote(note, { fields: m.fields, aiFields: m.aiFields });
          toast(`AI đã điền nghĩa theo ngữ cảnh cho “${word}”`);
        } catch {
          toast(`Đã thêm “${word}”, nhưng chưa gọi được AI. Bạn có thể điền sau trong Thư viện.`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="panel col word-panel" data-testid="word-panel" aria-live="polite">
      <div class="row between">
        <div class="row" style={{ gap: "10px" }}>
          <b class="wp-word">{word}</b>
          {entry?.ipa && <span class="muted">/{entry.ipa.replace(/^\/|\/$/g, "")}/</span>}
          {pos && <span class="b-badge">{pos}</span>}
        </div>
        <button type="button" class="btn ghost sm" onClick={onClose} aria-label="Đóng">Đóng</button>
      </div>
      {look === undefined && <p class="muted">Đang tra từ điển…</p>}
      {look === null && <p class="muted" data-testid="wp-notfound">Không có trong từ điển offline: nhập nghĩa tay{aiAvailable ? " hoặc để AI điền theo ngữ cảnh" : ""}.</p>}
      <div class="field">
        <label for="wp-vi">Nghĩa tiếng Việt {look && vi && !viEdited.current && <span class="ai-tag" title="Gợi ý từ Wiktionary (CC BY-SA)">Wiktionary</span>}</label>
        <input id="wp-vi" class="input" value={vi} placeholder="Nghĩa trong câu này" onInput={(e) => (viEdited.current = true, setVi(e.currentTarget.value))} data-testid="wp-vi" />
      </div>
      <div class="field">
        <label for="wp-ex">Câu trong đề (làm ví dụ)</label>
        <textarea id="wp-ex" class="textarea" rows={2} value={ex} onInput={(e) => setEx(e.currentTarget.value)} data-testid="wp-ex" />
      </div>
      <div class="row">
        <button type="button" class="btn primary" disabled={!canAdd} onClick={() => void add(false)} data-testid="wp-add"><Icon n="plus" /> Thêm thẻ</button>
        {aiAvailable && <button type="button" class="btn" disabled={!canAdd} onClick={() => void add(true)} data-testid="wp-add-ai"><Icon n="sparkle" /> Thêm và AI điền</button>}
        <button type="button" class="btn ghost" onClick={onKnow} data-testid="wp-know">Biết rồi</button>
      </div>
      {!canAdd && !busy && <p class="muted small">Cần có nghĩa tiếng Việt hoặc định nghĩa tiếng Anh.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ grammar

function GrammarTab({ deck, testName }: { deck: DeckSink; testName: string | null }) {
  const allNotes = useStore(notes);
  const p = useStore(prefs);
  const [sentence, setSentence] = useState("");
  const [answer, setAnswer] = useState("");
  const [topic, setTopic] = useState<string>("");
  const [translation, setTranslation] = useState("");
  const [rule, setRule] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  const full = completeSentence(sentence, answer);
  const found = !!answer.trim() && findExact(full, answer) !== null;
  const draft: Note = { id: "preview", type: "grammar", deckId: "", fields: { sentence: full, answer: answer.trim(), topic, translation, rule }, createdAt: 0, updatedAt: 0 };
  const tpl = template("grammar", "fill")!;
  const count = allNotes.filter((n) => n.type === "grammar").length;
  const dup = !!full && allNotes.some((n) => n.type === "grammar" && str(n.fields.sentence).toLowerCase() === full.toLowerCase());
  const canSave = !!full && found && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const tags = ["ngu-phap", ...(testName ? [testTag(testName)] : [])];
      await addNote({ type: "grammar", fields: { sentence: full, answer: answer.trim(), topic, translation, rule }, tags, deckId: await deck.resolve() });
      toast("Đã thêm thẻ ngữ pháp");
      setSentence(""); setAnswer(""); setTranslation(""); setRule("");
      box.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="two" data-testid="grammar-tab">
      <section class="panel col">
        <div class="field">
          <label for="g-sentence">Câu trong đề</label>
          <textarea id="g-sentence" ref={box} class="textarea" rows={3} value={sentence} placeholder="vd: ___ you need any help, please call us.  (hoặc dán câu đã có đáp án)" onInput={(e) => setSentence(e.currentTarget.value)} data-testid="g-sentence" />
        </div>
        <div class="field">
          <label for="g-answer">Đáp án đúng (từ hoặc cụm bị che)</label>
          <input id="g-answer" class="input" value={answer} placeholder="vd: Should" autocomplete="off" onInput={(e) => setAnswer(e.currentTarget.value)} data-testid="g-answer" />
          {answer.trim() && full && !found && <span class="pill bad" data-testid="g-notfound">Đáp án không nằm trong câu</span>}
        </div>
        <div class="field">
          <span class="lbl">Chủ đề</span>
          <div class="chips">
            {GRAMMAR_TOPICS.map((t) => <button type="button" key={t} class={`wchip${topic === t ? " on" : ""}`} aria-pressed={topic === t} onClick={() => setTopic(topic === t ? "" : t)}>{t}</button>)}
          </div>
        </div>
        <div class="field">
          <label for="g-rule">Vì sao đáp án này đúng (quy tắc, 1 dòng)</label>
          <textarea id="g-rule" class="textarea" rows={2} value={rule} maxLength={300} placeholder="vd: Đảo ngữ điều kiện: Should + S + V = If + S + should + V" onInput={(e) => setRule(e.currentTarget.value)} data-testid="g-rule" />
        </div>
        <div class="field">
          <label for="g-vi">Nghĩa của câu (không bắt buộc)</label>
          <input id="g-vi" class="input" value={translation} maxLength={300} onInput={(e) => setTranslation(e.currentTarget.value)} />
        </div>
        <div class="row">
          <button type="button" class="btn primary" disabled={!canSave} onClick={() => void save()} data-testid="g-save"><Icon n="check" /> Lưu thẻ</button>
          <span class="muted small">{count} thẻ ngữ pháp{testName ? ` · gắn với ${testName}` : ""}</span>
        </div>
        {dup && <span class="pill warn" data-testid="g-dup">Câu này đã có. Lưu sẽ tạo thêm một bản.</span>}
      </section>

      <section class="col">
        <span class="lbl">Xem trước thẻ</span>
        {canSave || (full && found) ? (
          <div class="panel" data-testid="g-preview">
            <Blocks blocks={tpl.front(draft, p.layout)} cloze />
            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
            <Blocks blocks={tpl.back(draft, p.layout)} />
          </div>
        ) : (
          <div class="panel empty" style={{ padding: "28px" }}>
            <p>Nhập câu và đáp án để xem thẻ.</p>
            <p class="muted small">Thẻ che đáp án, bạn gõ lại từ đúng; quy tắc hiện ra sau khi lật.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function DeckPick({ target, decks: list, onChange }: { target: DeckTarget; decks: Array<{ id: string; name: string }>; onChange(t: DeckTarget): void }) {
  return (
    <div class="deck-pick row" data-testid="deck-pick">
      <label class="muted small" for="dp">Lưu thẻ vào bộ</label>
      {target.newName === null ? (
        <>
          <select id="dp" class="select" value={target.id} onChange={(e) => onChange({ id: e.currentTarget.value, newName: null })} data-testid="deck-select">
            {list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button type="button" class="btn sm" onClick={() => onChange({ id: target.id, newName: "" })} data-testid="deck-new">+ Mới</button>
        </>
      ) : (
        <>
          <input id="dp" class="input" value={target.newName} maxLength={60} placeholder="Tên bộ thẻ mới" onInput={(e) => onChange({ id: target.id, newName: e.currentTarget.value })} data-testid="deck-name" />
          {list.length > 0 && <button type="button" class="btn ghost sm" onClick={() => onChange({ id: list[0].id, newName: null })}>Chọn bộ có sẵn</button>}
        </>
      )}
    </div>
  );
}
