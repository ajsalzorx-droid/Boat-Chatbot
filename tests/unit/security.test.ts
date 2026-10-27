import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { checkPasswordStrength, hashPassword, verifyPassword } from "@/lib/auth/password";
import { assertSameOriginMutation } from "@/lib/http/api";
import { backoffDelayMs } from "@/services/jobs/backoff";
import { faqSchema, idParamsSchema, loginSchema, settingsSchema } from "@/lib/validation/admin";
import { DEFAULT_SETTINGS } from "@/services/settings/settings-service";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });

  it("enforces a minimum strength", () => {
    expect(checkPasswordStrength("short")).toMatch(/12/);
    expect(checkPasswordStrength("aaaaaaaaaaaaaa")).not.toBeNull();
    expect(checkPasswordStrength("owner-secret-2026", "owner@company.ae")).not.toBeNull();
    expect(checkPasswordStrength("a long unique passphrase")).toBeNull();
  });
});

describe("CSRF / same-origin protection", () => {
  const make = (headers: Record<string, string>, method = "POST") => new NextRequest("http://localhost:3000/api/admin/faqs", { method, headers });

  it("allows same-origin mutations that carry the marker header", () => {
    expect(() => assertSameOriginMutation(make({ origin: "http://localhost:3000", "x-requested-with": "fetch", host: "localhost:3000" }))).not.toThrow();
  });

  it("rejects cross-origin, missing origin, or unmarked mutations", () => {
    expect(() => assertSameOriginMutation(make({ origin: "https://evil.example", "x-requested-with": "fetch" }))).toThrow();
    expect(() => assertSameOriginMutation(make({ "x-requested-with": "fetch" }))).toThrow();
    expect(() => assertSameOriginMutation(make({ origin: "http://localhost:3000" }))).toThrow();
  });

  it("does not restrict safe methods", () => {
    expect(() => assertSameOriginMutation(make({}, "GET"))).not.toThrow();
  });
});

describe("input validation", () => {
  it("rejects query-operator injection in ids and logins", () => {
    expect(idParamsSchema.safeParse({ id: { $ne: null } }).success).toBe(false);
    expect(idParamsSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(idParamsSchema.safeParse({ id: "507f1f77bcf86cd799439011" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: { $gt: "" }, password: "x" }).success).toBe(false);
    expect(loginSchema.parse({ email: "  Owner@Company.AE ", password: "x" }).email).toBe("owner@company.ae");
  });

  it("validates FAQs and settings", () => {
    expect(faqSchema.safeParse({ question: "Hi", answer: "" }).success).toBe(false);
    const { ...settings } = DEFAULT_SETTINGS;
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    expect(settingsSchema.safeParse({ ...settings, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, websiteUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially with jitter and a cap", () => {
    expect(backoffDelayMs(1, { random: () => 0 })).toBe(5_000);
    expect(backoffDelayMs(1, { random: () => 1 })).toBe(10_000);
    expect(backoffDelayMs(3, { random: () => 1 })).toBe(40_000);
    expect(backoffDelayMs(30, { random: () => 1 })).toBe(15 * 60_000);
  });
});
