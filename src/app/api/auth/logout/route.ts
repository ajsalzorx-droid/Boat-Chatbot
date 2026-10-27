import { NextResponse, type NextRequest } from "next/server";

import { revokeSessionByToken, SESSION_COOKIE_NAMES, sessionCookieName } from "@/lib/auth/session";
import { assertSameOriginMutation, errorResponse } from "@/lib/http/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOriginMutation(request);
    await revokeSessionByToken(request.cookies.get(sessionCookieName())?.value);
    const response = NextResponse.json({ signedOut: true });
    for (const name of SESSION_COOKIE_NAMES) {
      response.cookies.set(name, "", { httpOnly: true, secure: name.startsWith("__Host-"), sameSite: "lax", path: "/", maxAge: 0 });
    }
    return response;
  } catch (error) {
    return errorResponse(error, { route: "logout" });
  }
}
