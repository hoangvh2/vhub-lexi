/**
 * Compiles shared/seed/grammar-toeic.txt (the grammar traps, written by hand) into shared/seed/grammar-toeic.json,
 * the file both apps load. Refuses to write when the text has problems (see seedProblems in shared/seed.ts).
 *
 *   node tools/seed/build.ts          write the JSON
 *   node tools/seed/build.ts --check  only check; exit 1 when the JSON is missing, stale or the text has problems
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAMMAR_PACK, buildPack } from "./pack.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../shared/seed");
const { json, problems, pack } = buildPack(readFileSync(join(dir, GRAMMAR_PACK.text), "utf8"));
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} problem(s); ${GRAMMAR_PACK.json} not written.`);
  process.exit(1);
}
const out = join(dir, GRAMMAR_PACK.json);
if (process.argv.includes("--check")) {
  const same = existsSync(out) && readFileSync(out, "utf8") === json;
  console.log(same ? `${GRAMMAR_PACK.json} is up to date` : `${GRAMMAR_PACK.json} is stale: run node tools/seed/build.ts`);
  process.exit(same ? 0 : 1);
}
writeFileSync(out, json);
const items = pack.notes.reduce((n, x) => n + (Array.isArray(x.fields.items) ? x.fields.items.length : 0), 0);
console.log(`${GRAMMAR_PACK.json}: ${pack.notes.length} patterns, ${items} sentences, version ${pack.version}`);
