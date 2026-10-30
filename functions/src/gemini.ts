import { GEMINI_BASE_URL } from "./config";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /** Per attempt. */
  timeoutMs?: number;
  /** Pause before the single retry. */
  retryDelayMs?: number;
}

/** A failure the user can be told about in one sentence. The upstream body is never forwarded. */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Gemini `generateContent` over REST. The key travels in a header (never in the URL, so it cannot
 * land in a log line). Nothing is stored on the Gemini side by this client.
 */
export class GeminiClient {
  constructor(private readonly cfg: GeminiConfig) {}

  /** Text in, JSON text out. */
  async generateJson(system: string, user: string): Promise<string> {
    return (await this.generate(system, user)).text;
  }

  /** Same, plus the token counts Gemini bills for (to measure the real cost per word). */
  generate(system: string, user: string): Promise<{ text: string; usage: TokenUsage }> {
    return this.call({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json", maxOutputTokens: 1400 },
    });
  }

  private async call(body: unknown): Promise<{ text: string; usage: TokenUsage }> {
    const url = `${this.cfg.baseUrl ?? GEMINI_BASE_URL}/models/${encodeURIComponent(this.cfg.model)}:generateContent`;
    const doFetch = this.cfg.fetchImpl ?? fetch;
    let last: GeminiError | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.cfg.retryDelayMs ?? 1_000));
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 40_000),
        });
        if (res.ok) {
          const json = await res.text();
          return { text: parseGenerateResponse(json), usage: parseUsage(json) };
        }
        const retryable = res.status === 429 || res.status >= 500;
        last = new GeminiError(describeStatus(res.status), retryable, res.status);
      } catch (e) {
        if (e instanceof GeminiError) {
          last = e;
        } else {
          last = new GeminiError("Không kết nối được tới Gemini", true);
        }
      }
      if (!last.retryable) break;
    }
    throw last ?? new GeminiError("Gemini không phản hồi", true);
  }
}

/** Billed tokens of one call; thinking tokens are billed at the output price. */
export interface TokenUsage {
  input: number;
  output: number;
  thinking: number;
}

export function parseUsage(json: string): TokenUsage {
  try {
    const u = (JSON.parse(json) as { usageMetadata?: Record<string, unknown> }).usageMetadata ?? {};
    const n = (v: unknown) => (typeof v === "number" && v >= 0 ? v : 0);
    return { input: n(u.promptTokenCount), output: n(u.candidatesTokenCount), thinking: n(u.thoughtsTokenCount) };
  } catch {
    return { input: 0, output: 0, thinking: 0 };
  }
}

function describeStatus(status: number): string {
  if (status === 429) return "Gemini đang quá tải hoặc hết hạn mức, thử lại sau ít phút";
  if (status === 401 || status === 403) return "Khoá Gemini bị từ chối, cần kiểm tra cấu hình";
  if (status === 400) return "Gemini từ chối yêu cầu";
  return "Gemini gặp lỗi tạm thời";
}

/** Joins the text parts of the first candidate, skipping the model's "thought" parts. */
export function parseGenerateResponse(json: string): string {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    throw new GeminiError("Phản hồi của Gemini không đọc được", true);
  }
  const r = root as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  const first = r.candidates?.[0];
  if (!first) {
    const reason = r.promptFeedback?.blockReason;
    throw new GeminiError(reason ? "Gemini từ chối nội dung này" : "Gemini không trả kết quả", !reason);
  }
  const text = (first.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new GeminiError("Gemini trả kết quả rỗng", first.finishReason === undefined || first.finishReason === "OTHER");
  return text;
}
