import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logging/logger";

describe("logger", () => {
  it("writes one redacted JSON line per entry", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("LOG_LEVEL", "debug");

    logger.child({ requestId: "r1" }).info("webhook.received", { apiToken: "secret-value", count: 2 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      message: "webhook.received",
      requestId: "r1",
      count: 2,
      apiToken: "[REDACTED]",
    });
    expect(line).not.toContain("secret-value");
  });

  it("never lets context overwrite the envelope fields", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.error("ai.failed", { message: "provider text", level: "info", timestamp: "x" });
    const entry = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "error",
      message: "ai.failed",
      ctx_message: "provider text",
      ctx_level: "info",
      ctx_timestamp: "x",
    });
    expect(entry.timestamp).not.toBe("x");
  });

  it("respects LOG_LEVEL", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubEnv("LOG_LEVEL", "warn");
    logger.info("ignored");
    expect(spy).not.toHaveBeenCalled();
  });

  it("routes errors to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.error("boom", { error: new Error("failed") });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
