import type { ComponentType } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CardLayout, Prefs } from "@shared/model.ts";
import { NOTE_TYPES } from "@shared/notetypes.ts";
import { applyFsrs, optimizeFsrs, savePrefs } from "../data/actions.ts";
import { firebaseConfigured, signOutUser } from "../data/firebase.ts";
import { validateExport } from "../data/repo.ts";
import { currentRepo, daily, prefs, sync } from "../data/state.ts";
import type { AnkiCollection } from "../lib/anki/read.ts";
import type { FitResult } from "../lib/optimizer.ts";
import { dictionary } from "../lib/dict.ts";
import { useStore } from "../lib/store.ts";
import { Icon, confirmDialog, syncLabel, toast } from "./common.tsx";

const ACCENTS: Array<[Prefs["accent"], string]> = [["teal", "#0e7c66"], ["blue", "#2457c5"], ["orange", "#c2410c"], ["violet", "#7c3aed"]];

export function Settings({ email }: { email: string | null }) {
  const p = useStore(prefs);
  const s = useStore(sync);
  const [meta, setMeta] = useState<{ words: number; withIpa: number; withVi?: number; version: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const apkg = useRef<HTMLInputElement>(null);
  const [anki, setAnki] = useState<{ col: AnkiCollection; name: string; View: ComponentType<{ col: AnkiCollection; name: string; onClose: () => void }> } | null>(null);
  const [ankiBusy, setAnkiBusy] = useState(false);
  const [prefetch, setPrefetch] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const v = await dictionary.version();
      if (!v) return;
      try {
        const r = await fetch(`/dict/${v}/meta.json`);
        if (r.ok) setMeta(await r.json());
      } catch {
        /* offline and not cached */
      }
    })();
  }, []);

  const set = (patch: Partial<Prefs>) => void savePrefs({ ...p, ...patch });
  const layout = (k: keyof CardLayout, v: boolean) => set({ layout: { ...p.layout, [k]: v } });
  const vocab = NOTE_TYPES.vocab;
  const chosen = new Set(p.templates.vocab ?? []);
  const toggleTpl = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    if (next.size === 0) return toast("Cần giữ ít nhất một loại thẻ");
    set({ templates: { ...p.templates, vocab: vocab.templates.map((t) => t.id).filter((x) => next.has(x)) } });
  };

  async function exportJson() {
    const data = await currentRepo().exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vh-lexi-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function importJson(f: File) {
    try {
      const data = JSON.parse(await f.text());
      if (!validateExport(data)) return toast("File không phải bản sao lưu của VH Lexi");
      const ok = await confirmDialog({
        title: "Nhập bản sao lưu?",
        message: `${data.notes.length} từ và ${data.cards.length} thẻ sẽ được nhập. Mục trùng mã sẽ bị ghi đè bằng bản trong file.`,
        confirm: "Nhập",
      });
      if (!ok) return;
      const r = await currentRepo().importAll(data);
      toast(`Đã nhập ${r.notes} từ, ${r.cards} thẻ`);
    } catch {
      toast("Không đọc được file");
    }
  }

  /** The Anki reader (SQLite in WebAssembly, ~1 MB) is only downloaded when a package is picked. */
  async function openApkg(f: File) {
    setAnkiBusy(true);
    try {
      const m = await import("./AnkiImport.tsx");
      const col = await m.loadApkg(f);
      if (col) setAnki({ col, name: f.name, View: m.AnkiImport });
    } catch (e) {
      console.error("[anki]", e);
      toast("Không tải được bộ đọc Anki, kiểm tra kết nối rồi thử lại");
    } finally {
      setAnkiBusy(false);
    }
  }

  async function signOut() {
    const ok = await confirmDialog({
      title: "Đăng xuất?",
      message: "Dữ liệu đã đồng bộ vẫn an toàn trên Firebase. Bạn cần đăng nhập lại để tiếp tục học.",
      confirm: "Đăng xuất",
      danger: true,
    });
    if (ok) await signOutUser();
  }

  return (
    <div class="page narrow">
      <div class="page-head"><h1>Cài đặt</h1></div>

      <section class="panel col">
        <h2>Học tập</h2>
        <div class="field">
          <label for="ret">Mức nhớ mục tiêu: {Math.round(p.desiredRetention * 100)}%</label>
          <input id="ret" type="range" min="0.8" max="0.97" step="0.01" value={p.desiredRetention} onChange={(e) => set({ desiredRetention: Number(e.currentTarget.value) })} />
          <p class="muted" style={{ fontSize: "13px" }}>Cao hơn = nhớ chắc hơn nhưng ôn nhiều hơn. 90% là điểm cân bằng thường dùng; 85% nếu muốn ít thẻ hơn.</p>
        </div>
        <div class="row">
          <div class="field grow"><label for="npd">Từ mới mỗi ngày</label><input id="npd" class="input" type="number" min="0" max="200" value={p.newPerDay} onChange={(e) => set({ newPerDay: Number(e.currentTarget.value) })} /></div>
          <div class="field grow"><label for="mrd">Tối đa thẻ ôn mỗi ngày</label><input id="mrd" class="input" type="number" min="0" max="9999" value={p.maxReviewsPerDay} onChange={(e) => set({ maxReviewsPerDay: Number(e.currentTarget.value) })} /></div>
          <div class="field grow"><label for="dsh">Ngày mới bắt đầu lúc (giờ)</label><input id="dsh" class="input" type="number" min="0" max="23" value={p.dayStartHour} onChange={(e) => set({ dayStartHour: Number(e.currentTarget.value) })} /></div>
        </div>
        <div class="field">
          <span class="lbl">Tự đọc phát âm</span>
          <div class="seg" role="group" aria-label="Tự đọc phát âm">
            {([["off", "Tắt"], ["front", "Khi hiện thẻ"], ["back", "Khi lật thẻ"]] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={p.autoSpeak === k} onClick={() => set({ autoSpeak: k })}>{l}</button>)}
          </div>
        </div>
      </section>

      <FsrsOptimizer />

      <section class="panel col">
        <h2>Loại thẻ tạo cho mỗi từ</h2>
        {vocab.templates.map((t) => (
          <label class="switch" key={t.id}>
            <span><b>{t.label}</b><br /><span class="muted" style={{ fontSize: "13px" }}>{t.description}</span></span>
            <input type="checkbox" checked={chosen.has(t.id)} onChange={(e) => toggleTpl(t.id, e.currentTarget.checked)} data-testid={`tpl-${t.id}`} />
          </label>
        ))}
        <p class="muted" style={{ fontSize: "13px" }}>Đổi lựa chọn sẽ tạo thêm thẻ cho các từ đã có. Thẻ đã tắt nhưng chưa học sẽ bị gỡ; thẻ đã học được giữ lại.</p>
      </section>

      <section class="panel col">
        <h2>Hiển thị</h2>
        {([["showIpa", "Phiên âm IPA"], ["showPos", "Loại từ"], ["showVi", "Nghĩa tiếng Việt"], ["showEn", "Định nghĩa tiếng Anh"], ["showExamples", "Ví dụ"], ["showMnemonic", "Mẹo nhớ"]] as const).map(([k, l]) => (
          <label class="switch" key={k}><span>{l}</span><input type="checkbox" checked={p.layout[k]} onChange={(e) => layout(k, e.currentTarget.checked)} /></label>
        ))}
        <div class="field">
          <span class="lbl">Giao diện</span>
          <div class="seg" role="group" aria-label="Giao diện">
            {([["system", "Theo hệ thống"], ["light", "Sáng"], ["dark", "Tối"]] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={p.theme === k} onClick={() => set({ theme: k })}>{l}</button>)}
          </div>
        </div>
        <div class="field">
          <span class="lbl">Màu nhấn</span>
          <div class="sw" role="group" aria-label="Màu nhấn">
            {ACCENTS.map(([k, c]) => <button type="button" key={k} style={{ background: c }} aria-label={k} aria-pressed={p.accent === k} onClick={() => set({ accent: k })} />)}
          </div>
        </div>
      </section>

      {firebaseConfigured && (
        <section class="panel col">
          <h2>AI</h2>
          <label class="switch"><span><b>Điền nghĩa tiếng Việt và ví dụ bằng AI</b><br /><span class="muted" style={{ fontSize: "13px" }}>Gọi Cloud Function của bạn; có giới hạn lượt mỗi ngày. Nội dung do AI viết luôn có nhãn “AI”.</span></span><input type="checkbox" checked={p.aiEnabled} onChange={(e) => set({ aiEnabled: e.currentTarget.checked })} /></label>
        </section>
      )}

      <section class="panel col">
        <h2>Dữ liệu & tài khoản</h2>
        <div class="row"><span class="pill">{syncLabel(s)}</span>{email && <span class="muted">{email}</span>}</div>
        <div class="row">
          <button type="button" class="btn" onClick={() => void exportJson()} data-testid="export"><Icon n="download" /> Xuất JSON</button>
          <button type="button" class="btn" onClick={() => file.current?.click()}><Icon n="upload" /> Nhập JSON</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void importJson(f); e.currentTarget.value = ""; }} data-testid="import-file" />
          <button type="button" class="btn" disabled={ankiBusy} onClick={() => apkg.current?.click()} data-testid="import-anki"><Icon n="upload" /> {ankiBusy ? "Đang đọc gói Anki…" : "Nhập từ Anki (.apkg)"}</button>
          <input ref={apkg} type="file" accept=".apkg,.colpkg" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void openApkg(f); e.currentTarget.value = ""; }} data-testid="import-anki-file" />
          {email && <button type="button" class="btn danger" onClick={() => void signOut()}><Icon n="logout" /> Đăng xuất</button>}
        </div>
      </section>

      <section class="panel col">
        <h2>Từ điển offline</h2>
        <p class="muted" style={{ fontSize: "13px" }}>Mỗi lần tra, app tải phần từ điển cần dùng và nhớ lại. Tải sẵn toàn bộ (khoảng 6 MB) để tra được mọi từ khi không có mạng.</p>
        <div class="row">
          <button
            type="button"
            class="btn"
            disabled={prefetch !== null && prefetch !== "Đã tải xong" && !prefetch.startsWith("Lỗi")}
            data-testid="prefetch"
            onClick={async () => {
              setPrefetch("Đang tải…");
              try {
                const ok = await dictionary.prefetchAll((d, t) => setPrefetch(`Đang tải ${Math.round((d / t) * 100)}%`));
                setPrefetch(ok ? "Đã tải xong" : "Lỗi: không thấy từ điển");
              } catch {
                setPrefetch("Lỗi: kiểm tra kết nối rồi thử lại");
              }
            }}
          >
            <Icon n="download" /> Tải sẵn toàn bộ từ điển
          </button>
          {prefetch && <span class="pill">{prefetch}</span>}
        </div>
      </section>

      {anki && <anki.View col={anki.col} name={anki.name} onClose={() => setAnki(null)} />}

      <section class="panel col">
        <h2>Về VH Lexi</h2>
        <p class="muted" style={{ fontSize: "13px" }}>
          Từ điển offline: {meta ? `${meta.words.toLocaleString("vi-VN")} mục, ${meta.withIpa.toLocaleString("vi-VN")} có phiên âm${meta.withVi ? `, ${meta.withVi.toLocaleString("vi-VN")} có nghĩa tiếng Việt` : ""} (${meta.version})` : "chưa tải"}.
          Phiên âm từ CMU Pronouncing Dictionary; loại từ, định nghĩa và ví dụ từ Princeton WordNet 3.1 (© Princeton University, WordNet License); nghĩa tiếng Việt gợi ý từ Wiktionary (CC BY-SA 4.0).
          Lập lịch ôn tập: FSRS qua thư viện ts-fsrs.
        </p>
      </section>
    </div>
  );
}

