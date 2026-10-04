import Link from "next/link";
import type { ReactNode } from "react";
import { signIn, auth } from "../../../auth";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { ADMIN_COOKIE_NAME, adminPasswordEnabled, verifyAdminCookie } from "@/lib/admin-cookie";
import { Badge, Callout, Card, CodeBlock, Reveal } from "@/components/ui/ui";
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
  } catch { /* OAuth not configured — OK */ }

  // Already authed via admin cookie? → bounce
  const jar = await cookies();
  if (verifyAdminCookie(jar.get(ADMIN_COOKIE_NAME)?.value)) redirect("/");

  const { error, callbackUrl } = await searchParams;
  const next = callbackUrl ?? "/";
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.NEXTAUTH_SECRET);
  const hasPassword = adminPasswordEnabled();
  const hasBearer = Boolean(process.env.GATEWAY_API_KEY);

  const h = await headers();
  const host = h.get("host") ?? "your-gateway";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = `${proto}://${host}/v1`;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-[520px] space-y-6">
        <Reveal i={0}>
          <div className="flex flex-col items-center text-center">
            <span className="relative grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 text-[19px] font-black text-white shadow-[0_12px_36px_-10px_rgba(139,123,255,0.95)]">
              BC
              <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/30" />
            </span>
            <h1 className="mt-5 text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">
              <span className="text-gradient">เข้าสู่ระบบ BCAiRouter</span>
            </h1>
            <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-[var(--muted)]">
              {hasGoogle
                ? "เข้าสู่ระบบด้วยบัญชี Google ของเจ้าของระบบ"
                : "เลือกวิธีเข้าสู่ระบบ 1 ใน 3 แบบ — admin เข้าจัดการผ่านหน้าเว็บ ส่วนแอปหรือ SDK ใช้ API key"}
            </p>
          </div>
        </Reveal>

        {error && (
          <Reveal i={1}>
            <div role="alert">
              <Callout tone="warning" title="เข้าสู่ระบบไม่สำเร็จ">
                {error === "AccessDenied" ? "บัญชี Google นี้ไม่มีสิทธิ์เข้าระบบ — ต้องเป็นอีเมลเจ้าของระบบที่ยืนยันแล้ว" : "กรุณาลองใหม่อีกครั้ง"}
              </Callout>
            </div>
          </Reveal>
        )}

        <Reveal i={2}>
          <Card glow className="divide-y divide-white/10 p-0">
            {/* ─── Method 1: Google OAuth ─────────────────────────────── */}
            <Method
              n="1"
              title="เข้าด้วย Google"
              subtitle="สำหรับเจ้าของระบบที่ใช้บัญชี Google"
              disabled={!hasGoogle}
            >
              {hasGoogle ? (
                <form
                  action={async () => {
                    "use server";
                    await signIn("google", { redirectTo: next });
                  }}
                >
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-2.5 text-[14px] font-medium text-neutral-900 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 active:scale-[0.98]"
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.2 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.2 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                      <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2.1 14-5.4l-6.5-5.3c-2 1.5-4.5 2.5-7.5 2.5-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
                      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.5 5.3C41.4 36.5 44 31 44 24c0-1.3-.1-2.4-.4-3.5z"/>
                    </svg>
                    <span>Continue with Google</span>
                  </button>
                </form>
              ) : (
                <Hint>
                  Admin ต้องตั้ง <Env>GOOGLE_CLIENT_ID/SECRET</Env> + <Env>NEXTAUTH_SECRET/URL</Env> ใน <Env>.env</Env>
                </Hint>
              )}
            </Method>

            {/* Google configured → Google is the only web login; other methods are setup hints. */}
            {!hasGoogle && (<>
            {/* ─── Method 2: Password ─────────────────────────────────── */}
            <Method
              n="2"
              title="เข้าด้วย Admin Password"
              subtitle="สำหรับกรณีไม่มี Gmail หรือ Google ล่ม — signed cookie หมดอายุ 7 วัน"
              disabled={!hasPassword}
            >
              {hasPassword ? (
                <PasswordLoginForm next={next} />
              ) : (
                <Hint>
                  Admin ต้องตั้ง <Env>ADMIN_PASSWORD</Env> ใน <Env>.env</Env> (≥ 4 chars, แนะนำ ≥ 20)
                </Hint>
              )}
            </Method>

            {/* ─── Method 3: Bearer Key (API client) ──────────────────── */}
            <Method
              n="3"
              title="Bearer API Key (สำหรับ client / SDK)"
              subtitle="ไม่ต้อง login ที่หน้าเว็บ — ใส่ header Authorization ใน request เอง"
              disabled={!hasBearer}
            >
              {hasBearer ? (
                <div className="space-y-3">
                  <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
                    ใช้กับ OpenAI SDK / curl / automation. ไม่มี session / cookie — ส่ง key ทุก request.
                  </p>
                  <CodeBlock
                    code={`from openai import OpenAI
client = OpenAI(
    base_url="${baseUrl}",
    api_key="sk-gw-..."   # master
    # api_key="bcai_live_..."  # per-client (ออกที่ /admin/keys)
)`}
                  />
                  <p className="text-[12px] text-[var(--muted)]">
                    ดูตัวอย่าง Python/Node/LangChain/Hermes/OpenClaw ที่{" "}
                    <Link href="/guide" className="text-violet-300 underline-offset-2 hover:underline">/guide</Link>
                  </p>
                </div>
              ) : (
                <Hint>
                  Admin ต้องตั้ง <Env>GATEWAY_API_KEY</Env> ใน <Env>.env</Env> (หรือใช้ master + ออก key ที่ <Env>/admin/keys</Env>)
                </Hint>
              )}
            </Method>
            </>)}
          </Card>
        </Reveal>

        {!hasGoogle && !hasPassword && !hasBearer && (
          <Reveal i={3}>
            <Callout tone="warning" title="ไม่มีวิธี login ที่เปิดใช้">
              admin ต้องตั้งอย่างน้อย 1 env ใน <Env>.env.production</Env>
            </Callout>
          </Reveal>
        )}

        <Reveal i={4}>
          <div className="text-center text-[12.5px]">
            <Link href="/" className="text-[var(--muted)] transition-colors hover:text-white">← กลับหน้าหลัก</Link>
          </div>
        </Reveal>
      </div>
    </main>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

/** One login method inside the shared card: numbered header + body. Disabled = not configured. */
function Method({
  n,
  title,
  subtitle,
  disabled,
  children,
}: {
  n: string;
  title: string;
  subtitle: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`space-y-4 p-5 sm:p-6 ${disabled ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-[13px] font-bold text-violet-100 ring-1 ring-inset ring-white/15">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-white">{title}</h2>
            {disabled && <Badge>ยังไม่ตั้งค่า</Badge>}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{subtitle}</p>
        </div>
      </div>
      <div className={disabled ? "pointer-events-none" : ""}>{children}</div>
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] italic leading-relaxed text-gray-500">{children}</p>;
}

function Env({ children }: { children: ReactNode }) {
  return <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] not-italic text-gray-300">{children}</code>;
}
