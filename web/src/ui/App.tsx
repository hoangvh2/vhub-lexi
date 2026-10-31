import { useEffect, useMemo } from "preact/hooks";
import { meaningsByNote } from "@shared/confusables.ts";
import { dayId } from "@shared/model.ts";
import { cards, daily, notes, prefs, sync, warnings } from "../data/state.ts";
import { buildQueue } from "../lib/queue.ts";
import { eligibility } from "../lib/select.ts";
import { useStore } from "../lib/store.ts";
import { Add } from "./Add.tsx";
import { ConfirmHost, Icon, Toasts, route, syncLabel, toast } from "./common.tsx";
import { Library } from "./Library.tsx";
import { Settings } from "./Settings.tsx";
import { Stats } from "./Stats.tsx";
import { Study } from "./Study.tsx";
import { Today } from "./Today.tsx";

const NAV = [
  { path: "/today", label: "Ôn tập", icon: "study" },
  { path: "/add", label: "Thêm từ", icon: "plus" },
  { path: "/library", label: "Thư viện", icon: "library" },
  { path: "/stats", label: "Thống kê", icon: "chart" },
  { path: "/settings", label: "Cài đặt", icon: "cog" },
] as const;

export function App({ email }: { email: string | null }) {
  const r = useStore(route);
  const p = useStore(prefs);
  const s = useStore(sync);
  const allCards = useStore(cards);
  const allNotes = useStore(notes);
  const dailies = useStore(daily);
  const warning = useStore(warnings);

  useEffect(() => {
    const el = document.documentElement;
    if (p.theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", p.theme);
    el.setAttribute("data-accent", p.accent);
  }, [p.theme, p.accent]);

  useEffect(() => {
    if (warning) {
      toast(warning, undefined, 6000);
      warnings.set(null);
    }
  }, [warning]);

  const due = useMemo(() => {
    const now = Date.now();
    const q = buildQueue({
      cards: allCards, eligible: eligibility(allNotes), today: dailies.find((d) => d.id === dayId(now, p.dayStartHour)), prefs: p, now, deckId: null, buried: new Set(),
      meanings: meaningsByNote(allNotes),
    });
    return q.counts.new + q.counts.learning + q.counts.review;
  }, [allCards, allNotes, dailies, p]);

  const [path, query = ""] = r.split("?");
  const [, section, arg] = path.split("/");
  // The study session belongs to the "Ôn tập" tab, whose home is the Today screen.
  const current = "/" + (!section || section === "study" ? "today" : section);
  const page =
    section === "add" ? <Add /> :
    section === "library" ? <Library /> :
    section === "stats" ? <Stats /> :
    section === "settings" ? <Settings email={email} /> :
    section === "study" ? <Study deckId={arg || null} initialTag={new URLSearchParams(query).get("tag") ?? ""} key={r} /> :
    <Today />;

  const pillClass = s === "synced" || s === "local" ? "ok" : s === "denied" || s === "error" ? "bad" : "warn";

  return (
    <div class="shell">
      <aside class="side" aria-label="Điều hướng">
        <div class="brand"><i>L</i>VH Lexi</div>
        {NAV.map((n) => (
          <a key={n.path} class="nav-item" href={`#${n.path}`} aria-current={current === n.path ? "page" : undefined} data-testid={`nav-${n.path.slice(1)}`}>
            <Icon n={n.icon} /> {n.label}
            {n.path === "/today" && due > 0 && <span class="badge" data-testid="due-badge">{due}</span>}
          </a>
        ))}
        <span class="spacer" />
        <div class="row" style={{ padding: "8px 10px" }}>
          <span class={`pill ${pillClass}`} data-testid="sync-pill"><span class="dot" />{syncLabel(s)}</span>
        </div>
      </aside>
      <header class="topbar">
        <div class="brand" style={{ padding: "0px" }}><i>L</i>VH Lexi</div>
        <span class="spacer" />
        <span class={`pill ${pillClass}`}><span class="dot" />{syncLabel(s)}</span>
      </header>
      <main class="main" id="main">{page}</main>
      <nav class="tabbar" aria-label="Điều hướng">
        {NAV.map((n) => (
          <a key={n.path} class="tab" href={`#${n.path}`} aria-current={current === n.path ? "page" : undefined}>
            <Icon n={n.icon} />
            {n.label}
            {n.path === "/today" && due > 0 && <span class="badge">{due}</span>}
          </a>
        ))}
      </nav>
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
