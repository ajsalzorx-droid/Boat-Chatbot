/**
 * Redaction helpers that keep credentials and unnecessary personal data out of logs.
 */

const REDACTED = "[REDACTED]";

/**
 * Sensitive keys are matched on a normalised form (lowercase, letters and digits only) by exact
 * name or by suffix, so `accessToken`, `META_APP_SECRET` and `x-hub-signature-256` are redacted
 * while observability fields such as `inputTokens`, `sessionId` or `signatureValid` stay visible.
 */
const SENSITIVE_KEY_NAMES: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "session",
  "credentials",
  "mongodburi",
  "connectionstring",
  "databaseurl",
  "xhubsignature256",
]);

const SENSITIVE_KEY_SUFFIXES: readonly string[] = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "signingkey",
  "privatekey",
  "signature",
  "credential",
];

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_NAMES.has(normalised) || SENSITIVE_KEY_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

const MAX_AGGREGATE_ERRORS = 10;

/** Credential-shaped substrings that can leak through error messages. */
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /mongodb(\+srv)?:\/\/[^\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsha256=[a-f0-9]{64}\b/gi,
  /\bEAA[A-Za-z0-9]{20,}\b/g, // Meta Graph API access tokens
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // Common LLM provider key prefix
];

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2_000;

export function redactString(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result.length > MAX_STRING_LENGTH ? `${result.slice(0, MAX_STRING_LENGTH)}…[truncated]` : result;
}

/** Deep-copies `value`, replacing sensitive keys and credential-like strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[MaxDepth]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value, depth);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redact(entry, depth + 1);
  }
  return output;
}

export function serializeError(error: Error, depth = 0): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message),
  };
  const withCode = error as Error & { code?: unknown; details?: unknown };
  if (withCode.code !== undefined) serialized.code = withCode.code;
  if (withCode.details !== undefined) serialized.details = redact(withCode.details, depth + 1);
  if (process.env.NODE_ENV !== "production" && error.stack) {
    serialized.stack = redactString(error.stack);
  }
  if (error.cause !== undefined && depth < MAX_DEPTH) {
    // Non-Error causes (e.g. `{ status: 503, body }`) are kept too, after redaction.
    serialized.cause =
      error.cause instanceof Error ? serializeError(error.cause, depth + 1) : redact(error.cause, depth + 1);
  }
  if (error instanceof AggregateError && depth < MAX_DEPTH) {
    // e.g. the MongoDB driver reports one error per host it tried.
    const errors: unknown[] = error.errors;
    serialized.errors = errors
      .slice(0, MAX_AGGREGATE_ERRORS)
      .map((inner) => (inner instanceof Error ? serializeError(inner, depth + 1) : redact(inner, depth + 1)));
    if (errors.length > MAX_AGGREGATE_ERRORS) serialized.errorsTruncated = errors.length - MAX_AGGREGATE_ERRORS;
  }
  return serialized;
}

/**
 * Masks a WhatsApp ID / phone number for logs, keeping only the last four digits
 * so operators can correlate events without logging full customer numbers.
 */
export function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
