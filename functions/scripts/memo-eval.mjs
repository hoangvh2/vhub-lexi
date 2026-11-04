// Compares the memory hook ("Mẹo nhớ") written by the enrich prompt on `main` (before) and in this checkout (after),
// on real TOEIC words, with the real Gemini model. Nothing is written to Firestore.
//
//   cd functions
//   $env:GEMINI_API_KEY = (gcloud secrets versions access latest --secret=<gemini secret id>)   # PowerShell
//   node scripts/memo-eval.mjs [--base main] [--model gemini-3.5-flash-lite] [--out memo-eval.md] [word ...]
//
// Only `git` and Node are needed (no shell), so it runs the same on Windows and Linux.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

// 20 words from "600 Essential Words for the TOEIC": some with an obvious Vietnamese sound-alike, most without.
const WORDS = [
  "convince", "inspiration", "invoice", "bargain", "tax", "lend", "reliable", "negotiate", "warranty", "inventory",
  "refund", "postpone", "attract", "compromise", "consume", "expand", "merchandise", "candidate", "deadline", "afford",
];

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : def;
};
const base = opt("base", "main");
const model = opt("model", process.env.GEMINI_MODEL || "gemini-3.5-flash-lite");
const out = opt("out", "memo-eval.md");
const words = args.length ? args : WORDS;
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Set GEMINI_API_KEY first (see the header of this file).");
  process.exit(1);
}

/** Bundles one version of enrich.ts (+ gemini.ts) and imports it. */
async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
  const tmp = mkdtempSync(join(tmpdir(), "memo-eval-"));
  const file = join(tmp, "m.mjs");
  writeFileSync(file, r.outputFiles[0].text);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const entry = (enrichFile) => `export * from ${JSON.stringify(enrichFile)}; export { GeminiClient } from ${JSON.stringify(join(src, "gemini.ts"))};`;
async function loadVersion(enrichFile) {
  const tmp = join(src, `.memo-eval-${process.pid}-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(tmp, entry(enrichFile));
  try {
    return await load(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// The base version is written next to the real one so its relative imports (./config, ./gemini) resolve.
const baseFile = join(src, `.enrich-base-${process.pid}.ts`);
writeFileSync(baseFile, execFileSync("git", ["show", `${base}:functions/src/enrich.ts`], { encoding: "utf8" }));
let before, after;
try {
  before = await loadVersion(baseFile);
  after = await loadVersion(join(src, "enrich.ts"));
} finally {
  rmSync(baseFile, { force: true });
}

const client = new after.GeminiClient({ apiKey, model, ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}) });
const cell = (t) => (t ?? "—").replace(/\|/g, "\\|");
const rows = [];
const usage = { before: { in: 0, out: 0, n: 0 }, after: { in: 0, out: 0, n: 0 } };
for (const word of words) {
  const row = { word };
  for (const [name, mod] of [["before", before], ["after", after]]) {
    const input = mod.parseEnrichInput({ word });
    try {
      const { text, usage: u } = await client.generate(mod.SYSTEM_PROMPT, mod.buildUserPrompt(input));
      const r = mod.parseEnrichResult(text, input);
      row[name] = r.mnemonic;
      row[`${name}Vi`] = r.vi;
      usage[name].in += u.input;
      usage[name].out += u.output + u.thinking;
      usage[name].n++;
    } catch (e) {
      row[name] = `(lỗi: ${e.message})`;
    }
  }
  rows.push(row);
  console.log(`${word}\n  before: ${row.before ?? "—"}\n  after:  ${row.after ?? "—"}`);
}

// Gemini 3.5 Flash-Lite paid tier, USD per 1M tokens (ai.google.dev/pricing, read 2026-10-30).
const PRICE = { in: 0.3, out: 2.5 };
const avg = (u) => (u.n ? { in: Math.round(u.in / u.n), out: Math.round(u.out / u.n), usd: (u.in * PRICE.in + u.out * PRICE.out) / 1e6 / u.n } : { in: 0, out: 0, usd: 0 });
const len = (k) => Math.round(rows.reduce((s, r) => s + (r[k]?.length ?? 0), 0) / rows.length);
const b = avg(usage.before);
const a = avg(usage.after);
const md = [
  `# Mẹo nhớ: trước / sau (${model}, ${new Date().toISOString().slice(0, 10)})`,
  "",
  `| | Trước (${base}) | Sau |`,
  "|---|---|---|",
  `| Độ dài mẹo trung bình (ký tự) | ${len("before")} | ${len("after")} |`,
  `| Token vào / ra mỗi từ | ${b.in} / ${b.out} | ${a.in} / ${a.out} |`,
  `| Chi phí mỗi từ (USD, giá trả phí) | ${b.usd.toFixed(5)} | ${a.usd.toFixed(5)} |`,
  "",
  "| Từ | Nghĩa (sau) | Trước | Sau |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.word} | ${cell(r.afterVi)} | ${cell(r.before)} | ${cell(r.after)} |`),
  "",
].join("\n");
writeFileSync(out, md);
console.log(`\nWrote ${out}`);
