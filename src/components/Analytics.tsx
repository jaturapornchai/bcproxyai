"use client";

import { PROVIDER_COLORS, fmtMs, ProviderBadge } from "./shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProviderStat {
  provider: string;
  total: number;
  success: number;
  successRate: number;
  avgLatencyMs: number;
}

export interface HourlyVolume {
  hour: string;
  total: number;
  success: number;
  failed: number;
}

export interface TopModel {
  model: string;
  provider: string;
  count: number;
  avgLatencyMs: number;
}

export interface DailyToken {
  date: string;
  input: number;
  output: number;
}

export interface AnalyticsData {
  providerStats: ProviderStat[];
  hourlyVolume: HourlyVolume[];
  topModels: TopModel[];
  dailyTokens: DailyToken[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getProviderHex(provider: string): string {
  const glowMap: Record<string, string> = {
    openrouter: "#3b82f6",
    kilo: "#a855f7",
    google: "#34d399",
    groq: "#fb923c",
    cerebras: "#f43e5e",
    sambanova: "#14b8a6",
    mistral: "#38bdf8",
    ollama: "#84cc16",
  };
  return glowMap[provider] ?? "#6366f1";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Analytics({ data }: { data: AnalyticsData | null }) {
  if (!data) return null;

  const { providerStats, hourlyVolume, topModels, dailyTokens } = data;

  // Compute max values for scaling
  const maxHourly = Math.max(...hourlyVolume.map((h) => h.total), 1);
  const maxModelCount = Math.max(...(topModels.length ? topModels.map((m) => m.count) : [1]), 1);
  const maxDailyTotal = Math.max(
    ...(dailyTokens.length ? dailyTokens.map((d) => d.input + d.output) : [1]),
    1
  );

  const hasAnyData =
    providerStats.length > 0 ||
    hourlyVolume.some((h) => h.total > 0) ||
    topModels.length > 0 ||
    dailyTokens.length > 0;

  if (!hasAnyData) {
    return (
      <section id="analytics" className="animate-fade-in-up stagger-3">
        <div className="flex items-center gap-3 mb-6">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </span>
          <h2 className="text-2xl font-bold text-white">Charts & Analytics</h2>
        </div>
        <div className="glass rounded-2xl p-12 text-center text-gray-500">
          <div className="text-5xl mb-3">📊</div>
          <p>ยังไม่มีข้อมูล — ใช้งาน Gateway แล้วกลับมาดูสถิติ</p>
        </div>
      </section>
    );
  }

  return (
    <section id="analytics" className="animate-fade-in-up stagger-3">
      <div className="flex items-center gap-3 mb-6">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </span>
        <h2 className="text-2xl font-bold text-white">Charts & Analytics</h2>
        <span className="text-xs text-gray-500">24 ชม. ล่าสุด</span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-6">

        {/* ── 1. Provider Success Rate ─────────────────────────────────── */}
        <div className="glass rounded-2xl p-5 card-3d">
          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-400" />
            Provider Success Rate
          </h3>
          {providerStats.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">ไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-3">
              {providerStats.map((p) => {
                const hex = getProviderHex(p.provider);
                return (
                  <div key={p.provider}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <ProviderBadge provider={p.provider} />
                        <span className="text-xs text-gray-500">{p.total} requests</span>
                      </div>
                      <span className="text-xs font-bold" style={{ color: hex }}>
                        {p.successRate}%
                      </span>
                    </div>
                    <div className="h-3 bg-gray-800/60 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${p.successRate}%`,
                          background: `linear-gradient(90deg, ${hex}80, ${hex})`,
                          boxShadow: `0 0 8px ${hex}60`,
                        }}
                      />
                    </div>
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      avg {fmtMs(p.avgLatencyMs)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 2. Hourly Request Volume ─────────────────────────────────── */}
        <div className="glass rounded-2xl p-5 card-3d">
          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Hourly Request Volume
          </h3>
          <div className="flex items-end gap-[2px] h-32">
            {hourlyVolume.map((h) => {
              const totalPct = (h.total / maxHourly) * 100;
              const failedPct = h.total > 0 ? (h.failed / h.total) * totalPct : 0;
              const successPct = totalPct - failedPct;
              return (
                <div
                  key={h.hour}
                  className="flex-1 flex flex-col justify-end group relative"
                  style={{ height: "100%" }}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                    <div className="glass rounded px-2 py-1 text-[10px] text-gray-300 whitespace-nowrap border border-white/10">
                      {h.hour}:00 — {h.total} req ({h.success} ok, {h.failed} fail)
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="w-full flex flex-col justify-end" style={{ height: "100%" }}>
                    {h.total > 0 && (
                      <>
                        <div
                          className="w-full rounded-t transition-all duration-500"
                          style={{
                            height: `${failedPct}%`,
                            background: "rgba(239,68,68,0.7)",
                            minHeight: failedPct > 0 ? "2px" : "0",
                          }}
                        />
                        <div
                          className="w-full rounded-b transition-all duration-500"
                          style={{
                            height: `${successPct}%`,
                            background: "linear-gradient(180deg, rgba(52,211,153,0.8), rgba(52,211,153,0.4))",
                            minHeight: successPct > 0 ? "2px" : "0",
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* X-axis labels */}
          <div className="flex gap-[2px] mt-1">
            {hourlyVolume.map((h, i) => (
              <div key={h.hour} className="flex-1 text-center text-[8px] text-gray-600">
                {i % 3 === 0 ? h.hour : ""}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(52,211,153,0.7)" }} />
              Success
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(239,68,68,0.7)" }} />
              Failed
            </span>
          </div>
        </div>

        {/* ── 3. Top Models by Usage ───────────────────────────────────── */}
        <div className="glass rounded-2xl p-5 card-3d">
          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-400" />
            Top Models by Usage
          </h3>
          {topModels.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">ไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-2.5">
              {topModels.map((m, i) => {
                const pct = (m.count / maxModelCount) * 100;
                const hex = getProviderHex(m.provider);
                return (
                  <div key={`${m.model}-${m.provider}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-gray-600 w-4 text-right shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-xs text-gray-200 truncate">{m.model}</span>
                        <ProviderBadge provider={m.provider} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs font-bold text-gray-300">{m.count}</span>
                        <span className="text-[10px] text-gray-600">{fmtMs(m.avgLatencyMs)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-800/60 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, ${hex}60, ${hex})`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 4. Daily Token Usage ─────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5 card-3d">
          <h3 className="text-sm font-bold text-gray-300 mb-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Token Usage (7 days)
          </h3>
          {dailyTokens.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">ไม่มีข้อมูล</p>
          ) : (
            <>
              <div className="flex items-end gap-2 h-32">
                {dailyTokens.map((d) => {
                  const total = d.input + d.output;
                  const totalPct = (total / maxDailyTotal) * 100;
                  const inputPct = total > 0 ? (d.input / total) * totalPct : 0;
                  const outputPct = totalPct - inputPct;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col justify-end group relative"
                      style={{ height: "100%" }}
                    >
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                        <div className="glass rounded px-2 py-1 text-[10px] text-gray-300 whitespace-nowrap border border-white/10">
                          {d.date} — {fmtK(d.input)} in / {fmtK(d.output)} out
                        </div>
                      </div>
                      <div className="w-full flex flex-col justify-end" style={{ height: "100%" }}>
                        <div
                          className="w-full rounded-t transition-all duration-500"
                          style={{
                            height: `${outputPct}%`,
                            background: "rgba(251,191,36,0.7)",
                            minHeight: outputPct > 0 ? "2px" : "0",
                          }}
                        />
                        <div
                          className="w-full rounded-b transition-all duration-500"
                          style={{
                            height: `${inputPct}%`,
                            background: "linear-gradient(180deg, rgba(99,102,241,0.8), rgba(99,102,241,0.4))",
                            minHeight: inputPct > 0 ? "2px" : "0",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* X-axis labels */}
              <div className="flex gap-2 mt-1">
                {dailyTokens.map((d) => (
                  <div key={d.date} className="flex-1 text-center text-[9px] text-gray-600">
                    {d.date.slice(5)}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(99,102,241,0.7)" }} />
                  Input
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "rgba(251,191,36,0.7)" }} />
                  Output
                </span>
                <span className="ml-auto text-gray-600">
                  Total: {fmtK(dailyTokens.reduce((s, d) => s + d.input + d.output, 0))} tokens
                </span>
              </div>
            </>
          )}
        </div>

      </div>
    </section>
  );
}
