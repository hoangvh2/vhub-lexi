/**
 * Refreshes tools/dict/data/vi-wiktionary.json.gz: Vietnamese meanings for the words of the built pack.
 *
 *   node tools/dict/build.ts                       # the pack decides which words are kept
 *   node tools/dict/extract-vi.ts [--en <file>] [--vi <file>]
 *
 * Without --en/--vi the two kaikki.org extracts are streamed from the network (~3.4 GB + ~60 MB gzip),
 * which is why the result is committed instead of rebuilt on every `build.ts` run. CI runs this through
 * the "Dictionary - Vietnamese meanings" workflow.
 */
import { createReadStream, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createGunzip, gzipSync } from "node:zlib";
import { addEnglishLine, addVietnameseLine, finalize, type Collected } from "./wiktionary.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
export const EN_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl";
export const VI_URL = "https://kaikki.org/viwiktionary/raw-wiktextract-data.jsonl.gz";
export const OUT = join(here, "data", "vi-wiktionary.json.gz");

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

async function open(file: string | undefined, url: string): Promise<NodeJS.ReadableStream> {
  let s: NodeJS.ReadableStream;
  if (file) s = createReadStream(file);
  else {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
    s = Readable.fromWeb(res.body as never);
  }
  return (file ?? url).endsWith(".gz") ? s.pipe(createGunzip()) : s;
}

async function eachLine(stream: NodeJS.ReadableStream, fn: (l: string) => void): Promise<number> {
  let n = 0;
  for await (const l of createInterface({ input: stream, crlfDelay: Infinity })) {
    n++;
    fn(l);
  }
  return n;
}

async function main() {
  const dist = join(root, "dist-dict");
  const { version } = JSON.parse(readFileSync(join(dist, "latest.json"), "utf8")) as { version: string };
  const words = new Set<string>();
  for (const f of readdirSync(join(dist, version))) {
    if (f === "meta.json") continue;
    for (const e of (JSON.parse(readFileSync(join(dist, version, f), "utf8")) as { e: Array<[string]> }).e) words.add(e[0]);
  }
  const keep = (w: string) => words.has(w);
  const c: Collected = new Map();
  const en = await eachLine(await open(opt("--en"), EN_URL), (l) => addEnglishLine(c, l, keep));
  const vi = await eachLine(await open(opt("--vi"), VI_URL), (l) => addVietnameseLine(c, l, keep));
  const data = finalize(c);
  const out = {
    source: {
      name: "Wiktionary (English and Vietnamese editions) via kaikki.org / wiktextract",
      license: "CC BY-SA 4.0",
      urls: [EN_URL, VI_URL],
      fetched: new Date().toISOString().slice(0, 10),
    },
    words: data,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  // mtime 0 keeps the gzip bytes stable for identical content.
  const gz = gzipSync(Buffer.from(JSON.stringify(out)), { level: 9 });
  writeFileSync(OUT, gz);
  const n = Object.keys(data).length;
  console.log(JSON.stringify({ linesEn: en, linesVi: vi, packWords: words.size, withVi: n, gzipBytes: gz.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
