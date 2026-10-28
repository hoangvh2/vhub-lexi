import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { FieldValue, Note } from "@shared/model.ts";
import { template, wantedTemplates } from "@shared/notetypes.ts";
import { addNote, createDeck } from "../data/actions.ts";
import { callEnrich, firebaseConfigured } from "../data/firebase.ts";
import { decks, notes, prefs } from "../data/state.ts";
import { POS_NAMES, dictionary, normalizeWord, viFor, type DictEntry, type Lookup } from "../lib/dict.ts";
import { useStore } from "../lib/store.ts";
import { Blocks } from "./Blocks.tsx";
import { Icon, toast } from "./common.tsx";

interface Draft {
  word: string;
  ipa: string;
  pos: string;
  en: string;
  vi: string;
  examples: string[];
  mnemonic: string;
  /** Which fields currently hold AI-written text. */
  ai: Set<string>;
}
const EMPTY: Draft = { word: "", ipa: "", pos: "", en: "", vi: "", examples: [], mnemonic: "", ai: new Set() };

interface SenseRef {
  pos: string;
  def: string;
  ex: string[];
}

function senseList(e: DictEntry | null): SenseRef[] {
  return e ? e.pos.flatMap((p) => p.senses.map((s) => ({ pos: POS_NAMES[p.pos], def: s.def, ex: s.ex }))) : [];
}

function draftFromSenses(e: DictEntry, picked: SenseRef[]): Draft {
  const first = picked[0];
  return {
    word: e.word,
    ipa: e.ipa,
    pos: first?.pos ?? "",
    en: picked.map((s) => s.def).join("; "),
    vi: first ? viFor(e, first.pos) : "",
    examples: [...new Set(picked.flatMap((s) => s.ex))].slice(0, 3),
    mnemonic: "",
    ai: new Set(),
  };
}

