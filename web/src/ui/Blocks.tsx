import type { Block } from "@shared/notetypes.ts";
import { speak, speechAvailable } from "../lib/speech.ts";
import { Icon } from "./common.tsx";

/** Renders template blocks (shared/notetypes.ts). The same description drives the Android UI. */
export function Blocks({ blocks, cloze }: { blocks: Block[]; cloze?: boolean }) {
  return (
    <div class="blocks">
      {blocks.map((b, i) => {
        switch (b.k) {
          case "title":
            return <div class="b-title" key={i}>{b.text}</div>;
          case "ipa":
            return <div class="b-ipa" key={i}>/{b.text.replace(/^\/|\/$/g, "")}/</div>;
          case "badge":
            return <span class="b-badge" key={i}>{b.text}</span>;
          case "speak":
            return speechAvailable() ? (
              <button type="button" class="speak" key={i} onClick={(e) => (e.stopPropagation(), speak(b.text))} aria-label={`Nghe phát âm ${b.text}`} data-testid="speak">
                <Icon n="speaker" size={18} /> Nghe
              </button>
            ) : null;
          case "quote":
            return <div class={`b-quote${cloze && b.text.includes("_____") ? " cloze" : ""}`} key={i}>{b.text}</div>;
          case "text":
            return <div class={b.tone === "strong" ? "b-strong" : b.tone === "muted" ? "b-muted" : ""} key={i}>{b.text}</div>;
        }
      })}
    </div>
  );
}
