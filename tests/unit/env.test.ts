import { describe, expect, it } from "vitest";

import {
  getAiConfig,
  getCronSecret,
  isSimulatorEnabled,
  getAuthConfig,
  getConfigStatus,
  getDatabaseConfig,
  getQueueConfig,
  getWhatsAppConfig,
} from "@/lib/config/env";
import { ConfigError } from "@/lib/errors/app-error";

const strong = (char: string) => char.repeat(48);

const validWhatsApp = {
  WHATSAPP_ACCESS_TOKEN: "EAAG" + strong("a"),
  WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
  WHATSAPP_BUSINESS_ACCOUNT_ID: "987654321098765",
  WHATSAPP_VERIFY_TOKEN: strong("v"),
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  WHATSAPP_API_VERSION: "v23.0",
};

function captureConfigError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected ConfigError");
}

describe("getDatabaseConfig", () => {
  it("accepts mongodb+srv URIs", () => {
    expect(getDatabaseConfig({ MONGODB_URI: "mongodb+srv://u:p@cluster.example.net/db" }).uri).toMatch(/^mongodb\+srv/);
  });

  it("treats blank values as missing", () => {
    const error = captureConfigError(() => getDatabaseConfig({ MONGODB_URI: "   " }));
    expect(error.code).toBe("CONFIG_MISSING");
    expect(error.variables).toEqual(["MONGODB_URI"]);
  });

  it("rejects non-MongoDB URIs without echoing them", () => {
    const error = captureConfigError(() => getDatabaseConfig({ MONGODB_URI: "postgres://user:hunter2@host/db" }));
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).not.toContain("hunter2");
  });
});

