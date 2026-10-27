/** Exponential backoff with "equal jitter": half fixed, half random, capped. */
export function backoffDelayMs(attempt: number, options: { baseMs?: number; capMs?: number; random?: () => number } = {}): number {
  const base = options.baseMs ?? 10_000;
  const cap = options.capMs ?? 15 * 60_000;
  const random = options.random ?? Math.random;
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential / 2 + random() * (exponential / 2));
}
