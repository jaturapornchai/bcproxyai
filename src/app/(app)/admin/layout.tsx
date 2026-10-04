import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "../../../../auth";
import { Card, EmptyState, LinkButton } from "@/components/ui/ui";
import { IconLock } from "@/components/ui/icons";
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
        <Card className="reveal mx-auto mt-10 max-w-md">
          <EmptyState
            icon={<IconLock size={22} />}
            title="คุณไม่มีสิทธิ์เข้าหน้า Admin"
            description={
              <>
                บัญชี <code className="rounded bg-white/5 px-1.5 py-0.5 text-amber-300">{email}</code> ไม่ได้อยู่ใน{" "}
                <code className="rounded bg-white/5 px-1.5 py-0.5">AUTH_OWNER_EMAIL</code> ของ server นี้
              </>
            }
            action={<LinkButton href="/overview">กลับหน้าหลัก</LinkButton>}
          />
        </Card>
      );
    }
  }

  redirect("/login?callbackUrl=/admin/keys");
}
