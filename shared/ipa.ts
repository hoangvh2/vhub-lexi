/**
 * ARPAbet (CMUdict) to IPA, General American.
 *
 * CMUdict marks stress on vowels (0 none, 1 primary, 2 secondary) but does not mark syllable
 * boundaries. We place the stress mark before the longest valid English onset that precedes the
 * stressed vowel, which matches how learner dictionaries print it (ˈdɪp.ə.ti, not ˈdɪ.pə.ti).
 * Single-syllable words get no stress mark, as in most dictionaries.
 */

const VOWELS: Record<string, [string, string]> = {
  // [stressed, unstressed]
  AA: ["ɑ", "ɑ"],
  AE: ["æ", "æ"],
  AH: ["ʌ", "ə"],
  AO: ["ɔ", "ɔ"],
  AW: ["aʊ", "aʊ"],
  AY: ["aɪ", "aɪ"],
  EH: ["ɛ", "ɛ"],
  ER: ["ɝ", "ɚ"],
  EY: ["eɪ", "eɪ"],
  IH: ["ɪ", "ɪ"],
  IY: ["i", "i"],
  OW: ["oʊ", "oʊ"],
  OY: ["ɔɪ", "ɔɪ"],
  UH: ["ʊ", "ʊ"],
  UW: ["u", "u"],
};

const CONSONANTS: Record<string, string> = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m",
  N: "n", NG: "ŋ", P: "p", R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j",
  Z: "z", ZH: "ʒ",
};

const STOPS = new Set(["P", "B", "T", "D", "K", "G"]);

/** Can this consonant sequence (ARPAbet symbols) begin an English syllable? */
function validOnset(c: string[]): boolean {
  if (c.length === 0 || c.length === 1) return c.length === 1 && c[0] !== "NG";
  if (c.length === 2) {
    const [a, b] = c;
    if (STOPS.has(a) && (b === "L" || b === "R" || b === "W" || b === "Y")) return !(a === "T" && b === "L") && !(a === "D" && b === "L");
    if ((a === "F" || a === "TH" || a === "SH") && (b === "L" || b === "R" || b === "W")) return !(a === "SH" && b === "L") && !(a === "SH" && b === "W");
    if (a === "V" && b === "R") return false;
    if (a === "S" && (b === "P" || b === "T" || b === "K" || b === "M" || b === "N" || b === "F" || b === "L" || b === "W")) return true;
    if (a === "HH" && b === "Y") return true;
    if (a === "M" && b === "Y" || a === "N" && b === "Y" || a === "F" && b === "Y" || a === "V" && b === "Y" || a === "K" && b === "Y") return true;
    return false;
  }
  if (c.length === 3 && c[0] === "S") {
    const [, b, d] = c;
    if (b === "P" || b === "T" || b === "K") return d === "L" || d === "R" || d === "W" || d === "Y";
  }
  return false;
}

export interface Phone {
  sym: string;
  stress: number | null; // vowels only
}

export function parseArpabet(pron: string): Phone[] {
  return pron
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([A-Z]+)([012])?$/.exec(tok);
      if (!m) throw new Error(`Bad ARPAbet token: ${tok}`);
      return { sym: m[1], stress: m[2] === undefined ? null : Number(m[2]) };
    });
}

export function arpabetToIpa(pron: string): string {
  const ph = parseArpabet(pron);
  const vowelIdx = ph.map((p, i) => (p.sym in VOWELS ? i : -1)).filter((i) => i >= 0);
  const marks = new Map<number, string>(); // index of first phone of onset -> mark
  if (vowelIdx.length > 1) {
    for (const vi of vowelIdx) {
      const st = ph[vi].stress;
      if (st !== 1 && st !== 2) continue;
      // Walk left over consonants, keeping the longest valid onset.
      let start = vi;
      let j = vi - 1;
      const cons: string[] = [];
      while (j >= 0 && !(ph[j].sym in VOWELS)) {
        cons.unshift(ph[j].sym);
        if (validOnset(cons)) start = j;
        else if (cons.length >= 3) break;
        j--;
      }
      // A stressed syllable at the start of the word takes the whole leading cluster.
      if (j < 0) start = 0;
      marks.set(start, st === 1 ? "ˈ" : "ˌ");
    }
  }
  let out = "";
  ph.forEach((p, i) => {
    const mark = marks.get(i);
    if (mark) out += mark;
    if (p.sym in VOWELS) {
      const [s, u] = VOWELS[p.sym];
      out += p.stress === 0 ? u : s;
    } else {
      const c = CONSONANTS[p.sym];
      if (!c) throw new Error(`Unknown ARPAbet symbol: ${p.sym}`);
      out += c;
    }
  });
  return out;
}
