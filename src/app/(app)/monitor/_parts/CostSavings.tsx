"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, EmptyState, LinkButton } from "@/components/ui/ui";
import { IconSparkle } from "@/components/ui/icons";

interface PaidProvider { id: string; label: string; inputPrice: number; outputPrice: number; cost: number; costThb: number }
interface Savings {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalRequests: number;
  todayRequests: number;
  providers: PaidProvider[];
}

// Display-only formatting of server-computed values — never parse these strings back into numbers.
const kTokens = (n: number) => `${Math.round(n / 1000).toLocaleString("th-TH")}K`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const thb = (n: number) => `฿${n.toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

/** "What would this have cost on a paid API?" — the old dashboard's receipt card (/api/cost-savings, every 15s). */
export function CostSavings() {
  const [d, setD] = useState<Savings | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/cost-savings");
        if (res.ok) setD((await res.json()) as Savings);
      } catch { /* keep last value */ } finally {
        setLoaded(true);
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card>
      <CardHeader
        icon={<IconSparkle size={18} />}
        title="ประหยัดไปเท่าไหร่"
        subtitle="ถ้าส่ง token ทั้งหมดที่ใช้มาไปที่ API แบบเสียเงิน จะต้องจ่ายเท่านี้ — ผ่าน BCAiRouter ใช้โมเดลฟรีจึงจ่าย 0 บาท"
      />
      {!loaded ? (
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
        </div>
      ) : !d || d.totalTokens === 0 ? (
        <EmptyState
          icon={<IconSparkle size={22} />}
          title="ยังไม่มีการใช้งาน"
          description="เมื่อมีคำขอผ่าน gateway ระบบจะคำนวณยอดที่ประหยัดได้ให้ที่นี่"
          action={<LinkButton href="/playground" variant="primary" size="sm">ลองส่งแชทแรก</LinkButton>}
        />
      ) : (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] tabular-nums text-[var(--muted)]">
            <span>คำขอสะสม <strong className="text-white">{d.totalRequests.toLocaleString("th-TH")}</strong></span>
            <span>วันนี้ <strong className="text-white">{d.todayRequests.toLocaleString("th-TH")}</strong></span>
            <span>
              ใช้ไป <strong className="text-violet-200">{kTokens(d.totalTokens)} tokens</strong>{" "}
              (ขาเข้า {kTokens(d.totalInputTokens)} + ขาออก {kTokens(d.totalOutputTokens)})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {(d.providers ?? []).map((p) => (
              <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <div className="truncate text-[12px] text-[var(--muted)]" title={p.label}>ถ้าใช้ {p.label}</div>
                <div className="mt-1 text-[18px] font-semibold tabular-nums text-rose-200">{usd(p.cost)}</div>
                <div className="text-[12px] tabular-nums text-rose-300/70">{thb(p.costThb)}</div>
                <div className="mt-1 text-[10.5px] tabular-nums text-gray-500">${p.inputPrice} / ${p.outputPrice} ต่อ 1M token</div>
              </div>
            ))}
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] p-3 text-center">
              <div className="text-[12px] text-emerald-300">ผ่าน BCAiRouter</div>
              <div className="mt-1 text-[18px] font-semibold tabular-nums text-emerald-200">$0.00</div>
              <div className="text-[12px] text-emerald-300/80">ฟรี</div>
              <div className="mt-1 text-[10.5px] tabular-nums text-emerald-500/80">$0 / $0 ต่อ 1M token</div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
