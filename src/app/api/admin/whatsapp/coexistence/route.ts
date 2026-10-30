import { adminRoute } from "@/lib/auth/guards";
import { getEmbeddedSignupConfig, getWhatsAppConfig } from "@/lib/config/env";
import { json, readJson } from "@/lib/http/api";
import { coexistenceOnboardingSchema } from "@/lib/validation/admin";
import type { WhatsAppConnectionDoc } from "@/models/whatsapp-connection";
import { completeCoexistenceOnboarding, getCoexistenceConnection, startBusinessAppSync, SYNC_WINDOW_MS } from "@/services/whatsapp/coexistence-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function toConnectionDto(connection: WhatsAppConnectionDoc | null) {
  if (!connection) return null;
  const sync = (request: WhatsAppConnectionDoc["historySync"]) => ({ requestedAt: request.requestedAt?.toISOString() ?? null, error: request.error });
  return {
    businessAccountId: connection.businessAccountId,
    phoneNumberId: connection.phoneNumberId,
    connectedAt: connection.connectedAt.toISOString(),
    syncDeadline: new Date(connection.connectedAt.getTime() + SYNC_WINDOW_MS).toISOString(),
    subscribed: connection.subscribed,
    contactsSync: sync(connection.contactsSync),
    historySync: sync(connection.historySync),
  };
}

function activeIds(): { phoneNumberId: string; businessAccountId: string } | null {
  try {
    const config = getWhatsAppConfig();
    return { phoneNumberId: config.phoneNumberId, businessAccountId: config.businessAccountId };
  } catch {
    return null;
  }
}

/** Embedded Signup settings for the browser (public IDs only) and the last connection. Owner only. */
export const GET = adminRoute("owner", async () => {
  const signup = getEmbeddedSignupConfig();
  return json({
    signup: signup.enabled ? { enabled: true, appId: signup.appId, configId: signup.configId, apiVersion: signup.apiVersion } : { enabled: false, reason: signup.reason },
    active: activeIds(),
    connection: toConnectionDto(await getCoexistenceConnection()),
  });
});

/** Starts the one-time contacts and chat-history import for the connected number. Owner only. */
export const PUT = adminRoute("owner", async () => {
  const connection = await startBusinessAppSync();
  return json({ connection: toConnectionDto(connection), active: activeIds() });
});

/** Finishes onboarding after the Embedded Signup popup reported success. Owner only. */
export const POST = adminRoute("owner", async ({ request }) => {
  const body = await readJson(request, coexistenceOnboardingSchema, 8_000);
  const connection = await completeCoexistenceOnboarding({ code: body.code, businessAccountId: body.wabaId, phoneNumberId: body.phoneNumberId });
  return json({ connection: toConnectionDto(connection), active: activeIds() });
});
