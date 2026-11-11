// Generates firestore.rules and storage.rules from their .tmpl files using ALLOWED_EMAILS (comma separated).
//   ALLOWED_EMAILS=you@gmail.com node scripts/configure.mjs
// Terraform fills the same template at deploy time; this script is for the emulator, tests and CI.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const emails = (process.env.ALLOWED_EMAILS ?? "")
  .split(/[\s,;]+/)
  .map((e) => e.trim().toLowerCase())
  .filter((e) => /^[^@\s']+@[^@\s']+\.[^@\s']+$/.test(e));
if (emails.length === 0) {
  console.error("Set ALLOWED_EMAILS to at least one valid address, e.g. ALLOWED_EMAILS=you@gmail.com");
  process.exit(1);
}
const list = emails.map((e) => `'${e}'`).join(", ");
for (const name of ["firestore.rules", "storage.rules"]) {
  const tmpl = readFileSync(root + name + ".tmpl", "utf8");
  writeFileSync(root + name, tmpl.replace("__ALLOWED_EMAILS__", list));
}
console.log(`firestore.rules and storage.rules written for ${emails.length} address(es).`);
