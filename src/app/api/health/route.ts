import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db/mongoose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public liveness/readiness probe for uptime monitors.
 *
 * Deliberately minimal: it reports only whether the service can reach its database. Detailed
 * configuration status lives behind admin authentication (System Health, Phase 5).
 */
export async function GET() {
  const database = await pingDatabase();
  const healthy = database.ok;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks: { database: database.ok ? "ok" : "unavailable" },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
