// Checks the short phrases ("cụm ngắn", one per meaning) written by the enrich function's phrases prompt, on real TOEIC words
// that have several meanings, with the real Gemini model. Nothing is written to Firestore.
//
//   cd functions
//   $env:GEMINI_API_KEY = (gcloud secrets versions access latest --secret=<gemini secret id>)   # PowerShell
//   node scripts/phrases-eval.mjs [--model gemini-3.5-flash-lite] [--out phrases-eval.md]
//
// The report lists every phrase next to the meaning it was written for, so you can judge by eye whether each one
// really points at ONE meaning (the point of the feature), plus automatic checks: how many phrases the server kept,
// how many words got 3, and the tokens and cost per word. Only Node is needed (no shell), so it runs the same on Windows and Linux.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

// [word, part of speech, the Vietnamese meanings a learner would already have for it]
const WORDS = [
  ["accommodate", "verb", "chứa được; đáp ứng; tạo điều kiện"],
  ["address", "verb", "giải quyết; phát biểu trước; đề cập"],
  ["issue", "noun", "vấn đề; số báo; sự phát hành"],
  ["charge", "noun", "phí; trách nhiệm; lời buộc tội"],
  ["appeal", "verb", "thu hút; kháng cáo; kêu gọi"],
  ["file", "verb", "nộp hồ sơ; lưu hồ sơ"],
  ["handle", "verb", "xử lý; đảm nhiệm; cầm"],
  ["claim", "noun", "yêu cầu bồi thường; lời tuyên bố"],
  ["figure", "noun", "con số; nhân vật; hình dáng"],
  ["present", "verb", "trình bày; tặng; giới thiệu"],
  ["party", "noun", "bên (trong hợp đồng); bữa tiệc"],
  ["term", "noun", "điều khoản; thời hạn; thuật ngữ"],
  ["cover", "verb", "bao gồm; chi trả; che phủ"],
  ["draft", "noun", "bản nháp; luồng gió; đợt tuyển"],
  ["run", "verb", "điều hành; chạy; vận hành"],
  ["deliver", "verb", "giao hàng; trình bày bài nói; mang lại kết quả"],
  ["meet", "verb", "gặp gỡ; đáp ứng yêu cầu; thanh toán"],
  ["reserve", "verb", "đặt trước; dự trữ"],
  ["apply", "verb", "nộp đơn; áp dụng; bôi"],
  ["reliable", "adjective", "đáng tin cậy"], // one meaning: three collocations, never three invented senses
];

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const model = opt("model", process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
const out = opt("out", "phrases-eval.md");
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY first (see the header of this file).");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "phrases-eval-"));
let mod;
try {
  const entry = join(src, `.phrases-eval-${process.pid}.ts`);
  writeFileSync(entry, `export * from ${JSON.stringify(join(src, "enrich.ts"))}; export { GeminiClient } from ${JSON.stringify(join(src, "gemini.ts"))};`);
  try {
    const r = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
    const file = join(tmp, "m.mjs");
    writeFileSync(file, r.outputFiles[0].text);
    mod = await import(pathToFileURL(file).href);
  } finally {
    rmSync(entry, { force: true });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const client = new mod.GeminiClient({ apiKey, model, ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}) });
const cell = (t) => (t ?? "—").replace(/\|/g, "\\|");
const rows = [];
const usage = { in: 0, out: 0, n: 0 };
let rawTotal = 0;
let keptTotal = 0;
for (const [word, pos, vi] of WORDS) {
  const input = mod.parseEnrichInput({ word, pos, vi, only: "phrases" });
  const row = { word, vi, phrases: [], raw: 0 };
  try {
    const { text, usage: u } = await client.generate(mod.PHRASES_PROMPT, mod.buildUserPrompt(input));
    usage.in += u.input;
    usage.out += u.output + u.thinking;
    usage.n++;
    row.raw = (JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")).phrases ?? []).length;
    row.phrases = mod.parsePhrasesResult(text, input).phrases;
  } catch (e) {
    row.error = e.message;
  }
  rawTotal += row.raw;
  keptTotal += row.phrases.length;
  rows.push(row);
  console.log(`${word}: ${row.phrases.length}/${row.raw} kept${row.error ? ` (${row.error})` : ""}\n${row.phrases.map((p) => `  ${p}`).join("\n")}`);
}

// Gemini 3.5 Flash-Lite paid tier, USD per 1M tokens (ai.google.dev/pricing, read 2026-10-30).
const PRICE = { in: 0.3, out: 2.5 };
const n = usage.n || 1;
const usd = (usage.in * PRICE.in + usage.out * PRICE.out) / 1e6 / n;
const three = rows.filter((r) => r.phrases.length === 3).length;
const failed = rows.filter((r) => r.error).length;
const md = [
  `# Cụm ngắn theo nghĩa (${model}, ${new Date().toISOString().slice(0, 10)})`,
  "",
  "| Kiểm tra tự động | Kết quả |",
  "|---|---|",
  `| Từ được thử | ${rows.length} |`,
  `| Từ có đủ 3 cụm hợp lệ | ${three} |`,
  `| Từ không có cụm hợp lệ nào (lỗi) | ${failed} |`,
  `| Cụm AI viết / cụm máy chủ giữ lại | ${rawTotal} / ${keptTotal} |`,
  `| Token vào / ra mỗi từ | ${Math.round(usage.in / n)} / ${Math.round(usage.out / n)} |`,
  `| Chi phí mỗi từ (USD, giá trả phí) | ${usd.toFixed(5)} |`,
  `| Ước tính 600 từ (USD) | ${(usd * 600).toFixed(2)} |`,
  "",
  "Bạn đọc cột cụm và tự chấm: mỗi cụm có chỉ ra đúng MỘT nghĩa, và khi che từ đi thì có đoán ra từ không? Từ cuối (reliable) chỉ có 1 nghĩa, nên 3 cụm cùng một nghĩa là đúng.",
  "",
  "| Từ | Nghĩa đã học | Cụm → nghĩa trong cụm |",
  "|---|---|---|",
  ...rows.map((r) => `| ${r.word} | ${cell(r.vi)} | ${r.error ? `(lỗi: ${cell(r.error)})` : r.phrases.map((p) => cell(p)).join("<br>")} |`),
  "",
].join("\n");
writeFileSync(out, md);
console.log(`\nWrote ${out}`);
