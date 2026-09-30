import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signer link tokens.
 *
 * 32 random bytes, base64url encoded — 256 bits, so guessing one is not a
 * threat model. What is stored is HMAC-SHA256(token, pepper), never the token,
 * so a database leak alone yields no working link. The pepper also means an
 * attacker holding the table cannot grind candidate tokens offline.
 *
 * The token appears in exactly two places: the URL in the email, and the
 * incoming request. It is never logged, never written to an audit row, and
 * never returned to the owner's UI after the send.
 */

const TOKEN_BYTES = 32;

function pepper(): string {
  const value = process.env.SIGNER_TOKEN_PEPPER;
  if (!value || value.trim().length < 16) {
    throw new Error(
      "SIGNER_TOKEN_PEPPER is missing or too short. Generate one with `openssl rand -base64 32` " +
        "and set it in .env.local and in Vercel before sending anything for signature.",
    );
  }
  return value.trim();
}

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHmac("sha256", pepper()).update(token).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Lookups are by hash so the database does the matching, but this is used
 * wherever two digests are compared in application code — a plain === leaks
 * timing information about how many leading characters matched.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Default lifetime of a signing link. */
export const DEFAULT_EXPIRY_DAYS = 30;

export function expiryFromNow(days = DEFAULT_EXPIRY_DAYS): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + Math.max(1, Math.min(365, Math.floor(days))));
  return at.toISOString();
}
