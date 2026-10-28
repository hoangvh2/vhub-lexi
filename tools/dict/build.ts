/**
 * Builds the offline dictionary pack from open sources.
 *
 *   node tools/dict/build.ts [--out dist-dict] [--copy-web] [--copy-android]
 *
 * Sources (downloaded once into tools/dict/.cache, SHA-256 pinned):
 *   - CMU Pronouncing Dictionary (pronunciation, ARPAbet -> IPA)
 *   - Princeton WordNet 3.1 via the `wordnet-db` npm package (parts of speech, definitions, examples)
 *
 * Output: <out>/<version>/{meta.json, <xx>.json}. Shards are keyed by the first two
 * letters so the web app can fetch only what a typed word needs.
 *
 * Vietnamese meanings are NOT in the pack: the Anh-Viet sources found so far have an unverified
 * licence (see docs/DICTIONARY.md). They come from the optional AI step instead.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { arpabetToIpa } from "../../shared/ipa.ts";
import { parseWordNet, type WnWord } from "./wordnet.ts";
import { parseCmudict } from "./cmudict.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const cache = join(here, ".cache");

const CMU_COMMIT = "74790861f652b15e4ac49015a90074ad62a27690";
const CMU_URL = `https://raw.githubusercontent.com/cmusphinx/cmudict/${CMU_COMMIT}/cmudict.dict`;
const WN_VERSION = "3.1.14";
const WN_URL = `https://registry.npmjs.org/wordnet-db/-/wordnet-db-${WN_VERSION}.tgz`;
/** Filled on first successful download; a mismatch afterwards aborts the build. */
const PINS: Record<string, string> = JSON.parse(readFileSync(join(here, "pins.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const outRoot = join(root, opt("--out", "dist-dict"));

async function fetchPinned(url: string, file: string): Promise<Buffer> {
  mkdirSync(cache, { recursive: true });
  const path = join(cache, file);
  let buf: Buffer;
  if (existsSync(path)) buf = readFileSync(path);
  else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(path, buf);
  }
  const sha = createHash("sha256").update(buf).digest("hex");
  if (!PINS[file]) {
    console.warn(`! No pin for ${file}; add to tools/dict/pins.json: "${file}": "${sha}"`);
  } else if (PINS[file] !== sha) {
    throw new Error(`SHA-256 mismatch for ${file}: expected ${PINS[file]}, got ${sha}`);
  }
  return buf;
}

async function main() {
  console.log("Fetching sources…");
  const cmu = await fetchPinned(CMU_URL, "cmudict.dict");
  const wnTgz = await fetchPinned(WN_URL, `wordnet-db-${WN_VERSION}.tgz`);

  const wnDir = join(cache, "wordnet-db");
  if (!existsSync(join(wnDir, "package", "dict", "index.noun"))) {
    rmSync(wnDir, { recursive: true, force: true });
    mkdirSync(wnDir, { recursive: true });
    execFileSync("tar", ["-xzf", join(cache, `wordnet-db-${WN_VERSION}.tgz`), "-C", wnDir]);
  }
  const dictDir = join(wnDir, "package", "dict");

  console.log("Parsing…");
  const prons = parseCmudict(cmu.toString("utf8"));
  const wn = parseWordNet(dictDir);

  // Assemble entries.
  const entries: Array<{ w: string; e: unknown[] }> = [];
  let withIpa = 0;
  for (const [word, rec] of wn.words) {
    const arpa = prons.get(word.replaceAll(" ", ""))?.[0] ?? prons.get(word)?.[0];
    let ipa = "";
    if (arpa) {
      try {
        ipa = arpabetToIpa(arpa);
        withIpa++;
      } catch {
        ipa = "";
      }
    }
    entries.push({ w: word, e: [word, ipa, rec.rank, rec.pos.map((p) => [p.pos, p.senses.map((s) => (s.ex.length ? [s.def, s.ex] : [s.def]))])] });
  }
  entries.sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));

  // Shard by first two letters (letters only; others go to "_").
  const shards = new Map<string, unknown[]>();
  for (const { w, e } of entries) {
    const key = /^[a-z]{2}/.test(w) ? w.slice(0, 2) : "_";
    (shards.get(key) ?? shards.set(key, []).get(key)!).push(e);
  }

  const payload = new Map<string, string>();
  for (const [k, list] of shards) payload.set(k, JSON.stringify({ v: 1, e: list }));
  const hash = createHash("sha256");
  for (const k of [...payload.keys()].sort()) hash.update(k).update(payload.get(k)!);
  const version = `v1-${hash.digest("hex").slice(0, 8)}`;

  const outDir = join(outRoot, version);
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [k, s] of payload) writeFileSync(join(outDir, `${k}.json`), s);
  const meta = {
    version,
    format: 1,
    words: entries.length,
    withIpa,
    shards: [...payload.keys()].sort(),
    sources: [
      { name: "CMU Pronouncing Dictionary", commit: CMU_COMMIT, license: "BSD-style (see CMU source repository)" },
      { name: "Princeton WordNet", version: "3.1", package: `wordnet-db@${WN_VERSION}`, license: "WordNet License (attribution)" },
    ],
  };
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta));
  writeFileSync(join(outRoot, "latest.json"), JSON.stringify({ version }));

  // Report.
  let raw = 0;
  for (const f of readdirSync(outDir)) raw += readFileSync(join(outDir, f)).length;
  const gz = gzipSync(Buffer.concat(readdirSync(outDir).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(outDir, f)))), { level: 9 }).length;
  console.log(JSON.stringify({ version, words: entries.length, withIpa, shards: payload.size, rawBytes: raw, gzipBytes: Number(gz) }, null, 2));

  if (flag("--copy-web")) {
    const dest = join(root, "web", "public", "dict");
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(outDir, join(dest, version), { recursive: true });
    writeFileSync(join(dest, "latest.json"), JSON.stringify({ version }));
    console.log(`Copied to ${dest}`);
  }
  if (flag("--copy-android")) {
    const dest = join(root, "android", "app", "src", "main", "assets", "dict");
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(outDir, dest, { recursive: true });
    console.log(`Copied to ${dest}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
