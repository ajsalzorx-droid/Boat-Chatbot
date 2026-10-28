import "server-only";

import mongoose, { type Connection } from "mongoose";

import { getWebsiteDbConfig } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import type { KnowledgeProduct } from "@/services/chatbot/types";
import { getSettings } from "@/services/settings/settings-service";

import { mapWebsiteCatalog, type WebsiteDailyCatch, type WebsiteMenuItem, type WebsiteOffer } from "./website-catalog";

/**
 * Live, read-only access to the company website's own database (WEBSITE_DB_URI), so prices and
 * offers changed in the website admin reach the bot without a sync. Only `find` is ever called.
 *
 * Results are cached briefly so a burst of messages does not query the website database each
 * time. When the website database cannot be reached, the last good result is used; with none,
 * callers fall back to the bot's own products.
 */

const CACHE_TTL_MS = 30_000;
const STALE_LIMIT_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DB_NAME = "boat";
const CURRENCY = "AED";

interface WebsiteDbCache {
  connection: Promise<Connection> | null;
  products: KnowledgeProduct[] | null;
  loadedAt: number;
}

const globalForWebsite = globalThis as typeof globalThis & { __websiteDbCache?: WebsiteDbCache };
const cache: WebsiteDbCache = (globalForWebsite.__websiteDbCache ??= { connection: null, products: null, loadedAt: 0 });

function connect(uri: string, dbName: string): Promise<Connection> {
  cache.connection ??= mongoose
    .createConnection(uri, { dbName, maxPoolSize: 3, serverSelectionTimeoutMS: 5_000, readPreference: "secondaryPreferred", autoIndex: false, autoCreate: false })
    .asPromise()
    .catch((error: unknown) => {
      cache.connection = null;
      throw error;
    });
  return cache.connection;
}

export function isWebsiteDbConfigured(): boolean {
  try {
    return getWebsiteDbConfig() !== null;
  } catch {
    return false;
  }
}

/** Website products, or null when the website database is not configured or not reachable. */
export async function loadWebsiteProducts(): Promise<KnowledgeProduct[] | null> {
  let config;
  try {
    config = getWebsiteDbConfig();
  } catch (error) {
    logger.warn("website_db.config_invalid", { error });
    return null;
  }
  if (!config) return null;
  if (cache.products && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.products;

  try {
    const [connection, settings] = await Promise.all([connect(config.uri, config.dbName ?? DEFAULT_DB_NAME), getSettings()]);
    const db = connection.db;
    if (!db) throw new Error("Website database handle unavailable");
    const [menuItems, dailyCatch, offers] = await Promise.all([
      db.collection<WebsiteMenuItem>("menu_items").find({ is_active: { $ne: false } }).limit(1000).toArray(),
      db.collection<WebsiteDailyCatch>("daily_catch").find({}).limit(200).toArray(),
      db.collection<WebsiteOffer>("offers").find({ is_active: true }).limit(100).toArray(),
    ]);
    cache.products = mapWebsiteCatalog({ menuItems, dailyCatch, offers, now: new Date(), timeZone: settings.timezone, currency: CURRENCY });
    cache.loadedAt = Date.now();
    return cache.products;
  } catch (error) {
    const stale = cache.products && Date.now() - cache.loadedAt < STALE_LIMIT_MS ? cache.products : null;
    logger.warn("website_db.load_failed", { error, usingStaleCache: stale !== null });
    return stale;
  }
}
