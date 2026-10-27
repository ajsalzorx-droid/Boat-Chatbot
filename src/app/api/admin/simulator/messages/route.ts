import { adminRoute } from "@/lib/auth/guards";
import { json, readJson } from "@/lib/http/api";
import { simulatorMessageSchema } from "@/lib/validation/admin";
import { simulateCustomerMessage } from "@/services/simulator/simulator-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sends a simulated customer message through the full bot pipeline. Never reaches WhatsApp. */
export const POST = adminRoute("admin", async ({ request }) => {
  const input = await readJson(request, simulatorMessageSchema, 20_000);
  return json(await simulateCustomerMessage(input), { status: 201 });
});