describe("getWhatsAppConfig", () => {
  it("parses a complete configuration and builds the Graph API URL", () => {
    const config = getWhatsAppConfig(validWhatsApp);
    expect(config.graphApiBaseUrl).toBe("https://graph.facebook.com/v23.0");
    expect(config.phoneNumberId).toBe("123456789012345");
  });

  it("reports every missing variable by name", () => {
    const error = captureConfigError(() => getWhatsAppConfig({}));
    expect(error.variables).toEqual(expect.arrayContaining(Object.keys(validWhatsApp)));
  });

  it("rejects malformed identifiers and API versions", () => {
    const error = captureConfigError(() =>
      getWhatsAppConfig({ ...validWhatsApp, WHATSAPP_PHONE_NUMBER_ID: "+1 555", WHATSAPP_API_VERSION: "latest" }),
    );
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.variables).toEqual(expect.arrayContaining(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_VERSION"]));
  });

  it("reports missing and invalid variables together", () => {
    const rest: Record<string, string> = { ...validWhatsApp };
    delete rest.WHATSAPP_ACCESS_TOKEN;
    const error = captureConfigError(() => getWhatsAppConfig({ ...rest, WHATSAPP_API_VERSION: "23.0" }));
    expect(error.code).toBe("CONFIG_MISSING");
    expect(error.missing).toEqual(["WHATSAPP_ACCESS_TOKEN"]);
    expect(error.invalid).toEqual(["WHATSAPP_API_VERSION"]);
  });

  it("rejects a short verify token", () => {
    const error = captureConfigError(() => getWhatsAppConfig({ ...validWhatsApp, WHATSAPP_VERIFY_TOKEN: "short" }));
    expect(error.variables).toEqual(["WHATSAPP_VERIFY_TOKEN"]);
  });

  it("rejects placeholder secrets only in production", () => {
    const placeholder = { ...validWhatsApp, WHATSAPP_VERIFY_TOKEN: "change-me-change-me-change-me-change-me" };
    expect(() => getWhatsAppConfig(placeholder)).not.toThrow();
    const error = captureConfigError(() => getWhatsAppConfig({ ...placeholder, NODE_ENV: "production" }));
    expect(error.variables).toEqual(["WHATSAPP_VERIFY_TOKEN"]);
  });
});

describe("getAuthConfig", () => {
  it("defaults the session TTL and enables secure cookies in production", () => {
    const config = getAuthConfig({ ADMIN_SESSION_SECRET: strong("s"), NODE_ENV: "production" });
    expect(config.sessionTtlSeconds).toBe(12 * 3600);
    expect(config.secureCookies).toBe(true);
  });

  it("does not force secure cookies outside production (localhost is http)", () => {
    expect(getAuthConfig({ ADMIN_SESSION_SECRET: strong("s") }).secureCookies).toBe(false);
  });

  it("bounds the session TTL", () => {
    const error = captureConfigError(() =>
      getAuthConfig({ ADMIN_SESSION_SECRET: strong("s"), ADMIN_SESSION_TTL_HOURS: "1000" }),
    );
    expect(error.variables).toEqual(["ADMIN_SESSION_TTL_HOURS"]);
  });
});

describe("getAiConfig", () => {
  it("is disabled by default and never throws", () => {
    expect(getAiConfig({})).toEqual({ enabled: false, reason: "AI_PROVIDER is not set" });
  });

  it("is disabled with a reason when the key or model is missing", () => {
    const config = getAiConfig({ AI_PROVIDER: "anthropic" });
    expect(config.enabled).toBe(false);
    if (!config.enabled) expect(config.reason).toContain("AI_PROVIDER_API_KEY");
  });

  it("ignores leftover AI settings while the provider is off", () => {
    expect(getAiConfig({ AI_PROVIDER: "none", AI_TIMEOUT_MS: "500" })).toEqual({
      enabled: false,
      reason: "AI_PROVIDER is not set",
    });
  });

  it("rejects a placeholder API key in production", () => {
    const config = getAiConfig({
      NODE_ENV: "production",
      AI_PROVIDER: "anthropic",
      AI_PROVIDER_API_KEY: "your-anthropic-api-key-here",
      AI_MODEL: "claude-haiku-5-5",
    });
    expect(config.enabled).toBe(false);
    if (!config.enabled) expect(config.reason).toContain("invalid: AI_PROVIDER_API_KEY");
  });

  it("is disabled, not thrown, for an unknown provider", () => {
    expect(getAiConfig({ AI_PROVIDER: "mystery" }).enabled).toBe(false);
  });

  it("enables a fully configured provider with the default timeout", () => {
    expect(
      getAiConfig({ AI_PROVIDER: "anthropic", AI_PROVIDER_API_KEY: strong("k"), AI_MODEL: "claude-haiku-5-5" }),
    ).toEqual({
      enabled: true,
      provider: "anthropic",
      apiKey: strong("k"),
      model: "claude-haiku-5-5",
      timeoutMs: 12_000,
    });
  });
});

describe("getQueueConfig", () => {
  const validQueue = {
    APP_BASE_URL: "https://bot.example.com/",
    QSTASH_TOKEN: strong("q"),
    QSTASH_CURRENT_SIGNING_KEY: strong("c"),
    QSTASH_NEXT_SIGNING_KEY: strong("n"),
  };

  it("falls back to inline mode when QStash is not configured", () => {
    expect(getQueueConfig({})).toEqual({ mode: "inline" });
  });

  it("normalizes the base URL in qstash mode", () => {
    const config = getQueueConfig(validQueue);
    expect(config.mode === "qstash" ? config.appBaseUrl : null).toBe("https://bot.example.com");
  });

  it("rejects a partial QStash configuration", () => {
    const error = captureConfigError(() => getQueueConfig({ QSTASH_TOKEN: strong("q") }));
    expect(error.missing).toEqual(expect.arrayContaining(["APP_BASE_URL", "QSTASH_CURRENT_SIGNING_KEY"]));
  });

  it("requires https in production", () => {
    const error = captureConfigError(() =>
      getQueueConfig({ ...validQueue, APP_BASE_URL: "http://bot.internal", NODE_ENV: "production" }),
    );
    expect(error.variables).toEqual(["APP_BASE_URL"]);
  });

  it("checks the scheme case-insensitively", () => {
    expect(() => getQueueConfig({ ...validQueue, APP_BASE_URL: "HTTPS://bot.example.com", NODE_ENV: "production" })).not.toThrow();
  });

  it("rejects non-web schemes in every environment", () => {
    for (const url of ["ftp://host", "javascript:alert(1)"]) {
      const error = captureConfigError(() => getQueueConfig({ ...validQueue, APP_BASE_URL: url }));
      expect(error.invalid).toEqual(["APP_BASE_URL"]);
    }
  });
});

describe("getConfigStatus", () => {
  it("reports variable names only", () => {
    const status = getConfigStatus({ MONGODB_URI: "mongodb://user:topsecret@localhost:27017/app" });
    expect(status.database).toEqual({ configured: true });
    expect(status.whatsapp).toMatchObject({ configured: false, invalid: [] });
    expect(JSON.stringify(status)).not.toContain("topsecret");
  });
});

describe("getCronSecret", () => {
  it("requires a strong secret", () => {
    expect(getCronSecret({ CRON_SECRET: strong("c") })).toBe(strong("c"));
    expect(captureConfigError(() => getCronSecret({ CRON_SECRET: "short" })).invalid).toEqual(["CRON_SECRET"]);
  });
});

describe("isSimulatorEnabled", () => {
  it("is on outside production and off in production unless explicitly enabled", () => {
    expect(isSimulatorEnabled({})).toBe(true);
    expect(isSimulatorEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isSimulatorEnabled({ NODE_ENV: "production", SIMULATOR_ENABLED: "true" })).toBe(true);
    expect(isSimulatorEnabled({ SIMULATOR_ENABLED: "false" })).toBe(false);
  });
});
