import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { faqSchema, idParamsSchema } from "@/lib/validation/admin";
import { toFaqDto } from "@/services/dto";
import { deleteFaq, updateFaq } from "@/services/knowledge/knowledge-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = adminRoute<{ id: string }>("admin", async ({ request, params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = await readJson(request, faqSchema.partial());
  return json({ item: toFaqDto(await updateFaq(id, input)) });
});

export const DELETE = adminRoute<{ id: string }>("admin", async ({ params }) => {
  const { id } = idParamsSchema.parse(params);
  await deleteFaq(id);
  return json({ deleted: true });
});
