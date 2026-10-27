/**
 * Prints a cryptographically secure random secret.
 *
 * Usage: npm run secret            -> 48 random bytes, base64url
 *        npm run secret -- 64      -> 64 random bytes
 *
 * Use a different value for each variable (WHATSAPP_VERIFY_TOKEN, ADMIN_SESSION_SECRET,
 * CRON_SECRET) and for each environment (development, preview, production).
 */
import { randomBytes } from "node:crypto";

const byteLength = Number.parseInt(process.argv[2] ?? "48", 10);
if (!Number.isInteger(byteLength) || byteLength < 32 || byteLength > 128) {
  console.error("Byte length must be an integer between 32 and 128.");
  process.exit(1);
}

console.log(randomBytes(byteLength).toString("base64url"));
