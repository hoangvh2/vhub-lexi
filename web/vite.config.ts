import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Lists the built files in the service worker so the shell works offline after the first visit. */
function precache(): Plugin {
  let outDir = "dist";
  return {
    name: "lexi-precache",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string, rel = "") => {
        for (const n of readdirSync(dir)) {
          const p = join(dir, n);
          const r = rel ? `${rel}/${n}` : n;
          if (statSync(p).isDirectory()) {
            if (r === "dict" || r.startsWith("pdfjs-")) continue; // fetched on demand, cached by version
            walk(p, r);
          } else if (!/\.(map|woff)$/.test(n) && n !== "sw.js" && !/^(sql-wasm|fsrs-binding|optimizer\.worker|pdf)/.test(n)) files.push("/" + r);
          // sql-wasm*: the Anki reader (~1 MB), downloaded only when the learner imports a package. fsrs-binding*,
          // optimizer.worker*: the FSRS optimizer (~1.6 MB), only when they press "Tối ưu". pdf*: pdf.js and its worker
          // (~1.5 MB), only when a test PDF is picked. All cached on first use.
        }
      };
      walk(outDir);
      const swPath = join(outDir, "sw.js");
      files.sort();
      const build = createHash("sha256").update(files.join("|")).digest("hex").slice(0, 10);
      const sw = readFileSync(swPath, "utf8").replace("__PRECACHE__", JSON.stringify(files)).replace("__BUILD__", build);
      writeFileSync(swPath, sw);
    },
  };
}

/**
 * pdf.js decodes the images of copier scans (CCITT fax, JBIG2), JPEG 2000 and colour profiles with WebAssembly it
 * fetches from `wasmUrl`. Served from this site under a versioned folder (fetched only when a scan is rendered).
 */
const PDFJS_DIR = `pdfjs-${JSON.parse(readFileSync(fileURLToPath(new URL("./node_modules/pdfjs-dist/package.json", import.meta.url)), "utf8")).version}`;
function pdfjsWasm(): Plugin {
  const src = fileURLToPath(new URL("./node_modules/pdfjs-dist/wasm/", import.meta.url));
  return {
    name: "lexi-pdfjs-wasm",
    apply: "build",
    generateBundle() {
      for (const n of readdirSync(src)) {
        // The decoders and their licences; not the eval stand-in (eval is off) nor the JS fallbacks (wasm is allowed).
        if (/^(jbig2|openjpeg|qcms_bg)\.wasm$|^LICENSE_/.test(n)) this.emitFile({ type: "asset", fileName: `${PDFJS_DIR}/${n}`, source: readFileSync(join(src, n)) });
      }
    },
  };
}

/** Shown in Settings, so the build a phone runs can be told apart: short commit and build date (no shell: Windows). */
function buildId(): string {
  let sha = "dev";
  try {
    sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || sha;
  } catch {
    // Not a git checkout (CI tarball): the date alone still tells builds apart.
  }
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`;
}

export default defineConfig({
  define: { __LEXI_BUILD__: JSON.stringify(buildId()), __PDFJS_WASM__: JSON.stringify(`/${PDFJS_DIR}/`) },
  plugins: [preact(), pdfjsWasm(), precache()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  server: { fs: { allow: [".."] }, port: 5173 },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1000 },
  // Module workers: the FSRS optimizer worker loads its WebAssembly with top-level await.
  worker: { format: "es" },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"] },
});
