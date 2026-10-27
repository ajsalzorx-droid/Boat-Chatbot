import mongoose, { type Model, type Schema } from "mongoose";

/**
 * Returns the existing compiled model when one exists (development hot reload, serverless reuse)
 * instead of recompiling, which Mongoose rejects.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  return existing ?? mongoose.model<T>(name, schema);
}

/** Days after which operational records (webhook events, finished jobs) expire via TTL index. */
export const OPERATIONAL_RECORD_TTL_DAYS = 30;

export function expiresInDays(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
