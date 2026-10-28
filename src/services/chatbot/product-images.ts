import { formatPrice } from "./rules";
import { normalize } from "./text";
import type { KnowledgeProduct } from "./types";

/** At most this many photos follow one reply, so a full menu does not flood the chat. */
export const MAX_PRODUCT_IMAGES = 5;

export interface ProductImage {
  productId: string;
  url: string;
  caption: string;
}

function caption(product: KnowledgeProduct): string {
  if (product.price === null) return product.name;
  const price = formatPrice(product.offer?.price ?? product.price, product.currency);
  return `${product.name} - ${price}${product.offer ? ` (offer until ${product.offer.validUntil})` : ""}`;
}

/**
 * Photos of the products a bot reply names, in the order the reply mentions them. When one name
 * contains another ("King Crab Legs" / "King Crab"), only the longer match counts.
 */
export function productImagesForReply(reply: string, products: readonly KnowledgeProduct[], max = MAX_PRODUCT_IMAGES): ProductImage[] {
  const text = ` ${normalize(reply)} `;
  const candidates = products
    .filter((product) => product.imageUrl?.startsWith("https://"))
    .map((product) => ({ product, name: ` ${normalize(product.name)} ` }))
    .filter(({ name }) => name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  const covered: [number, number][] = [];
  const found: { product: KnowledgeProduct; at: number }[] = [];
  for (const { product, name } of candidates) {
    let first = -1;
    for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
      // The padding spaces are shared with neighbouring words, so they do not count as overlap.
      const start = at + 1;
      const end = at + name.length - 1;
      if (covered.some(([from, to]) => start < to && end > from)) continue;
      covered.push([start, end]);
      if (first === -1) first = at;
    }
    if (first !== -1) found.push({ product, at: first });
  }

  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, max)
    .map(({ product }) => ({ productId: product.id, url: product.imageUrl ?? "", caption: caption(product) }));
}
