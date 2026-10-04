"use client";

// Owner-only OpenRouter account watch for the cost window. Its own chunk (next/dynamic in Cost.tsx), so the public
// landing bundle never carries the provider name or the owner endpoint.
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";
import { ago, useNow } from "./shared";

// Owner-only endpoint (GET /api/openrouter-status).
interface OrStatus {
  configured: boolean;
  level: "ok" | "warn" | "alert" | "unknown";
  messages: string[];
  isFreeTier?: boolean;
  limit?: number | null;
  limitRemaining?: number | null;
  usage?: number;
  usageDaily?: number;
  freeDailyLimit?: number;
  freeUsedToday?: number;
  disabledByTripwire?: boolean;
  checkedAt?: string;
}

const POLL_MS = 60_000;

function useOpenRouterStatus(): OrStatus | null {
  const [st, setSt] = useState<OrStatus | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/openrouter-status", { cache: "no-store", signal: ctl.signal });
        setSt(r.ok ? ((await r.json()) as OrStatus) : null); // 401/404/5xx → "unavailable" line
      } catch {
        /* aborted or offline: keep the last value */
      }
    };
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
  }, []);
  return st;
}

const LEVEL: Record<OrStatus["level"], { label: string; tone: Tone }> = {
  ok: { label: "ปกติ", tone: "success" },
  warn: { label: "เฝ้าระวัง", tone: "warning" },
  alert: { label: "แจ้งเตือน", tone: "danger" },
  unknown: { label: "ไม่ทราบสถานะ", tone: "neutral" },
};

// display-only formatting; nothing is computed from these numbers
const usd = (n: number) => `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 4 : 2)}`;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="tabular-nums text-gray-200">{children}</dd>
    </div>
  );
}

export default function OpenRouterWatch() {
  const st = useOpenRouterStatus();
  const now = useNow(30_000);
  if (!st) return <p className="text-[11.5px] text-[var(--muted)]">สถานะบัญชี OpenRouter: ยังอ่านไม่ได้</p>;
  const lv = !st.configured ? { label: "ยังไม่ได้ตั้งค่า", tone: "neutral" as Tone } : LEVEL[st.level];
  return (
    <div className="space-y-2 border-t border-white/[0.08] pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-white">บัญชี OpenRouter</span>
        <Badge tone={lv.tone} dot={st.level === "ok" && st.configured}>{lv.label}</Badge>
      </div>
      {st.disabledByTripwire && (
        <p className="rounded-lg bg-rose-400/10 px-2.5 py-1.5 text-[12px] text-rose-200">ระบบปิดการใช้ OpenRouter อัตโนมัติ (tripwire)</p>
      )}
      {st.messages.length > 0 && (
        <ul className="space-y-1 text-[11.5px] leading-snug text-gray-300">
          {st.messages.map((m) => <li key={m}>• {m}</li>)}
        </ul>
      )}
      <dl className="space-y-1">
        {st.isFreeTier != null && <Fact label="ประเภทบัญชี">{st.isFreeTier ? "ฟรี" : "มีเครดิต"}</Fact>}
        {st.freeUsedToday != null && st.freeDailyLimit != null && (
          <Fact label="โควตาฟรีวันนี้">{st.freeUsedToday}/{st.freeDailyLimit}</Fact>
        )}
        {st.usage != null && <Fact label="ใช้จริงสะสม">{usd(st.usage)}</Fact>}
        {st.usageDaily != null && <Fact label="ใช้จริงวันนี้">{usd(st.usageDaily)}</Fact>}
        {st.limit === null && <Fact label="วงเงินคงเหลือ">ไม่จำกัด</Fact>}
        {typeof st.limitRemaining === "number" && <Fact label="วงเงินคงเหลือ">{usd(st.limitRemaining)}</Fact>}
      </dl>
      {st.checkedAt && <p className="text-[10.5px] text-[var(--muted)]">ตรวจล่าสุด {ago(st.checkedAt, now, "ที่แล้ว")}</p>}
    </div>
  );
}
