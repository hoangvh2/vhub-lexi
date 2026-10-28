/** Parses cmudict.dict ("word PH1 PH2 …", variants "word(2) …", comments after ';;;' or '#'). */
export function parseCmudict(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const raw of text.split("\n")) {
    if (!raw || raw.startsWith(";;;")) continue;
    const line = raw.split("#")[0].trim();
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const word = line.slice(0, sp).replace(/\(\d+\)$/, "").toLowerCase();
    const pron = line.slice(sp + 1).trim();
    if (!pron) continue;
    const list = out.get(word);
    if (list) list.push(pron);
    else out.set(word, [pron]);
  }
  return out;
}
