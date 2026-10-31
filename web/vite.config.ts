import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
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
            if (r === "dict") continue; // fetched on demand, cached by version
            walk(p, r);
          } else if (!/\.(map|woff)$/.test(n) && n !== "sw.js" && !n.startsWith("sql-wasm")) files.push("/" + r);
          // sql-wasm*: the Anki reader (~1 MB), downloaded only when the learner imports a package.
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

export default defineConfig({
  plugins: [preact(), precache()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  server: { fs: { allow: [".."] }, port: 5173 },
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1000 },
  test: { environment: "jsdom", include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"] },
});
