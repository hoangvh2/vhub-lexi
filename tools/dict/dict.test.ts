import { test } from "node:test";
import assert from "node:assert/strict";
import { arpabetToIpa } from "../../shared/ipa.ts";
import { baseForms } from "../../shared/morphy.ts";
import { IRREGULAR } from "../../shared/irregular.ts";
import { splitGloss } from "./wordnet.ts";
import { parseCmudict } from "./cmudict.ts";

test("arpabet -> ipa places stress before the onset", () => {
  assert.equal(arpabetToIpa("S EH2 R AH0 N D IH1 P AH0 T IY0"), "ˌsɛrənˈdɪpəti");
  assert.equal(arpabetToIpa("R IH0 Z IH1 L Y AH0 N T"), "rɪˈzɪljənt");
  assert.equal(arpabetToIpa("HH AH0 L OW1"), "həˈloʊ");
  assert.equal(arpabetToIpa("S T R IY1 T"), "strit"); // one syllable: no mark
  assert.equal(arpabetToIpa("EH1 K S T R AH0"), "ˈɛkstrə");
  assert.equal(arpabetToIpa("P R AH0 K R AE1 S T AH0 N EY2 T"), "prəˈkræstəˌneɪt");
  assert.equal(arpabetToIpa("CH IY1 Z"), "tʃiz");
});

test("baseForms handles regular and irregular inflection", () => {
  assert.ok(baseForms("running").includes("run"));
  assert.ok(baseForms("studies").includes("study"));
  assert.ok(baseForms("boxes").includes("box"));
  assert.ok(baseForms("bigger").includes("big"));
  assert.ok(baseForms("loved").includes("love"));
  assert.ok(baseForms("went", IRREGULAR).includes("go"));
  assert.ok(baseForms("children", IRREGULAR).includes("child"));
  assert.deepEqual(baseForms("a"), []);
  assert.ok(!baseForms("cat").includes("cat"));
});

test("gloss splitting separates definition and quoted examples", () => {
  const g = splitGloss('able to recover; elastic; "clean bouncy hair"; "a lively tennis ball"');
  assert.equal(g.def, "able to recover; elastic");
  assert.deepEqual(g.ex, ["clean bouncy hair", "a lively tennis ball"]);
  assert.deepEqual(splitGloss("plain definition"), { def: "plain definition", ex: [] });
});

test("cmudict parser keeps variants and drops comments", () => {
  const m = parseCmudict(";;; c\nread R EH1 D\nread(2) R IY1 D # x\n");
  assert.deepEqual(m.get("read"), ["R EH1 D", "R IY1 D"]);
});
