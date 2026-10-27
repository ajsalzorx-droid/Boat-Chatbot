import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { connectToDatabase } from "@/lib/db/mongoose";
import { getRegisteredModels } from "@/models";

/**
 * Real MongoDB (in-memory server) for integration tests, so unique indexes, atomic updates and
 * races behave exactly as in production. No external database is touched.
 */

let server: MongoMemoryServer | null = null;

export async function startTestDatabase(): Promise<void> {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri();
  process.env.MONGODB_DB_NAME = "chatbot_test";
  // Each test file gets fresh modules; drop any connection cached by an earlier file.
  (globalThis as { __mongooseCache?: unknown }).__mongooseCache = undefined;
  await connectToDatabase();
  await Promise.all(getRegisteredModels().map((model) => model.createIndexes()));
}

export async function stopTestDatabase(): Promise<void> {
  await mongoose.disconnect();
  await server?.stop();
  server = null;
}

export async function clearDatabase(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
