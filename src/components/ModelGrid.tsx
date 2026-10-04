"use client";

import { useMemo, useState } from "react";
import {
  GlowDot,
  ProviderBadge,
  TIER_LABELS,
  fmtCooldown,
  fmtCtx,
  fmtMs,
} from "./shared";
import type { ModelData } from "./shared";
import { Badge, Button, Card, EmptyState, Reveal } from "./ui/ui";
import type { Tone } from "./ui/ui";

function IconSearch({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

// ─── Status helpers ───────────────────────────────────────────────────────────

type StatusFilter = "all" | ModelData["health"]["status"];

const STATUS_TEXT: Record<ModelData["health"]["status"], string> = {
  available: "พร้อมรับงาน",
  cooldown: "พักชั่วคราว",
  unknown: "ยังไม่ได้ตรวจ",
};

const STATUS_CARD: Record<ModelData["health"]["status"], string> = {
  available: "",
  cooldown: "opacity-70",
  unknown: "opacity-55",
};

function getSpeedLabel(ms: number): string {
  if (ms <= 200) return "สายฟ้า";
  if (ms <= 500) return "เร็วมาก";
  if (ms <= 1000) return "เร็ว";
  if (ms <= 3000) return "ปกติ";
  if (ms <= 5000) return "ช้าหน่อย";
  return "ช้ามาก";
}

function scoreTone(score: number): Tone {
  return score >= 8 ? "success" : score >= 5 ? "warning" : "danger";
}

function categoryTone(score: number): Tone {
  return score >= 80 ? "success" : score >= 60 ? "info" : score >= 40 ? "warning" : "danger";
}

// ─── Component ────────────────────────────────────────────────────────────────

// Each card has a blur surface, so render in pages instead of hundreds at once
const PAGE_SIZE = 48;

interface ModelGridProps {
  sortedModels: ModelData[];
  availableCount: number;
  cooldownCount: number;
  unknownCount: number;
  loading: boolean;
}

export function ModelGrid({ sortedModels, availableCount, cooldownCount, unknownCount, loading }: ModelGridProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedModels.filter(
      (m) =>
        (status === "all" || m.health.status === status) &&
        (!q || `${m.name} ${m.provider} ${m.modelId}`.toLowerCase().includes(q)),
    );
  }, [sortedModels, query, status]);

  const filters: Array<{ id: StatusFilter; label: string; count: number; dot?: ModelData["health"]["status"] }> = [
    { id: "all", label: "ทั้งหมด", count: sortedModels.length },
    { id: "available", label: "พร้อมใช้", count: availableCount, dot: "available" },
    { id: "cooldown", label: "พักชั่วคราว", count: cooldownCount, dot: "cooldown" },
    { id: "unknown", label: "ยังไม่ตรวจ", count: unknownCount, dot: "unknown" },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar: search + status filter */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full lg:max-w-sm">
          <span className="sr-only">ค้นหาโมเดล</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }}
            placeholder="ค้นหาชื่อโมเดล หรือผู้ให้บริการ…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-10 pr-3 text-[13px] text-white placeholder:text-[var(--muted)] transition-colors focus:border-violet-400/60 focus:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40"
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="กรองตามสถานะ">
          {filters.map((f) => {
            const active = status === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => { setStatus(f.id); setLimit(PAGE_SIZE); }}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ${
                  active
                    ? "border-violet-400/40 bg-violet-400/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:border-white/20 hover:text-gray-200"
                }`}
              >
                {f.dot && <GlowDot status={f.dot} />}
                {f.label}
                <span className="tabular-nums opacity-80">{f.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconSearch size={22} />}
            title={sortedModels.length === 0 ? "ยังไม่มีโมเดลในระบบ" : "ไม่พบโมเดลที่ตรงกับเงื่อนไข"}
            description={
              sortedModels.length === 0
                ? "ใส่ API key ของผู้ให้บริการอย่างน้อย 1 เจ้า แล้วรอให้ระบบสแกนโมเดลรอบแรก"
                : "ลองเปลี่ยนคำค้นหา หรือเลือกสถานะ “ทั้งหมด”"
            }
          />
        </Card>
      ) : (
        <>
          <p className="text-[12px] text-[var(--muted)]">
            แสดง <span className="tabular-nums text-gray-200">{Math.min(limit, visible.length)}</span> จาก{" "}
            <span className="tabular-nums">{visible.length}</span> โมเดล
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.slice(0, limit).map((model, idx) => {
              const cooldownText = fmtCooldown(model.health.cooldownUntil);
              const speed = model.health.latencyMs > 0 ? getSpeedLabel(model.health.latencyMs) : null;
              const cats = model.categoryScores
                ? Object.entries(model.categoryScores).sort(([, a], [, b]) => b - a)
                : [];

              return (
                <Reveal key={model.id} i={Math.min(idx, 8)} className="h-full">
                  <Card hover className={`h-full p-4 ${STATUS_CARD[model.health.status]}`}>
                    {/* Header: name + tier */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-1.5 shrink-0"><GlowDot status={model.health.status} /></span>
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-medium leading-tight text-white" title={model.name}>{model.name}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]" title={model.modelId}>{model.modelId}</div>
                        </div>
                      </div>
                      <Badge tone={model.tier === "large" ? "accent" : model.tier === "medium" ? "info" : "neutral"}>
                        {TIER_LABELS[model.tier] ?? "S"}
                      </Badge>
                    </div>

                    {/* Provider + context + capabilities */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <ProviderBadge provider={model.provider} />
                      <span className="text-[11px] tabular-nums text-[var(--muted)]">{fmtCtx(model.contextLength)} ctx</span>
                      {model.supportsVision && <Badge tone="accent">ดูรูปได้</Badge>}
                      {model.supportsTools && <Badge tone="info">tools</Badge>}
                      {speed && (
                        <span className="text-[11px] tabular-nums text-[var(--muted)]">
                          {speed} · {fmtMs(model.health.latencyMs)}
                        </span>
                      )}
                    </div>

                    {/* Status line + benchmark score */}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-[var(--muted)]">{STATUS_TEXT[model.health.status]}</span>
                      {model.benchmark ? (
                        <span title={`${model.benchmark.questionsAnswered}/${model.benchmark.totalQuestions} ข้อ`}>
                          <Badge tone={scoreTone(model.benchmark.avgScore)}>
                            คะแนน {model.benchmark.avgScore.toFixed(1)}
                          </Badge>
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--muted)]">ยังไม่ได้สอบ</span>
                      )}
                    </div>

                    {/* Category scores */}
                    {cats.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {cats.map(([cat, score]) => (
                          <span key={cat} title={`${cat}: ${score}%`}>
                            <Badge tone={categoryTone(score)}>{cat} {score}%</Badge>
                          </span>
                        ))}
                      </div>
                    )}

                    {cooldownText && (
                      <div className="mt-3 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[12px] text-amber-300">
                        {cooldownText}
                      </div>
                    )}
                  </Card>
                </Reveal>
              );
            })}
          </div>
          {visible.length > limit && (
            <div className="flex justify-center pt-2">
              <Button onClick={() => setLimit((n) => n + PAGE_SIZE)}>แสดงเพิ่ม (เหลืออีก {visible.length - limit} โมเดล)</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
