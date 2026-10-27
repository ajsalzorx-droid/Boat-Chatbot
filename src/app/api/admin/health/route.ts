import { adminRoute } from "@/lib/auth/guards";
import { json } from "@/lib/http/api";
import { getHealthReport } from "@/services/health/health-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute("admin", async () => json(await getHealthReport()));
