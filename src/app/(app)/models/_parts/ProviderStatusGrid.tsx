"use client";

import Link from "next/link";
import { PROVIDER_COLORS, ProviderBadge } from "@/components/shared";
import { IconLock, IconPlug } from "@/components/ui/icons";
import { Badge, Card, CardHeader, EmptyState, LinkButton } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";

export interface ProviderStatus {
  provider: string;
  envVar: string;
  hasKey: boolean;
  hasDbKey: boolean;
  noKeyRequired: boolean;
  modelCount: number;
  availableCount: number;
  status: "active" | "no_key" | "no_models" | "error" | "disabled";
}

const STATUS: Record<ProviderStatus["status"], { label: string; tone: Tone }> = {
  active:    { label: "ใช้งานได้", tone: "success" },
  no_key:    { label: "ยังไม่มี Key", tone: "warning" },
  no_models: { label: "มี key — รอสแกน", tone: "info" },
  error:     { label: "ออฟไลน์", tone: "danger" },
  disabled:  { label: "ปิดใช้งานเอง", tone: "neutral" },
};

interface ProviderStatusGridProps {
  providers: ProviderStatus[];
  /** null while the admin check is still pending */
  isAdmin: boolean | null;
  loading: boolean;
}

export function ProviderStatusGrid({ providers, isAdmin, loading }: ProviderStatusGridProps) {
  const activeCount = providers.filter((p) => p.status === "active").length;

  return (
    <Card>
      <CardHeader
        title="ผู้ให้บริการทั้งหมด"
        subtitle="ผู้ให้บริการแต่ละเจ้าเป็นเจ้าของโมเดลฟรี — ต้องใส่ API key ก่อนถึงจะเรียกใช้ได้ กดการ์ดที่ยังไม่พร้อมเพื่อไปใส่ key"
        icon={<IconPlug size={18} />}
        action={providers.length > 0 ? <Badge tone="success" dot>{activeCount}/{providers.length} ใช้งานได้</Badge> : undefined}
      />

      {loading || isAdmin === null ? (
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}
        </div>
      ) : !isAdmin ? (
        <EmptyState
          icon={<IconLock size={22} />}
          title="สถานะผู้ให้บริการดูได้เฉพาะผู้ดูแลระบบ"
          description="ล็อกอินด้วยบัญชีผู้ดูแลเพื่อดูว่าผู้ให้บริการเจ้าไหนพร้อมใช้งาน และเจ้าไหนยังขาด API key"
        />
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<IconPlug size={22} />}
          title="ยังไม่มีข้อมูลผู้ให้บริการ"
          description="เริ่มจากใส่ API key ของผู้ให้บริการอย่างน้อย 1 เจ้า ระบบจะสแกนโมเดลให้อัตโนมัติ"
          action={<LinkButton href="/setup" variant="primary">ไปใส่ API key</LinkButton>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => {
            const st = STATUS[p.status] ?? { label: p.status, tone: "neutral" as Tone };
            const colors = PROVIDER_COLORS[p.provider];
            const needsAction = p.status !== "active";
            const pct = p.modelCount > 0 ? (p.availableCount / p.modelCount) * 100 : 0;
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <ProviderBadge provider={p.provider} />
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
                <div className={`mt-3 text-[14px] font-semibold capitalize ${colors?.text ?? "text-gray-200"}`}>{p.provider}</div>
                <div className="mt-0.5 text-[12px] tabular-nums text-[var(--muted)]">
                  {p.status === "error"
                    ? `${p.modelCount} โมเดล (ออฟไลน์)`
                    : `พร้อมใช้ ${p.availableCount}/${p.modelCount} โมเดล`}
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  {/* width is data-driven */}
                  <div className="animate-bar h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{ width: `${pct}%` }} />
                </div>
                {p.status === "no_key" && <div className="mt-2.5 text-[12px] font-medium text-amber-300">กดเพื่อใส่ API key →</div>}
                {p.status === "error" && <div className="mt-2.5 text-[12px] font-medium text-rose-300">มี key แล้ว แต่โมเดลตอบไม่ได้ — ตรวจ key หรือโควต้า</div>}
              </>
            );
            const cls = "block rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-all duration-300";
            return needsAction ? (
              <Link
                key={p.provider}
                href="/setup"
                className={`${cls} hover:-translate-y-0.5 hover:border-violet-400/40 hover:bg-white/[0.05]`}
              >
                {body}
              </Link>
            ) : (
              <div key={p.provider} className={cls}>{body}</div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
