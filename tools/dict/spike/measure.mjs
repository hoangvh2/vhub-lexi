// Spike: how many dictionary headwords get a Vietnamese meaning from Wiktionary (kaikki.org extracts)?
// node tools/dict/spike/measure.mjs <dist-dict/version dir> <en.jsonl> <vi.jsonl> <google-10k.txt>
import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";

const [packDir, enFile, viFile, freqFile] = process.argv.slice(2);
const pack = new Map(); // word -> rank
for (const f of readdirSync(packDir)) {
  if (f === "meta.json" || !f.endsWith(".json")) continue;
  for (const e of JSON.parse(readFileSync(`${packDir}/${f}`, "utf8")).e) pack.set(e[0], { rank: e[2], pos: e[3].map((p) => p[0]) });
}
const add = (m, w, pos, v) => {
  w = w.toLowerCase();
  if (!pack.has(w) || !v) return;
  const r = m.get(w) ?? m.set(w, []).get(w);
  r.push(`${pos}: ${v}`);
};

async function lines(file, fn) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let n = 0;
  for await (const l of rl) { n++; fn(l); }
  return n;
}

const en = new Map();
const enLines = await lines(enFile, (l) => {
  if (!l.includes('"vi"')) return;
  const o = JSON.parse(l);
  if (o.lang_code !== "en") return;
  const tr = [...(o.translations ?? []), ...(o.senses ?? []).flatMap((s) => s.translations ?? [])];
  for (const t of tr) if ((t.lang_code ?? t.code) === "vi" && t.word) add(en, o.word, o.pos, t.sense ? `${t.word} (${t.sense.slice(0, 40)})` : t.word);
});
const vi = new Map();
const viLines = await lines(viFile, (l) => {
  if (!l.includes('"en"')) return;
  const o = JSON.parse(l);
  if (o.lang_code !== "en") return;
  for (const s of o.senses ?? []) for (const g of s.glosses ?? []) add(vi, o.word, o.pos, g);
});

const freq = readFileSync(freqFile, "utf8").split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((w) => pack.has(w));
const pct = (a, b) => `${a}/${b} (${((100 * a) / b).toFixed(1)}%)`;
const cov = (words, m) => words.filter((w) => m.has(w)).length;
const either = new Map([...en, ...vi]);
const all = [...pack.keys()];
const single = all.filter((w) => !w.includes(" ") && !w.includes("-"));
const out = [];
out.push(`Lines read: en=${enLines} vi=${viLines}`);
out.push(`Pack words ${all.length}, single words ${single.length}, Google-10k words in pack ${freq.length}`);
for (const [name, m] of [["en-wiktionary translations", en], ["vi-wiktionary glosses", vi], ["either", either]]) {
  out.push(`${name}: all ${pct(cov(all, m), all.length)} | single ${pct(cov(single, m), single.length)} | top1k ${pct(cov(freq.slice(0, 1000), m), Math.min(1000, freq.length))} | top5k ${pct(cov(freq.slice(0, 5000), m), Math.min(5000, freq.length))} | top10k ${pct(cov(freq, m), freq.length)}`);
}
const size = (m) => gzipSync(Buffer.from(JSON.stringify([...m]))).length;
out.push(`gzip size: en ${size(en)} B, vi ${size(vi)} B`);
out.push("--- samples (frequency rank: word => vi-wiktionary || en-wiktionary)");
const picks = [0, 5, 20, 50, 100, 200, 300, 500, 800, 1200, 1600, 2000, 2500, 3000, 3500, 4000, 5000, 6000, 7000, 8000, 9000].map((i) => freq[i]).filter(Boolean);
for (const w of [...picks, "book", "run", "set", "get", "deadline", "invoice", "negotiate", "commute", "email", "app", "procurement", "reimburse", "itinerary", "ubiquitous", "mitigate", "take off", "look forward to"]) {
  out.push(`${w} => VI: ${(vi.get(w) ?? []).slice(0, 4).join(" | ").slice(0, 260) || "-"} || EN: ${(en.get(w) ?? []).slice(0, 5).join(" | ").slice(0, 200) || "-"}`);
}
const missTop = freq.slice(0, 3000).filter((w) => !either.has(w));
out.push(`--- top-3000 missing in both (${missTop.length}): ${missTop.slice(0, 80).join(", ")}`);
console.log(out.join("\n"));
