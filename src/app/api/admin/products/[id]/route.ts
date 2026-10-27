import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { idParamsSchema, productSchema } from "@/lib/validation/admin";
import { toProductDto } from "@/services/dto";
import { deleteProduct, updateProduct } from "@/services/knowledge/knowledge-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = adminRoute<{ id: string }>("admin", async ({ request, params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = await readJson(request, productSchema.partial());
  return json({ item: toProductDto(await updateProduct(id, input)) });
});

export const DELETE = adminRoute<{ id: string }>("admin", async ({ params }) => {
  const { id } = idParamsSchema.parse(params);
  await deleteProduct(id);
  return json({ deleted: true });
});
