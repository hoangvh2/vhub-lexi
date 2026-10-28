/** The parts of a Firebase ID token the allowlist looks at. */
export interface TokenClaims {
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

/** "A@x.com, b@y.com" → ["a@x.com", "b@y.com"]. Anything that is not an address is dropped. */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

/**
 * Only a verified Google account whose address is on the list gets in. An empty list admits
 * nobody, so a missing configuration can never open the system.
 */
export function isAllowedToken(token: TokenClaims | undefined, allowed: readonly string[]): boolean {
  if (!token || allowed.length === 0) return false;
  if (token.email_verified !== true) return false;
  if (token.firebase?.sign_in_provider !== "google.com") return false;
  const email = token.email?.trim().toLowerCase();
  return !!email && allowed.includes(email);
}
