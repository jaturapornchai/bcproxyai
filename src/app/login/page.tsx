import { signIn, auth } from "../../../auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { PasswordLoginForm } from "./password-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  // Already authed via Google? → bounce
  try {
    const session = await auth();
    if (session?.user) redirect("/");
  } catch { /* OAuth unconfigured — OK, render password-only */ }

  // Already authed via admin cookie? → bounce
  const jar = await cookies();
  const adminCookie = jar.get(ADMIN_COOKIE_NAME)?.value;
  if (verifyAdminCookie(adminCookie)) redirect("/");

  const { error, callbackUrl } = await searchParams;
  const next = callbackUrl ?? "/";
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.NEXTAUTH_SECRET);
  const hasPassword = adminPasswordEnabled();

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-6">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">SMLGateway</h1>
          <p className="text-sm text-neutral-400">เข้าสู่ระบบ admin</p>
        </div>

        {error && (
          <div className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            Sign-in failed. {error === "AccessDenied" ? "Email not verified." : "Please try again."}
          </div>
        )}

        {hasGoogle && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: next });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-md bg-white text-neutral-900 font-medium px-4 py-2.5 hover:bg-neutral-100 transition"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.2 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.2 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.3c-2 1.5-4.5 2.5-7.5 2.5-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.5 5.3C41.4 36.5 44 31 44 24c0-1.3-.1-2.4-.4-3.5z"/>
              </svg>
              <span>เข้าด้วย Google</span>
            </button>
          </form>
        )}

        {hasGoogle && hasPassword && (
          <div className="flex items-center gap-3 text-[11px] text-neutral-500">
            <div className="flex-1 h-px bg-neutral-800" />
            <span>หรือ</span>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>
        )}

        {hasPassword && <PasswordLoginForm next={next} />}

        {!hasGoogle && !hasPassword && (
          <div className="rounded-md border border-amber-900/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
            ไม่มี login method ที่ใช้งานได้ — admin ต้องตั้ง <code>ADMIN_PASSWORD</code> หรือ <code>GOOGLE_CLIENT_ID</code> ใน <code>.env</code>
          </div>
        )}

        <p className="text-xs text-neutral-500 leading-relaxed">
          เฉพาะ admin (อยู่ใน <code className="text-amber-300">AUTH_OWNER_EMAIL</code>) ถึงจะเข้า <code>/admin/*</code> ได้.
          Password path: ทุกคนที่มี password ถือเป็น admin ทันที.
        </p>
      </div>
    </main>
  );
}
