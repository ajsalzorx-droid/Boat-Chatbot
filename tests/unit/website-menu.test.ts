import { describe, expect, it } from "vitest";

import { parseWebsiteMenu } from "@/services/knowledge/website-menu";

function page(...blocks: unknown[]): string {
  return `<html><head>${blocks.map((block) => `<script type="application/ld+json">${typeof block === "string" ? block : JSON.stringify(block)}</script>`).join("")}</head><body><p>Price: 999 AED</p></body></html>`;
}

const MENU = {
  "@context": "https://schema.org",
  "@type": "Menu",
  name: "Restaurant Menu",
  hasMenuSection: [
    {
      "@type": "MenuSection",
      name: "Appetizers",
      hasMenuItem: [
        { "@type": "MenuItem", name: "Crispy  Calamari", description: "Squid rings.", offers: { "@type": "Offer", price: "75", priceCurrency: "aed" } },
        { "@type": "MenuItem", name: "Crispy Calamari", description: "Repeated in a carousel.", offers: { "@type": "Offer", price: "80", priceCurrency: "AED" } },
      ],
    },
    {
      "@type": "MenuSection",
      name: "Market Fresh",
      hasMenuItem: [{ "@type": "MenuItem", name: "King Crab", offers: [{ "@type": "Offer", price: 310, priceCurrency: "AED", availability: "https://schema.org/SoldOut" }] }],
    },
  ],
};

describe("parseWebsiteMenu", () => {
  it("reads menu items with section, price and currency, keeping the first of repeated items", () => {
    expect(parseWebsiteMenu(page(MENU))).toEqual([
      { key: "crispy calamari", name: "Crispy Calamari", description: "Squid rings.", price: 75, currency: "AED", availability: null, section: "Appetizers" },
      { key: "king crab", name: "King Crab", description: "", price: 310, currency: "AED", availability: "out_of_stock", section: "Market Fresh" },
    ]);
  });

  it("reads Product items inside @graph and leaves the price empty when none is published", () => {
    const items = parseWebsiteMenu(page({ "@context": "https://schema.org", "@graph": [{ "@type": ["Product"], name: "Gift card" }] }));
    expect(items).toEqual([{ key: "gift card", name: "Gift card", description: "", price: null, currency: null, availability: null, section: null }]);
  });

  it("skips malformed blocks and ignores visible page text", () => {
    expect(parseWebsiteMenu(page("{not json", MENU))).toHaveLength(2);
    expect(parseWebsiteMenu("<p>Oysters 120 AED</p>")).toEqual([]);
  });
});
