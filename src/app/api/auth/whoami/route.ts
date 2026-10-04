import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "../../../../../auth";
import { hasOwners, isOwnerEmail } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, verifyAdminCookie, adminPasswordEnabled } from "@/lib/admin-cookie";

export const dynamic = "force-dynamic";

// Unified identity for the top-nav chip. Reports whichever auth mode is
// currently active: Google session, password cookie, or anonymous.
export async function GET() {
  // Local mode (no GATEWAY_API_KEY / owner email / admin password — same test as proxy.ts):
  // every endpoint is already open, so show the dashboard as logged in instead of a login prompt.
  // Deliberately NOT keyed on the Host header — that is client-controlled and spoofable.
  if (!(process.env.GATEWAY_API_KEY?.trim() || hasOwners() || adminPasswordEnabled())) {
    return NextResponse.json({ loggedIn: true, source: "local", role: "admin", email: null });
  }

  const jar = await cookies();

  // 1. Password cookie (httpOnly — JS can't see it, so we relay via this endpoint)
  if (verifyAdminCookie(jar.get(ADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({
      loggedIn: true,
      source: "password",
      role: "admin",
      email: null,
    });
  }

  // 2. Google OAuth session
  try {
    const session = (await auth()) as { user?: { email?: string | null } } | null;
    const email = session?.user?.email ?? "";
    if (email) {
      return NextResponse.json({
        loggedIn: true,
        source: "google",
        role: isOwnerEmail(email) ? "admin" : "guest",
        email,
      });
    }
  } catch { /* OAuth unconfigured or broken */ }

  return NextResponse.json({ loggedIn: false });
}
