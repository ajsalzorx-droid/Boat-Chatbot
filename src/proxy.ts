import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: sends visitors without a session cookie to /login. Real session and
 * role checks run on the server in every admin page and API route.
 */
export function proxy(request: NextRequest): NextResponse {
  const hasCookie = request.cookies.has("__Host-wcb_session") || request.cookies.has("wcb_session");
  if (!hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
