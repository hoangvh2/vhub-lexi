#!/usr/bin/env node
// One command from "nothing" to "running": builds the function, applies Terraform (APIs, Firebase, Firestore + rules,
// App Check, Gemini key in Secret Manager, the `enrich` function, optional budget), builds the offline dictionary and the
// web app with the settings Terraform produced, and publishes it to Firebase Hosting.
//
//   node infra/deploy.mjs            ask before Terraform changes anything
//   node infra/deploy.mjs --yes      no questions (re-deploys)
//   node infra/deploy.mjs --plan     show what Terraform would change, change nothing
//   node infra/deploy.mjs --skip-web only the Terraform part (function, rules, allowlist...)
//   node infra/deploy.mjs --skip-terraform  only build + publish the web app (e.g. after fixing the Firebase sign-in)
//
// Needs: terraform (>= 1.10), gcloud, node 22, npm. Reads infra/terraform.tfvars (never committed).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIREBASE_TOOLS = "firebase-tools@15.34.1";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const infra = join(root, "infra");
const win = process.platform === "win32";
const args = new Set(process.argv.slice(2));
const skipTf = args.has("--skip-terraform");

const say = (m) => console.log(`\n\x1b[1m▶ ${m}\x1b[0m`);
const die = (m) => {
  console.error(`\n\x1b[31m✖ ${m}\x1b[0m`);
  process.exit(1);
};

function run(cmd, a, opts = {}) {
  const r = spawnSync(cmd, a, { stdio: "inherit", shell: win, ...opts });
  if (r.error) die(`Cannot run "${cmd}": ${r.error.message}`);
  if (r.status !== 0) die(`"${cmd} ${a.join(" ")}" failed (exit ${r.status}).`);
}
function capture(cmd, a, opts = {}) {
  const r = spawnSync(cmd, a, { encoding: "utf8", shell: win, ...opts });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
function need(cmd, hint) {
  if (!capture(cmd, ["--version"]).ok) die(`"${cmd}" not found. ${hint}`);
}

// ---------------------------------------------------------------- checks
say("Checking tools and configuration");
need("terraform", "Install Terraform >= 1.10 (https://developer.hashicorp.com/terraform/install).");
need("gcloud", "Install the Google Cloud CLI (https://cloud.google.com/sdk/docs/install).");
need("npm", "Install Node.js 22.");

const tfvars = join(infra, "terraform.tfvars");
if (!existsSync(tfvars)) die("infra/terraform.tfvars is missing. Copy infra/terraform.tfvars.example to infra/terraform.tfvars and fill it in.");
const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(tfvars, "utf8"))?.[1];
if (!projectId) die('project_id = "..." not found in infra/terraform.tfvars.');
console.log(`Project: ${projectId}`);

if (!capture("gcloud", ["auth", "application-default", "print-access-token"]).ok) {
  say("Signing in to Google (a browser window opens)");
  run("gcloud", ["auth", "application-default", "login"]);
}

// ---------------------------------------------------------------- function build
if (!skipTf && !args.has("--skip-build")) {
  say("Building the enrich function");
  run("npm", ["ci", "--prefix", "functions"], { cwd: root });
  run("npm", ["test", "--prefix", "functions"], { cwd: root });
  run("npm", ["run", "build", "--prefix", "functions"], { cwd: root });
}
if (!skipTf) {
  const out = join(infra, ".build", "functions");
  rmSync(join(infra, ".build"), { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(root, "functions", "lib"), join(out, "lib"), { recursive: true });
  cpSync(join(root, "functions", "package-lock.json"), join(out, "package-lock.json"));
  const pkg = JSON.parse(readFileSync(join(root, "functions", "package.json"), "utf8"));
  delete pkg.scripts; // the code is already compiled; the cloud build must not run scripts
  writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2));
}

// ---------------------------------------------------------------- terraform
if (!skipTf) {
  say("Terraform");
  run("terraform", ["init", "-input=false", "-upgrade=false"], { cwd: infra });
  if (args.has("--plan")) {
    run("terraform", ["plan", "-input=false"], { cwd: infra });
    process.exit(0);
  }
  run("terraform", ["apply", "-input=false", ...(args.has("--yes") ? ["-auto-approve"] : [])], { cwd: infra });
}

