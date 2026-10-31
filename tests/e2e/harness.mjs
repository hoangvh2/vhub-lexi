import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
export const { chromium } = require("playwright");

// The exact Content-Security-Policy production serves (firebase.json), so tests catch anything it would block.
const csp = JSON.parse(readFileSync(fileURLToPath(new URL("../../firebase.json", import.meta.url)), "utf8")).hosting.headers
  .find((h) => h.source === "/").headers.find((h) => h.key === "Content-Security-Policy").value;
const dist = join(fileURLToPath(new URL("../../web/dist", import.meta.url)));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".wasm": "application/wasm" };

/** Serves web/dist like Firebase Hosting would (static files, no SPA rewrite needed for hash routing). */
export function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    const file = join(dist, p);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    const headers = { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" };
    if (p === "/index.html") headers["content-security-policy"] = csp;
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

export async function open(browser, base, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
}

export async function addWord(page, base, word, vi) {
  await page.goto(`${base}/#/add`);
  await page.fill('[data-testid=word-input]', word);
  await page.waitForSelector('[data-testid=vi-input]');
  await page.waitForFunction((w) => document.querySelector('[data-testid=preview]')?.textContent?.toLowerCase().includes(w), word.split(" ")[0]);
  await page.fill('[data-testid=vi-input]', vi);
  await page.click('[data-testid=save-word]');
  await page.waitForFunction(() => document.querySelector('[data-testid=word-input]').value === "");
}
