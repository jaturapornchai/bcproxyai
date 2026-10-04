import type { NextRequest } from "next/server";
import { auth } from "../../auth";
import { hasOwners, isOwnerEmail } from "@/lib/admin-emails";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { timingSafeStringEqual } from "@/lib/secret-compare";

const API_KEY = process.env.GATEWAY_API_KEY?.trim() ?? "";

/** Server mode = any auth env is set. Otherwise local open mode: everyone is treated as the owner. */
export const AUTH_ENABLED = Boolean(API_KEY || hasOwners() || adminPasswordEnabled());

export function bearerToken(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export function isMasterKey(token: string): boolean {
  return Boolean(token && API_KEY && timingSafeStringEqual(token, API_KEY));
}

/** Owner = master Bearer, signed admin cookie, or the owner's Google session. Never trusts Host/X-Forwarded-*. */
export async function isOwnerRequest(req: NextRequest): Promise<boolean> {
  if (!AUTH_ENABLED) return true;
  if (isMasterKey(bearerToken(req))) return true;
  if (verifyAdminCookie(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) return true;
  try {
    const session = await auth();
    return isOwnerEmail(session?.user?.email);
  } catch {
    return false;
  }
}
