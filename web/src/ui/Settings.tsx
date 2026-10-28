import { useEffect, useRef, useState } from "preact/hooks";
import type { CardLayout, Prefs } from "@shared/model.ts";
import { NOTE_TYPES } from "@shared/notetypes.ts";
import { savePrefs } from "../data/actions.ts";
import { firebaseConfigured, signOutUser } from "../data/firebase.ts";
import { validateExport } from "../data/repo.ts";
import { currentRepo, prefs, sync } from "../data/state.ts";
import { dictionary } from "../lib/dict.ts";
import { useStore } from "../lib/store.ts";
import { Icon, confirmDialog, syncLabel, toast } from "./common.tsx";

const ACCENTS: Array<[Prefs["accent"], string]> = [["teal", "#0e7c66"], ["blue", "#2457c5"], ["orange", "#c2410c"], ["violet", "#7c3aed"]];

export function Settings({ email }: { email: string | null }) {
  const p = useStore(prefs);
  const s = useStore(sync);
  const [meta, setMeta] = useState<{ words: number; withIpa: number; withVi?: number; version: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
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
