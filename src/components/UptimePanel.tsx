"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PROVIDER_COLORS, fmtTime, fmtMs } from "./shared";
import { Badge, Card, CardHeader, EmptyState } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconCheck, IconPulse } from "./ui/icons";

interface UptimeStat {
  provider: string;
  total_checks: number;
  available_checks: number;
  uptime_pct: number;
  avg_latency_ms: number | null;
}

interface DailyUptime {
  date: string;
  provider: string;
  uptime_pct: number;
}

interface Incident {
  checked_at: string;
  provider: string;
  model_id: string;
  nickname: string | null;
  status: string;
  error: string | null;
  cooldown_until: string | null;
}

interface CooldownCount {
  provider: string;
  cooldown_count: number;
}

interface UptimeData {
  uptimeStats: UptimeStat[];
  dailyUptime: DailyUptime[];
  incidents: Incident[];
  cooldownCounts: CooldownCount[];
}

const PROVIDER_HEX: Record<string, string> = {
  openrouter: "#3b82f6", kilo: "#a855f7", google: "#34d399", groq: "#fb923c",
  cerebras: "#f43e5e", sambanova: "#14b8a6", mistral: "#38bdf8", ollama: "#84cc16",
};

const INCIDENT_META: Record<string, { label: string; tone: Tone }> = {
  rate_limited: { label: "ติด rate limit", tone: "warning" },
  blacklisted: { label: "ถูกแบน", tone: "danger" },
  complained: { label: "ถูกร้องเรียน", tone: "warning" },
  error: { label: "ผิดพลาด", tone: "danger" },
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        icon={<IconPulse />}
        title="ความพร้อมใช้งานของผู้ให้บริการ"
        subtitle="สัดส่วนเวลาที่ผู้ให้บริการแต่ละรายตอบสนองได้ปกติ (Uptime) พร้อมเหตุการณ์ผิดปกติใน 24 ชั่วโมงล่าสุด"
      />
      {children}
    </Card>
  );
}

export function UptimePanel() {
  const [data, setData] = useState<UptimeData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/uptime");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) {
    return (
      <Shell>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="กำลังโหลดข้อมูล Uptime">
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-32" />)}
        </div>
      </Shell>
    );
  }
  if (!data || data.uptimeStats.length === 0) {
    return (
      <Shell>
        <EmptyState
          icon={<IconPulse size={22} />}
          title="ยังไม่มีข้อมูลความพร้อมใช้งาน"
          description="ระบบจะตรวจสุขภาพของผู้ให้บริการอัตโนมัติเป็นรอบ ๆ — ผลรอบแรกจะปรากฏที่นี่เมื่อตรวจเสร็จ"
        />
      </Shell>
    );
  }

  const { uptimeStats, dailyUptime, incidents, cooldownCounts } = data;
  const cooldownMap = new Map(cooldownCounts.map(c => [c.provider, c.cooldown_count]));

  // Get 7 dates for mini chart
  const uniqueDates = [...new Set(dailyUptime.map(d => d.date))].sort();

  return (
    <Shell>
      {/* Provider uptime tiles */}
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {uptimeStats.map((stat, idx) => {
          const hex = PROVIDER_HEX[stat.provider] ?? "#6366f1";
          const colors = PROVIDER_COLORS[stat.provider] ?? PROVIDER_COLORS.openrouter;
          const cooldowns = cooldownMap.get(stat.provider) ?? 0;
          const uptimeColor = stat.uptime_pct >= 99 ? "text-emerald-300" :
            stat.uptime_pct >= 90 ? "text-amber-300" : "text-rose-300";

          return (
            <div
              key={stat.provider}
              className="reveal relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-4"
              style={{ "--i": idx } as React.CSSProperties}
            >
              <div className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 rounded-full opacity-20 blur-2xl" style={{ background: hex }} />

              <div className="relative flex items-center justify-between gap-2">
                <span className={`text-[13px] font-semibold ${colors.text}`}>{stat.provider}</span>
                {cooldowns > 0 && <Badge tone="danger">{cooldowns} cooldown</Badge>}
              </div>

              <div className={`relative mt-2 text-[28px] font-semibold tabular-nums tracking-tight ${uptimeColor}`}>
                {stat.uptime_pct}%
              </div>
              <div className="relative mt-0.5 text-[12px] tabular-nums text-[var(--muted)]">
                ตรวจ {stat.total_checks} ครั้ง · เฉลี่ย {stat.avg_latency_ms ? fmtMs(stat.avg_latency_ms) : "-"}
              </div>

              {/* Mini sparkline: uptime per day */}
              <div className="relative mt-3 flex h-8 items-end gap-[3px]" role="img" aria-label={`Uptime รายวันของ ${stat.provider}`}>
                {uniqueDates.map(date => {
                  const row = dailyUptime.find(d => d.date === date && d.provider === stat.provider);
                  const pct = row ? row.uptime_pct : 0;
                  const barColor = pct >= 99 ? hex : pct >= 90 ? "#fbbf24" : "#ef4444";
                  return (
                    <div
                      key={date}
                      className="flex-1 rounded-sm opacity-60 transition-opacity hover:opacity-100"
                      style={{ height: `${Math.max(pct, 5)}%`, background: barColor }}
                      title={`${date.slice(5)}: ${pct}%`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Incident timeline */}
      <div className="border-t border-white/5">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h4 className="text-[13px] font-semibold text-white">เหตุการณ์ผิดปกติ (24 ชม.)</h4>
            <p className="text-[12px] text-[var(--muted)]">โมเดลที่ติด rate limit ถูกแบน ถูกร้องเรียน หรือเกิดข้อผิดพลาด</p>
          </div>
          <Badge tone={incidents.length === 0 ? "success" : "warning"}>{incidents.length} รายการ</Badge>
        </div>
        {incidents.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-5 pb-6 pt-2 text-[13px] text-emerald-300">
            <IconCheck size={16} /> ไม่มีเหตุการณ์ผิดปกติ — ทุกอย่างทำงานปกติ
          </div>
        ) : (
          <ul className="max-h-[360px] divide-y divide-white/5 overflow-y-auto border-t border-white/5">
            {incidents.map((inc, i) => {
              const colors = PROVIDER_COLORS[inc.provider] ?? PROVIDER_COLORS.openrouter;
              const meta = INCIDENT_META[inc.status] ?? { label: inc.status, tone: "neutral" as Tone };
              return (
                <li key={i} className="flex items-center gap-3 px-5 py-3 text-[13px] transition-colors hover:bg-white/[0.02]">
                  <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="truncate font-mono text-[12.5px] text-gray-200">{inc.model_id}</span>
                      <span className={`text-[11px] ${colors.text}`}>{inc.provider}</span>
                    </div>
                    {inc.error && (
                      <div className="truncate text-[12px] text-[var(--muted)]">{inc.error.slice(0, 80)}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">{fmtTime(inc.checked_at)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Shell>
  );
}
