import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { assertSameOriginMutation, errorResponse } from "@/lib/http/api";
import { AppError } from "@/lib/errors/app-error";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import type { AdminRole } from "@/models/admin-user";

import { resolveSession, sessionCookieName, type ResolvedSession } from "./session";

/**
 * Authorization is enforced on the server for every admin page and API route. The proxy only
 * does an optimistic redirect for missing cookies; it is not relied on for security.
 */

export const ROLE_ACCESS = {
  /** Conversations: everyone. */
  agent: ["owner", "admin", "agent"],
  /** Content, settings, health, simulator. */
  admin: ["owner", "admin"],
  owner: ["owner"],
} as const satisfies Record<string, readonly AdminRole[]>;

export type AccessLevel = keyof typeof ROLE_ACCESS;

export function hasAccess(role: AdminRole, level: AccessLevel): boolean {
  return (ROLE_ACCESS[level] as readonly AdminRole[]).includes(role);
}

/** For Server Components and layouts: redirects to /login when signed out. */
export async function requirePageSession(level: AccessLevel = "agent"): Promise<ResolvedSession> {
  const store = await cookies();
  const session = await resolveSession(store.get(sessionCookieName())?.value);
  if (!session) redirect("/login");
  if (!hasAccess(session.user.role, level)) redirect("/admin?denied=1");
  return session;
}

export async function getPageSession(): Promise<ResolvedSession | null> {
  const store = await cookies();
  return resolveSession(store.get(sessionCookieName())?.value);
}

export interface AdminRouteContext<P> {
  request: NextRequest;
  session: ResolvedSession;
  params: P;
}

/**
 * Wraps an admin Route Handler: same-origin check for mutations, session, role, a per-user rate
 * limit on writes, and safe error responses.
 */
export function adminRoute<P = Record<string, never>>(
  level: AccessLevel,
  handler: (context: AdminRouteContext<P>) => Promise<Response>,
): (request: NextRequest, context: { params: Promise<P> }) => Promise<Response> {
  return async (request, context) => {
    try {
      assertSameOriginMutation(request);
      const session = await resolveSession(request.cookies.get(sessionCookieName())?.value);
      if (!session) {
        throw new AppError("Not signed in", { code: "UNAUTHORIZED", httpStatus: 401, publicMessage: "Please sign in." });
      }
      if (!hasAccess(session.user.role, level)) {
        throw new AppError("Insufficient role", { code: "FORBIDDEN", httpStatus: 403, publicMessage: "You do not have access to this." });
      }
      if (request.method !== "GET") {
        const limit = await consumeRateLimit("admin-write", session.user._id.toString(), 120, 60);
        if (!limit.allowed) {
          throw new AppError("Rate limited", {
            code: "RATE_LIMITED",
            httpStatus: 429,
            publicMessage: "Too many requests. Please wait a moment.",
            details: { retryAfterSeconds: limit.retryAfterSeconds },
          });
        }
      }
      return await handler({ request, session, params: await context.params });
    } catch (error) {
      return errorResponse(error, { route: new URL(request.url).pathname, method: request.method });
    }
  };
}
