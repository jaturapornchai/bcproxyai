import { NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-cookie";

export const dynamic = "force-dynamic";

// Clears the password-login admin cookie. Google OAuth sign-out uses
// NextAuth's /api/auth/signout — this is for the password path only.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET() {
  return POST();
}
