import "server-only";

import { getWhatsAppConfig, type WhatsAppConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";

/**
 * WhatsApp Cloud API client (Graph API).
 *
 * Every call has a timeout, and failures become a `WhatsAppApiError` that says whether a retry can
 * help. The access token is only ever sent in the Authorization header and never logged.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_TEXT_LENGTH = 4096;

/**
 * Graph/WhatsApp error codes where a later retry can succeed (throttling, temporary outages).
 * Everything else (bad parameters, auth, policy, recipient problems) is permanent.
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
 */
const RETRYABLE_CODES: ReadonlySet<number> = new Set([
  1, // API unknown (transient)
  2, // API service temporarily unavailable
  4, // Application request limit reached
  17, // User request limit reached
  341, // Application limit reached
  80007, // WhatsApp Business Account rate limit
  130429, // Cloud API throughput limit
  131000, // Something went wrong
  131016, // Service unavailable
  131056, // Pair rate limit (too many messages to one customer)
  131057, // Account in maintenance mode
  133004, // Server temporarily unavailable
]);

/** Codes meaning a free-form message is not allowed and a template is required instead. */
export const OUTSIDE_WINDOW_CODES: ReadonlySet<number> = new Set([131047]);

export class WhatsAppApiError extends AppError {
  readonly graphCode: number | null;
  readonly graphSubcode: number | null;
  /** HTTP status Meta returned (0 = no response). */
  readonly graphHttpStatus: number;
  readonly fbtraceId: string | null;
  /** True when the request may have reached Meta (e.g. timeout): resending could duplicate. */
  readonly deliveryAmbiguous: boolean;

  constructor(
    message: string,
    options: { httpStatus: number; graphCode: number | null; graphSubcode: number | null; fbtraceId: string | null; retryable: boolean; deliveryAmbiguous?: boolean; cause?: unknown },
  ) {
    super(message, {
      code: "EXTERNAL_SERVICE_ERROR",
      httpStatus: 502,
      publicMessage: "The message could not be sent through WhatsApp.",
      retryable: options.retryable,
      details: { graphCode: options.graphCode, graphSubcode: options.graphSubcode, httpStatus: options.httpStatus, fbtraceId: options.fbtraceId },
      cause: options.cause,
    });
    this.name = "WhatsAppApiError";
    this.graphCode = options.graphCode;
    this.graphSubcode = options.graphSubcode;
    this.graphHttpStatus = options.httpStatus;
    this.fbtraceId = options.fbtraceId;
    this.deliveryAmbiguous = options.deliveryAmbiguous ?? false;
  }
}

export function isRetryableGraphError(httpStatus: number, graphCode: number | null): boolean {
  if (graphCode !== null && RETRYABLE_CODES.has(graphCode)) return true;
  if (graphCode !== null) return false;
  return httpStatus === 429 || httpStatus >= 500;
}

interface GraphErrorBody {
  error?: { message?: unknown; code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown; error_data?: { details?: unknown } };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function toApiError(response: Response): Promise<WhatsAppApiError> {
  const body = (await response.json().catch(() => ({}))) as GraphErrorBody;
  const graphCode = asNumber(body.error?.code);
  const details = asString(body.error?.error_data?.details);
  const message = asString(body.error?.message) ?? `Graph API HTTP ${response.status}`;
  return new WhatsAppApiError(details ? `${message}: ${details}` : message, {
    httpStatus: response.status,
    graphCode,
    graphSubcode: asNumber(body.error?.error_subcode),
    fbtraceId: asString(body.error?.fbtrace_id),
    retryable: isRetryableGraphError(response.status, graphCode),
  });
}

/**
 * Exchanges the authorization code from Embedded Signup for a business access token. The app
 * secret is sent to Meta only, over HTTPS, and the token is never logged.
 */
export async function exchangeEmbeddedSignupCode(input: {
  code: string;
  appId: string;
  appSecret: string;
  apiVersion: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${input.apiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("code", input.code);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, { method: "GET", signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    throw new WhatsAppApiError("Token exchange failed (network)", { httpStatus: 0, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: true, cause: error });
  }
  if (!response.ok) throw await toApiError(response);
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown };
  const token = asString(body.access_token);
  if (!token) {
    throw new WhatsAppApiError("Token exchange returned no access token", { httpStatus: response.status, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: false });
  }
  return token;
}

/** WhatsApp recipient IDs are digits only (country code + number, no "+"). */
const RECIPIENT_PATTERN = /^\d{6,15}$/;

export interface SendResult {
  /** The `wamid` Meta assigned; status webhooks refer to it. */
  messageId: string;
}

export interface TemplateStatus {
  name: string;
  language: string;
  status: string;
  category: string | null;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface WhatsAppClientOptions {
  config?: WhatsAppConfig;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export class WhatsAppClient {
  private readonly config: WhatsAppConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: WhatsAppClientOptions = {}) {
    this.config = options.config ?? getWhatsAppConfig();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async sendText(input: { to: string; body: string; replyToMessageId?: string | null }): Promise<SendResult> {
    const body = input.body.trim();
    if (body.length === 0 || body.length > MAX_TEXT_LENGTH) {
      throw new WhatsAppApiError(`Text must be 1-${MAX_TEXT_LENGTH} characters`, {
        httpStatus: 400, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: false,
      });
    }
    return this.sendMessage(input.to, {
      type: "text",
      text: { body, preview_url: false },
      ...(input.replyToMessageId ? { context: { message_id: input.replyToMessageId } } : {}),
    });
  }

  /** Image by public https link; WhatsApp downloads it. Captions are limited to 1024 characters. */
  async sendImage(input: { to: string; link: string; caption: string }): Promise<SendResult> {
    if (!input.link.startsWith("https://")) {
      throw new WhatsAppApiError("Image link must be https", {
        httpStatus: 400, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: false,
      });
    }
    const caption = input.caption.trim().slice(0, 1024);
    return this.sendMessage(input.to, { type: "image", image: { link: input.link, ...(caption ? { caption } : {}) } });
  }

  async sendTemplate(input: {
    to: string;
    name: string;
    languageCode: string;
    bodyParameters?: string[];
  }): Promise<SendResult> {
    const parameters = input.bodyParameters ?? [];
    return this.sendMessage(input.to, {
      type: "template",
      template: {
        name: input.name,
        language: { code: input.languageCode },
        ...(parameters.length > 0
          ? { components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    });
  }

  /** Looks up a template by name on the WhatsApp Business Account (read-only). */
  async getTemplate(name: string, languageCode: string): Promise<TemplateStatus | null> {
    const url = new URL(`${this.config.graphApiBaseUrl}/${this.config.businessAccountId}/message_templates`);
    url.searchParams.set("name", name);
    url.searchParams.set("fields", "name,language,status,category");
    url.searchParams.set("limit", "50");
    const response = await this.request(url, { method: "GET" });
    const body = (await response.json()) as { data?: { name?: unknown; language?: unknown; status?: unknown; category?: unknown }[] };
    const match = (body.data ?? []).find((item) => item.name === name && item.language === languageCode);
    if (!match) return null;
    return {
      name,
      language: languageCode,
      status: asString(match.status) ?? "UNKNOWN",
      category: asString(match.category),
    };
  }

  /** Read-only check that the token and phone number ID work. */
  async getPhoneNumberInfo(): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null }> {
    const url = new URL(`${this.config.graphApiBaseUrl}/${this.config.phoneNumberId}`);
    url.searchParams.set("fields", "display_phone_number,verified_name,quality_rating");
    const response = await this.request(url, { method: "GET" });
    const body = (await response.json()) as Record<string, unknown>;
    return {
      displayPhoneNumber: asString(body.display_phone_number),
      verifiedName: asString(body.verified_name),
      qualityRating: asString(body.quality_rating),
    };
  }

  /** Subscribes this app to a WhatsApp Business Account's webhooks. */
  async subscribeAppToAccount(businessAccountId: string): Promise<void> {
    const url = new URL(`${this.config.graphApiBaseUrl}/${businessAccountId}/subscribed_apps`);
    await this.request(url, { method: "POST" });
  }

  /**
   * Coexistence: asks Meta to send the WhatsApp Business app's contacts (`smb_app_state_sync`) or
   * chat history (`history`) as webhooks. Each can be requested once, within 24 hours of onboarding.
   */
  async requestBusinessAppSync(phoneNumberId: string, syncType: "smb_app_state_sync" | "history"): Promise<{ requestId: string | null }> {
    const url = new URL(`${this.config.graphApiBaseUrl}/${phoneNumberId}/smb_app_data`);
    const response = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
    });
    const body = (await response.json().catch(() => ({}))) as { request_id?: unknown };
    return { requestId: asString(body.request_id) };
  }

  private async sendMessage(to: string, message: Record<string, unknown>): Promise<SendResult> {
    if (!RECIPIENT_PATTERN.test(to)) {
      throw new WhatsAppApiError("Recipient must be a WhatsApp ID (digits only)", {
        httpStatus: 400, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: false,
      });
    }

    const url = new URL(`${this.config.graphApiBaseUrl}/${this.config.phoneNumberId}/messages`);
    const response = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...message }),
    });

    const body = (await response.json().catch(() => ({}))) as { messages?: { id?: unknown }[] };
    const messageId = asString(body.messages?.[0]?.id);
    if (!messageId) {
      // Meta accepted the request but returned no ID: the message may or may not have been sent.
      throw new WhatsAppApiError("Graph API response did not include a message ID", {
        httpStatus: response.status, graphCode: null, graphSubcode: null, fbtraceId: null, retryable: false,
      });
    }
    return { messageId };
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.config.accessToken}` },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new WhatsAppApiError(timedOut ? "Graph API request timed out" : "Graph API request failed (network)", {
        httpStatus: 0, graphCode: null, graphSubcode: null, fbtraceId: null,
        retryable: true,
        // A request that timed out may still have been processed by Meta.
        deliveryAmbiguous: timedOut,
        cause: error,
      });
    }

    if (!response.ok) throw await toApiError(response);
    return response;
  }
}
