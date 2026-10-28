// Renders web/public/icons/*.png from icon.svg with Chromium (Playwright). Run: node scripts/render-icons.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = fileURLToPath(new URL("../web/public/icons/", import.meta.url));
const svg = readFileSync(dir + "icon.svg", "utf8");
const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["apple-touch-icon.png", 180, false],
  ["icon-maskable-512.png", 512, true],
];
const browser = await chromium.launch();
for (const [file, size, maskable] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // Maskable icons need the artwork inside the central 80% safe zone and a full-bleed background.
  const body = maskable
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><rect width="512" height="512" fill="#0e7c66"/><g transform="translate(51.2 51.2) scale(.8)">${inner.replace(/<rect width="512" height="512" rx="112" fill="#0e7c66"\/>/, "")}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${inner}</svg>`;
  await page.setContent(`<body style="margin:0;background:transparent">${body}</body>`);
  writeFileSync(dir + file, await page.screenshot({ omitBackground: true }));
  await page.close();
}
await browser.close();
console.log("icons rendered");
