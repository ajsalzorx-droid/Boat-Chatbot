import "server-only";

import { z } from "zod";

import { ConfigError } from "@/lib/errors/app-error";

/**
 * Server-side environment configuration.
 *
 * Variables are grouped by feature and validated lazily, when that feature is used, so that a
 * missing optional integration (AI) never prevents the app from booting, while a missing critical
 * integration (database, WhatsApp) fails that operation loudly and safely.
 *
 * Values are never included in error messages, only variable names.
 */

type EnvSource = Readonly<Record<string, string | undefined>>;

const PLACEHOLDER_PATTERN = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|your[-_]|<.*>|^x{4,}$|^test$|^secret$)/i;

/** Treats empty strings as unset, which is how most hosting dashboards represent "blank". */
function readEnv(source: EnvSource, keys: readonly string[]): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const key of keys) {
    const raw = source[key];
    values[key] = raw === undefined || raw.trim() === "" ? undefined : raw.trim();
  }
  return values;
}

function isProduction(source: EnvSource): boolean {
  return source.NODE_ENV === "production";
}

/** A high-entropy secret. Placeholder values are rejected in production. */
function secret(minLength: number, source: EnvSource) {
  return z
    .string()
    .min(minLength)
    .refine((value) => !isProduction(source) || !PLACEHOLDER_PATTERN.test(value), {
      message: "placeholder value is not allowed in production",
    });
}

const numericId = z.string().regex(/^\d{5,20}$/, "must be a numeric Meta identifier");

function parseGroup<S extends z.ZodObject>(group: string, schema: S, source: EnvSource): z.infer<S> {
  const keys = Object.keys(schema.shape);
  const values = readEnv(source, keys);
  const result = schema.safeParse(values);
  if (result.success) return result.data;

  // Report missing and invalid variables together so operators can fix everything in one deploy.
  const missing = new Set<string>();
  const invalid = new Set<string>();
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "unknown");
    if (values[key] === undefined) missing.add(key);
    else invalid.add(key);
  }
  throw new ConfigError(group, { missing: [...missing], invalid: [...invalid] });
}

/** An absolute http(s) URL; production additionally requires https. Scheme check is case-insensitive. */
function webUrl(source: EnvSource) {
  return z.url().refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return isProduction(source) ? protocol === "https:" : protocol === "https:" || protocol === "http:";
    },
    { message: "must be an http(s) URL (https in production)" },
  );
}

// ---------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------

const databaseSchema = z.object({
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a MongoDB connection string"),
  MONGODB_DB_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/).optional(),
});

export interface DatabaseConfig {
  uri: string;
  dbName: string | undefined;
}

export function getDatabaseConfig(source: EnvSource = process.env): DatabaseConfig {
  const env = parseGroup("database", databaseSchema, source);
  return { uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME };
}

// ---------------------------------------------------------------------------------------------
// Company website database (optional, read only)
// ---------------------------------------------------------------------------------------------

const websiteDbSchema = z.object({
  WEBSITE_DB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, "must be a MongoDB connection string"),
  WEBSITE_DB_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/).optional(),
});

/** Null when WEBSITE_DB_URI is not set: the bot then answers from its own products only. */
export function getWebsiteDbConfig(source: EnvSource = process.env): DatabaseConfig | null {
  if (readEnv(source, ["WEBSITE_DB_URI"]).WEBSITE_DB_URI === undefined) return null;
  const env = parseGroup("website database", websiteDbSchema, source);
  return { uri: env.WEBSITE_DB_URI, dbName: env.WEBSITE_DB_NAME };
}

// ---------------------------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------------------------

function whatsAppSchema(source: EnvSource) {
  return z.object({
    WHATSAPP_ACCESS_TOKEN: secret(20, source),
    WHATSAPP_PHONE_NUMBER_ID: numericId,
    WHATSAPP_BUSINESS_ACCOUNT_ID: numericId,
    WHATSAPP_VERIFY_TOKEN: secret(32, source),
    META_APP_SECRET: secret(16, source),
    WHATSAPP_API_VERSION: z.string().regex(/^v\d{1,3}\.\d$/, "must look like v23.0"),
  });
}

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  appSecret: string;
  apiVersion: string;
  graphApiBaseUrl: string;
}

