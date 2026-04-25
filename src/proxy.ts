import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyKey as verifyGatewayKey } from "@/lib/gateway-keys";
import { hasOwners, isOwnerEmail } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, verifyAdminCookie, adminPasswordEnabled } from "@/lib/admin-cookie";
import { auth } from "../auth";

// Auth model (kept as simple as possible — no browser OAuth):
//   • Local mode   = GATEWAY_API_KEY unset AND AUTH_OWNER_EMAIL unset → open
//   • Server mode  = either is set → Bearer required on /v1/* + /api/admin/*
//
// Three kinds of Bearer tokens are accepted:
//   1. GATEWAY_API_KEY env   — master key (full access, incl. /api/admin/*)
//   2. sml_live_* from DB    — admin-issued (only /v1/*)
//   3. (none)                — pages + GET /api/* that aren't /v1/* are open
const API_KEY = process.env.GATEWAY_API_KEY?.trim() ?? "";
const AUTH_ENABLED = Boolean(API_KEY || hasOwners() || adminPasswordEnabled());

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// GET endpoints ที่ expose user messages / per-request traces / infra detail /
// masked credentials / operational state — ต้อง auth เหมือน /api/admin/*
// ถึงแม้จะ GET method
const SENSITIVE_GET_PREFIXES = [
  "/api/gateway-logs",     // user_message + assistant_message
  "/v1/trace/",            // per-request trace (messages + provider details)
  "/api/dev-suggestions",  // internal diagnostics
  "/api/k6-report",        // internal load-test data
  "/api/infra",            // Redis info + replica details
  "/api/complaint",        // user-reported wrong answers (full message text)
  "/api/setup",            // masked API keys + provider toggle state
  "/api/status",           // worker state + run timing
  "/api/warmup-stats",     // worker_logs (warmup-step messages)
  "/api/semantic-cache",   // hashed user prompts (query_hash + redacted preview)
  "/api/providers",        // operational provider state
  "/api/provider-limits",  // upstream rate-limit headroom
  "/api/live-score",       // per-model live success rate
  "/api/learning",         // routing-learning state
  "/api/control-room",     // ops snapshot — provider/model breakdown + circuits
  "/api/routing-explain",  // routing decisions trail
  "/api/autopilot",        // ops recommendations from gateway state
];

function isSensitiveGet(pathname: string, method: string): boolean {
  if (method !== "GET") return false;
  return SENSITIVE_GET_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status: number) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function proxy(req: NextRequest) {
  if (!AUTH_ENABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // Always open: health + auth endpoints (NextAuth callbacks, password-login, whoami)
  if (pathname === "/api/health") return NextResponse.next();
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  const isV1Route = pathname.startsWith("/v1/");
  const isAdminApi = pathname.startsWith("/api/admin/");
  const isMutatingApi = pathname.startsWith("/api/") && MUTATING_METHODS.has(method);

  const authHeader = req.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const isMaster = Boolean(presented && API_KEY && timingSafeEqual(presented, API_KEY));
  const isAdminIssued =
    Boolean(presented && presented.startsWith("sml_live_")) &&
    (await verifyGatewayKey(presented));

  // /api/admin/* → master Bearer OR owner Google session OR password cookie
  if (isAdminApi) {
    if (isMaster) return NextResponse.next();
    if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return NextResponse.next();
    try {
      const session = (await auth()) as { user?: { email?: string | null } } | null;
      const email = session?.user?.email ?? "";
      if (email && isOwnerEmail(email)) return NextResponse.next();
    } catch { /* fall through */ }
    return json({ error: { message: "admin: login or master key required", type: "auth_error" } }, 401);
  }

  // Sensitive GET endpoints (logs, traces, infra, masked keys) → owner/master only.
  // MUST run before the /v1/* gate so sml_live_* tokens — which can chat but
  // shouldn't see other tenants' traces/logs — don't slip through.
  if (isSensitiveGet(pathname, method)) {
    if (isMaster) return NextResponse.next();
    if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return NextResponse.next();
    try {
      const session = (await auth()) as { user?: { email?: string | null } } | null;
      const email = session?.user?.email ?? "";
      if (email && isOwnerEmail(email)) return NextResponse.next();
    } catch { /* fall through */ }
    return json({ error: { message: "owner only", type: "auth_error" } }, 401);
  }

  // /v1/* → master or sml_live_*
  if (isV1Route) {
    if (isMaster || isAdminIssued) return NextResponse.next();
    return json(
      { error: { message: presented ? "invalid api key" : "authentication required", type: "auth_error" } },
      401,
    );
  }

  // Mutating /api/* (setup, etc) → master Bearer OR owner Google session OR password cookie
  if (isMutatingApi) {
    if (isMaster) return NextResponse.next();
    if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return NextResponse.next();
    try {
      const session = (await auth()) as { user?: { email?: string | null } } | null;
      const email = session?.user?.email ?? "";
      if (email && isOwnerEmail(email)) return NextResponse.next();
    } catch { /* fall through */ }
    return json({ error: { message: "admin: login or master key required", type: "auth_error" } }, 401);
  }

  // All pages + GET /api/* are open — UI is meant to be viewable.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|css|js|woff|woff2)$).*)",
  ],
};