if (args.has("--skip-web")) {
  console.log("\nTerraform part done (--skip-web).");
  process.exit(0);
}

const outputs = (name) => {
  const r = capture("terraform", ["output", "-json", name], { cwd: infra });
  if (!r.ok) die(`terraform output ${name} failed: ${r.err}`);
  return JSON.parse(r.out);
};
const webEnv = outputs("web_env");
const url = outputs("url");

// ---------------------------------------------------------------- dictionary + web
say("Building the offline dictionary (CMUdict + WordNet)");
run("node", ["tools/dict/build.ts", "--copy-web"], { cwd: root });

say("Building the web app");
run("npm", ["ci", "--prefix", "web"], { cwd: root });
run("npm", ["test", "--prefix", "web"], { cwd: root });
run("npm", ["run", "build", "--prefix", "web"], { cwd: root, env: { ...process.env, ...webEnv } });

say("Publishing to Firebase Hosting");
// The Firebase CLI keeps its OWN sign-in (`firebase login`). Being signed in to gcloud does not carry over to it.
const firebase = (a) => ["--yes", FIREBASE_TOOLS, ...a];
const fb = (a) => capture("npx", firebase(a), { cwd: root });
const explain = (r) => {
  let msg = "";
  try {
    msg = String(JSON.parse(r.out).error ?? "");
  } catch {
    /* not JSON */
  }
  if (!msg) {
    msg = `${r.out}\n${r.err}`
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^npm (warn|notice)/i.test(l))
      .join("\n");
  }
  return msg || "(the Firebase CLI gave no message)";
};
const signedInAs = () => /Logged in as ([^\s]+)/i.exec(fb(["login:list"]).out)?.[1] ?? null;
const loginHelp = `Sign in to the Firebase CLI once, in a normal terminal:
    npx ${FIREBASE_TOOLS} login
  with the Google account that owns the project, then check it with:
    npx ${FIREBASE_TOOLS} login:list
  and finish with:
    node infra/deploy.mjs --skip-terraform`;

let account = signedInAs();
if (!account) {
  say("The Firebase CLI needs its own sign-in (separate from gcloud)");
  if (process.env.MSYSTEM) die(`Not signed in to the Firebase CLI, and Git Bash cannot complete the sign-in.\n  ${loginHelp}`);
  run("npx", firebase(["login"]), { cwd: root });
  account = signedInAs();
  if (!account) die(`The Firebase CLI sign-in did not complete.\n  ${loginHelp}`);
}
console.log(`Firebase CLI account: ${account}`);

const sites = fb(["hosting:sites:list", "--project", projectId, "--json"]);
if (!sites.ok) {
  const why = explain(sites);
  const hint = /authenticat|login|credential/i.test(why)
    ? loginHelp
    : /403|permission|PERMISSION_DENIED|not been used|disabled/i.test(why)
      ? `Is ${account} the Google account that owns project ${projectId}? Hosting also needs the Firebase Hosting API enabled (Terraform does this).`
      : "";
  die(`Firebase CLI could not list Hosting sites for ${projectId}:\n${why}${hint ? `\n  ${hint}` : ""}`);
}
if (!sites.out.includes(`/sites/${projectId}"`)) run("npx", firebase(["hosting:sites:create", projectId, "--project", projectId]), { cwd: root });
run("npx", firebase(["deploy", "--only", "hosting", "--project", projectId, "--non-interactive"]), { cwd: root });

// ---------------------------------------------------------------- done
const emails = outputs("allowed_emails");
const authUrl = outputs("auth_console");
console.log(`
\x1b[32m✔ Deployed.\x1b[0m

  App:        ${url}
  Allowed:    ${emails.join(", ")}

One-time manual step (about a minute), only the first time:
  1. Open ${authUrl}
  2. "Get started" > Google > Enable > pick a support email > Save.
     (Keep every other sign-in method disabled.)
Custom domain, DNS records, Android setup and common errors: infra/README.md
`);
