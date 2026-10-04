import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyKey as verifyGatewayKey } from "@/lib/gateway-keys";
import { AUTH_ENABLED, bearerToken, isMasterKey, isOwnerRequest } from "@/lib/owner-request";

// Auth model — default-deny:
//   • Local mode  = GATEWAY_API_KEY, AUTH_OWNER_EMAIL and ADMIN_PASSWORD all unset → open
//   • Server mode = only the public paths below are open; everything else needs:
//       /v1/*   → master Bearer or an admin-issued bcai_live_* key
//       /v1/trace/*, /v1/prompts* → owner only (other callers' messages; shared prompts injected into chat)
//       /api/my-stats → a valid key too (stats of the caller's own IP — Caddy overwrites X-Real-IP)
//       /api/*  → owner (Google session / admin cookie / master Bearer), else 401 JSON
//       pages   → owner, else redirect to /login?callbackUrl=<path>
const PUBLIC_PATHS = new Set(["/", "/login", "/api/health"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/api/public/"];

function authError(message: string) {
  return NextResponse.json({ error: { message, type: "auth_error" } }, { status: 401 });
}

export async function proxy(req: NextRequest) {
  if (!AUTH_ENABLED) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const ownerOnlyV1 = pathname.startsWith("/v1/trace/") || pathname === "/v1/prompts" || pathname.startsWith("/v1/prompts/");
  const isV1 = pathname.startsWith("/v1/") && !ownerOnlyV1;
  if (isV1 || pathname === "/api/my-stats") {
    const token = bearerToken(req);
    if (isMasterKey(token)) return NextResponse.next();
    if (token.startsWith("bcai_live_") && (await verifyGatewayKey(token))) return NextResponse.next();
    if (isV1) return authError(token ? "invalid api key" : "authentication required");
  }

  if (await isOwnerRequest(req)) return NextResponse.next();
  if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) return authError("owner only");

  const login = new URL("/login", req.url);
  login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // API routes always pass through: the static-extension exclusion below must not let
    // dynamic segments like /v1/prompts/x.css or /api/admin/providers/x.js skip auth.
    "/api/:path*",
    "/v1/:path*",
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|css|js|woff|woff2)$).*)",
  ],
};
