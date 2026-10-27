import { redact } from "./redact";

/**
 * Structured JSON logger.
 *
 * Emits one JSON object per line so Vercel (and any log drain) can index fields. Every context
 * object passes through `redact`, but callers must still avoid passing customer message bodies:
 * log identifiers and counts, not content.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveMinimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export type LogContext = Record<string, unknown>;

const RESERVED_FIELDS: ReadonlySet<string> = new Set(["timestamp", "level", "message"]);

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

function write(level: LogLevel, message: string, bindings: LogContext, context: LogContext | undefined): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveMinimumLevel()]) return;

  // Context keys that collide with the envelope fields are kept under a `ctx_` prefix so they can
  // never overwrite the real level/message/timestamp that alerting and search depend on.
  const fields: LogContext = {};
  for (const [key, value] of Object.entries(redact({ ...bindings, ...context }) as LogContext)) {
    fields[RESERVED_FIELDS.has(key) ? `ctx_${key}` : key] = value;
  }

  const entry = { ...fields, timestamp: new Date().toISOString(), level, message };

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ timestamp: entry.timestamp, level, message, logError: "unserializable context" });
  }

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function createLogger(bindings: LogContext = {}): Logger {
  return {
    debug: (message, context) => { write("debug", message, bindings, context); },
    info: (message, context) => { write("info", message, bindings, context); },
    warn: (message, context) => { write("warn", message, bindings, context); },
    error: (message, context) => { write("error", message, bindings, context); },
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const logger: Logger = createLogger({ service: "whatsapp-chatbot" });
