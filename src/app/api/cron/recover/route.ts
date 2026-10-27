import { NextResponse, type NextRequest } from "next/server";

import { getCronSecret } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { safeEqual } from "@/lib/whatsapp/signature";
import { runRecovery } from "@/services/jobs/recovery-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled recovery, called by Vercel Cron (see vercel.json) or a server crontab with
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  let secret: string;
  try {
    secret = getCronSecret();
  } catch {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) {
    logger.warn("cron.unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const report = await runRecovery();
    return NextResponse.json(report);
  } catch (error) {
    logger.error("cron.recovery_failed", { error });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
