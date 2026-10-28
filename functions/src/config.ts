/** Hard limits that keep one enrichment cheap and bounded, whoever calls it. */
export const LIMITS = {
  /** Enrichments one account may make per UTC day. */
  dailyEnrich: 100,
  maxWord: 80,
  maxContext: 400,
  maxExamples: 3,
} as const;

/** Override with the GEMINI_MODEL parameter (Terraform variable gemini_model). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Region of the callable. Must match the web app's getFunctions(app, region). */
export const REGION = "asia-southeast1";

/**
 * Browser origins allowed to call the function: the two default Firebase Hosting hosts plus an optional
 * custom domain. Entries may be bare hostnames or https URLs; anything else is dropped.
 */
export function allowedOrigins(project: string, extra: string | undefined): string[] {
  const origins = [`https://${project}.web.app`, `https://${project}.firebaseapp.com`];
  for (const raw of (extra ?? "").split(/[\s,;]+/)) {
    const host = raw.trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/$/, "");
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) origins.push(`https://${host}`);
  }
  return [...new Set(origins)];
}
