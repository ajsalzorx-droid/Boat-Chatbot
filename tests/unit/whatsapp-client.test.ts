import { describe, expect, it, vi } from "vitest";

import type { WhatsAppConfig } from "@/lib/config/env";
import { exchangeEmbeddedSignupCode, isRetryableGraphError, WhatsAppApiError, WhatsAppClient, type FetchLike } from "@/lib/whatsapp/client";

const config: WhatsAppConfig = {
  accessToken: "EAAG-test-token",
  phoneNumberId: "123456789012345",
  businessAccountId: "987654321098765",
  verifyToken: "v".repeat(40),
  appSecret: "secret",
  apiVersion: "v25.0",
  graphApiBaseUrl: "https://graph.facebook.com/v25.0",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function graphError(code: number, message = "error") {
  return { error: { message, type: "OAuthException", code, fbtrace_id: "trace123" } };
}

async function captureError(promise: Promise<unknown>): Promise<WhatsAppApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WhatsAppApiError) return error;
    throw error;
  }
  throw new Error("expected WhatsAppApiError");
}

describe("WhatsAppClient.sendText", () => {
  it("posts the Cloud API payload with a server-side bearer token and returns the message ID", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.ABC" }] }));
    const client = new WhatsAppClient({ config, fetchImpl });

    await expect(client.sendText({ to: "971500000001", body: " Hello! " })).resolves.toEqual({ messageId: "wamid.ABC" });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v25.0/123456789012345/messages");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer EAAG-test-token");
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "971500000001",
      type: "text",
      text: { body: "Hello!", preview_url: false },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects invalid recipients and empty or oversized text before calling the API", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const client = new WhatsAppClient({ config, fetchImpl });
    expect((await captureError(client.sendText({ to: "+971 50", body: "x" }))).retryable).toBe(false);
    expect((await captureError(client.sendText({ to: "971500000001", body: "   " }))).retryable).toBe(false);
    expect((await captureError(client.sendText({ to: "971500000001", body: "x".repeat(4097) }))).retryable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an expired token (190) as permanent", async () => {
    const client = new WhatsAppClient({ config, fetchImpl: vi.fn<FetchLike>().mockResolvedValue(jsonResponse(401, graphError(190, "Session has expired"))) });
    const error = await captureError(client.sendText({ to: "971500000001", body: "hi" }));
    expect(error).toMatchObject({ graphCode: 190, graphHttpStatus: 401, retryable: false, fbtraceId: "trace123" });
  });

  it("treats throttling and server errors as retryable", async () => {
    for (const [status, body] of [
      [429, graphError(130429)],
      [400, graphError(131056)],
      [500, graphError(131000)],
      [503, {}],
    ] as const) {
      const client = new WhatsAppClient({ config, fetchImpl: vi.fn<FetchLike>().mockResolvedValue(jsonResponse(status, body)) });
      expect((await captureError(client.sendText({ to: "971500000001", body: "hi" }))).retryable).toBe(true);
    }
  });

  it("treats policy and recipient errors as permanent", async () => {
    for (const code of [131047, 131026, 131031, 100, 132001]) {
      const client = new WhatsAppClient({ config, fetchImpl: vi.fn<FetchLike>().mockResolvedValue(jsonResponse(400, graphError(code))) });
      expect((await captureError(client.sendText({ to: "971500000001", body: "hi" }))).retryable).toBe(false);
    }
  });

  it("flags timeouts as ambiguous (the message may have been sent)", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const client = new WhatsAppClient({ config, fetchImpl: vi.fn<FetchLike>().mockRejectedValue(timeout) });
    const error = await captureError(client.sendText({ to: "971500000001", body: "hi" }));
    expect(error).toMatchObject({ retryable: true, deliveryAmbiguous: true, graphHttpStatus: 0 });
  });

  it("does not flag connection failures as ambiguous", async () => {
    const client = new WhatsAppClient({ config, fetchImpl: vi.fn<FetchLike>().mockRejectedValue(new TypeError("fetch failed")) });
    const error = await captureError(client.sendText({ to: "971500000001", body: "hi" }));
    expect(error).toMatchObject({ retryable: true, deliveryAmbiguous: false });
  });

  it("never includes the access token in error messages", async () => {
    const client = new WhatsAppClient({ config, fetchImpl: vi.fn<FetchLike>().mockResolvedValue(jsonResponse(400, graphError(100, "Invalid parameter"))) });
    const error = await captureError(client.sendText({ to: "971500000001", body: "hi" }));
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain("EAAG-test-token");
  });
});

describe("WhatsAppClient templates", () => {
  it("sends a template with body parameters", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(200, { messages: [{ id: "wamid.T" }] }));
    await new WhatsAppClient({ config, fetchImpl }).sendTemplate({ to: "971500000001", name: "order_update", languageCode: "en", bodyParameters: ["A-1"] });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toMatchObject({
      type: "template",
      template: { name: "order_update", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "A-1" }] }] },
    });
  });

  it("looks up a template's approval status", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(200, { data: [{ name: "reengage", language: "en", status: "APPROVED", category: "UTILITY" }, { name: "reengage", language: "ar", status: "PENDING" }] }),
      ),
    );
    const client = new WhatsAppClient({ config, fetchImpl });
    await expect(client.getTemplate("reengage", "en")).resolves.toEqual({ name: "reengage", language: "en", status: "APPROVED", category: "UTILITY" });
    await expect(client.getTemplate("reengage", "fr")).resolves.toBeNull();
  });
});

describe("isRetryableGraphError", () => {
  it("falls back to the HTTP status when Meta sends no code", () => {
    expect(isRetryableGraphError(502, null)).toBe(true);
    expect(isRetryableGraphError(400, null)).toBe(false);
  });
});

describe("coexistence onboarding calls", () => {
  it("requests the business app sync for the phone number", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(200, { request_id: "req-123" }));
    const client = new WhatsAppClient({ config, fetchImpl });

    expect(await client.requestBusinessAppSync("555000111222333", "history")).toEqual({ requestId: "req-123" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v25.0/555000111222333/smb_app_data");
    expect(JSON.parse(String(init?.body))).toEqual({ messaging_product: "whatsapp", sync_type: "history" });
  });

  it("subscribes the app to an account", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(200, { success: true }));
    await new WhatsAppClient({ config, fetchImpl }).subscribeAppToAccount("111222333444555");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v25.0/111222333444555/subscribed_apps");
    expect(init?.method).toBe("POST");
  });

  it("exchanges the Embedded Signup code for a business token", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(200, { access_token: "business-token" }));
    const token = await exchangeEmbeddedSignupCode({ code: "the-code", appId: "1234567", appSecret: "app-secret", apiVersion: "v25.0", fetchImpl });
    expect(token).toBe("business-token");
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.pathname).toBe("/v25.0/oauth/access_token");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "1234567", client_secret: "app-secret", code: "the-code" });
  });

  it("rejects a token exchange without a token", async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(400, graphError(100, "Invalid code")));
    await expect(exchangeEmbeddedSignupCode({ code: "bad-code-xx", appId: "1234567", appSecret: "s", apiVersion: "v25.0", fetchImpl })).rejects.toBeInstanceOf(WhatsAppApiError);
  });
});
