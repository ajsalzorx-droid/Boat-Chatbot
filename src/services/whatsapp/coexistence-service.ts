import "server-only";

import { getEmbeddedSignupConfig, getWhatsAppConfig } from "@/lib/config/env";
import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";
import { exchangeEmbeddedSignupCode, WhatsAppApiError, WhatsAppClient } from "@/lib/whatsapp/client";
import { WhatsAppConnection, type SyncRequest, type WhatsAppConnectionDoc } from "@/models/whatsapp-connection";

/**
 * Coexistence onboarding: the business connected its WhatsApp Business app number through
 * Embedded Signup in the dashboard. We exchange the code for a business token, subscribe this app
 * to the account's webhooks, and request the one-time contacts and chat-history sync (allowed
 * only within 24 hours of onboarding). The business token is used for these calls only and is
 * not stored; day-to-day sending uses WHATSAPP_ACCESS_TOKEN.
 */

function safeError(error: unknown): string {
  if (error instanceof WhatsAppApiError) return `${error.graphCode ?? `HTTP ${error.graphHttpStatus}`}: ${error.message}`.slice(0, 500);
  return "Unexpected error";
}

async function requestSync(client: WhatsAppClient, phoneNumberId: string, syncType: "smb_app_state_sync" | "history"): Promise<SyncRequest> {
  try {
    const { requestId } = await client.requestBusinessAppSync(phoneNumberId, syncType);
    return { requestedAt: new Date(), requestId, error: null };
  } catch (error) {
    logger.warn("coexistence.sync_failed", { syncType, error });
    return { requestedAt: null, requestId: null, error: safeError(error) };
  }
}

export async function completeCoexistenceOnboarding(input: { code: string; businessAccountId: string; phoneNumberId: string }): Promise<WhatsAppConnectionDoc> {
  const signup = getEmbeddedSignupConfig();
  if (!signup.enabled) {
    throw new AppError("Embedded Signup not configured", {
      code: "CONFLICT",
      httpStatus: 409,
      publicMessage: "Embedded Signup is not configured on the server (META_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID).",
    });
  }
  const whatsapp = getWhatsAppConfig();

  let businessToken: string;
  try {
    businessToken = await exchangeEmbeddedSignupCode({ code: input.code, appId: signup.appId, appSecret: whatsapp.appSecret, apiVersion: whatsapp.apiVersion });
  } catch (error) {
    logger.warn("coexistence.token_exchange_failed", { error });
    throw new AppError("Token exchange failed", {
      code: "EXTERNAL_SERVICE_ERROR",
      httpStatus: 502,
      publicMessage: "Meta did not accept the signup code. Please run the connection again.",
      cause: error,
    });
  }

  const client = new WhatsAppClient({ config: { ...whatsapp, accessToken: businessToken } });
  let subscribed = false;
  try {
    await client.subscribeAppToAccount(input.businessAccountId);
    subscribed = true;
  } catch (error) {
    logger.warn("coexistence.subscribe_failed", { error });
  }

  // Contacts first, then history, as Meta recommends.
  const contactsSync = await requestSync(client, input.phoneNumberId, "smb_app_state_sync");
  const historySync = await requestSync(client, input.phoneNumberId, "history");

  await connectToDatabase();
  const saved = await WhatsAppConnection.findOneAndUpdate(
    { key: "default" },
    {
      $set: {
        businessAccountId: input.businessAccountId,
        phoneNumberId: input.phoneNumberId,
        connectedAt: new Date(),
        subscribed,
        contactsSync,
        historySync,
      },
      $setOnInsert: { key: "default" },
    },
    { upsert: true, returnDocument: "after", lean: true, runValidators: true },
  );
  if (!saved) throw new Error("Connection upsert returned nothing");
  logger.info("coexistence.onboarded", { subscribed, contactsSync: !contactsSync.error, historySync: !historySync.error });
  return saved;
}

export async function getCoexistenceConnection(): Promise<WhatsAppConnectionDoc | null> {
  await connectToDatabase();
  return WhatsAppConnection.findOne({ key: "default" }).lean();
}
