import "server-only";

import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";
import { Product, type ProductDoc } from "@/models/product";
import { getSettings } from "@/services/settings/settings-service";

import { normalizeItemName, parseWebsiteMenu, type WebsiteItem } from "./website-menu";

/**
 * Imports products from the company website's menu page into the bot's own database. The website
 * keeps its own database; this sync copies only what the page publishes as structured data.
 *
 * - New website items are created as active products.
 * - Existing website items get the website's name, description, price and currency. Keywords,
 *   offers, type and the Active switch set in the dashboard are kept.
 * - A manual item with the same name is taken over instead of duplicated.
 * - Website items that disappear from the page are deactivated (not deleted).
 * - Manual items are never touched otherwise.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const EXTERNAL_PREFIX = "website:";

export interface WebsiteSyncReport {
  url: string;
  found: number;
  created: number;
  updated: number;
  deactivated: number;
}

function badRequest(message: string): AppError {
  return new AppError(message, { code: "VALIDATION_FAILED", httpStatus: 400, publicMessage: message });
}

function sameSite(hostname: string, websiteHost: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "");
  const host = strip(hostname);
  const site = strip(websiteHost);
  return host === site || host.endsWith(`.${site}`);
}

/**
 * Only https pages on the website saved in Settings may be fetched, so an admin account cannot be
 * used to make the server request arbitrary (internal) addresses.
 */
async function resolveAllowedUrl(raw: string): Promise<URL> {
  const settings = await getSettings();
  if (!settings.websiteUrl) throw badRequest("Add your website address under Settings first.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Enter a full page address, for example https://example.com/menu.");
  }
  const websiteHost = new URL(settings.websiteUrl).hostname;
  if (url.protocol !== "https:" || !sameSite(url.hostname, websiteHost)) {
    throw badRequest(`Only https pages on ${websiteHost} can be synced (the website set in Settings).`);
  }
  return url;
}

async function fetchPage(url: URL): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store", headers: { Accept: "text/html" } });
  } catch (cause) {
    throw new AppError("Website fetch failed", { code: "EXTERNAL_SERVICE_ERROR", httpStatus: 502, publicMessage: "Could not reach the website. Try again in a moment.", retryable: true, cause });
  }
  const finalHost = new URL(response.url || url.href).hostname;
  if (!sameSite(finalHost, url.hostname)) throw badRequest("The page redirected to another website.");
  if (!response.ok) {
    throw new AppError("Website returned an error", { code: "EXTERNAL_SERVICE_ERROR", httpStatus: 502, publicMessage: `The website answered with status ${response.status}.`, details: { status: response.status } });
  }
  const html = await response.text();
  if (html.length > MAX_PAGE_BYTES) throw badRequest("The page is too large to read.");
  return html;
}

function mergeKeywords(existing: string[], section: string | null): string[] {
  const keyword = section?.toLowerCase().trim().slice(0, 50);
  if (!keyword || existing.includes(keyword) || existing.length >= 30) return existing;
  return [...existing, keyword];
}

function websiteFields(item: WebsiteItem) {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    ...(item.currency ? { currency: item.currency } : {}),
  };
}

export async function syncProductsFromWebsite(rawUrl: string): Promise<WebsiteSyncReport> {
  await connectToDatabase();
  const url = await resolveAllowedUrl(rawUrl);
  const items = parseWebsiteMenu(await fetchPage(url));
  if (items.length === 0) {
    throw badRequest("No products were found on that page. The page must publish its menu as schema.org data (Menu / MenuItem or Product).");
  }

  const existing = await Product.find().lean<ProductDoc[]>();
  const byExternalId = new Map(existing.filter((product) => product.externalId).map((product) => [product.externalId, product]));
  const manualByName = new Map(existing.filter((product) => !product.externalId).map((product) => [normalizeItemName(product.name), product]));
  const report: WebsiteSyncReport = { url: url.href, found: items.length, created: 0, updated: 0, deactivated: 0 };
  const seen = new Set<string>();

  for (const item of items) {
    const externalId = `${EXTERNAL_PREFIX}${item.key}`;
    seen.add(externalId);
    const current = byExternalId.get(externalId) ?? manualByName.get(item.key);

    if (!current) {
      await Product.create({
        ...websiteFields(item),
        availability: item.availability ?? "available",
        keywords: mergeKeywords([], item.section),
        source: "website",
        externalId,
      });
      report.created += 1;
      continue;
    }

    // An item the sync deactivated earlier because it had left the page comes back.
    const returning = current.source === "website" && !current.active && current.availability === "discontinued";
    await Product.updateOne(
      { _id: current._id },
      {
        $set: {
          ...websiteFields(item),
          ...(item.availability ? { availability: item.availability } : returning ? { availability: "available" } : {}),
          ...(returning ? { active: true } : {}),
          keywords: mergeKeywords(current.keywords, item.section),
          source: "website",
          externalId,
        },
      },
      { runValidators: true },
    );
    report.updated += 1;
  }

  const gone = existing.filter((product) => product.externalId?.startsWith(EXTERNAL_PREFIX) && !seen.has(product.externalId) && product.active);
  if (gone.length > 0) {
    await Product.updateMany({ _id: { $in: gone.map((product) => product._id) } }, { $set: { active: false, availability: "discontinued" } });
    report.deactivated = gone.length;
  }

  logger.info("products.website_sync", { ...report });
  return report;
}
