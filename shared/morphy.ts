/**
 * Candidate base forms for an inflected English word ("running" -> run, "children" -> child).
 *
 * This is WordNet's morphy rule set plus consonant-doubling, as a pure function so the web app,
 * the Android app and the tests agree. The caller checks each candidate against the dictionary
 * and takes the first that exists.
 *
 * `exceptions` maps irregular forms to bases (WordNet's *.exc files), built by tools/dict.
 */

const SUFFIX_RULES: Array<[string, string]> = [
  // nouns
  ["ses", "s"], ["xes", "x"], ["zes", "z"], ["ches", "ch"], ["shes", "sh"], ["men", "man"], ["ies", "y"],
  // verbs
  ["s", ""], ["es", "e"], ["es", ""], ["ed", "e"], ["ed", ""], ["ing", "e"], ["ing", ""],
  // adjectives
  ["er", ""], ["est", ""], ["er", "e"], ["est", "e"],
];

export function baseForms(raw: string, exceptions: Readonly<Record<string, string>> = {}): string[] {
  const w = raw.trim().toLowerCase();
  if (!w) return [];
  const out: string[] = [];
  const add = (c: string) => {
    if (c.length >= 2 && c !== w && !out.includes(c)) out.push(c);
  };
  const exc = exceptions[w];
  if (exc) add(exc);
  for (const [suffix, repl] of SUFFIX_RULES) {
    if (w.length > suffix.length + 1 && w.endsWith(suffix)) {
      const stem = w.slice(0, -suffix.length) + repl;
      add(stem);
      // running -> runn -> run ; bigger -> bigg -> big
      if (repl === "" && /^(ing|ed|er|est)$/.test(suffix) && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
    }
  }
  return out;
}
