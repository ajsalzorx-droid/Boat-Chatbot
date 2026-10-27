import { describe, expect, it } from "vitest";

import { maskPhoneNumber, redact, redactString } from "@/lib/logging/redact";

describe("redact", () => {
  it("replaces values of sensitive keys at any depth", () => {
    const result = redact({
      accessToken: "abc",
      nested: { META_APP_SECRET: "def", password: "ghi", list: [{ authorization: "Bearer x" }] },
      safe: "visible",
    });
    expect(result).toEqual({
      accessToken: "[REDACTED]",
      nested: { META_APP_SECRET: "[REDACTED]", password: "[REDACTED]", list: [{ authorization: "[REDACTED]" }] },
      safe: "visible",
    });
  });

  it("keeps observability fields that merely contain a sensitive word", () => {
    expect(
      redact({ inputTokens: 120, maxTokens: 512, sessionId: "s1", signatureValid: false, "x-hub-signature-256": "sha" }),
    ).toEqual({ inputTokens: 120, maxTokens: 512, sessionId: "s1", signatureValid: false, "x-hub-signature-256": "[REDACTED]" });
  });

  it("redacts env-style credential names", () => {
    const result = redact({
      WHATSAPP_ACCESS_TOKEN: "a",
      QSTASH_CURRENT_SIGNING_KEY: "b",
      AI_PROVIDER_API_KEY: "c",
      session: "d",
    });
    expect(Object.values(result as Record<string, unknown>)).toEqual(Array(4).fill("[REDACTED]"));
  });

  it("scrubs credential-shaped substrings from free text", () => {
    const hmac = "a".repeat(64);
    const text = redactString(
      `failed mongodb+srv://u:p@c.net/db with Bearer EAAGabcdefghijklmnopqrstuvwxyz and sha256=${hmac}`,
    );
    expect(text).not.toContain("u:p@");
    expect(text).not.toContain("EAAG");
    expect(text).not.toContain(hmac);
  });

  it("serializes errors with causes and redacts their messages", () => {
    const error = new Error("outer", { cause: new Error("connect mongodb://admin:pw@db failed") });
    const result = redact({ error }) as { error: { cause: { message: string } } };
    expect(result.error.cause.message).not.toContain("admin:pw");
  });

  it("keeps non-Error causes, redacted", () => {
    const error = new Error("publish failed", { cause: { status: 503, apiToken: "t" } });
    expect(redact({ error })).toMatchObject({ error: { cause: { status: 503, apiToken: "[REDACTED]" } } });
  });

  it("serializes AggregateError members", () => {
    const error = new AggregateError([new Error("host a down"), new Error("host b down")], "all hosts failed");
    const result = redact({ error }) as { error: { errors: { message: string }[] } };
    expect(result.error.errors.map((inner) => inner.message)).toEqual(["host a down", "host b down"]);
  });

  it("truncates very long strings", () => {
    expect(redactString("x".repeat(5_000)).length).toBeLessThan(2_100);
  });

  it("bounds recursion depth", () => {
    interface Node {
      next?: Node;
    }
    const root: Node = {};
    let cursor = root;
    for (let index = 0; index < 20; index += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    expect(JSON.stringify(redact(root))).toContain("[MaxDepth]");
  });
});

describe("maskPhoneNumber", () => {
  it("keeps only the last four digits", () => {
    expect(maskPhoneNumber("+91 98765 43210")).toBe("********3210");
    expect(maskPhoneNumber("123")).toBe("****");
  });
});
