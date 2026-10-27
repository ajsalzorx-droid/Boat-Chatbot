import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;

/**
 * Verifies Meta's `X-Hub-Signature-256` header.
 *
 * The HMAC must be computed over the exact raw request bytes: re-serialising parsed JSON changes
 * whitespace and escaping, so it would not match. Comparison is constant-time.
 */
export function verifyMetaSignature(rawBody: Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const match = SIGNATURE_PATTERN.exec(header.trim());
  if (!match?.[1]) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Produces a header value; used by the simulator and tests, never to trust incoming data. */
export function signMetaPayload(rawBody: Uint8Array | string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/** Constant-time string equality that does not leak length (both sides are hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
