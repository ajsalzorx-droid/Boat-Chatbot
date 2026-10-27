import { Receiver } from "@upstash/qstash";
import { Types } from "mongoose";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getQueueConfig } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { JOB_WORKER_PATH, runJob } from "@/services/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ jobId: z.string().regex(/^[a-f0-9]{24}$/i) });

/**
 * QStash worker. Only requests signed by QStash (current or next signing key) are accepted.
 * Answers 200 once the outcome is recorded, including retries we scheduled ourselves; answers 500
 * only when the outcome could not be recorded, so QStash redelivers.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const queue = getQueueConfig();
  if (queue.mode !== "qstash") return NextResponse.json({ error: "queue_not_configured" }, { status: 404 });

  const body = await request.text();
  const signature = request.headers.get("upstash-signature");
  if (!signature) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const receiver = new Receiver({ currentSigningKey: queue.currentSigningKey, nextSigningKey: queue.nextSigningKey });
    const valid = await receiver.verify({ signature, body, url: `${queue.appBaseUrl}${JOB_WORKER_PATH}`, clockTolerance: 30 });
    if (!valid) throw new Error("invalid");
  } catch {
    logger.warn("jobs.signature_invalid");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let jobId: Types.ObjectId;
  try {
    jobId = new Types.ObjectId(bodySchema.parse(JSON.parse(body)).jobId);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const result = await runJob(jobId);
    return NextResponse.json({ result });
  } catch (error) {
    logger.error("jobs.run_failed", { jobId: jobId.toString(), error });
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
