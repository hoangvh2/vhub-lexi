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
            return <div class={b.tone === "strong" ? "b-strong" : b.tone === "muted" ? "b-muted" : "b-plain"} key={i}>{b.text}</div>;
          case "example":
            return (
              <div class="b-ex" key={i} data-testid="example">
                <div class="b-ex-en">
                  <span>
                    {b.at ? (
                      <>
                        {b.text.slice(0, b.at[0])}
                        <mark>{b.text.slice(b.at[0], b.at[1])}</mark>
                        {b.text.slice(b.at[1])}
                      </>
                    ) : (
                      b.text
                    )}
                  </span>
                  {speechAvailable() && (
                    <button type="button" class="b-ex-say" onClick={(e) => (e.stopPropagation(), speak(b.text))} aria-label="Nghe câu ví dụ">
                      <Icon n="speaker" size={16} />
                    </button>
                  )}
                </div>
                {b.vi && <div class="b-ex-vi">{b.vi}</div>}
              </div>
            );
          case "memo":
            return (
              <div class="b-memo" key={i} data-testid="memo">
                <span class="b-memo-lbl"><Icon n="sparkle" size={14} /> Mẹo nhớ</span>
                {b.text}
              </div>
            );
          case "fold":
            return (
              <details class="b-fold" key={i} onClick={(e) => e.stopPropagation()}>
                <summary>{b.label}</summary>
                <p>{b.text}</p>
              </details>
            );
          case "listen":
            return <Listen key={i} text={b.text} />;
        }
      })}
    </div>
  );
}

/** Listening cards: a large play button and a slower replay. */
function Listen({ text }: { text: string }) {
  if (!speechAvailable()) return <div class="b-muted">Trình duyệt này không đọc được câu. Hãy điền theo ngữ cảnh.</div>;
  return (
    <div class="b-listen">
      <button type="button" class="b-listen-play" onClick={(e) => (e.stopPropagation(), speak(text))} aria-label="Nghe câu" data-testid="listen-play">
        <Icon n="speaker" size={34} />
      </button>
      <button type="button" class="btn ghost sm" onClick={(e) => (e.stopPropagation(), speak(text, 0.7))} data-testid="listen-slow">
        Nghe chậm
      </button>
    </div>
  );
}
