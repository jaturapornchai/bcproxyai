"use client";

import { useMemo } from "react";
import { PROVIDER_COLORS, fmtMs } from "./shared";
import type { ModelData } from "./shared";
import { providerColor } from "./Analytics";
import { IconPulse } from "./ui/icons";
import { Card, CardHeader, EmptyState } from "./ui/ui";

interface ProviderRace {
  provider: string;
  avgLatency: number;
  modelCount: number;
  available: boolean;
}

interface SpeedRaceProps {
  models: ModelData[];
  loading: boolean;
}

const MEDAL_STYLE = [
  "bg-amber-300/20 text-amber-200 ring-amber-300/40",
  "bg-slate-300/15 text-slate-200 ring-slate-300/30",
  "bg-orange-400/15 text-orange-200 ring-orange-400/30",
];

/** Round coloured avatar with the provider's initial; colour is data-driven (per provider). */
function ProviderAvatar({ provider, size }: { provider: string; size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold uppercase text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: providerColor(provider, 0.22),
        boxShadow: `inset 0 0 0 1.5px ${providerColor(provider, 0.6)}, 0 0 18px ${providerColor(provider, 0.25)}`,
      }}
      aria-hidden
    >
      {provider.slice(0, 1)}
    </span>
  );
}

export function SpeedRace({ models, loading }: SpeedRaceProps) {
  const racers = useMemo(() => {
    const grouped: Record<string, { totalLatency: number; count: number; availableCount: number }> = {};

    for (const m of models) {
      const g = (grouped[m.provider] ??= { totalLatency: 0, count: 0, availableCount: 0 });
      g.count++;
      if (m.health.status === "available" && m.health.latencyMs > 0) {
        g.totalLatency += m.health.latencyMs;
        g.availableCount++;
      }
    }

    const result: ProviderRace[] = Object.entries(grouped).map(([provider, g]) => ({
      provider,
      avgLatency: g.availableCount > 0 ? Math.round(g.totalLatency / g.availableCount) : 0,
      modelCount: g.count,
      available: g.availableCount > 0,
    }));

    // Available first (fastest first), then the rest
    result.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.available ? a.avgLatency - b.avgLatency : 0;
    });
    return result;
  }, [models]);

  const maxLatency = useMemo(() => {
    const latencies = racers.filter((r) => r.available).map((r) => r.avgLatency);
    return latencies.length > 0 ? Math.max(...latencies) : 1;
  }, [racers]);

  const top3 = racers.filter((r) => r.available).slice(0, 3);

  if (loading) {
    return (
      <Card className="p-5">
        <div className="skeleton mb-4 h-6 w-56" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12" />)}
        </div>
      </Card>
    );
  }

  if (racers.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<IconPulse size={22} />}
          title="ยังไม่มีข้อมูลความเร็ว"
          description="รอให้ระบบตรวจสุขภาพโมเดลรอบแรกเสร็จ แล้วผลการวิ่งแข่งจะแสดงที่นี่"
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="ใครตอบเร็วที่สุด"
        subtitle="เปรียบเทียบเวลาตอบเฉลี่ยของแต่ละผู้ให้บริการ (นับเฉพาะโมเดลที่พร้อมใช้) — แท่งยาว = เร็วกว่า"
        icon={<IconPulse size={18} />}
      />

      {/* Podium */}
      {top3.length >= 2 && (
        <div className="mx-5 mt-5 flex flex-wrap items-end justify-center gap-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 sm:gap-12">
          {top3.map((racer, i) => (
            <div
              key={racer.provider}
              className={`flex flex-col items-center gap-1.5 ${i === 0 ? "order-2" : i === 1 ? "order-1" : "order-3"}`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ring-1 ring-inset ${MEDAL_STYLE[i]}`}>{i + 1}</span>
              <ProviderAvatar provider={racer.provider} size={i === 0 ? 56 : 44} />
              <span className="text-[13px] font-semibold capitalize text-white">{racer.provider}</span>
              <span className="font-mono text-[12px] tabular-nums" style={{ color: providerColor(racer.provider) }}>
                {fmtMs(racer.avgLatency)}
              </span>
              <span className="text-[11px] text-[var(--muted)]">{racer.modelCount} โมเดล</span>
            </div>
          ))}
        </div>
      )}

      {/* Race lanes */}
      <div className="space-y-1 p-3 sm:p-4">
        {racers.map((racer) => {
          const c = PROVIDER_COLORS[racer.provider];
          // fastest = widest bar; slowest keeps at least 30% so every lane stays readable
          const barPct = racer.available ? Math.max(10, 100 - (racer.avgLatency / maxLatency) * 70) : 0;

          return (
            <div key={racer.provider} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-300 hover:bg-white/[0.03] sm:px-3">
              <ProviderAvatar provider={racer.provider} size={28} />
              <span className={`w-20 shrink-0 truncate text-[13px] font-medium capitalize sm:w-28 ${c?.text ?? "text-gray-300"}`}>
                {racer.provider}
              </span>
              <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                {racer.available ? (
                  <div
                    className="animate-bar relative h-full rounded-full"
                    style={{
                      width: `${barPct}%`,
                      background: `linear-gradient(90deg, ${providerColor(racer.provider, 0.35)}, ${providerColor(racer.provider)})`,
                      boxShadow: `0 0 14px ${providerColor(racer.provider, 0.4)}`,
                    }}
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-[9px] uppercase tracking-wider text-[var(--muted)]">offline</span>
                )}
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums text-gray-200">
                {racer.available ? fmtMs(racer.avgLatency) : "N/A"}
              </span>
              <span className="hidden w-20 shrink-0 text-right text-[11px] text-[var(--muted)] sm:block">
                {racer.modelCount} โมเดล
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
