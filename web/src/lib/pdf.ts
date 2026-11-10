/**
 * Reads a test PDF in the browser with pdf.js: the text of each page in reading order (two-column pages read left
 * column first), and a JPEG of a page for scans. Nothing leaves the device here; pdf.js (~1.5 MB with its worker) is
 * downloaded only when a PDF is picked.
 */
import type { PdfPage } from "./testset.ts";
import { SCANNED_BELOW } from "./testset.ts";

/** The part of pdf.js used here (the browser build and the Node "legacy" build used by the tests have it). */
export interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean; useSystemFonts?: boolean }): { promise: Promise<PdfDocProxy>; destroy(): Promise<void> };
}
interface PdfDocProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
}
/** An open PDF; `close()` frees pdf.js's worker-side copy of it. */
export interface PdfDoc extends PdfDocProxy {
  close(): Promise<void>;
}
interface PdfPageProxy {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[]; width?: number; height?: number; hasEOL?: boolean }> }>;
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; canvas?: HTMLCanvasElement }): { promise: Promise<void> };
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** pdf.js for the browser, with its worker served from this site (CSP worker-src 'self'). */
async function browserPdfJs(): Promise<PdfJs> {
  // Bundled as a module worker (.js, served like every other script), handed to pdf.js as a port.
  const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?worker")]);
  lib.GlobalWorkerOptions.workerPort ??= new worker.default();
  return lib as unknown as PdfJs;
}

/**
 * Text items → lines in reading order. A page is two columns when most items sit wholly on one side of the middle
 * and a good share sit on the right; then the full-width lines above the columns come first, the left column,
 * the right column, then full-width lines below.
 */
export function layoutText(items: readonly TextItem[], pageWidth: number): string {
  const words = items.filter((i) => i.str.trim());
  if (!words.length) return "";
  const mid = pageWidth / 2;
  const side = (i: TextItem) => (i.x + i.w <= mid + 2 ? "L" : i.x >= mid - 2 ? "R" : "X");
  const counts = { L: 0, R: 0, X: 0 };
  for (const i of words) counts[side(i)]++;
  const twoCol = counts.R >= words.length * 0.2 && counts.L >= words.length * 0.2 && counts.X <= words.length * 0.12;
  if (!twoCol) return lines(words);
  const colItems = words.filter((i) => side(i) !== "X");
  const top = Math.max(...colItems.map((i) => i.y));
  const bottom = Math.min(...colItems.map((i) => i.y));
  const above = words.filter((i) => side(i) === "X" && i.y > top);
  const below = words.filter((i) => side(i) === "X" && i.y < bottom);
  const inside = words.filter((i) => side(i) === "X" && i.y <= top && i.y >= bottom);
  return [lines(above), lines([...words.filter((i) => side(i) === "L"), ...inside.filter((i) => i.x < mid)]), lines([...words.filter((i) => side(i) === "R"), ...inside.filter((i) => i.x >= mid)]), lines(below)]
    .filter(Boolean)
    .join("\n\n");
}

/** Items → text lines top to bottom: same baseline (within half a line) = same line; a tall gap = a blank line. */
function lines(items: readonly TextItem[]): string {
  if (!items.length) return "";
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const tol = Math.max(2, (it.h || 10) * 0.5);
    if (row && Math.abs(row[0].y - it.y) <= tol) row.push(it);
    else rows.push([it]);
  }
  const out: string[] = [];
  let prevY: number | null = null;
  let prevH = 10;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let line = "";
    let end = -Infinity;
    for (const it of row) {
      const gap = it.x - end;
      line += line && gap > 1 && !line.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
      line += it.str;
      end = it.x + it.w;
    }
    const y = row[0].y;
    if (prevY !== null && prevY - y > prevH * 2.2) out.push("");
    out.push(line.replace(/\s+/g, " ").trim());
    prevY = y;
    prevH = Math.max(6, row[0].h || 10);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function openPdf(data: Uint8Array, lib?: PdfJs): Promise<PdfDoc> {
  const pdfjs = lib ?? (await browserPdfJs());
  // No eval (the site's CSP forbids it), no font loading: only the text and the picture are needed.
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  return { numPages: doc.numPages, getPage: (n) => doc.getPage(n), close: () => task.destroy() };
}

/** Text of every page in reading order, and whether the page has to be read as a picture. */
export async function readPages(doc: PdfDoc, onPage?: (n: number) => void): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: TextItem[] = tc.items
      .filter((i) => typeof i.str === "string" && i.transform)
      .map((i) => ({ str: i.str!, x: i.transform![4], y: i.transform![5], w: i.width ?? 0, h: i.height || Math.abs(i.transform![3]) || 10 }));
    const text = layoutText(items, vp.width);
    pages.push({ n, text, scanned: text.replace(/\s/g, "").length < SCANNED_BELOW });
    onPage?.(n);
  }
  return pages;
}

/** Longest side of a rendered page: enough for the model to read 9-pt print, small enough for the function's limit. */
const RENDER_PX = 1600;

/** A page as a JPEG in base64 (no data: prefix), for the function. */
export async function renderPage(doc: PdfDoc, n: number): Promise<{ mime: string; data: string }> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = RENDER_PX / Math.max(base.width, base.height);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  for (const q of [0.8, 0.65, 0.5]) {
    const data = canvas.toDataURL("image/jpeg", q).split(",")[1] ?? "";
    if (data.length <= 1_400_000) return { mime: "image/jpeg", data };
  }
  throw new Error("Trang quá lớn để đọc");
}
