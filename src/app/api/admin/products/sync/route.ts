import { z } from "zod";

import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { syncProductsFromWebsite } from "@/services/knowledge/website-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const syncSchema = z.object({ url: z.string().trim().min(1).max(500) });

export const POST = adminRoute("admin", async ({ request }) => {
  const { url } = await readJson(request, syncSchema);
  return json({ report: await syncProductsFromWebsite(url) });
});
