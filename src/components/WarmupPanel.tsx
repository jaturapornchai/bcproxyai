"use client";

import { useCallback, useEffect, useState } from "react";

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
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function levelColor(level: string): string {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-400";
    case "success":
      return "text-emerald-400";
    default:
      return "text-gray-400";
  }
}

export function WarmupPanel() {
  const [stats, setStats] = useState<WarmupStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
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
        : "text-red-300";

  return (
    <div className="glass rounded-2xl p-4 border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-500 text-white text-base">
            🔥
          </span>
          Warmup Worker
        </h2>
        <span className="text-xs text-gray-500">
          ping ทุก 2 นาที • last run{" "}
          {formatRelative(stats?.lastRunAt ?? null)}
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">กำลังโหลด…</div>
      ) : !stats ? (
        <div className="text-sm text-gray-500">ไม่สามารถโหลดข้อมูลได้</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3">
              <div className="text-[10px] text-orange-300 uppercase tracking-wide">
                pings (last 24h)
              </div>
              <div className="text-2xl font-bold text-orange-200">
                {stats.totalPings24h.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
              <div className="text-[10px] text-red-300 uppercase tracking-wide">
                success rate
              </div>
              <div className={`text-2xl font-bold ${rateColor}`}>
                {stats.successRate.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 mb-2 uppercase tracking-wide">
            Recent warmup cycles
          </div>
          {stats.recentLogs.length === 0 ? (
            <div className="text-xs text-gray-500 py-2 text-center">
              ยังไม่มีประวัติ warmup — worker จะเริ่มทำงานหลัง deploy 30 วินาที
            </div>
          ) : (
            <div className="space-y-1 font-mono text-[11px]">
              {stats.recentLogs.map((log, i) => {
                const time = new Date(log.createdAt).toLocaleTimeString("th-TH", {
                  hour12: false,
                });
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-1 border-b border-gray-800/40 last:border-0"
                  >
                    <span className="text-gray-600 shrink-0">{time}</span>
                    <span className={levelColor(log.level)}>
                      {log.message}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
