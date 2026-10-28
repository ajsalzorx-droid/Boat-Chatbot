import type { Availability } from "@/models/product";

/**
 * Reads products from a web page's schema.org JSON-LD (`Menu` → `MenuSection` → `MenuItem`, or
 * `Product`). Only structured data is used: visible page text is never scraped, so the bot keeps
 * answering from exactly what the website publishes as prices.
 */

export interface WebsiteItem {
  /** Stable identity across syncs: the normalised name. */
  key: string;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  /** Null when the page does not say; the existing value is then kept. */
  availability: Availability | null;
  /** The menu section the item is listed under, e.g. "Appetizers". */
  section: string | null;
}

const ITEM_TYPES = new Set(["MenuItem", "Product"]);
const SECTION_TYPES = new Set(["MenuSection"]);
const JSON_LD_SCRIPT = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

type Json = Record<string, unknown>;

export function normalizeItemName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function types(node: Json): string[] {
  const value = node["@type"];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.replace(/^https?:\/\/schema\.org\//, ""));
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function mapAvailability(value: unknown): Availability | null {
  const name = typeof value === "string" ? value.replace(/^https?:\/\/schema\.org\//, "") : "";
  if (name === "InStock" || name === "InStoreOnly" || name === "OnlineOnly" || name === "LimitedAvailability") return "available";
  if (name === "OutOfStock" || name === "SoldOut") return "out_of_stock";
  if (name === "PreOrder" || name === "PreSale" || name === "BackOrder" || name === "MadeToOrder") return "on_request";
  if (name === "Discontinued") return "discontinued";
  return null;
}

function readOffer(offers: unknown): Pick<WebsiteItem, "price" | "currency" | "availability"> {
  const offer = (Array.isArray(offers) ? offers[0] : offers) as Json | undefined;
  if (!offer || typeof offer !== "object") return { price: null, currency: null, availability: null };
  const raw = offer.price ?? offer.lowPrice;
  const price = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[^\d.]/g, "")) : NaN;
  const currency = typeof offer.priceCurrency === "string" && /^[A-Za-z]{3}$/.test(offer.priceCurrency) ? offer.priceCurrency.toUpperCase() : null;
  return {
    price: Number.isFinite(price) && price >= 0 && (typeof raw !== "string" || raw.trim() !== "") ? price : null,
    currency,
    availability: mapAvailability(offer.availability),
  };
}

export function parseWebsiteMenu(html: string): WebsiteItem[] {
  const items = new Map<string, WebsiteItem>();

  function visit(node: unknown, section: string | null): void {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, section);
      return;
    }
    if (!node || typeof node !== "object") return;
    const object = node as Json;
    const kinds = types(object);

    if (kinds.some((kind) => ITEM_TYPES.has(kind))) {
      const name = text(object.name, 150);
      const key = normalizeItemName(name);
      // Pages often repeat an item (carousel and list); the first occurrence wins.
      if (key && !items.has(key)) {
        items.set(key, { key, name, description: text(object.description, 2000), section, ...readOffer(object.offers) });
      }
      return;
    }

    const childSection = kinds.some((kind) => SECTION_TYPES.has(kind)) ? text(object.name, 50) || section : section;
    for (const [key, value] of Object.entries(object)) {
      if (key !== "@context") visit(value, childSection);
    }
  }

  for (const match of html.matchAll(JSON_LD_SCRIPT)) {
    try {
      visit(JSON.parse(match[1] ?? ""), null);
    } catch {
      // A malformed block elsewhere on the page must not stop the others from being read.
    }
  }
  return [...items.values()];
}
