import type { KnowledgeProduct } from "@/services/chatbot/types";

import { normalizeItemName } from "./website-menu";

/**
 * Maps the company website's own collections (`menu_items`, `daily_catch`, `offers`) to the
 * products the chatbot answers from. Pure, so it can be tested without either database.
 */

export interface WebsiteMenuItem {
  _id: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  category?: unknown;
  tag?: unknown;
  dietary?: unknown;
  is_active?: unknown;
}

export interface WebsiteDailyCatch {
  _id: unknown;
  name?: unknown;
  origin?: unknown;
  description?: unknown;
  price?: unknown;
  is_available?: unknown;
}

export interface WebsiteOffer {
  title?: unknown;
  percent?: unknown;
  scope?: unknown;
  categories?: unknown;
  item_ids?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  is_active?: unknown;
}

export interface WebsiteCatalogInput {
  menuItems: WebsiteMenuItem[];
  dailyCatch: WebsiteDailyCatch[];
  offers: WebsiteOffer[];
  now: Date;
  /** Company timezone, used to express an offer's last day. */
  timeZone: string;
  currency: string;
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
const price = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const date = (value: unknown) => {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

function dayInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

interface ActiveOffer {
  percent: number;
  note: string;
  validUntil: string;
  scope: string;
  categories: Set<string>;
  itemIds: Set<string>;
}

function activeOffers(offers: WebsiteOffer[], now: Date, timeZone: string): ActiveOffer[] {
  const result: ActiveOffer[] = [];
  for (const offer of offers) {
    const starts = date(offer.starts_at);
    const ends = date(offer.ends_at);
    const percent = typeof offer.percent === "number" ? offer.percent : NaN;
    if (offer.is_active !== true || !ends || ends < now || (starts && starts > now) || !(percent > 0 && percent < 100)) continue;
    result.push({
      percent,
      note: str(offer.title, 200),
      validUntil: dayInZone(ends, timeZone),
      scope: str(offer.scope, 20),
      categories: new Set(strings(offer.categories).map((category) => category.toLowerCase())),
      itemIds: new Set(strings(offer.item_ids)),
    });
  }
  return result;
}

/** The best current discount for an item, if any. */
function offerFor(offers: ActiveOffer[], ids: string[], category: string, basePrice: number | null): KnowledgeProduct["offer"] {
  if (basePrice === null) return null;
  const applicable = offers.filter(
    (offer) => offer.scope === "all" || ids.some((id) => offer.itemIds.has(id)) || (category !== "" && offer.categories.has(category.toLowerCase())),
  );
  const best = applicable.sort((a, b) => b.percent - a.percent)[0];
  if (!best) return null;
  return { price: Math.round(basePrice * (100 - best.percent)) / 100, validUntil: best.validUntil, note: `${best.note ? `${best.note}: ` : ""}${best.percent}% off` };
}

interface Entry {
  product: KnowledgeProduct;
  /** Every website id of this item: the website stores some dishes twice, and offers may list either copy. */
  ids: string[];
  category: string;
}

export function mapWebsiteCatalog(input: WebsiteCatalogInput): KnowledgeProduct[] {
  const offers = activeOffers(input.offers, input.now, input.timeZone);
  const entries = new Map<string, Entry>();

  for (const item of input.menuItems) {
    const name = str(item.name, 150);
    const key = normalizeItemName(name);
    if (!key || item.is_active === false) continue;
    const id = String(item._id);
    const existing = entries.get(key);
    if (existing) {
      existing.ids.push(id);
      continue;
    }
    const category = str(item.category, 50);
    const dietary = strings(item.dietary);
    entries.set(key, {
      ids: [id],
      category,
      product: {
        id: `website:${id}`,
        kind: "product",
        name,
        description: [str(item.description, 1500), dietary.length ? `Dietary: ${dietary.join(", ")}.` : ""].filter(Boolean).join(" "),
        price: price(item.price),
        currency: input.currency,
        availability: "available",
        keywords: [category, str(item.tag, 50)].filter(Boolean).map((keyword) => keyword.toLowerCase()),
        offer: null,
      },
    });
  }

  for (const fish of input.dailyCatch) {
    const name = str(fish.name, 150);
    const key = normalizeItemName(name);
    if (!key || entries.has(key)) continue;
    const id = String(fish._id);
    const origin = str(fish.origin, 100);
    entries.set(key, {
      ids: [id],
      category: "",
      product: {
        id: `website:${id}`,
        kind: "product",
        name,
        description: [str(fish.description, 1500), origin ? `Origin: ${origin}.` : "", "Part of today's fresh catch."].filter(Boolean).join(" "),
        price: price(fish.price),
        currency: input.currency,
        availability: fish.is_available === false ? "out_of_stock" : "available",
        keywords: ["daily catch", "fresh catch", "fresh fish"],
        offer: null,
      },
    });
  }

  return [...entries.values()].map(({ product, ids, category }) => ({ ...product, offer: offerFor(offers, ids, category, product.price) }));
}
