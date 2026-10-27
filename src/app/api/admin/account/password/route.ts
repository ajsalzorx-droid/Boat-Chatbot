import { adminRoute } from "@/lib/auth/guards";
import { checkPasswordStrength, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeAllSessions } from "@/lib/auth/session";
import { connectToDatabase } from "@/lib/db/mongoose";
import { AppError } from "@/lib/errors/app-error";
import { json, readJson } from "@/lib/http/api";
import { logger } from "@/lib/logging/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { passwordChangeSchema } from "@/lib/validation/admin";
import { AdminUser } from "@/models/admin-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changes the signed-in user's password and signs out every other session. */
export const POST = adminRoute("agent", async ({ request, session }) => {
  const limit = await consumeRateLimit("password-change", session.user._id.toString(), 5, 15 * 60);
  if (!limit.allowed) {
    throw new AppError("Rate limited", { code: "RATE_LIMITED", httpStatus: 429, publicMessage: "Too many attempts. Please wait.", details: { retryAfterSeconds: limit.retryAfterSeconds } });
  }

  const { currentPassword, newPassword } = await readJson(request, passwordChangeSchema, 4_000);
  await connectToDatabase();
  const user = await AdminUser.findById(session.user._id).select("+passwordHash").lean();
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("Wrong current password", { code: "UNAUTHORIZED", httpStatus: 400, publicMessage: "Your current password is incorrect." });
  }
  const weakness = checkPasswordStrength(newPassword, user.email);
  if (weakness) throw new AppError("Weak password", { code: "VALIDATION_FAILED", httpStatus: 400, publicMessage: weakness });

  // passwordChangedAt invalidates every existing session; the new one is created just after.
  await AdminUser.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } });
  await revokeAllSessions(user._id);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { cookie } = await createSession(user._id, request.headers.get("user-agent") ?? "");
  logger.info("auth.password_changed", { userId: user._id.toString() });

  const response = json({ changed: true });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
});
