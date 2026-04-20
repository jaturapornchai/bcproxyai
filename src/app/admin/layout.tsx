import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "../../../auth";
import { isOwnerEmail, hasOwners } from "@/lib/admin-emails";
import {
  ADMIN_COOKIE_NAME,
  adminPasswordEnabled,
  verifyAdminCookie,
} from "@/lib/admin-cookie";

// Server-side guard for /admin/*. Accepts either:
//   • Google OAuth session with email in AUTH_OWNER_EMAIL, OR
//   • Valid signed admin cookie from password login.
// Local-only mode (no OAuth, no owners, no password) → wide open.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const hasOauth = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.NEXTAUTH_SECRET);
  const hasPassword = adminPasswordEnabled();

  // Local mode: nothing configured → open
  if (!hasOauth && !hasOwners() && !hasPassword) return <>{children}</>;

  // Password-cookie path
  const jar = await cookies();
  if (verifyAdminCookie(jar.get(ADMIN_COOKIE_NAME)?.value)) return <>{children}</>;

  // Google OAuth path
  if (hasOauth) {
    let email = "";
    try {
      const session = (await auth()) as { user?: { email?: string | null } } | null;
      email = session?.user?.email ?? "";
    } catch { /* OAuth broken; fall through to deny */ }

    if (email && isOwnerEmail(email)) return <>{children}</>;

    if (email && !isOwnerEmail(email)) {
      return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-red-500/30 bg-red-500/5 p-6 space-y-3 text-center">
            <div className="text-3xl">🚫</div>
            <div className="text-sm font-bold">คุณไม่มีสิทธิ์เข้าหน้า Admin</div>
            <div className="text-xs text-gray-400">
              บัญชี <code className="text-amber-300">{email}</code> ไม่ได้อยู่ใน{" "}
              <code>AUTH_OWNER_EMAIL</code> ของ server นี้
            </div>
            <a href="/" className="inline-block text-xs text-indigo-300 hover:underline">
              กลับหน้าหลัก
            </a>
          </div>
        </div>
      );
    }
  }

  redirect("/login?callbackUrl=/admin/keys");
}
