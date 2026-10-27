import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import type { Types } from "mongoose";

import { getAuthConfig } from "@/lib/config/env";
import { connectToDatabase } from "@/lib/db/mongoose";
import { AdminSession } from "@/models/admin-session";
import { AdminUser, type AdminUserDoc } from "@/models/admin-user";

/**
 * Server-side sessions: the cookie holds a random token; MongoDB stores only an HMAC of it.
 * Sessions expire, can be revoked individually (logout) or all at once (password change), and
 * die automatically when the user is deactivated.
 */

const DEV_COOKIE = "wcb_session";
// `__Host-` cookies must be Secure, host-only and path=/, which blocks subdomain overrides.
const PROD_COOKIE = "__Host-wcb_session";
const TOUCH_INTERVAL_MS = 5 * 60_000;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? PROD_COOKIE : DEV_COOKIE;
}

export const SESSION_COOKIE_NAMES = [DEV_COOKIE, PROD_COOKIE] as const;

function hashToken(token: string): string {
  return createHmac("sha256", getAuthConfig().sessionSecret).update(token).digest("hex");
}

export interface SessionCookie {
  name: string;
  value: string;
  options: { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };
}

export function buildSessionCookie(token: string, maxAgeSeconds: number): SessionCookie {
  const { secureCookies } = getAuthConfig();
  return {
    name: sessionCookieName(),
    value: token,
    options: { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: maxAgeSeconds },
  };
}

export async function createSession(userId: Types.ObjectId, userAgent: string): Promise<{ token: string; cookie: SessionCookie }> {
  await connectToDatabase();
  const { sessionTtlSeconds } = getAuthConfig();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await AdminSession.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now.getTime() + sessionTtlSeconds * 1000),
    lastSeenAt: now,
    userAgent: userAgent.slice(0, 300),
  });
  return { token, cookie: buildSessionCookie(token, sessionTtlSeconds) };
}

export interface ResolvedSession {
  sessionId: Types.ObjectId;
  user: Pick<AdminUserDoc, "_id" | "email" | "name" | "role">;
}

export async function resolveSession(token: string | undefined | null): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  await connectToDatabase();
  const now = new Date();
  const session = await AdminSession.findOne({ tokenHash: hashToken(token), revokedAt: null, expiresAt: { $gt: now } }).lean();
  if (!session) return null;

  const user = await AdminUser.findById(session.userId).select({ email: 1, name: 1, role: 1, active: 1, passwordChangedAt: 1 }).lean();
  if (!user?.active) return null;
  // Sessions created before a password change are no longer valid.
  if (user.passwordChangedAt && user.passwordChangedAt.getTime() > session.createdAt.getTime()) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await AdminSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } });
  }
  return { sessionId: session._id, user: { _id: user._id, email: user.email, name: user.name, role: user.role } };
}

export async function revokeSessionByToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await connectToDatabase();
  await AdminSession.updateOne({ tokenHash: hashToken(token) }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: Types.ObjectId): Promise<void> {
  await connectToDatabase();
  await AdminSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
