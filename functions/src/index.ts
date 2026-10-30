import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import { isAllowedToken, parseAllowedEmails } from "./auth";
import { LIMITS, REGION, allowedOrigins, DEFAULT_GEMINI_MODEL, GEMINI_BASE_URL } from "./config";
import { EnrichError, SYSTEM_PROMPT, buildUserPrompt, parseEnrichInput, parseEnrichResult } from "./enrich";
import { GeminiClient, GeminiError } from "./gemini";
import { FirestoreQuota } from "./usage";

initializeApp();

/** Comma-separated Google addresses, set by Terraform at deploy time (never committed). */
const ALLOWED_EMAILS = defineString("ALLOWED_EMAILS");
const GEMINI_MODEL = defineString("GEMINI_MODEL", { default: DEFAULT_GEMINI_MODEL });
/** Lives in Secret Manager; only this function's service account can read it. */
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const inEmulator = process.env.FUNCTIONS_EMULATOR === "true";
const project = process.env.GCLOUD_PROJECT ?? "";
/** App Check can only be required when every client can attest (the sideloaded Android app cannot). */
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true" && !inEmulator;

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

function requireAllowed(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Cần đăng nhập");
  if (!isAllowedToken(request.auth.token, parseAllowedEmails(ALLOWED_EMAILS.value()))) {
    logger.warn("enrich denied", { uid: shortHash(request.auth.uid) });
    throw new HttpsError("permission-denied", "Tài khoản này chưa được cấp quyền");
  }
  return request.auth.uid;
}

/**
 * Word → Vietnamese meaning, examples, mnemonic.
 *
 * Gate order: App Check (when enforced) → signed in → verified Google account on the allowlist →
 * payload validation → daily quota → Gemini. One fixed operation; not a general Gemini proxy.
 */
export const enrich = onCall(
  {
    region: REGION,
    secrets: [GEMINI_API_KEY],
    enforceAppCheck,
    consumeAppCheckToken: enforceAppCheck,
    cors: inEmulator ? true : allowedOrigins(project, process.env.EXTRA_ORIGINS),
    maxInstances: 3,
    concurrency: 8,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const uid = requireAllowed(request);
    const started = Date.now();
    try {
      const input = parseEnrichInput(request.data);
      const allowed = await new FirestoreQuota(getFirestore()).consume(uid, LIMITS.dailyEnrich, new Date());
      if (!allowed) throw new HttpsError("resource-exhausted", "Hết lượt dùng AI hôm nay");
      const gemini = new GeminiClient({ apiKey: GEMINI_API_KEY.value(), model: GEMINI_MODEL.value(), baseUrl: GEMINI_BASE_URL });
      const { text, usage } = await gemini.generate(SYSTEM_PROMPT, buildUserPrompt(input));
      const result = parseEnrichResult(text, input);
      // Counts, tokens and timings only: the words a person studies are personal data and stay out of logs.
      // The token counts are what Gemini bills, so the real cost per word can be read from the logs.
      logger.info("enrich", {
        uid: shortHash(uid), senses: result.senses.length, examples: result.examples.length, story: !!result.mnemonic,
        tokensIn: usage.input, tokensOut: usage.output, tokensThinking: usage.thinking, ms: Date.now() - started,
      });
      return result;
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      if (e instanceof EnrichError) throw new HttpsError(e.code, e.message);
      if (e instanceof GeminiError) {
        logger.warn("enrich failed", { uid: shortHash(uid), status: e.status ?? 0, ms: Date.now() - started });
        throw new HttpsError("unavailable", e.message);
      }
      logger.error("enrich crashed", { uid: shortHash(uid), error: e instanceof Error ? e.name : "unknown" });
      throw new HttpsError("internal", "Có lỗi khi gọi AI");
    }
  },
);
