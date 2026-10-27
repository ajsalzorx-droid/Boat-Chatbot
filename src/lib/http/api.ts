import "server-only";

import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";

import { AppError, isAppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging/logger";

/** Shared helpers for JSON Route Handlers: bounded body parsing, origin checks, safe errors. */

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown, context: Record<string, unknown> = {}): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields are invalid.",
          // Paths and messages only; submitted values are never echoed back.
          fields: error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      },
      { status: 400 },
    );
  }
  if (isAppError(error)) {
    if (error.httpStatus >= 500) logger.error("api.error", { ...context, error });
    const headers: Record<string, string> = {};
    const retryAfter = error.details?.retryAfterSeconds;
    if (typeof retryAfter === "number") headers["Retry-After"] = String(retryAfter);
    return NextResponse.json(
      { error: { code: error.code, message: error.publicMessage, ...(error.details?.reason ? { reason: error.details.reason } : {}) } },
      { status: error.httpStatus, headers },
    );
  }
  logger.error("api.unhandled_error", { ...context, error });
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }, { status: 500 });
}

const DEFAULT_MAX_BODY_BYTES = 100_000;

export async function readJson<S extends z.ZodType>(request: Request, schema: S, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<z.infer<S>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw tooLarge();
  const raw = await request.text();
  if (Buffer.byteLength(raw) > maxBytes) throw tooLarge();
  let parsed: unknown;
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    throw new AppError("Invalid JSON", { code: "VALIDATION_FAILED", httpStatus: 400, publicMessage: "Request body must be valid JSON." });
  }
  return schema.parse(parsed);
}

function tooLarge(): AppError {
  return new AppError("Body too large", { code: "VALIDATION_FAILED", httpStatus: 413, publicMessage: "Request body is too large." });
}

/**
 * Client IP for rate limiting. Uses the RIGHTMOST X-Forwarded-For entry: that one is appended by
 * our own reverse proxy (Nginx on a VPS, or Vercel's edge), while entries to its left are supplied
 * by the client and can be forged to dodge per-IP limits.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-authenticated mutations: the request must come from our own origin
 * and carry a custom header, which a cross-site form or simple request cannot add. (Session
 * cookies are also SameSite=Lax.) No CORS headers are sent, so other origins cannot read responses.
 */
export function assertSameOriginMutation(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  if (process.env.APP_BASE_URL) allowed.add(process.env.APP_BASE_URL.replace(/\/+$/, ""));

  if (!origin || !allowed.has(origin) || request.headers.get("x-requested-with") !== "fetch") {
    throw new AppError("Cross-origin or unmarked mutation rejected", {
      code: "FORBIDDEN",
      httpStatus: 403,
      publicMessage: "Request rejected.",
    });
  }
}
