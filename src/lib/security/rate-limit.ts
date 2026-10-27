import "server-only";

import { createHash } from "node:crypto";

import { isDuplicateKeyError } from "@/lib/db/errors";
import { connectToDatabase } from "@/lib/db/mongoose";
import { RateLimit } from "@/models/rate-limit";

/**
 * Fixed-window rate limiting stored in MongoDB, so limits hold across all serverless instances
 * without another service. Keys are hashed: no IPs or emails are stored in clear text.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function consumeRateLimit(scope: string, identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  await connectToDatabase();
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${scope}:${createHash("sha256").update(identifier).digest("hex").slice(0, 32)}:${windowStart}`;

  const increment = () =>
    RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expireAt: new Date(windowStart + windowMs + 60_000) } },
      { upsert: true, returnDocument: "after", lean: true },
    );

  let record;
  try {
    record = await increment();
  } catch (error) {
    // Two first requests raced on the upsert; the second attempt increments the existing record.
    if (!isDuplicateKeyError(error)) throw error;
    record = await increment();
  }

  const count = record?.count ?? limit + 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000),
  };
}
