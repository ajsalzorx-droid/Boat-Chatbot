import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { productSchema } from "@/lib/validation/admin";
import { toProductDto } from "@/services/dto";
import { createProduct, listProducts } from "@/services/knowledge/knowledge-service";
import { isWebsiteDbConfigured, loadWebsiteProducts } from "@/services/knowledge/website-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("admin", async () => {
  const [items, websiteItems] = await Promise.all([listProducts(), isWebsiteDbConfigured() ? loadWebsiteProducts() : Promise.resolve(undefined)]);
  // `website`: null when not connected, { error } when connected but unreachable.
  const website = websiteItems === undefined ? null : websiteItems === null ? { error: true, items: [] } : { error: false, items: websiteItems };
  return json({ items: items.map(toProductDto), website });
});

export const POST = adminRoute("admin", async ({ request }) => {
  const input = await readJson(request, productSchema);
  return json({ item: toProductDto(await createProduct(input)) }, { status: 201 });
});
