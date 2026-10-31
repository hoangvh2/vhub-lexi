import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { SyncState } from "../data/repo.ts";
import { createStore, useStore } from "../lib/store.ts";

export function syncLabel(s: SyncState): string {
  switch (s) {
    case "local": return "Chỉ lưu trên máy này";
    case "loading": return "Đang tải…";
    case "synced": return "Đã đồng bộ";
    case "pending": return "Đang đồng bộ…";
    case "offline": return "Offline · sẽ đồng bộ khi có mạng";
    case "denied": return "Tài khoản chưa được cấp quyền";
    case "error": return "Lỗi đồng bộ";
  }
}

// ------------------------------------------------------------------ icons
const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  study: "M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5z",
  library: "M4 6h16M4 12h16M4 18h10",
  chart: "M5 20V10M12 20V4M19 20v-7",
  cog: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  speaker: "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  check: "M5 12.5 10 17.5 19 7",
  x: "M6 6l12 12M18 6 6 18",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM14 6l4 4",
  cloud: "M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9.5 4 4 0 0 1 17 18z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  pause: "M8 5v14M16 5v14",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  upload: "M12 16V5M7 9l5-5 5 5M5 20h14",
  logout: "M10 5H5v14h5M15 8l4 4-4 4M19 12H9",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  calendar: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4",
  star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z",
  flame: "M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5.4 3.7-7.6.4 1.6 1.2 2.7 2.4 3.4.2-2.9 1.4-5.5 3.6-7.1-.3 3 .9 4.7 2.3 6.4 1.2 1.5 1.9 3 1.9 4.9 0 3.6-3.1 6.2-7.4 6.2zM12 21c-1.7 0-2.9-1.2-2.9-2.8 0-1.8 1.6-2.8 2.4-4.3.9 1.2 3.4 2.2 3.4 4.4 0 1.5-1.2 2.7-2.9 2.7z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
};

export function Icon({ n, size }: { n: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg class="i" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: `${size}px`, height: `${size}px` } : undefined}>
      <path d={PATHS[n] ?? ""} />
    </svg>
  );
}

// ------------------------------------------------------------------ toast
interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
const toasts = createStore<ToastItem[]>([]);
let toastSeq = 0;

export function toast(text: string, action?: ToastItem["action"], ms = 3500) {
  const id = ++toastSeq;
  toasts.update((l) => [...l.slice(-1), { id, text, action }]);
  setTimeout(() => toasts.update((l) => l.filter((t) => t.id !== id)), ms);
}

export function Toasts() {
  const list = useStore(toasts);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div class="toast" key={t.id}>
          <span class="grow">{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                toasts.update((l) => l.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modal + confirm
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[autofocus], input, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, []);
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirm: string;
  danger?: boolean;
}
interface Pending extends ConfirmOptions {
  resolve(v: boolean): void;
}
const pending = createStore<Pending | null>(null);

/**
 * Every destructive action (delete, sign out, discard) goes through this dialog. No gesture or
 * shortcut may skip it. Resolves true only on the explicit confirm button.
 */
export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => pending.set({ ...o, resolve }));
}

export function ConfirmHost() {
  const p = useStore(pending);
  if (!p) return null;
  const close = (v: boolean) => {
    pending.set(null);
    p.resolve(v);
  };
  return (
    <Modal title={p.title} onClose={() => close(false)}>
      <p>{p.message}</p>
      <div class="modal-actions">
        <button type="button" class="btn" onClick={() => close(false)} data-testid="confirm-cancel" autofocus>
          Huỷ
        </button>
        <button type="button" class={`btn ${p.danger ? "danger" : "primary"}`} onClick={() => close(true)} data-testid="confirm-ok">
          {p.confirm}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ routing
export const route = createStore<string>(location.hash.replace(/^#/, "") || "/today");
addEventListener("hashchange", () => route.set(location.hash.replace(/^#/, "") || "/today"));
export const go = (path: string) => {
  location.hash = path;
};
