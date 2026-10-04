"use client";

import { useCallback, useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";
import { IconPulse } from "./ui/icons";
import { LiveNumber } from "./StatsCards";
import { Card, CardHeader } from "./ui/ui";

interface WarmupLog {
  createdAt: string;
  message: string;
  level: string;
}

interface WarmupStats {
  totalPings24h: number;
  successRate: number;
  recentLogs: WarmupLog[];
  lastRunAt: string | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)} วินาทีที่แล้ว`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ชม.ที่แล้ว`;
  return `${Math.round(diff / 86_400_000)} วันที่แล้ว`;
}

function levelColor(level: string): string {
  switch (level) {
    case "error":
      return "text-rose-300";
    case "warn":
      return "text-amber-300";
    case "success":
      return "text-emerald-300";
    default:
      return "text-gray-400";
  }
}

export function WarmupPanel() {
  const [stats, setStats] = useState<WarmupStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      if (!(await getAdminAccess())) {
        setStats(null);
        return;
      }
      const res = await fetch("/api/warmup-stats");
      if (res.ok) setStats(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const rateColor =
    stats && stats.successRate >= 80
      ? "text-emerald-300"
      : stats && stats.successRate >= 50
        ? "text-amber-300"
        : "text-rose-300";

  return (
    <Card>
      <CardHeader
        title="อุ่นเครื่อง (Warmup)"
        subtitle={`ระบบส่งคำถามสั้นๆ หาโมเดลที่สอบผ่านทุก 2 นาที เพื่อให้พร้อมตอบทันที · ครั้งล่าสุด ${formatRelative(stats?.lastRunAt ?? null)}`}
        icon={<IconPulse size={18} />}
      />

      <div className="p-5">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
          </div>
        ) : !stats ? (
          <p className="py-4 text-center text-[13px] text-[var(--muted)]">ไม่สามารถโหลดข้อมูลได้</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-orange-400/20 bg-orange-400/[0.07] px-4 py-3" title="จำนวน ping ไปหาโมเดลใน 24 ชม.ล่าสุด">
                <div className="text-[12px] text-orange-200">ping ใน 24 ชม.</div>
                <div className="mt-1 text-[26px] font-semibold leading-tight text-white">
                  <LiveNumber value={stats.totalPings24h} />
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3" title="สัดส่วนที่ ping สำเร็จ = โมเดลยังพร้อมใช้">
                <div className="text-[12px] text-[var(--muted)]">อัตราสำเร็จ</div>
                <div className={`mt-1 text-[26px] font-semibold leading-tight ${rateColor}`}>
                  <LiveNumber value={stats.successRate} decimals={1} suffix="%" />
                </div>
              </div>
            </div>

            <div className="mb-2 mt-5 text-[12px] font-medium text-[var(--muted)]">ประวัติอุ่นเครื่องล่าสุด</div>
            {stats.recentLogs.length === 0 ? (
              <p className="py-3 text-center text-[13px] text-[var(--muted)]">
                ยังไม่มีประวัติ — worker จะเริ่มอุ่นเครื่องหลัง deploy ประมาณ 30 วินาที
              </p>
            ) : (
              <div className="font-mono text-[11px]">
                {stats.recentLogs.map((log, i) => {
                  const time = new Date(log.createdAt).toLocaleTimeString("th-TH", { hour12: false });
                  return (
                    <div key={i} className="flex items-start gap-3 border-b border-white/[0.05] py-1.5 last:border-0">
                      <span className="shrink-0 tabular-nums text-[var(--muted)]">{time}</span>
                      <span className={`min-w-0 break-words ${levelColor(log.level)}`}>{log.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
