"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_COLORS, fmtTime, fmtMs } from "./shared";

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

export function UptimePanel() {
  const [data, setData] = useState<UptimeData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/uptime");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) return <div className="text-gray-500 text-center py-8">กำลังโหลดข้อมูล Uptime...</div>;
  if (!data || data.uptimeStats.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-gray-500">
        <div className="text-4xl mb-3">🏥</div>
        <p>ครูยังไม่ได้เช็คชื่อ — รอครูใหญ่มาเช็คชื่อรอบแรกก่อนนะ</p>
      </div>
    );
  }

  const { uptimeStats, dailyUptime, incidents, cooldownCounts } = data;
  const cooldownMap = new Map(cooldownCounts.map(c => [c.provider, c.cooldown_count]));

  // Get 7 dates for mini chart
  const uniqueDates = [...new Set(dailyUptime.map(d => d.date))].sort();

  return (
    <div className="space-y-4">
      {/* Uptime Cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        {uptimeStats.map(stat => {
          const hex = PROVIDER_HEX[stat.provider] ?? "#6366f1";
          const colors = PROVIDER_COLORS[stat.provider] ?? PROVIDER_COLORS.openrouter;
          const cooldowns = cooldownMap.get(stat.provider) ?? 0;
          const uptimeColor = stat.uptime_pct >= 99 ? "text-emerald-400" :
            stat.uptime_pct >= 90 ? "text-yellow-400" : "text-red-400";

          return (
            <div key={stat.provider} className="glass rounded-xl p-4 relative overflow-hidden">
              {/* Background glow */}
              <div className="absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-10" style={{ background: hex }} />

              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-bold ${colors.text}`}>{stat.provider}</span>
                {cooldowns > 0 && (
                  <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 rounded">{cooldowns} cooldown</span>
                )}
              </div>

              <div className={`text-3xl font-black ${uptimeColor}`}>
                {stat.uptime_pct}%
              </div>
              <div className="text-[10px] text-gray-500 mt-1">
                {stat.total_checks} checks / {stat.avg_latency_ms ? fmtMs(stat.avg_latency_ms) : "-"} avg
              </div>

              {/* Mini 7-day sparkline */}
              <div className="flex items-end gap-[2px] h-6 mt-2">
                {uniqueDates.map(date => {
                  const row = dailyUptime.find(d => d.date === date && d.provider === stat.provider);
                  const pct = row ? row.uptime_pct : 0;
                  const barColor = pct >= 99 ? hex : pct >= 90 ? "#fbbf24" : "#ef4444";
                  return (
                    <div
                      key={date}
                      className="flex-1 rounded-sm"
                      style={{ height: `${Math.max(pct, 5)}%`, background: barColor, opacity: 0.6 }}
                      title={`${date.slice(5)}: ${pct}%`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Incident Timeline */}
      <div className="bg-gray-800/30 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50 flex items-center justify-between">
          <h4 className="text-white font-medium text-sm">เหตุการณ์ — ใครมาสาย ใครขาดเรียน (24 ชม.)</h4>
          <span className="text-xs text-gray-500">{incidents.length} รายการ</span>
        </div>
        <div className="divide-y divide-gray-700/30">
          {incidents.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-sm">ไม่มีใครขาดเรียน — เด็กดีทุกคน! 🟢</div>
          ) : (
            incidents.map((inc, i) => {
              const colors = PROVIDER_COLORS[inc.provider] ?? PROVIDER_COLORS.openrouter;
              const statusIcon = inc.status === "rate_limited" ? "⏳" :
                inc.status === "blacklisted" ? "🚫" :
                inc.status === "complained" ? "📝" :
                inc.status === "error" ? "❌" : "⚠️";
              return (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                  <span className="text-base">{statusIcon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-200">{inc.model_id}</span>
                      <span className={`${colors.text} text-[10px]`}>{inc.provider}</span>
                    </div>
                    {inc.error && (
                      <div className="text-gray-500 truncate">{inc.error.slice(0, 80)}</div>
                    )}
                  </div>
                  <div className="text-gray-600 shrink-0">{fmtTime(inc.checked_at)}</div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