export function getWhatsAppConfig(source: EnvSource = process.env): WhatsAppConfig {
  const env = parseGroup("whatsapp", whatsAppSchema(source), source);
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    appSecret: env.META_APP_SECRET,
    apiVersion: env.WHATSAPP_API_VERSION,
    graphApiBaseUrl: `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Embedded Signup (optional): connects a number already used in the WhatsApp Business app
// ("coexistence"). Needs the Meta app ID and a Facebook Login for Business configuration ID.
// ---------------------------------------------------------------------------------------------

const embeddedSignupSchema = z.object({
  META_APP_ID: numericId,
  META_EMBEDDED_SIGNUP_CONFIG_ID: numericId,
});

export type EmbeddedSignupConfig =
  | { enabled: true; appId: string; configId: string; apiVersion: string }
  | { enabled: false; reason: string };

/** Never throws: the dashboard explains what is missing instead. */
export function getEmbeddedSignupConfig(source: EnvSource = process.env): EmbeddedSignupConfig {
  try {
    const env = parseGroup("embedded_signup", embeddedSignupSchema, source);
    const whatsapp = getWhatsAppConfig(source);
    return { enabled: true, appId: env.META_APP_ID, configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID, apiVersion: whatsapp.apiVersion };
  } catch (error) {
    return { enabled: false, reason: error instanceof ConfigError ? error.message : "Embedded Signup configuration could not be read" };
  }
}

// ---------------------------------------------------------------------------------------------
// Admin authentication
// ---------------------------------------------------------------------------------------------

function authSchema(source: EnvSource) {
  return z.object({
    ADMIN_SESSION_SECRET: secret(32, source),
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  });
}

export interface AuthConfig {
  sessionSecret: string;
  sessionTtlSeconds: number;
  secureCookies: boolean;
}

export function getAuthConfig(source: EnvSource = process.env): AuthConfig {
  const env = parseGroup("auth", authSchema(source), source);
  return {
    sessionSecret: env.ADMIN_SESSION_SECRET,
    sessionTtlSeconds: env.ADMIN_SESSION_TTL_HOURS * 3600,
    secureCookies: isProduction(source),
  };
}

// ---------------------------------------------------------------------------------------------
// AI provider (optional)
// ---------------------------------------------------------------------------------------------

export const AI_PROVIDERS = ["none", "anthropic", "gemini"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const aiProviderSchema = z.object({ AI_PROVIDER: z.enum(AI_PROVIDERS).default("none") });

function aiSettingsSchema(source: EnvSource) {
  return z.object({
    AI_PROVIDER_API_KEY: secret(20, source),
    AI_MODEL: z.string().regex(/^[A-Za-z0-9._:/-]{2,100}$/),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(12_000),
  });
}

export type AiConfig =
  | { enabled: true; provider: Exclude<AiProviderName, "none">; apiKey: string; model: string; timeoutMs: number }
  | { enabled: false; reason: string };

function describeConfigError(error: unknown): string {
  return error instanceof ConfigError ? error.message : "AI configuration could not be read";
}

/**
 * Never throws: the chatbot must keep answering from FAQs and rules when AI is unavailable.
 * The `reason` is safe to show on the admin health page.
 *
 * The provider is resolved first, so leftover AI settings never produce a misleading
 * error while AI is switched off.
 */
export function getAiConfig(source: EnvSource = process.env): AiConfig {
  let provider: AiProviderName;
  try {
    provider = parseGroup("ai", aiProviderSchema, source).AI_PROVIDER;
  } catch (error) {
    return { enabled: false, reason: describeConfigError(error) };
  }
  if (provider === "none") return { enabled: false, reason: "AI_PROVIDER is not set" };

  try {
    const env = parseGroup("ai", aiSettingsSchema(source), source);
    return {
      enabled: true,
      provider,
      apiKey: env.AI_PROVIDER_API_KEY,
      model: env.AI_MODEL,
      timeoutMs: env.AI_TIMEOUT_MS,
    };
  } catch (error) {
    return { enabled: false, reason: describeConfigError(error) };
  }
}

// ---------------------------------------------------------------------------------------------
// Durable queue (Upstash QStash)
// ---------------------------------------------------------------------------------------------

const QSTASH_KEYS = ["QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const;

function queueSchema(source: EnvSource) {
  return z.object({
    APP_BASE_URL: webUrl(source),
    QSTASH_TOKEN: secret(20, source),
    QSTASH_CURRENT_SIGNING_KEY: secret(16, source),
    QSTASH_NEXT_SIGNING_KEY: secret(16, source),
    QSTASH_URL: webUrl(source).optional(),
    // Max jobs QStash runs at once. Caps concurrent AI calls, MongoDB connections and WhatsApp sends
    // during bursts; extra jobs wait in QStash instead of failing.
    QSTASH_PARALLELISM: z.coerce.number().int().min(1).max(500).default(20),
  });
}

/**
 * `qstash`: every job is persisted in MongoDB, then delivered to the worker by QStash.
 * `inline`: QStash is not configured; jobs are still persisted first, then processed after the
 * response via `after()` and recovered by the cron sweeper if that run is lost. Suitable for local
 * development; production should use `qstash` (the admin health page warns otherwise).
 */
export type QueueConfig =
  | {
      mode: "qstash";
      appBaseUrl: string;
      qstashToken: string;
      currentSigningKey: string;
      nextSigningKey: string;
      qstashUrl: string | undefined;
      parallelism: number;
    }
  | { mode: "inline" };

/** Throws only when QStash is partially or invalidly configured; unset means `inline`. */
export function getQueueConfig(source: EnvSource = process.env): QueueConfig {
  const anySet = QSTASH_KEYS.some((key) => readEnv(source, [key])[key] !== undefined);
  if (!anySet) return { mode: "inline" };

  const env = parseGroup("queue", queueSchema(source), source);
  return {
    mode: "qstash",
    appBaseUrl: env.APP_BASE_URL.replace(/\/+$/, ""),
    qstashToken: env.QSTASH_TOKEN,
    currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    qstashUrl: env.QSTASH_URL,
    parallelism: env.QSTASH_PARALLELISM,
  };
}

// ---------------------------------------------------------------------------------------------
// Scheduled recovery (Vercel Cron)
// ---------------------------------------------------------------------------------------------

function cronSchema(source: EnvSource) {
  return z.object({ CRON_SECRET: secret(32, source) });
}

export function getCronSecret(source: EnvSource = process.env): string {
  return parseGroup("cron", cronSchema(source), source).CRON_SECRET;
}

// ---------------------------------------------------------------------------------------------
// Demo simulator
// ---------------------------------------------------------------------------------------------

/**
 * The simulator lets admins chat with the bot without WhatsApp. Simulated conversations never
 * reach WhatsApp. Enabled by default outside production; in production only with
 * SIMULATOR_ENABLED=true.
 */
export function isSimulatorEnabled(source: EnvSource = process.env): boolean {
  const value = source.SIMULATOR_ENABLED?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return !isProduction(source);
}

// ---------------------------------------------------------------------------------------------
// Status reporting (variable names only, never values)
// ---------------------------------------------------------------------------------------------

export type ConfigGroupStatus =
  | { configured: true }
  | { configured: false; missing: readonly string[]; invalid: readonly string[] };

export interface ConfigStatus {
  database: ConfigGroupStatus;
  whatsapp: ConfigGroupStatus;
  auth: ConfigGroupStatus;
  queue: ConfigGroupStatus & { mode?: QueueConfig["mode"] };
  cron: ConfigGroupStatus;
  ai: { enabled: boolean; reason?: string };
  simulatorEnabled: boolean;
}

function groupStatus(load: () => unknown): ConfigGroupStatus {
  try {
    load();
    return { configured: true };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { configured: false, missing: error.missing, invalid: error.invalid };
    }
    throw error;
  }
}

function queueStatus(source: EnvSource): ConfigStatus["queue"] {
  try {
    return { configured: true, mode: getQueueConfig(source).mode };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { configured: false, missing: error.missing, invalid: error.invalid };
    }
    throw error;
  }
}

export function getConfigStatus(source: EnvSource = process.env): ConfigStatus {
  const ai = getAiConfig(source);
  return {
    database: groupStatus(() => getDatabaseConfig(source)),
    whatsapp: groupStatus(() => getWhatsAppConfig(source)),
    auth: groupStatus(() => getAuthConfig(source)),
    queue: queueStatus(source),
    cron: groupStatus(() => getCronSecret(source)),
    ai: ai.enabled ? { enabled: true } : { enabled: false, reason: ai.reason },
    simulatorEnabled: isSimulatorEnabled(source),
  };
}
