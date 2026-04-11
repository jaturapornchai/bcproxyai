"use client";

import {
  GlowDot,
  Skeleton,
  PROVIDER_COLORS,
  TIER_LABELS,
  TIER_COLORS,
  fmtCooldown,
  fmtCtx,
  fmtMs,
} from "./shared";
import type { ModelData } from "./shared";

// ─── Fun Status ───────────────────────────────────────────────────────────────

function getFunStatus(model: ModelData): { text: string; emoji: string } {
  if (model.health.status === "cooldown") {
    return { text: "พักแป๊บ", emoji: "😴" };
  }
  if (model.health.status === "unknown") {
    return { text: "รอสแกน", emoji: "✏️" };
  }
  return { text: "พร้อมรับงาน", emoji: "💪" };
}

function getSpeedLabel(ms: number): { text: string; emoji: string } {
  if (ms <= 200) return { text: "สายฟ้า", emoji: "⚡" };
  if (ms <= 500) return { text: "เร็วมาก", emoji: "🚀" };
  if (ms <= 1000) return { text: "เร็ว", emoji: "🏃" };
  if (ms <= 3000) return { text: "ปกติ", emoji: "🚶" };
  if (ms <= 5000) return { text: "ช้าหน่อย", emoji: "🐢" };
  return { text: "ช้ามาก", emoji: "🦥" };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ModelGridProps {
  sortedModels: ModelData[];
  availableCount: number;
  cooldownCount: number;
  unknownCount: number;
  loading: boolean;
}

export function ModelGrid({ sortedModels, availableCount, cooldownCount, unknownCount, loading }: ModelGridProps) {
  return (
    <section id="all-models" className="animate-fade-in-up stagger-3">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </span>
          ห้องเรียน AI
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-emerald-400"><GlowDot status="available" /> มาเรียน ({availableCount})</span>
          <span className="flex items-center gap-1.5 text-amber-400"><GlowDot status="cooldown" /> ลาพัก ({cooldownCount})</span>
          <span className="flex items-center gap-1.5 text-gray-500"><GlowDot status="unknown" /> ขาดเรียน ({unknownCount})</span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : sortedModels.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center text-gray-500">
          <div className="text-5xl mb-3">🏫</div>
          <p>ยังไม่มีนักเรียน — กด &quot;รันตอนนี้&quot; เพื่อเปิดรับสมัคร</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          {sortedModels.map((model) => {
            const pc = PROVIDER_COLORS[model.provider] ?? PROVIDER_COLORS.openrouter;
            const cooldownText = fmtCooldown(model.health.cooldownUntil);
            const funStatus = getFunStatus(model);
            const speedInfo = model.health.latencyMs > 0 ? getSpeedLabel(model.health.latencyMs) : null;

            return (
              <div
                key={model.id}
                className={`card-3d glass rounded-xl p-4 cursor-default transition-all ${
                  model.health.status === "available" ? "border border-emerald-500/20 hover:border-emerald-400/40" :
                  model.health.status === "cooldown"  ? "border border-amber-500/20 hover:border-amber-400/40 opacity-60" :
                  "border border-white/5 opacity-40"
                }`}
              >
                {/* Header: name + tier badge */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <GlowDot status={model.health.status} />
                    <div className="min-w-0">
                      <span className="text-sm text-gray-100 font-medium truncate block leading-tight">{model.provider}</span>
                      <span className="text-xs text-gray-500 truncate block leading-tight font-mono">{model.modelId}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${TIER_COLORS[model.tier] ?? TIER_COLORS.small}`}>
                      {TIER_LABELS[model.tier] ?? "S"}
                    </span>
                  </div>
                </div>

                {/* Provider + context + capabilities */}
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${pc.text} ${pc.bg} border ${pc.border}`}>
                    {model.provider}
                  </span>
                  <span className="text-xs text-gray-600">{fmtCtx(model.contextLength)}</span>
                  {model.supportsVision && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30" title="อ่านรูปภาพได้">👁 ดูรูปได้</span>
                  )}
                  {model.supportsTools && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30" title="รองรับ Tool Calling">🔧 tools</span>
                  )}
                  {speedInfo && (
                    <span className="text-xs text-gray-600">{speedInfo.emoji} {fmtMs(model.health.latencyMs)}</span>
                  )}
                </div>

                {/* Fun status line + benchmark score */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">
                    {funStatus.emoji} {funStatus.text}
                  </span>
                  {model.benchmark ? (
                    <span
                      className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        model.benchmark.avgScore >= 8 ? "bg-emerald-500/20 text-emerald-300" :
                        model.benchmark.avgScore >= 5 ? "bg-amber-500/20 text-amber-300" :
                        "bg-red-500/20 text-red-300"
                      }`}
                      title={`${model.benchmark.questionsAnswered}/${model.benchmark.totalQuestions} ข้อ`}
                    >
                      ★ {model.benchmark.avgScore.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-700">ยังไม่ได้สอบ</span>
                  )}
                </div>

                {/* Category scores */}
                {model.categoryScores && Object.keys(model.categoryScores).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(model.categoryScores)
                      .sort(([,a], [,b]) => b - a)
                      .map(([cat, score]) => (
                        <span
                          key={cat}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            score >= 80 ? "bg-emerald-500/20 text-emerald-300" :
                            score >= 60 ? "bg-cyan-500/20 text-cyan-300" :
                            score >= 40 ? "bg-amber-500/20 text-amber-300" :
                            "bg-red-500/20 text-red-300"
                          }`}
                          title={`${cat}: ${score}%`}
                        >
                          {cat} {score}%
                        </span>
                      ))}
                  </div>
                )}

                {/* Cooldown */}
                {cooldownText && (
                  <div className="mt-2 text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1">
                    😴 {cooldownText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
