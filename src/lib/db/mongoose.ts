import "server-only";

import mongoose from "mongoose";

import { getDatabaseConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

/**
 * Shared Mongoose connection for serverless runtimes.
 *
 * Serverless instances are reused between invocations, so the connection promise is cached on
 * `globalThis` (which also survives hot reloads in development). A failed attempt clears the cache
 * so the next request retries instead of reusing a rejected promise forever.
 */

// A filter on a path that is not in the schema (e.g. a typo) throws instead of being stripped.
// With `true`, Mongoose would silently drop the path, turning `deleteMany({ typo: id })` into
// `deleteMany({})`.
mongoose.set("strictQuery", "throw");

// Query-selector injection (`{ "$gt": "" }` arriving where a scalar is expected) is prevented at
// the boundary: every request body and query string is parsed with a Zod schema that only admits
// primitive values for filter fields. `sanitizeFilter` is NOT enabled globally because it would
// also neutralise the operators our own server code relies on (e.g. `{ runAt: { $lte: now } }`).
// Where a filter is built directly from user-controlled objects, apply it per query:
// `Model.find(filter).setOptions({ sanitizeFilter: true })`.

interface ConnectionCache {
  promise: Promise<typeof mongoose> | null;
  listenersAttached: boolean;
}

const globalForMongoose = globalThis as typeof globalThis & { __mongooseCache?: ConnectionCache };
const cache: ConnectionCache = (globalForMongoose.__mongooseCache ??= { promise: null, listenersAttached: false });

if (!cache.listenersAttached) {
  // After an explicit `disconnect()` or a closed connection the resolved promise is stale; drop it
  // so the next call reconnects instead of returning a dead connection. Transient network drops
  // are handled by the driver's own reconnection and do not emit `close`.
  mongoose.connection.on("close", () => {
    cache.promise = null;
  });
  cache.listenersAttached = true;
}

const isProduction = process.env.NODE_ENV === "production";

export async function connectToDatabase(): Promise<typeof mongoose> {
  const state = mongoose.connection.readyState;
  if (state === mongoose.ConnectionStates.connected) return mongoose;

  // Disconnected with a cached (settled) promise means the connection was closed: start over.
  if (state === mongoose.ConnectionStates.disconnected) cache.promise = null;

  if (!cache.promise) {
    const { uri, dbName } = getDatabaseConfig();
    cache.promise = mongoose.connect(uri, {
      ...(dbName ? { dbName } : {}),
      // Small pool per instance: many concurrent serverless instances share one Atlas cluster.
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 8_000,
      socketTimeoutMS: 30_000,
      // Fail fast instead of queueing operations while disconnected.
      bufferCommands: false,
      retryWrites: true,
      // Indexes (including the unique indexes that enforce idempotency) are built by
      // `npm run db:sync-indexes` during deployment, not on every production cold start.
      autoIndex: !isProduction,
      appName: "whatsapp-chatbot",
    });
  }

  try {
    const connection = await cache.promise;
    return connection;
  } catch (error) {
    cache.promise = null;
    logger.error("database.connect_failed", { error });
    throw new AppError("Unable to connect to MongoDB", {
      code: "DATABASE_UNAVAILABLE",
      httpStatus: 503,
      publicMessage: "Service temporarily unavailable.",
      retryable: true,
      cause: error,
    });
  }
}

/** Round-trips a `ping` command. Used by health checks; never throws. */
export async function pingDatabase(): Promise<{ ok: true; latencyMs: number } | { ok: false }> {
  const startedAt = performance.now();
  try {
    const connection = await connectToDatabase();
    const db = connection.connection.db;
    if (!db) return { ok: false };
    await db.admin().command({ ping: 1 });
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    logger.warn("database.ping_failed", { error });
    return { ok: false };
  }
}
