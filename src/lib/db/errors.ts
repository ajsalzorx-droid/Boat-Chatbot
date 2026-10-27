/** True for MongoDB duplicate-key errors (E11000), which signal an idempotent repeat. */
export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
