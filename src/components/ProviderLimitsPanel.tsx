"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";
import { getAdminAccess } from "./admin-access";
import { Badge, Card, CardHeader, EmptyState } from "./ui/ui";
import { IconPlug } from "./ui/icons";

interface ProviderLimit {
  provider: string;
  modelId: string;
  limitTpm: number | null;
  limitTpd: number | null;
  limitRpm?: number | null;
  remainingTpm: number | null;
  remainingTpd: number | null;
  remainingRpm?: number | null;
  resetTpmAt: string | null;
  resetTpdAt: string | null;
  source: string;
  lastUpdated: number;
}

interface LimitsResponse {
  limits: ProviderLimit[];
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function pct(remaining: number | null | undefined, limit: number | null | undefined): number | null {
  if (remaining == null || limit == null || limit <= 0) return null;
  return Math.min(100, Math.max(0, (remaining / limit) * 100));
}

function barColor(p: number | null): string {
  if (p == null) return "bg-white/10";
  if (p < 20) return "bg-gradient-to-r from-rose-500 to-rose-400";
  if (p < 50) return "bg-gradient-to-r from-amber-500 to-amber-400";
  return "bg-gradient-to-r from-emerald-500 to-emerald-400";
}

function pctText(p: number | null): string {
  if (p == null) return "text-[var(--muted)]";
  if (p < 20) return "text-rose-300";
  if (p < 50) return "text-amber-300";
  return "text-emerald-300";
}

function formatSource(source: string): string {
  const map: Record<string, string> = {
    header: "Header",
    "error-tpd": "429 TPD",
    "error-tpm": "429 TPM",
    "error-unknown": "429",
    "error-generic": "429",
    unknown: "—",
  };
  return map[source] ?? source;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "เมื่อกี้";
  const s = Math.floor(diff / 1000);
  if (s < 5) return "เมื่อกี้";
  if (s < 60) return `${s} วินาทีที่แล้ว`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  const d = Math.floor(h / 24);
  return `${d} วันที่แล้ว`;
}

interface BarProps {
  label: string;
  remaining: number | null | undefined;
  limit: number | null | undefined;
}

function LimitBar({ label, remaining, limit }: BarProps) {
  const p = pct(remaining, limit);
  const width = p == null ? "0%" : p.toFixed(0) + "%";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px]">
        <span className="font-semibold text-gray-200">{label}</span>
        <span className="font-mono tabular-nums text-[var(--muted)]">
          {formatNum(remaining ?? null)} / {formatNum(limit ?? null)}
          {p != null && <span className={`ml-2 font-semibold ${pctText(p)}`}>{p.toFixed(0)}%</span>}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-white/5"
        role="progressbar"
        aria-label={`${label} คงเหลือ`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p == null ? undefined : Math.round(p)}
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${barColor(p)}`} style={{ width }} />
      </div>
    </div>
  );
}

export function ProviderLimitsPanel() {
  const [limits, setLimits] = useState<ProviderLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const fetchLimits = useCallback(async () => {
    try {
      if (!(await getAdminAccess())) {
        setLimits([]);
        return;
      }
      const res = await fetch("/api/provider-limits");
      if (res.ok) {
        const data: LimitsResponse = await res.json();
        setLimits(Array.isArray(data.limits) ? data.limits : []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
    const interval = setInterval(fetchLimits, 5_000);
    return () => clearInterval(interval);
  }, [fetchLimits]);

  // Tick every 15s so relative time re-renders without extra fetch
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Sort by TPM remaining % DESC (models with no TPM info sink to bottom)
  const sorted = [...limits].sort((a, b) => {
    const pa = pct(a.remainingTpm, a.limitTpm) ?? -1;
    const pb = pct(b.remainingTpm, b.limitTpm) ?? -1;
    return pb - pa;
  });

  return (
    <Card>
      <CardHeader
        icon={<IconPlug />}
        title="โควต้าผู้ให้บริการ"
        subtitle="ปริมาณที่เหลือของแต่ละโมเดล — TPM = token ต่อนาที, TPD = token ต่อวัน, RPM = คำขอต่อนาที (อัปเดตทุก 5 วินาที)"
        action={<Badge tone="accent">{limits.length} โมเดล</Badge>}
      />

      {loading ? (
        <div className="grid gap-3 p-5 md:grid-cols-2" aria-busy="true" aria-label="กำลังโหลดโควต้า">
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-32" />)}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<IconPlug size={22} />}
          title="ยังไม่มีข้อมูลโควต้า"
          description="ระบบเรียนรู้ข้อจำกัดจาก header และ error 429 ที่ผู้ให้บริการตอบกลับ — ข้อมูลจะปรากฏหลังมีการเรียกใช้งานโมเดล"
        />
      ) : (
        <div className="grid gap-3 p-5 md:grid-cols-2">
          {sorted.map((l, i) => (
            <div
              key={`${l.provider}-${l.modelId}-${i}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ProviderBadge provider={l.provider} />
                  <span className="truncate font-mono text-[13px] font-semibold text-white">
                    {l.modelId}
                  </span>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--muted)]" title="แหล่งที่มาของข้อมูลโควต้า">
                  {formatSource(l.source)}
                </span>
              </div>

              <div className="space-y-3">
                {l.limitTpm != null && (
                  <LimitBar label="TPM" remaining={l.remainingTpm} limit={l.limitTpm} />
                )}
                {l.limitTpd != null && (
                  <LimitBar label="TPD" remaining={l.remainingTpd} limit={l.limitTpd} />
                )}
                {l.limitRpm != null && (
                  <LimitBar label="RPM" remaining={l.remainingRpm} limit={l.limitRpm} />
                )}
                {l.limitTpm == null && l.limitTpd == null && l.limitRpm == null && (
                  <div className="py-1 text-[12px] italic text-[var(--muted)]">
                    ยังไม่มีข้อมูล limit ตัวเลข
                  </div>
                )}
              </div>

              <div className="mt-3 text-right text-[11px] text-[var(--muted)]">
                {formatRelative(l.lastUpdated)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default ProviderLimitsPanel;
