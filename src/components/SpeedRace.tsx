"use client";

import { useMemo } from "react";
import { PROVIDER_COLORS, fmtMs } from "./shared";
import type { ModelData } from "./shared";

// ─── Provider Emoji Map ───────────────────────────────────────────────────────

const PROVIDER_EMOJI: Record<string, string> = {
  openrouter: "\u{1F310}",  // 🌐
  kilo:       "\u26A1",     // ⚡
  google:     "\u{1F50D}",  // 🔍
  groq:       "\u{1F3CE}\uFE0F", // 🏎️
  cerebras:   "\u{1F9E0}",  // 🧠
  sambanova:  "\u{1F680}",  // 🚀
  mistral:    "\u{1F4A8}",  // 💨
  ollama:     "\u{1F4BB}",  // 💻
  github:     "\u{1F431}",  // 🐱
  fireworks:  "\u{1F386}",  // 🎆
  cohere:     "\u{1F4E1}",  // 📡
  cloudflare: "\u2601\uFE0F", // ☁️
  huggingface: "\u{1F917}",  // 🤗
};

const PROVIDER_HEX: Record<string, string> = {
  openrouter: "#3b82f6",
  kilo:       "#a855f7",
  google:     "#34d399",
  groq:       "#fb923c",
  cerebras:   "#f43f5e",
  sambanova:  "#14b8a6",
  mistral:    "#38bdf8",
  ollama:     "#84cc16",
  github:     "#9ca3af",
  fireworks:  "#ef4444",
  cohere:     "#ec4899",
  cloudflare: "#f59e0b",
  huggingface: "#fbbf24",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProviderRace {
  provider: string;
  emoji: string;
  avgLatency: number;
  modelCount: number;
  available: boolean;
}

interface SpeedRaceProps {
  models: ModelData[];
  loading: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SpeedRace({ models, loading }: SpeedRaceProps) {
  const racers = useMemo(() => {
    // Group models by provider
    const grouped: Record<string, { totalLatency: number; count: number; availableCount: number }> = {};

    for (const m of models) {
      if (!grouped[m.provider]) {
        grouped[m.provider] = { totalLatency: 0, count: 0, availableCount: 0 };
      }
      grouped[m.provider].count++;
      if (m.health.status === "available" && m.health.latencyMs > 0) {
        grouped[m.provider].totalLatency += m.health.latencyMs;
        grouped[m.provider].availableCount++;
      }
    }

    const result: ProviderRace[] = Object.entries(grouped).map(([provider, data]) => ({
      provider,
      emoji: PROVIDER_EMOJI[provider] ?? "\u{1F916}",
      avgLatency: data.availableCount > 0 ? Math.round(data.totalLatency / data.availableCount) : 0,
      modelCount: data.count,
      available: data.availableCount > 0,
    }));

    // Sort: available first (by latency asc), then unavailable
    result.sort((a, b) => {
      if (a.available && !b.available) return -1;
      if (!a.available && b.available) return 1;
      if (a.available && b.available) return a.avgLatency - b.avgLatency;
      return 0;
    });

    return result;
  }, [models]);

  // Calculate max latency for bar scaling
  const maxLatency = useMemo(() => {
    const latencies = racers.filter((r) => r.available).map((r) => r.avgLatency);
    return latencies.length > 0 ? Math.max(...latencies) : 1;
  }, [racers]);

  const top3 = racers.filter((r) => r.available).slice(0, 3);
  const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"]; // 🥇🥈🥉

  if (loading) {
    return (
      <section id="speed-race" className="animate-fade-in-up stagger-2">
        <div className="glass rounded-2xl p-6">
          <div className="shimmer rounded h-8 w-64 bg-gray-800/60 mb-6" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="shimmer rounded-xl h-14 bg-gray-800/60" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (racers.length === 0) {
    return (
      <section id="speed-race" className="animate-fade-in-up stagger-2">
        <div className="glass rounded-2xl p-12 text-center text-gray-500">
          <div className="text-5xl mb-3">{"\u{1F3C1}"}</div>
          <p>ยังไม่มีข้อมูลความเร็ว — รอ Worker ตรวจสอบ</p>
        </div>
      </section>
    );
  }

  return (
    <section id="speed-race" className="animate-fade-in-up stagger-2">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/20 text-orange-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          {"\u{1F3C1}"} Speed Race — ใครเร็วที่สุด?
        </h2>
      </div>

      {/* Podium - Top 3 */}
      {top3.length >= 2 && (
        <div className="glass-bright rounded-2xl p-5 neon-border card-3d mb-6">
          <div className="flex items-center justify-center gap-6 sm:gap-10 flex-wrap">
            {top3.map((racer, i) => {
              const hex = PROVIDER_HEX[racer.provider] ?? "#6366f1";
              return (
                <div
                  key={racer.provider}
                  className="flex flex-col items-center gap-1.5"
                  style={{ order: i === 0 ? 1 : i === 1 ? 0 : 2 }}
                >
                  <span className="text-2xl sm:text-3xl">{medals[i]}</span>
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{
                      width: i === 0 ? 56 : 44,
                      height: i === 0 ? 56 : 44,
                      background: `${hex}20`,
                      border: `2px solid ${hex}60`,
                      boxShadow: `0 0 20px ${hex}30`,
                      transition: "all 0.5s ease",
                    }}
                  >
                    <span className={`${i === 0 ? "text-2xl" : "text-xl"}`}>{racer.emoji}</span>
                  </div>
                  <span className="text-sm font-bold text-white capitalize">{racer.provider}</span>
                  <span className="text-xs font-mono" style={{ color: hex }}>
                    {fmtMs(racer.avgLatency)}
                  </span>
                  <span className="text-xs text-gray-500">{racer.modelCount} models</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Race Lanes */}
      <div className="glass rounded-2xl p-5 space-y-3">
        {racers.map((racer, i) => {
          const hex = PROVIDER_HEX[racer.provider] ?? "#6366f1";
          const c = PROVIDER_COLORS[racer.provider] ?? {
            text: "text-gray-300",
            bg: "bg-gray-700/40",
            border: "border-gray-600/40",
          };
          // Bar width: fastest = 100%, slowest proportionally less
          // Invert: lower latency = wider bar
          const barPct = racer.available
            ? Math.max(10, 100 - ((racer.avgLatency / maxLatency) * 70))
            : 0;

          return (
            <div
              key={racer.provider}
              className="group rounded-xl px-4 py-3 hover:bg-white/[0.03] transition-all duration-300"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-lg w-7 text-center shrink-0">{racer.emoji}</span>
                <span className={`font-semibold capitalize text-sm ${c.text} w-24 shrink-0`}>
                  {racer.provider}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="h-6 bg-gray-800/60 rounded-full overflow-hidden relative">
                    {racer.available ? (
                      <div
                        className="h-full rounded-full relative overflow-hidden"
                        style={{
                          width: `${barPct}%`,
                          background: `linear-gradient(90deg, ${hex}40, ${hex}90)`,
                          transition: "width 1s cubic-bezier(0.4, 0, 0.2, 1)",
                          boxShadow: `0 0 12px ${hex}40`,
                        }}
                      >
                        {/* Shimmer effect on bar */}
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)`,
                            animation: "race-shimmer 2s infinite",
                          }}
                        />
                        {/* Racing dot at the end */}
                        <div
                          className="absolute right-0 top-1/2 -translate-y-1/2"
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: hex,
                            boxShadow: `0 0 8px ${hex}, 0 0 16px ${hex}60`,
                            transition: "all 1s ease",
                          }}
                        />
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center">
                        <span className="text-xs text-gray-600">offline</span>
                      </div>
                    )}
                  </div>
                </div>
                <span
                  className="text-sm font-mono w-16 text-right shrink-0"
                  style={{ color: racer.available ? hex : "rgb(75,85,99)" }}
                >
                  {racer.available ? fmtMs(racer.avgLatency) : "N/A"}
                </span>
                <span className="text-xs text-gray-500 w-20 text-right shrink-0 hidden sm:block">
                  ({racer.modelCount} models)
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @keyframes race-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </section>
  );
}
