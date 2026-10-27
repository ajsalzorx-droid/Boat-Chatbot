import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { faqSchema } from "@/lib/validation/admin";
import { toFaqDto } from "@/services/dto";
import { createFaq, listFaqs } from "@/services/knowledge/knowledge-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("admin", async () => json({ items: (await listFaqs()).map(toFaqDto) }));

export const POST = adminRoute("admin", async ({ request }) => {
  const input = await readJson(request, faqSchema);
  return json({ item: toFaqDto(await createFaq(input)) }, { status: 201 });
});
