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

// ─── Fun Grade System ─────────────────────────────────────────────────────────

function getGrade(pct: number): { grade: string; label: string; color: string; emoji: string } {
  if (pct >= 90) return { grade: "A+", label: "นักเรียนดีเด่น", color: "text-yellow-300", emoji: "🏆" };
  if (pct >= 80) return { grade: "A", label: "เก่งมาก", color: "text-emerald-300", emoji: "⭐" };
  if (pct >= 70) return { grade: "B+", label: "ดี", color: "text-cyan-300", emoji: "👍" };
  if (pct >= 60) return { grade: "B", label: "พอใช้", color: "text-blue-300", emoji: "📘" };
  if (pct >= 50) return { grade: "C+", label: "ผ่านหวุดหวิด", color: "text-amber-300", emoji: "😅" };
  if (pct >= 40) return { grade: "C", label: "ต้องปรับปรุง", color: "text-orange-300", emoji: "📝" };
  if (pct >= 30) return { grade: "D", label: "สอบตก", color: "text-red-300", emoji: "😢" };
  return { grade: "F", label: "ไม่ผ่าน", color: "text-red-400", emoji: "💀" };
}

function getFunStatus(model: ModelData): { text: string; emoji: string } {
  if (model.health.status === "cooldown") {
    return { text: "ไปพักผ่อนก่อน", emoji: "😴" };
  }
  if (model.health.status === "unknown") {
    return { text: "ยังไม่มาเรียน", emoji: "🤷" };
  }
  if (!model.benchmark) {
    return { text: "รอเข้าห้องสอบ", emoji: "✏️" };
  }
  const pct = (model.benchmark.avgScore / model.benchmark.maxScore) * 100;
  if (pct >= 90) return { text: "หัวหน้าห้อง!", emoji: "👑" };
  if (pct >= 70) return { text: "ขยันดีมาก", emoji: "💪" };
  if (pct >= 50) return { text: "พอถูไถได้", emoji: "🙂" };
  if (pct >= 30) return { text: "ต้องติวเพิ่ม", emoji: "📚" };
  return { text: "ซ้ำชั้นเลย", emoji: "🫠" };
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedModels.map((model) => {
            const pc = PROVIDER_COLORS[model.provider] ?? PROVIDER_COLORS.openrouter;
            const cooldownText = fmtCooldown(model.health.cooldownUntil);
            const funStatus = getFunStatus(model);
            const hasBenchmark = model.benchmark && model.benchmark.avgScore > 0;
            const pct = hasBenchmark
              ? Math.round((model.benchmark!.avgScore / model.benchmark!.maxScore) * 100)
              : 0;
            const gradeInfo = hasBenchmark ? getGrade(pct) : null;
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
                {/* Header: name + grade badge */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <GlowDot status={model.health.status} />
                    <div className="min-w-0">
                      {model.nickname && (
                        <span className="text-sm font-bold text-amber-300 truncate block leading-tight">{model.nickname}</span>
                      )}
                      <span className={`${model.nickname ? "text-xs text-gray-500" : "text-sm text-gray-100 font-medium"} truncate block leading-tight`}>{model.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {gradeInfo && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-black ${gradeInfo.color} bg-white/5 border border-white/10`}>
                        {gradeInfo.grade}
                      </span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${TIER_COLORS[model.tier] ?? TIER_COLORS.small}`}>
                      {TIER_LABELS[model.tier] ?? "S"}
                    </span>
                  </div>
                </div>

                {/* Provider + context */}
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${pc.text} ${pc.bg} border ${pc.border}`}>
                    {model.provider}
                  </span>
                  <span className="text-xs text-gray-600">{fmtCtx(model.contextLength)}</span>
                  {speedInfo && (
                    <span className="text-xs text-gray-600">{speedInfo.emoji} {fmtMs(model.health.latencyMs)}</span>
                  )}
                </div>

                {/* Benchmark score + grade */}
                {hasBenchmark ? (
                  <div className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500">
                        {model.benchmark!.avgScore.toFixed(1)}/{model.benchmark!.maxScore}
                      </span>
                      <span className={`text-xs font-bold ${gradeInfo?.color ?? "text-indigo-300"}`}>
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${
                          pct >= 80 ? "bg-gradient-to-r from-yellow-500 to-amber-400" :
                          pct >= 60 ? "bg-gradient-to-r from-indigo-500 to-cyan-500" :
                          pct >= 40 ? "bg-gradient-to-r from-amber-500 to-orange-500" :
                          "bg-gradient-to-r from-red-500 to-pink-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mb-2" />
                )}

                {/* Capability badges */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    model.supportsTools === true
                      ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                      : model.supportsTools === false
                        ? "text-red-300 border-red-500/30 bg-red-500/10"
                        : "text-gray-400 border-white/10 bg-white/5"
                  }`}>
                    {model.supportsTools === true ? "tools ✓" : model.supportsTools === false ? "tools ✕" : "tools ?"}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    model.supportsVision === true
                      ? "text-cyan-300 border-cyan-500/30 bg-cyan-500/10"
                      : model.supportsVision === false
                        ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                        : "text-gray-400 border-white/10 bg-white/5"
                  }`}>
                    {model.supportsVision === true ? "vision ✓" : model.supportsVision === false ? "vision ✕" : "vision ?"}
                  </span>
                </div>

                {/* Fun status line */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 truncate">
                    {funStatus.emoji} {funStatus.text}
                  </span>
                  {gradeInfo && (
                    <span className={`text-xs shrink-0 ${gradeInfo.color}`}>
                      {gradeInfo.emoji} {gradeInfo.label}
                    </span>
                  )}
                </div>

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
