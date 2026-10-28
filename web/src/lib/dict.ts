/**
 * Offline dictionary client. The pack is built by tools/dict and served as static files:
 *   /dict/latest.json            -> { version }
 *   /dict/<version>/<xx>.json    -> entries whose word starts with the two letters xx ("_" for the rest)
 * Shards are fetched on demand and cached by the service worker, so looking a word up works
 * offline once its shard has been seen (and the common ones are warmed in the background).
 */
import { baseForms } from "@shared/morphy.ts";
import { IRREGULAR } from "@shared/irregular.ts";

export type PosCode = "n" | "v" | "a" | "r";
export interface DictSense {
  def: string;
  ex: string[];
}
export interface DictEntry {
  word: string;
  ipa: string;
  /** WordNet tagged-sense count: bigger = more common. */
  rank: number;
  pos: Array<{ pos: PosCode; senses: DictSense[] }>;
}
export interface Lookup {
  entry: DictEntry;
  /** Set when the typed word was an inflected form of `entry.word`. */
  inflectedFrom?: string;
}

type Raw = [string, string, number, Array<[PosCode, Array<[string, string[]?]>]>];

export function shardKey(word: string): string {
  return /^[a-z]{2}/.test(word) ? word.slice(0, 2) : "_";
}

export function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decode(r: Raw): DictEntry {
  return { word: r[0], ipa: r[1], rank: r[2], pos: r[3].map(([pos, senses]) => ({ pos, senses: senses.map(([def, ex]) => ({ def, ex: ex ?? [] })) })) };
}

export class Dictionary {
  private versionP: Promise<string | null> | null = null;
  private shards = new Map<string, Promise<DictEntry[]>>();

  constructor(
    private readonly base = "/dict",
    private readonly fetcher: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
  ) {}

  version(): Promise<string | null> {
    this.versionP ??= this.fetcher(`${this.base}/latest.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<{ version: string }>) : null))
      .then((j) => j?.version ?? null)
      .catch(() => null);
    return this.versionP;
  }

  /** True when the pack is reachable (served or cached). */
  async available(): Promise<boolean> {
    return (await this.version()) !== null;
  }

  private shard(key: string): Promise<DictEntry[]> {
    let p = this.shards.get(key);
    if (!p) {
      p = (async () => {
        const v = await this.version();
        if (!v) return [];
        const r = await this.fetcher(`${this.base}/${v}/${key}.json`);
        if (!r.ok) return [];
        const j = (await r.json()) as { e: Raw[] };
        return j.e.map(decode);
      })().catch(() => {
        this.shards.delete(key); // allow a retry (e.g. back online)
        return [];
      });
      this.shards.set(key, p);
    }
    return p;
  }

  private async exact(word: string): Promise<DictEntry | null> {
    const list = await this.shard(shardKey(word));
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = list[mid].word;
      if (w === word) return list[mid];
      if (w < word) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  async lookup(raw: string): Promise<Lookup | null> {
    const w = normalizeWord(raw);
    if (!w) return null;
    const hit = await this.exact(w);
    if (hit) return { entry: hit };
    for (const c of baseForms(w, IRREGULAR)) {
      const e = await this.exact(c);
      if (e) return { entry: e, inflectedFrom: w };
    }
    return null;
  }

  /**
   * Downloads every shard so lookups work offline for any word. The service worker keeps the
   * responses; we only read and discard them here (no parsing, so memory stays flat).
   */
  async prefetchAll(onProgress?: (done: number, total: number) => void): Promise<boolean> {
    const v = await this.version();
    if (!v) return false;
    const meta = (await (await this.fetcher(`${this.base}/${v}/meta.json`)).json()) as { shards: string[] };
    let done = 0;
    const queue = [...meta.shards];
    const worker = async () => {
      for (let k = queue.shift(); k; k = queue.shift()) {
        const r = await this.fetcher(`${this.base}/${v}/${k}.json`);
        if (!r.ok) throw new Error(`shard ${k}: ${r.status}`);
        await r.arrayBuffer();
        onProgress?.(++done, meta.shards.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return true;
  }

  /** Words starting with `prefix` (at least 2 letters), most common first. */
  async suggest(raw: string, n = 8): Promise<DictEntry[]> {
    const p = normalizeWord(raw);
    if (p.length < 2) return [];
    const list = await this.shard(shardKey(p));
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].word < p) lo = mid + 1;
      else hi = mid;
    }
    const found: DictEntry[] = [];
    for (let i = lo; i < list.length && list[i].word.startsWith(p) && found.length < 400; i++) found.push(list[i]);
    return found
      .sort((a, b) => Number(a.word.includes(" ")) - Number(b.word.includes(" ")) || b.rank - a.rank || a.word.length - b.word.length || (a.word < b.word ? -1 : 1))
      .slice(0, n);
  }
}

export const dictionary = new Dictionary();

export const POS_NAMES: Record<PosCode, string> = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
