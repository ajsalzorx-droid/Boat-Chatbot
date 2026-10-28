import { describe, expect, it } from "vitest";

import { mapWebsiteCatalog, type WebsiteCatalogInput } from "@/services/knowledge/website-catalog";

const NOW = new Date("2026-10-26T10:00:00.000Z");

function input(overrides: Partial<WebsiteCatalogInput> = {}): WebsiteCatalogInput {
  return {
    menuItems: [
      { _id: "a1", name: "Crispy Calamari", description: "Squid rings.", price: 75, category: "Appetizers", tag: "Classic", dietary: ["Spicy"], is_active: true },
      { _id: "a2", name: "Crispy  calamari", description: "Duplicate copy.", price: 75, category: "Appetizers", is_active: true },
      { _id: "b1", name: "Lobster", price: 245, category: "Signature Dishes", is_active: true },
      { _id: "c1", name: "Hidden dish", price: 10, category: "Desserts", is_active: false },
    ],
    dailyCatch: [{ _id: "d1", name: "Sea Bream", origin: "Greece", description: "Whole.", price: 120, is_available: false }],
    offers: [],
    now: NOW,
    timeZone: "Asia/Dubai",
    currency: "AED",
    ...overrides,
  };
}

describe("mapWebsiteCatalog", () => {
  it("maps active menu items once and the daily catch with its availability", () => {
    const products = mapWebsiteCatalog(input());
    expect(products.map((product) => product.name)).toEqual(["Crispy Calamari", "Lobster", "Sea Bream"]);
    expect(products[0]).toMatchObject({ id: "website:a1", price: 75, currency: "AED", availability: "available", keywords: ["appetizers", "classic"], description: "Squid rings. Dietary: Spicy.", offer: null });
    expect(products[2]).toMatchObject({ availability: "out_of_stock", keywords: ["daily catch", "fresh catch", "fresh fish"], description: "Whole. Origin: Greece. Part of today's fresh catch." });
  });

  it("applies a running percentage offer to listed items, including through a duplicate's id", () => {
    const offer = { title: "Dubai Fest", percent: 50, scope: "items", item_ids: ["a2"], starts_at: "2026-10-25T20:00:00.000Z", ends_at: "2026-10-26T19:59:59.999Z", is_active: true };
    const [calamari, lobster] = mapWebsiteCatalog(input({ offers: [offer] }));
    // Ends 23:59:59 Dubai time on the 26th.
    expect(calamari?.offer).toEqual({ price: 37.5, validUntil: "2026-10-26", note: "Dubai Fest: 50% off" });
    expect(lobster?.offer).toBeNull();
  });

  it("applies category and all-items offers and ignores ended, future or inactive ones", () => {
    const base = { percent: 20, starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-11-01T00:00:00.000Z", is_active: true };
    const products = mapWebsiteCatalog(
      input({
        offers: [
          { ...base, scope: "categories", categories: ["signature dishes"] },
          { ...base, percent: 90, scope: "all", ends_at: "2026-10-20T00:00:00.000Z" },
          { ...base, percent: 80, scope: "all", starts_at: "2026-10-27T00:00:00.000Z" },
          { ...base, percent: 70, scope: "all", is_active: false },
        ],
      }),
    );
    expect(products.find((product) => product.name === "Lobster")?.offer?.price).toBe(196);
    expect(products.find((product) => product.name === "Crispy Calamari")?.offer).toBeNull();
  });
});
