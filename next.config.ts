import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 * Next.js App Router injects inline bootstrap scripts, so `'unsafe-inline'` is required for
 * scripts until a nonce-based CSP is introduced through `src/proxy.ts` (planned with the admin
 * dashboard in Phase 5). `'unsafe-eval'` is only needed by the development server.
 */
function buildCsp(extra: { script?: string; connect?: string; frame?: string } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}${extra.script ? ` ${extra.script}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src 'self'${extra.connect ? ` ${extra.connect}` : ""}`,
    ...(extra.frame ? [`frame-src ${extra.frame}`] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const contentSecurityPolicy = buildCsp();

/**
 * The WhatsApp connection page loads Meta's JavaScript SDK for Embedded Signup. Only that page
 * allows Facebook's script, frames and API, and keeps its popup opener so the signup window can
 * report back (`same-origin-allow-popups` instead of `same-origin`).
 */
const FACEBOOK = "https://connect.facebook.net https://www.facebook.com https://web.facebook.com";
const embeddedSignupHeaders = [
  { key: "Content-Security-Policy", value: buildCsp({ script: "https://connect.facebook.net", connect: `${FACEBOOK} https://graph.facebook.com`, frame: "https://www.facebook.com https://web.facebook.com" }) },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  headers() {
    return Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      // Listed after the defaults so these values replace them on this page only.
      { source: "/admin/whatsapp", headers: embeddedSignupHeaders },
      {
        // API responses carry private data or webhook acknowledgements and must never be cached.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ]);
  },
};

export default nextConfig;
