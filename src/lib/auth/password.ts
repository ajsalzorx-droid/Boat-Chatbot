import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node; no native dependency to break on
 * serverless). Format: scrypt$N$r$p$<salt base64>$<hash base64>, so parameters can be raised later
 * and old hashes still verify.
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (![params.N, params.r, params.p].every(Number.isInteger)) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), params);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash of a random password: used to keep login timing equal for unknown emails. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64"));
  return dummyHash;
}

export const PASSWORD_MIN_LENGTH = 12;

/** Returns a problem description, or null when the password is acceptable. */
export function checkPasswordStrength(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return "Use at most 200 characters.";
  if (/^(.)\1+$/.test(password)) return "Do not repeat a single character.";
  if (email && password.toLowerCase().includes(email.split("@")[0]?.toLowerCase() ?? "\u0000")) {
    return "Do not include your email name in the password.";
  }
  return null;
}