const pct = (x: number) => `${(x * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

/** Anki's "Optimize": fits FSRS to this learner's answers, shows how much closer it predicts them, applies on request. */
function FsrsOptimizer() {
  const p = useStore(prefs);
  const days = useStore(daily);
  const [state, setState] = useState<{ busy: number } | { result: FitResult } | { error: string } | null>(null);
  const answers = days.reduce((n, d) => n + d.newCards + d.reviews, 0);
  const stale = !!p.fsrsWeights && !!p.fsrsOptimizedReviews && answers >= 2 * p.fsrsOptimizedReviews;
  const busy = !!state && "busy" in state;

  async function run() {
    setState({ busy: 0 });
    try {
      setState({ result: await optimizeFsrs((f) => setState({ busy: f })) });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function apply(r: Extract<FitResult, { status: "fitted" }>) {
    await applyFsrs(r);
    setState(null);
    toast("Đã áp dụng tham số mới, có hiệu lực từ lần ôn tiếp theo");
  }

  return (
    <section class="panel col" data-testid="fsrs">
      <h2>Thuật toán ôn tập (FSRS)</h2>
      <p data-testid="fsrs-status">
        {p.fsrsWeights
          ? `Đang dùng tham số tối ưu ngày ${new Date(p.fsrsOptimizedAt ?? 0).toLocaleDateString("vi-VN")} trên ${(p.fsrsOptimizedReviews ?? 0).toLocaleString("vi-VN")} lượt ôn.`
          : "Đang dùng tham số mặc định của FSRS."}
        {stale && <span class="pill warn" style={{ marginLeft: "8px" }}>Lịch sử đã gấp đôi, nên tối ưu lại</span>}
      </p>
      <p class="muted" style={{ fontSize: "13px" }}>
        Tối ưu là tính lại 21 tham số của FSRS theo lịch sử ôn của chính bạn (như nút Optimize của Anki), để lịch ôn khớp với trí nhớ của bạn hơn.
        Chạy ngay trên thiết bị này, không gửi dữ liệu đi. Nên chạy lại khi số lượt ôn tăng gấp đôi, hoặc khoảng mỗi tháng.
      </p>
      <div class="row">
        <button type="button" class="btn" disabled={busy} onClick={() => void run()} data-testid="fsrs-optimize">
          <Icon n="chart" /> {busy ? `Đang tối ưu… ${Math.round(state.busy * 100)}%` : "Tối ưu theo lịch sử ôn"}
        </button>
      </div>
      {state && "error" in state && <p class="pill bad" data-testid="fsrs-result">Lỗi: {state.error}</p>}
      {state && "result" in state && (
        <div class="col" data-testid="fsrs-result">
          {state.result.status === "not-enough" && <p>Chưa đủ lịch sử để tối ưu: mới có {state.result.reviews.toLocaleString("vi-VN")} lượt ôn. Học thêm vài tuần rồi thử lại.</p>}
          {state.result.status === "optimal" && <p>Tham số đang dùng đã khớp nhất với {state.result.reviews.toLocaleString("vi-VN")} lượt ôn của bạn, không cần đổi.</p>}
          {state.result.status === "fitted" && (() => {
            const r = state.result;
            return (
              <>
                <p>
                  Trên {r.reviews.toLocaleString("vi-VN")} lượt ôn, độ lệch giữa khả năng nhớ dự đoán và thực tế giảm từ <b>{pct(r.before.rmse)}</b> xuống <b>{pct(r.after.rmse)}</b> (càng thấp càng sát).
                </p>
                <p class="muted" style={{ fontSize: "13px" }}>Áp dụng cho các lần ôn từ nay về sau, trên cả web và Android. Lịch đã xếp của các thẻ giữ nguyên.</p>
                <div class="row">
                  <button type="button" class="btn" onClick={() => setState(null)} data-testid="fsrs-cancel">Bỏ qua</button>
                  <button type="button" class="btn primary" onClick={() => void apply(r)} data-testid="fsrs-apply">Áp dụng</button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </section>
  );
}
