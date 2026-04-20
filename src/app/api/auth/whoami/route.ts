import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "../../../../../auth";
import { isOwnerEmail } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/admin-cookie";

export const dynamic = "force-dynamic";

// Unified identity for the top-nav chip. Reports whichever auth mode is
// currently active: Google session, password cookie, or anonymous.
export async function GET() {
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