export function Add() {
  const allDecks = useStore(decks);
  const allNotes = useStore(notes);
  const p = useStore(prefs);

  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<DictEntry[]>([]);
  const [hit, setHit] = useState<Lookup | null>(null);
  const [picked, setPicked] = useState<number[]>([0]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [active, setActive] = useState(0);
  const [deckId, setDeckId] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [packOk, setPackOk] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const [newDeck, setNewDeck] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    void dictionary.available().then(setPackOk);
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!deckId && allDecks.length) setDeckId(p.defaultDeckId && allDecks.some((d) => d.id === p.defaultDeckId) ? p.defaultDeckId : allDecks[0].id);
  }, [allDecks, p.defaultDeckId]);

  const senses = useMemo(() => senseList(hit?.entry ?? null), [hit]);

  // Look up on every keystroke; stale answers are dropped.
  useEffect(() => {
    const id = ++seq.current;
    const w = normalizeWord(q);
    if (w.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    void (async () => {
      const [sugg, found] = await Promise.all([dictionary.suggest(w, 8), dictionary.lookup(w)]);
      if (id !== seq.current) return;
      setSearching(false);
      setSuggestions(sugg);
      setActive(0);
      // Do not clobber a word the user is already editing unless they typed a different word.
      if (found && found.entry.word !== draft.word && !(draft.word && normalizeWord(draft.word) === w)) choose(found, true);
      else if (!found && normalizeWord(draft.word) !== w) (setHit(null), setDraft(EMPTY));
    })();
  }, [q]);

  function choose(l: Lookup, keepQuery = false) {
    setHit(l);
    const s = senseList(l.entry);
    setPicked(s.length ? [0] : []);
    setDraft(draftFromSenses(l.entry, s.slice(0, 1)));
    if (!keepQuery) setQ(l.entry.word);
  }

  function toggleSense(i: number) {
    if (!hit) return;
    const next = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i].sort((a, b) => a - b);
    setPicked(next);
    setDraft((d) => {
      const fresh = draftFromSenses(hit.entry, next.map((k) => senses[k]));
      // Follow the part of speech while the meaning is still the dictionary's; keep anything the user or AI wrote.
      const fromDict = !d.vi || (!d.ai.has("vi") && d.vi === viFor(hit.entry, d.pos));
      return { ...fresh, vi: fromDict ? fresh.vi : d.vi, mnemonic: d.mnemonic, ai: d.ai };
    });
  }

  const manual = !hit && !searching && normalizeWord(q).length >= 2;
  const word = (hit ? draft.word : manual ? normalizeWord(q) : "").trim();
  const fields: Record<string, FieldValue> = {
    word,
    ipa: draft.ipa,
    pos: draft.pos,
    en: draft.en,
    vi: draft.vi,
    examples: draft.examples,
    mnemonic: draft.mnemonic,
  };
  const previewNote: Note = { id: "preview", type: "vocab", deckId: "", fields, createdAt: 0, updatedAt: 0 };
  const cardCount = word ? wantedTemplates(previewNote, p.templates).length : 0;
  const duplicate = word && allNotes.some((n) => n.type === "vocab" && String(n.fields.word ?? "").toLowerCase() === word.toLowerCase());
  const canSave = !!word && !!(draft.vi.trim() || draft.en.trim());
  const aiAvailable = firebaseConfigured && p.aiEnabled;

  async function save() {
    if (!canSave) return;
    // Snapshot and clear the form first so the next word can be typed immediately.
    const snapshot = { fields, ai: [...draft.ai], deck: deckId, newDeck, label: word, count: cardCount };
    setQ("");
    setHit(null);
    setDraft(EMPTY);
    setPicked([0]);
    setSuggestions([]);
    setNewDeck(null);
    input.current?.focus();
    let target = snapshot.deck;
    if (snapshot.newDeck !== null && snapshot.newDeck.trim()) target = (await createDeck(snapshot.newDeck)).id;
    await addNote({ type: "vocab", deckId: target || undefined, fields: snapshot.fields, aiFields: snapshot.ai });
    toast(`Đã thêm “${snapshot.label}” · ${snapshot.count} thẻ`);
  }

  async function enrich() {
    if (!word || aiBusy) return;
    setAiBusy(true);
    try {
      const r = (await callEnrich(word, { pos: draft.pos, en: draft.en, examples: draft.examples })) as {
        vi?: string; en?: string; examples?: string[]; mnemonic?: string;
      };
      setDraft((d) => {
        const ai = new Set(d.ai);
        const next = { ...d };
        if (r.vi) (next.vi = r.vi, ai.add("vi"));
        if (!d.en && r.en) (next.en = r.en, ai.add("en"));
        if (r.examples?.length) {
          next.examples = [...new Set([...d.examples, ...r.examples])].slice(0, 5);
          ai.add("examples");
        }
        if (r.mnemonic && !d.mnemonic) (next.mnemonic = r.mnemonic, ai.add("mnemonic"));
        next.ai = ai;
        return next;
      });
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      toast(code.includes("resource-exhausted") ? "Hết lượt AI hôm nay. Bạn vẫn có thể nhập tay." : "Không gọi được AI. Kiểm tra mạng rồi thử lại.");
    } finally {
      setAiBusy(false);
    }
  }

  const aiTag = (k: string) => (draft.ai.has(k) ? <span class="ai-tag">AI</span> : null);
  const viFromDict = !!hit && !!draft.vi && !draft.ai.has("vi") && draft.vi === viFor(hit.entry, draft.pos);
  const edit = (k: keyof Draft) => (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    setDraft((d) => {
      const ai = new Set(d.ai);
      ai.delete(k);
      return { ...d, [k]: v, ai };
    });
  };

  const tpl = template("vocab", "recognize")!;

  return (
    <div class="page">
      <div class="page-head">
        <h1>Thêm từ</h1>
        {packOk === false && <span class="pill warn">Chưa tải được từ điển offline</span>}
        {packOk && <span class="pill ok">Từ điển offline</span>}
      </div>

      <div class="two">
        <div class="col area-input">
          <div class="field">
            <label for="word">Từ hoặc cụm từ tiếng Anh</label>
            <input
              id="word"
              ref={input}
              class="input big"
              value={q}
              placeholder="vd: serendipity, look after…"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              data-testid="word-input"
              onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && suggestions.length) (e.preventDefault(), setActive((a) => Math.min(suggestions.length - 1, a + 1)));
                else if (e.key === "ArrowUp" && suggestions.length) (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
                else if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  const s = suggestions[active];
                  if (s) void dictionary.lookup(s.word).then((l) => l && choose(l));
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
              }}
            />
          </div>

          {suggestions.length > 0 && normalizeWord(q) !== hit?.entry.word && (
            <div class="suggest-list" role="listbox" aria-label="Gợi ý từ">
              {suggestions.map((s, i) => (
                <button type="button" key={s.word} role="option" aria-selected={i === active} onClick={() => void dictionary.lookup(s.word).then((l) => l && choose(l))}>
                  <b>{s.word}</b>
                  <span class="muted">{s.pos[0]?.senses[0]?.def.slice(0, 60)}</span>
                </button>
              ))}
            </div>
          )}

          {hit?.inflectedFrom && <p class="muted">“{hit.inflectedFrom}” là dạng của <b>{hit.entry.word}</b>.</p>}
          {manual && !hit && (
            <p class="muted" data-testid="not-found">
              Không có “{normalizeWord(q)}” trong từ điển offline. Bạn có thể tự nhập nghĩa{aiAvailable ? " hoặc nhờ AI điền" : ""}.
            </p>
          )}

          {senses.length > 0 && (
            <div class="col" style={{ gap: "8px" }}>
              <span class="lbl">Chọn nghĩa đưa vào thẻ</span>
              {senses.map((s, i) => (
                <button type="button" key={i} class="sense" aria-pressed={picked.includes(i)} onClick={() => toggleSense(i)} data-testid="sense">
                  <span class="b-badge">{s.pos}</span>
                  <span>
                    {s.def}
                    {s.ex[0] && <small>“{s.ex[0]}”</small>}
                  </span>
                </button>
              ))}
            </div>
          )}

        </div>

        {word && (
            <div class="col area-fields">
              <div class="row">
                <div class="field grow">
                  <label for="vi">
                    Nghĩa tiếng Việt {aiTag("vi")}
                    {viFromDict && (
                      <span class="ai-tag" title="Gợi ý từ Wiktionary (CC BY-SA), nên đọc lại trước khi lưu" data-testid="vi-source">
                        Wiktionary
                      </span>
                    )}
                  </label>
                  <input id="vi" class="input" value={draft.vi} onInput={edit("vi")} placeholder={aiAvailable ? "Nhập hoặc bấm “Điền bằng AI”" : "Nhập nghĩa tiếng Việt"} data-testid="vi-input" />
                </div>
                {aiAvailable && (
                  <button type="button" class="btn" style={{ alignSelf: "flex-end" }} onClick={() => void enrich()} disabled={aiBusy} data-testid="ai-fill">
                    <Icon n="sparkle" /> {aiBusy ? "Đang điền…" : "Điền bằng AI"}
                  </button>
                )}
              </div>
              {!hit && (
                <div class="field">
                  <label for="en">Định nghĩa tiếng Anh {aiTag("en")}</label>
                  <input id="en" class="input" value={draft.en} onInput={edit("en")} />
                </div>
              )}
              <div class="field">
                <label for="ex">Ví dụ (mỗi dòng một câu) {aiTag("examples")}</label>
                <textarea
                  id="ex"
                  class="textarea"
                  value={draft.examples.join("\n")}
                  onInput={(e) => {
                    const v = e.currentTarget.value.split("\n");
                    setDraft((d) => {
                      const ai = new Set(d.ai);
                      ai.delete("examples");
                      return { ...d, examples: v, ai };
                    });
                  }}
                />
              </div>
              <div class="field">
                <label for="mn">Mẹo nhớ {aiTag("mnemonic")}</label>
                <input id="mn" class="input" value={draft.mnemonic} onInput={edit("mnemonic")} />
              </div>
              <div class="row">
                <div class="field grow">
                  <label for="deck">Bộ thẻ</label>
                  {newDeck === null ? (
                    <div class="row" style={{ flexWrap: "nowrap" }}>
                      <select id="deck" class="select" value={deckId} onChange={(e) => setDeckId(e.currentTarget.value)}>
                        {allDecks.length === 0 && <option value="">Mặc định</option>}
                        {allDecks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button type="button" class="btn sm" onClick={() => setNewDeck("")}>+ Mới</button>
                    </div>
                  ) : (
                    <input id="deck" class="input" value={newDeck} placeholder="Tên bộ thẻ mới (vd: TOEIC)" onInput={(e) => setNewDeck(e.currentTarget.value)} />
                  )}
                </div>
              </div>
              {duplicate && <span class="pill warn" data-testid="duplicate">“{word}” đã có trong thư viện. Lưu sẽ tạo thêm một bản.</span>}
              <div class="row">
                <button type="button" class="btn primary" onClick={() => void save()} disabled={!canSave} data-testid="save-word">
                  <Icon n="check" /> Lưu · {cardCount} thẻ
                </button>
                <span class="muted" style={{ fontSize: "13px" }}>Ctrl+Enter để lưu nhanh</span>
              </div>
              {!canSave && <p class="muted" style={{ fontSize: "13px" }}>Cần có nghĩa tiếng Việt hoặc định nghĩa tiếng Anh.</p>}
            </div>
        )}

        <div class="col preview-card area-preview">
          <span class="lbl">Xem trước thẻ</span>
          {word ? (
            <div class="panel" data-testid="preview">
              <Blocks blocks={tpl.front(previewNote, p.layout)} />
              <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />
              <Blocks blocks={tpl.back(previewNote, p.layout)} />
            </div>
          ) : (
            <div class="panel empty" style={{ padding: "32px" }}>
              <p>Gõ một từ để xem thẻ hiện ra ngay.</p>
              <p class="muted" style={{ fontSize: "13px" }}>Phiên âm, loại từ, định nghĩa và ví dụ lấy từ từ điển offline.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
