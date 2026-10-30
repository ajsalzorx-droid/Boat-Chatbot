import "server-only";

import { getEmbeddedSignupConfig, getWhatsAppConfig } from "@/lib/config/env";
import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";
import { exchangeEmbeddedSignupCode, WhatsAppApiError, WhatsAppClient } from "@/lib/whatsapp/client";
import { WhatsAppConnection, type SyncRequest, type WhatsAppConnectionDoc } from "@/models/whatsapp-connection";

/**
 * Coexistence onboarding: the business connected its WhatsApp Business app number through
 * Embedded Signup in the dashboard. We exchange the code for a business token and subscribe this
 * app to the account's webhooks. The business token is used for that call only and is not stored;
 * day-to-day sending uses WHATSAPP_ACCESS_TOKEN.
 *
 * The one-time contacts and chat-history sync (allowed only within 24 hours of onboarding) is
 * started separately, once the environment points at the new number. Webhooks for any other
 * number are ignored, so history requested earlier would be lost.
 */

export const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;
const NOT_REQUESTED: SyncRequest = { requestedAt: null, requestId: null, error: null };

function activeIdsMatch(connection: Pick<WhatsAppConnectionDoc, "phoneNumberId" | "businessAccountId">): boolean {
  try {
    const config = getWhatsAppConfig();
    return config.phoneNumberId === connection.phoneNumberId && config.businessAccountId === connection.businessAccountId;
  } catch {
    return false;
  }
}

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

  // Reconnecting the number the server already uses can sync right away; a new number waits.
  const syncNow = activeIdsMatch(input);
  const contactsSync = syncNow ? await requestSync(client, input.phoneNumberId, "smb_app_state_sync") : NOT_REQUESTED;
  const historySync = syncNow ? await requestSync(client, input.phoneNumberId, "history") : NOT_REQUESTED;

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

/**
 * Starts the contacts and chat-history sync for the connected number with the server's own token
 * (the WhatsApp account must be assigned to its system user). Only once, and only while the
 * environment already uses that number.
 */
export async function startBusinessAppSync(): Promise<WhatsAppConnectionDoc> {
  const connection = await getCoexistenceConnection();
  const conflict = (publicMessage: string) => new AppError(publicMessage, { code: "CONFLICT", httpStatus: 409, publicMessage });
  if (!connection) throw conflict("No WhatsApp Business app number has been connected yet.");
  if (!activeIdsMatch(connection)) {
    throw conflict("Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_BUSINESS_ACCOUNT_ID to the connected number and redeploy first.");
  }
  if (Date.now() - connection.connectedAt.getTime() > SYNC_WINDOW_MS) {
    throw conflict("Meta allows the history import only within 24 hours of connecting. Connect the number again to retry.");
  }
  if (connection.historySync.requestedAt) throw conflict("The chat history import was already started.");

  const client = new WhatsAppClient();
  const contactsSync = connection.contactsSync.requestedAt ? connection.contactsSync : await requestSync(client, connection.phoneNumberId, "smb_app_state_sync");
  const historySync = await requestSync(client, connection.phoneNumberId, "history");
  const saved = await WhatsAppConnection.findOneAndUpdate({ key: "default" }, { $set: { contactsSync, historySync } }, { returnDocument: "after", lean: true });
  if (!saved) throw new Error("Connection disappeared");
  logger.info("coexistence.sync_started", { contactsSync: !contactsSync.error, historySync: !historySync.error });
  return saved;
}

export async function getCoexistenceConnection(): Promise<WhatsAppConnectionDoc | null> {
  await connectToDatabase();
  return WhatsAppConnection.findOne({ key: "default" }).lean();
}
