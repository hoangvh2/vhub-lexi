/**
 * Screenshots shrink in the browser before they are sent: a phone screenshot is several MB, and the model reads
 * text fine from a JPEG of about 2000 px on the long edge (about 0.3 MB).
 */
const MAX_EDGE = 2000;
const QUALITY = 0.85;

export interface Shrunk {
  mime: "image/jpeg";
  /** Base64 without the data: prefix. */
  data: string;
  /** For the thumbnail. */
  url: string;
}

export async function shrink(file: Blob): Promise<Shrunk> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", QUALITY);
    return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url };
  } finally {
    bmp.close();
  }
}
