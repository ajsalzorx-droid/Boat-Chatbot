import { NextResponse, type NextRequest } from "next/server";

import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { assertSameOriginMutation, clientIp, errorResponse, readJson } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { loginSchema } from "@/lib/validation/admin";
import { AdminUser } from "@/models/admin-user";
import { toAdminUserDto } from "@/services/dto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



const INVALID = new AppError("Invalid credentials", {
  code: "UNAUTHORIZED",
  httpStatus: 401,
  publicMessage: "Invalid email or password.",
});

function rateLimited(retryAfterSeconds: number): AppError {
  return new AppError("Login rate limited", {
    code: "RATE_LIMITED",
    httpStatus: 429,
    publicMessage: "Too many sign-in attempts. Please wait and try again.",
    details: { retryAfterSeconds },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOriginMutation(request);
    const ipLimit = await consumeRateLimit("login-ip", clientIp(request), 20, 15 * 60);
    if (!ipLimit.allowed) throw rateLimited(ipLimit.retryAfterSeconds);

    const { email, password } = await readJson(request, loginSchema, 4_000);
    const emailLimit = await consumeRateLimit("login-email", email, 8, 15 * 60);
    if (!emailLimit.allowed) throw rateLimited(emailLimit.retryAfterSeconds);

    await connectToDatabase();
    const user = await AdminUser.findOne({ email }).select("+passwordHash").lean();
    // Always run one hash verification so response time does not reveal which emails exist.
    const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !valid || !user.active) {
      logger.warn("auth.login_failed", { reason: !user ? "unknown_user" : !user.active ? "inactive" : "bad_password" });
      throw INVALID;
    }

    const { cookie } = await createSession(user._id, request.headers.get("user-agent") ?? "");
    await AdminUser.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    logger.info("auth.login_succeeded", { userId: user._id.toString() });

    const response = NextResponse.json({ user: toAdminUserDto(user) });
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    return errorResponse(error, { route: "login" });
  }
}
