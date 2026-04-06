"use client";

import { useEffect, useRef, useState } from "react";

// ─── Inline Types ──────────────────────────────────────────────────────────────

export interface WorkerStatus {
  status: "idle" | "running" | "error";
  lastRun: string | null;
  nextRun: string | null;
}

export interface Stats {
  totalModels: number;
  availableModels: number;
  cooldownModels: number;
  benchmarkedModels: number;
  avgScore: number;
}

export interface WorkerLog {
  step: string;
  message: string;
  level: string;
  createdAt: string;
}

export interface ModelChange {
  id: string;
  name: string;
  provider: string;
  tier: string;
  firstSeen?: string;
  lastSeen?: string;
}

export interface StatusData {
  worker: WorkerStatus;
  stats: Stats;
  recentLogs: WorkerLog[];
  modelChanges?: {
    new: ModelChange[];
    missing: ModelChange[];
    warning: ModelChange[];
  };
}

export interface HealthInfo {
  status: "available" | "cooldown" | "unknown";
  latencyMs: number;
  lastCheck: string | null;
  cooldownUntil: string | null;
}

export interface BenchmarkInfo {
  avgScore: number;
  maxScore: number;
  questionsAnswered: number;
  totalQuestions: number;
}

export interface ModelData {
  id: string;
  name: string;
  nickname: string | null;
  provider: string;
  modelId: string;
  contextLength: number;
  tier: string;
  supportsTools: boolean | null;
  supportsVision: boolean | null;
  health: HealthInfo;
  benchmark: BenchmarkInfo | null;
  firstSeen: string;
  lastSeen: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  provider: string;
  modelId: string;
  avgScore: number;
  totalScore: number;
  maxScore: number;
  percentage: number;
  questionsAnswered: number;
  avgLatencyMs: number;
  tier: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const PROVIDER_COLORS: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  openrouter: { text: "text-blue-300", bg: "bg-blue-500/20", border: "border-blue-500/40", glow: "rgba(59,130,246,0.5)" },
  kilo:       { text: "text-purple-300", bg: "bg-purple-500/20", border: "border-purple-500/40", glow: "rgba(168,85,247,0.5)" },
  google:     { text: "text-emerald-300", bg: "bg-emerald-500/20", border: "border-emerald-500/40", glow: "rgba(52,211,153,0.5)" },
  groq:       { text: "text-orange-300", bg: "bg-orange-500/20", border: "border-orange-500/40", glow: "rgba(251,146,60,0.5)" },
  cerebras:   { text: "text-rose-300", bg: "bg-rose-500/20", border: "border-rose-500/40", glow: "rgba(244,63,94,0.5)" },
  sambanova:  { text: "text-teal-300", bg: "bg-teal-500/20", border: "border-teal-500/40", glow: "rgba(20,184,166,0.5)" },
  mistral:    { text: "text-sky-300", bg: "bg-sky-500/20", border: "border-sky-500/40", glow: "rgba(56,189,248,0.5)" },
};

export const TIER_LABELS: Record<string, string> = { large: "L", medium: "M", small: "S" };
export const TIER_COLORS: Record<string, string> = {
  large: "bg-indigo-500/30 text-indigo-200 border border-indigo-500/40",
  medium: "bg-cyan-500/30 text-cyan-200 border border-cyan-500/40",
  small: "bg-gray-500/30 text-gray-300 border border-gray-500/40",
};

// ─── Utility Helpers ───────────────────────────────────────────────────────────

export function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("th-TH", { timeStyle: "medium", dateStyle: "short" });
}

export function fmtMs(ms: number) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

export function fmtCooldown(until: string | null) {
  if (!until) return null;
  const diff = new Date(until).getTime() - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `พักอีก ${h} ชม. ${m} นาที`;
  return `พักอีก ${m} นาที`;
}

export function fmtCtx(n: number) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function fmtCountdown(iso: string | null) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "กำลังจะเริ่ม...";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0) return `${h} ชม. ${m} นาที ${s} วินาที`;
  if (m > 0) return `${m} นาที ${s} วินาที`;
  return `${s} วินาที`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded bg-gray-800/60 ${className}`} />;
}

export function GlowDot({ status }: { status: "available" | "cooldown" | "unknown" | "idle" | "running" | "error" }) {
  const map = {
    available: "bg-emerald-400 animate-glow-green",
    running:   "bg-yellow-400 animate-glow-amber",
    cooldown:  "bg-amber-400 animate-glow-amber",
    idle:      "bg-indigo-400 animate-glow-pulse",
    unknown:   "bg-gray-500",
    error:     "bg-red-500 animate-glow-red",
  };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${map[status] ?? "bg-gray-500"}`} />;
}

export function ProviderBadge({ provider }: { provider: string }) {
  const c = PROVIDER_COLORS[provider] ?? { text: "text-gray-300", bg: "bg-gray-700/40", border: "border-gray-600/40" };
  const labels: Record<string, string> = { openrouter: "OR", kilo: "Kilo", google: "GG", groq: "Groq", cerebras: "Cerebras", sambanova: "SN", mistral: "Mistral" };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold ${c.text} ${c.bg} border ${c.border}`}>
      {labels[provider] ?? provider}
    </span>
  );
}

export function CircleProgress({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s ease" }}
      />
    </svg>
  );
}

// ─── Animated Counter ──────────────────────────────────────────────────────────

export function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const start = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const from = start.current;
    const to = value;
    const startTime = performance.now();
    function step(now: number) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * ease));
      if (t < 1) raf.current = requestAnimationFrame(step);
      else start.current = to;
    }
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, duration]);

  return <>{display}</>;
}
