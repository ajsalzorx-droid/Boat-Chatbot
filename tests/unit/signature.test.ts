import { describe, expect, it } from "vitest";

import { safeEqual, signMetaPayload, verifyMetaSignature } from "@/lib/whatsapp/signature";

const SECRET = "0123456789abcdef0123456789abcdef";
const encoder = new TextEncoder();

describe("verifyMetaSignature", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';

  it("accepts a signature computed over the exact raw bytes", () => {
    expect(verifyMetaSignature(encoder.encode(body), signMetaPayload(body, SECRET), SECRET)).toBe(true);
  });

  it("accepts an upper-case hex digest", () => {
    const header = signMetaPayload(body, SECRET).toUpperCase().replace("SHA256=", "sha256=");
    expect(verifyMetaSignature(encoder.encode(body), header, SECRET)).toBe(true);
  });

  it("rejects a body that differs only in whitespace (re-serialised JSON)", () => {
    const reformatted = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyMetaSignature(encoder.encode(reformatted), signMetaPayload(body, SECRET), SECRET)).toBe(false);
  });

  it("rejects the wrong secret, missing and malformed headers", () => {
    const bytes = encoder.encode(body);
    expect(verifyMetaSignature(bytes, signMetaPayload(body, "another-secret-value-123"), SECRET)).toBe(false);
    expect(verifyMetaSignature(bytes, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(bytes, "sha256=abc", SECRET)).toBe(false);
    expect(verifyMetaSignature(bytes, "sha1=" + "a".repeat(40), SECRET)).toBe(false);
    expect(verifyMetaSignature(bytes, "a".repeat(64), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = signMetaPayload(body, SECRET);
    expect(verifyMetaSignature(encoder.encode(body.replace("entry", "entrY")), header, SECRET)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("token", "token")).toBe(true);
    expect(safeEqual("token", "token2")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
