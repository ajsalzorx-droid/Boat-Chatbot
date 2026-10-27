import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as changePassword } from "@/app/api/admin/account/password/route";
import { GET as listConversations } from "@/app/api/admin/conversations/route";
import { GET as listFaqs, POST as createFaq } from "@/app/api/admin/faqs/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { hashPassword } from "@/lib/auth/password";
import { AdminUser, type AdminRole } from "@/models/admin-user";
import { Faq } from "@/models/faq";

import { clearDatabase, startTestDatabase, stopTestDatabase } from "../helpers/db";
import { setWhatsAppEnv } from "../helpers/fixtures";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "a long unique passphrase";
const noParams = { params: Promise.resolve({}) };

function request(path: string, options: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string } = {}): NextRequest {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": options.ip ?? "203.0.113.1" };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if ((options.method ?? "GET") !== "GET") headers["x-requested-with"] = "fetch";
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function createUser(email: string, role: AdminRole): Promise<void> {
  await AdminUser.create({ email, name: email.split("@")[0], role, passwordHash: await hashPassword(PASSWORD) });
}

async function signIn(email: string, password = PASSWORD): Promise<{ status: number; cookie: string }> {
  const response = await login(request("/api/auth/login", { method: "POST", body: { email, password } }));
  const setCookie = response.headers.get("set-cookie") ?? "";
  return { status: response.status, cookie: setCookie.split(";")[0] ?? "" };
}

beforeAll(async () => {
  setWhatsAppEnv();
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await clearDatabase();
  await createUser("owner@company.ae", "owner");
  await createUser("agent@company.ae", "agent");
});

describe("login", () => {
  it("sets an HttpOnly, SameSite session cookie on success", async () => {
    const response = await login(request("/api/auth/login", { method: "POST", body: { email: "Owner@Company.ae", password: PASSWORD } }));
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^wcb_session=[A-Za-z0-9_-]{40,};/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(await response.json()).toEqual({ user: expect.objectContaining({ email: "owner@company.ae", role: "owner" }) as unknown });
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrong = await login(request("/api/auth/login", { method: "POST", body: { email: "owner@company.ae", password: "wrong password!!" } }));
    const unknown = await login(request("/api/auth/login", { method: "POST", body: { email: "nobody@company.ae", password: "wrong password!!" } }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("refuses inactive users", async () => {
    await AdminUser.updateOne({ email: "agent@company.ae" }, { $set: { active: false } });
    expect((await signIn("agent@company.ae")).status).toBe(401);
  });

  it("rate-limits repeated attempts for one account", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(request("/api/auth/login", { method: "POST", body: { email: "owner@company.ae", password: "bad bad bad bad" }, ip: `198.51.100.${attempt}` }));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 8).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
    // Even the right password is refused while limited.
    expect((await signIn("owner@company.ae")).status).toBe(429);
  });

  it("rejects cross-origin login posts", async () => {
    const response = await login(request("/api/auth/login", { method: "POST", body: { email: "owner@company.ae", password: PASSWORD }, origin: "https://evil.example" }));
    expect(response.status).toBe(403);
  });
});

describe("admin API protection", () => {
  it("requires a session", async () => {
    expect((await listConversations(request("/api/admin/conversations"), noParams)).status).toBe(401);
    expect((await listFaqs(request("/api/admin/faqs", { cookie: "wcb_session=forged-token" }), noParams)).status).toBe(401);
  });

  it("enforces roles on the server", async () => {
    const agent = await signIn("agent@company.ae");
    expect((await listConversations(request("/api/admin/conversations", { cookie: agent.cookie }), noParams)).status).toBe(200);
    expect((await listFaqs(request("/api/admin/faqs", { cookie: agent.cookie }), noParams)).status).toBe(403);

    const owner = await signIn("owner@company.ae");
    expect((await listFaqs(request("/api/admin/faqs", { cookie: owner.cookie }), noParams)).status).toBe(200);
  });

  it("validates input and blocks CSRF on mutations", async () => {
    const owner = await signIn("owner@company.ae");
    const valid = await createFaq(request("/api/admin/faqs", { method: "POST", cookie: owner.cookie, body: { question: "Do you open on Friday?", answer: "Yes, from 2pm." } }), noParams);
    expect(valid.status).toBe(201);

    const invalid = await createFaq(request("/api/admin/faqs", { method: "POST", cookie: owner.cookie, body: { question: { $gt: "" }, answer: "x" } }), noParams);
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(await invalid.json())).not.toContain("$gt");

    const crossSite = await createFaq(request("/api/admin/faqs", { method: "POST", cookie: owner.cookie, origin: "https://evil.example", body: { question: "Hack?", answer: "x" } }), noParams);
    expect(crossSite.status).toBe(403);
    expect(await Faq.countDocuments()).toBe(1);
  });

  it("never returns password hashes or internal fields", async () => {
    const owner = await signIn("owner@company.ae");
    await createFaq(request("/api/admin/faqs", { method: "POST", cookie: owner.cookie, body: { question: "Parking available?", answer: "Yes." } }), noParams);
    const body = JSON.stringify(await (await listFaqs(request("/api/admin/faqs", { cookie: owner.cookie }), noParams)).json());
    expect(body).not.toMatch(/passwordHash|__v|"_id"/);
  });
});

describe("session lifecycle", () => {
  it("revokes the session on logout", async () => {
    const owner = await signIn("owner@company.ae");
    expect((await logout(request("/api/auth/logout", { method: "POST", cookie: owner.cookie }))).status).toBe(200);
    expect((await listFaqs(request("/api/admin/faqs", { cookie: owner.cookie }), noParams)).status).toBe(401);
  });

  it("signs out other sessions after a password change", async () => {
    const laptop = await signIn("owner@company.ae");
    const phone = await signIn("owner@company.ae");
    const response = await changePassword(
      request("/api/admin/account/password", { method: "POST", cookie: laptop.cookie, body: { currentPassword: PASSWORD, newPassword: "an even longer new passphrase" } }),
      noParams,
    );
    expect(response.status).toBe(200);
    const fresh = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    expect((await listFaqs(request("/api/admin/faqs", { cookie: phone.cookie }), noParams)).status).toBe(401);
    expect((await listFaqs(request("/api/admin/faqs", { cookie: laptop.cookie }), noParams)).status).toBe(401);
    expect((await listFaqs(request("/api/admin/faqs", { cookie: fresh }), noParams)).status).toBe(200);
    expect((await signIn("owner@company.ae", "an even longer new passphrase")).status).toBe(200);
  });
});
