import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { productSchema } from "@/lib/validation/admin";
import { toProductDto } from "@/services/dto";
import { createProduct, listProducts } from "@/services/knowledge/knowledge-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("admin", async () => json({ items: (await listProducts()).map(toProductDto) }));

export const POST = adminRoute("admin", async ({ request }) => {
  const input = await readJson(request, productSchema);
  return json({ item: toProductDto(await createProduct(input)) }, { status: 201 });
});
