import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { getOverviewStats } from "@/services/health/health-service";
import { getSettings } from "@/services/settings/settings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("agent", async () => {
  const settings = await getSettings();
  return json(await getOverviewStats(settings.timezone));
});
