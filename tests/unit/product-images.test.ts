import { describe, expect, it } from "vitest";

import { productImagesForReply } from "@/services/chatbot/product-images";
import type { KnowledgeProduct } from "@/services/chatbot/types";

function product(name: string, overrides: Partial<KnowledgeProduct> = {}): KnowledgeProduct {
  return {
    id: name.toLowerCase().replace(/\W+/g, "-"),
    kind: "product",
    name,
    description: "",
    price: 100,
    currency: "AED",
    availability: "available",
    keywords: [],
    offer: null,
    imageUrl: `https://img.example.com/${encodeURIComponent(name)}.webp`,
    ...overrides,
  };
}

const CRAB_LEGS = product("Alaskan King Crab Legs", { price: 310 });
const CRAB = product("Alaskan King Crab", { price: 310 });
const LOBSTER = product("Classic Lobster Thermidor", { price: 245, offer: { price: 200, validUntil: "2026-11-01", note: "" } });
const MOJITO = product("Classic Mint Mojito", { price: 35, imageUrl: null });

describe("productImagesForReply", () => {
  it("returns photos of the named products in reply order, with name and price captions", () => {
    const images = productImagesForReply("We have Classic Lobster Thermidor (245 AED) and Alaskan King Crab Legs (310 AED).", [CRAB_LEGS, LOBSTER, MOJITO]);
    expect(images).toEqual([
      { productId: LOBSTER.id, url: LOBSTER.imageUrl, caption: "Classic Lobster Thermidor - 200 AED (offer until 2026-11-01)" },
      { productId: CRAB_LEGS.id, url: CRAB_LEGS.imageUrl, caption: "Alaskan King Crab Legs - 310 AED" },
    ]);
  });

  it("does not count a name found only inside a longer product name", () => {
    expect(productImagesForReply("Our Alaskan King Crab Legs are 310 AED.", [CRAB, CRAB_LEGS]).map((image) => image.productId)).toEqual([CRAB_LEGS.id]);
    expect(productImagesForReply("Alaskan King Crab Legs, and also Alaskan King Crab.", [CRAB, CRAB_LEGS])).toHaveLength(2);
  });

  it("matches across punctuation and line breaks, skips items without a photo, and caps the count", () => {
    expect(productImagesForReply("- alaskan king crab legs\n- classic mint mojito", [CRAB_LEGS, MOJITO])).toHaveLength(1);
    const many = Array.from({ length: 8 }, (_, index) => product(`Dish ${String.fromCharCode(65 + index)}`));
    expect(productImagesForReply(many.map((item) => item.name).join(", "), many)).toHaveLength(5);
    expect(productImagesForReply("Hello! How can I help?", [CRAB_LEGS])).toEqual([]);
  });
});
