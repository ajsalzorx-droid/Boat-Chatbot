import { NextResponse, type NextRequest } from "next/server";

import { getWhatsAppConfig, type WhatsAppConfig } from "@/lib/config/env";
import { logger } from "@/lib/logging/logger";
import { safeEqual, verifyMetaSignature } from "@/lib/whatsapp/signature";
import { parseWebhookPayload } from "@/lib/whatsapp/webhook-parser";
import { dispatchJob } from "@/services/jobs/queue";
import { ingestEvents } from "@/services/webhooks/ingest-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 1_000_000;

function loadConfig(): WhatsAppConfig | null {
  try {
    return getWhatsAppConfig();
  } catch (error) {
    logger.error("webhook.config_missing", { error });
    return null;
  }
}

/**
 * Webhook verification handshake. Meta calls this once when the callback URL is saved and
 * expects the exact `hub.challenge` back only when `hub.verify_token` matches ours.
 */
export function GET(request: NextRequest): NextResponse {
  const config = loadConfig();
  if (!config) return new NextResponse("Service unavailable", { status: 503 });

  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token !== null && challenge !== null && safeEqual(token, config.verifyToken)) {
    logger.info("webhook.verified");
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  logger.warn("webhook.verification_rejected", { mode });
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Event delivery. The request is authenticated with X-Hub-Signature-256 over the raw bytes,
 * parsed and validated, then durably stored (messages, jobs, statuses) BEFORE we answer 200.
 * If storage fails we answer 500, and Meta retries the delivery later.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = loadConfig();
  if (!config) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    logger.warn("webhook.signature_invalid", { bytes: rawBody.byteLength });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    logger.warn("webhook.invalid_json");
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseWebhookPayload(payload);
  if (!parsed.ok) {
    // Authentic but not something we can use; a redelivery would not change that, so acknowledge.
    logger.warn("webhook.payload_ignored", { reason: parsed.reason });
    return NextResponse.json({ received: true });
  }

  try {
    const result = await ingestEvents(parsed.events, { channel: "whatsapp", expectedPhoneNumberId: config.phoneNumberId });
    for (const job of result.jobs) await dispatchJob(job.id, job.runAt);
    logger.info("webhook.accepted", { inbound: result.inbound, statuses: result.statuses, echoes: result.echoes, history: result.history, ignored: result.ignored });
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("webhook.ingest_failed", { error });
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 500 });
  }
}
