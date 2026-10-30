import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppConnection } from "@/models/whatsapp-connection";
import { completeCoexistenceOnboarding, startBusinessAppSync } from "@/services/whatsapp/coexistence-service";

import { clearDatabase, startTestDatabase, stopTestDatabase } from "../helpers/db";
import { setWhatsAppEnv, TEST_PHONE_NUMBER_ID } from "../helpers/fixtures";

const NEW_PHONE_ID = "555000111222333";
const NEW_WABA_ID = "444000111222333";

/** Graph API stand-in: token exchange, app subscription and sync requests. */
function stubGraph(): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const body = url.pathname.endsWith("/oauth/access_token")
      ? { access_token: `EAAB${"b".repeat(40)}` }
      : url.pathname.endsWith("/smb_app_data")
        ? { request_id: `req-${calls.length}` }
        : { success: true };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  });
  return calls;
}

beforeAll(async () => {
  setWhatsAppEnv();
  process.env.META_APP_ID = "1676148997210546";
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "1172487385733935";
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await clearDatabase();
  process.env.WHATSAPP_PHONE_NUMBER_ID = TEST_PHONE_NUMBER_ID;
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = "987654321098765";
});

describe("coexistence onboarding", () => {
  it("connects a new number without starting the history import, so no history is lost", async () => {
    const calls = stubGraph();
    const connection = await completeCoexistenceOnboarding({ code: "signup-code", businessAccountId: NEW_WABA_ID, phoneNumberId: NEW_PHONE_ID });
    expect(connection).toMatchObject({ phoneNumberId: NEW_PHONE_ID, subscribed: true, historySync: { requestedAt: null }, contactsSync: { requestedAt: null } });
    expect(calls.some((path) => path.endsWith("/smb_app_data"))).toBe(false);

    // The server still uses the old number: the import must wait.
    await expect(startBusinessAppSync()).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("starts the import once, after the server uses the connected number", async () => {
    stubGraph();
    await completeCoexistenceOnboarding({ code: "signup-code", businessAccountId: NEW_WABA_ID, phoneNumberId: NEW_PHONE_ID });
    process.env.WHATSAPP_PHONE_NUMBER_ID = NEW_PHONE_ID;
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = NEW_WABA_ID;

    const calls = stubGraph();
    const started = await startBusinessAppSync();
    expect(calls.filter((path) => path.endsWith(`/${NEW_PHONE_ID}/smb_app_data`))).toHaveLength(2);
    expect(started.historySync.requestedAt).toBeInstanceOf(Date);
    expect(started.contactsSync.requestedAt).toBeInstanceOf(Date);
    await expect(startBusinessAppSync()).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("refuses the import after Meta's 24-hour limit", async () => {
    stubGraph();
    await completeCoexistenceOnboarding({ code: "signup-code", businessAccountId: NEW_WABA_ID, phoneNumberId: NEW_PHONE_ID });
    await WhatsAppConnection.updateOne({}, { $set: { connectedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    process.env.WHATSAPP_PHONE_NUMBER_ID = NEW_PHONE_ID;
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = NEW_WABA_ID;
    await expect(startBusinessAppSync()).rejects.toMatchObject({ publicMessage: expect.stringContaining("24 hours") as unknown });
  });
});
