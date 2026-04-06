"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleProgress,
  GlowDot,
  ProviderBadge,
  Skeleton,
  PROVIDER_COLORS,
  TIER_COLORS,
  TIER_LABELS,
  fmtTime,
  fmtMs,
  fmtCountdown,
} from "../components/shared";
import type {
  StatusData,
  ModelData,
  LeaderboardEntry,
} from "../components/shared";
import { StatsCards } from "../components/StatsCards";
import { ModelGrid } from "../components/ModelGrid";
import { ChatPanel } from "../components/ChatPanel";
import { GuideModal } from "../components/GuideModal";
import { SpeedRace } from "../components/SpeedRace";

// ─── Gateway Config Card ───────────────────────────────────────────────────────

const ONBOARD_CMD_DOCKER = `docker exec <openclaw-container> \\
  openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://host.docker.internal:3333/v1 \\
  --custom-model-id auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`;

const ONBOARD_CMD_LOCAL = `openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://localhost:3333/v1 \\
  --custom-model-id auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`;

function GatewayConfigCard() {
  const [copied, setCopied] = useState(false);
  const [configMode, setConfigMode] = useState<"docker" | "local">("docker");
  const currentConfig = configMode === "docker" ? ONBOARD_CMD_DOCKER : ONBOARD_CMD_LOCAL;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentConfig).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={{
        background: "rgba(99,102,241,0.06)",
        border: "1px solid rgba(99,102,241,0.25)",
        backdropFilter: "blur(12px)",
        borderRadius: "1rem",
        padding: "1.5rem",
        marginTop: "1.5rem",
        maxWidth: "48rem",
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <div style={{ marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.75rem", color: "rgb(165,180,252)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Gateway Config
        </span>
        <p style={{ fontSize: "0.875rem", color: "rgb(156,163,175)", marginTop: "0.25rem" }}>
          เชื่อมต่อ OpenClaw กับ BCProxyAI — รันคำสั่งนี้ใน OpenClaw:
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {([["docker", "OpenClaw บน Docker"], ["local", "OpenClaw บนเครื่อง"]] as const).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => { setConfigMode(mode); setCopied(false); }}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: "pointer",
              border: `1px solid ${configMode === mode ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"}`,
              background: configMode === mode ? "rgba(99,102,241,0.2)" : "transparent",
              color: configMode === mode ? "rgb(165,180,252)" : "rgb(107,114,128)",
              transition: "all 0.2s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <pre
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "0.5rem",
            padding: "1rem",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.8rem",
            color: "rgb(209,213,219)",
            overflowX: "auto",
            margin: 0,
          }}
        >
          {currentConfig}
        </pre>
        <button
          onClick={handleCopy}
          style={{
            position: "absolute",
            top: "0.5rem",
            right: "0.5rem",
            padding: "0.25rem 0.75rem",
            background: copied ? "rgba(16,185,129,0.3)" : "rgba(99,102,241,0.3)",
            border: `1px solid ${copied ? "rgba(16,185,129,0.5)" : "rgba(99,102,241,0.5)"}`,
            borderRadius: "0.375rem",
            color: copied ? "rgb(110,231,183)" : "rgb(165,180,252)",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          {copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}
        </button>
      </div>

      <p style={{ fontSize: "0.7rem", color: "rgb(251,191,36)", marginTop: "0.5rem" }}>
        {configMode === "docker"
          ? "* ใช้ host.docker.internal แทน localhost เพราะ OpenClaw อยู่คนละ container"
          : "* ใช้ localhost ได้เลย เพราะ OpenClaw รันบนเครื่องเดียวกัน"}
      </p>
      <p style={{ fontSize: "0.7rem", color: "rgb(156,163,175)", marginTop: "0.25rem" }}>
        หลังรันคำสั่ง OpenClaw จะตั้งค่า provider ให้อัตโนมัติ (api: openai-completions, contextWindow: 131072)
      </p>

      <div style={{ marginTop: "1rem" }}>
        <p style={{ fontSize: "0.75rem", color: "rgb(107,114,128)", marginBottom: "0.5rem", fontWeight: 600 }}>
          โมเดลพิเศษ:
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {[
            { id: "auto",           desc: "เลือกตัวดีสุดอัตโนมัติ" },
            { id: "bcproxy/fast",   desc: "เร็วที่สุด" },
            { id: "bcproxy/tools",  desc: "รองรับ tool calling" },
            { id: "bcproxy/thai",   desc: "เก่งภาษาไทย" },
          ].map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <code style={{ fontSize: "0.75rem", color: "rgb(129,140,248)", fontFamily: "var(--font-geist-mono), monospace", minWidth: "10rem" }}>
                {m.id}
              </code>
              <span style={{ fontSize: "0.75rem", color: "rgb(156,163,175)" }}>— {m.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fmtUsd(amount: number) {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

function fmtThb(amount: number) {
  if (amount === 0) return "฿0";
  if (amount < 1) return `฿${amount.toFixed(2)}`;
  return `฿${amount.toFixed(0)}`;
}

function fmtTokenSummary(tokens: number) {
  if (tokens <= 0) return "0 tokens";
  if (tokens < 1000) return `${tokens} tokens`;
  return `${(tokens / 1000).toFixed(1)}K tokens`;
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [models, setModels] = useState<ModelData[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [, setTick] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

  interface GatewayLog {
    id: number;
    requestModel: string;
    resolvedModel: string | null;
    provider: string | null;
    status: number;
    latencyMs: number;
    error: string | null;
    userMessage: string | null;
    assistantMessage: string | null;
    createdAt: string;
  }
  const [gatewayLogs, setGatewayLogs] = useState<GatewayLog[]>([]);

  interface CostProvider {
    id: string;
    label: string;
    inputPrice: number;
    outputPrice: number;
    cost: number;
    costThb: number;
  }
  interface CostSavings {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalRequests: number;
    todayRequests: number;
    providers: CostProvider[];
    actualCost: number;
    totalSaved: number;
    totalSavedThb: number;
  }
  const [costSavings, setCostSavings] = useState<CostSavings | null>(null);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Tick every second for cooldown countdowns
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [s, m, l, cs] = await Promise.all([
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/models").then((r) => r.json()),
        fetch("/api/leaderboard").then((r) => r.json()),
        fetch("/api/cost-savings").then((r) => r.json()).catch(() => null),
      ]);
      setStatusData(s);
      setModels(Array.isArray(m) ? m : []);
      setLeaderboard(Array.isArray(l) ? l : []);
      if (cs) setCostSavings(cs);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Gateway logs — realtime polling every 2 seconds
  const fetchGatewayLogs = useCallback(async () => {
    try {
      const g = await fetch("/api/gateway-logs").then((r) => r.json());
      setGatewayLogs(Array.isArray(g) ? g : Array.isArray(g.logs) ? g.logs : []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchGatewayLogs();
    const t1 = setInterval(fetchAll, 15_000);
    const t2 = setInterval(fetchGatewayLogs, 2_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchAll, fetchGatewayLogs]);

  const triggerWorker = async () => {
    setTriggering(true);
    try {
      await fetch("/api/worker", { method: "POST" });
      await fetchAll();
    } finally {
      setTriggering(false);
    }
  };

  const workerStatus = statusData?.worker?.status ?? "idle";
  const stats = statusData?.stats;
  const logs = statusData?.recentLogs ?? [];

  // Deduplicate by provider+model_id (same model same provider = duplicate, different provider = different student)
  const deduped = (() => {
    const seen = new Set<string>();
    return models.filter((m) => {
      const key = m.id; // id = "provider:model_id" — already unique per provider+model
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  const availableModels = deduped.filter((m) => m.health.status === "available");
  const cooldownModels = deduped.filter((m) => m.health.status === "cooldown");
  const unknownModels = deduped.filter((m) => m.health.status === "unknown");
  const sortedModels = [...availableModels, ...cooldownModels, ...unknownModels];

  const logLevelStyle: Record<string, string> = {
    info:    "text-gray-400",
    warn:    "text-amber-400",
    error:   "text-red-400",
    success: "text-emerald-400",
  };

  const stepBadge: Record<string, string> = {
    scan:      "bg-blue-500/20 text-blue-300 border-blue-500/30",
    health:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    benchmark: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    worker:    "bg-gray-500/20 text-gray-300 border-gray-500/30",
  };

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/4 w-[600px] h-[400px] bg-indigo-600/5 rounded-full blur-[100px]" />
        <div className="absolute top-1/3 right-1/4 w-[400px] h-[300px] bg-cyan-500/5 rounded-full blur-[80px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[500px] h-[300px] bg-purple-600/4 rounded-full blur-[120px]" />
      </div>

      {/* ── Sticky Nav ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-white/5 glass">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg animate-glow-pulse">
                <span className="text-xs font-black text-white">BC</span>
              </div>
            </div>
            <span className="font-bold text-white tracking-tight">BCProxyAI</span>
            <span className="hidden sm:inline text-xs text-gray-500 border border-gray-800 rounded px-2 py-0.5">
              AI Gateway
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            {[
              { id: "status",     label: "ภาพรวม" },
              { id: "rankings",   label: "อันดับ" },
              { id: "speed-race", label: "แข่งความเร็ว" },
              { id: "all-models", label: "รายชื่อโมเดล" },
              { id: "chat",       label: "ทดลองแชท" },
              { id: "gateway-logs", label: "Gateway Log" },
              { id: "logs",       label: "ประวัติระบบ" },
            ].map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                {link.label}
              </a>
            ))}
            <button
              onClick={() => setShowGuide(true)}
              className="ml-2 px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              title="คู่มือการใช้งาน"
            >
              <svg className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              คู่มือ
            </button>
            <a
              href="https://github.com/jaturapornchai/bcproxyai"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              title="GitHub"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-16">

        {/* ── Section 1: Header + Worker Status ──────────────────────────── */}
        <section id="status" className="animate-fade-in-up">
          {/* Title */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-400" />
              </span>
              Live Dashboard
            </div>
            <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-3">
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent animate-gradient">
                BCProxyAI
              </span>
            </h1>
            <p className="text-gray-400 text-lg">Smart AI Gateway — เลือก model ฟรีที่ดีที่สุดให้อัตโนมัติ</p>
          </div>

          {/* Worker Status Card */}
          <div className="glass-bright rounded-2xl p-6 neon-border card-3d max-w-3xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <CircleProgress
                    pct={workerStatus === "running" ? 66 : workerStatus === "idle" ? 100 : 33}
                    color={workerStatus === "running" ? "#fbbf24" : workerStatus === "idle" ? "#6366f1" : "#ef4444"}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <GlowDot status={workerStatus} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-lg">Worker</span>
                    <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${
                      workerStatus === "running" ? "bg-yellow-500/20 text-yellow-300" :
                      workerStatus === "idle"    ? "bg-indigo-500/20 text-indigo-300" :
                                                  "bg-red-500/20 text-red-300"
                    }`}>
                      {workerStatus === "running" ? "🟡 กำลังทำงาน" :
                       workerStatus === "idle"    ? "🟢 ทำงานปกติ" :
                                                   "🔴 หยุด"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-gray-500">
                    <div className="flex gap-4">
                      <span>ทำงานล่าสุด: <span className="text-gray-300">{fmtTime(statusData?.worker.lastRun ?? null)}</span></span>
                      <span>ครั้งถัดไป: <span className="text-gray-300">{fmtTime(statusData?.worker.nextRun ?? null)}</span></span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {statusData?.worker.nextRun && workerStatus !== "running" && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-indigo-400">⏱</span>
                          <span className="text-indigo-300 font-medium">{fmtCountdown(statusData.worker.nextRun)}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <span className="text-amber-400">📝</span>
                        <span className="text-amber-300">คุมสอบ: <span className="font-medium">DeepSeek Chat</span></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {lastRefresh && (
                  <span className="text-xs text-gray-600 hidden sm:block">
                    รีเฟรชล่าสุด {lastRefresh.toLocaleTimeString("th-TH")}
                  </span>
                )}
                <button
                  onClick={triggerWorker}
                  disabled={triggering || workerStatus === "running"}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40"
                >
                  {triggering ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M12 8v4l2 2" />
                    </svg>
                  )}
                  รันตอนนี้
                </button>
              </div>
            </div>
          </div>

          {/* Gateway Config */}
          <GatewayConfigCard />

          {/* Cost Savings Card */}
          {costSavings && (
            <div className="mt-6 glass-bright rounded-2xl p-5 neon-border max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">💰</span>
                  <span className="font-bold text-white text-lg">เทียบต้นทุน</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap justify-end">
                  <span>สะสม {costSavings.totalRequests.toLocaleString()} requests</span>
                  <span>|</span>
                  <span>วันนี้ {costSavings.todayRequests.toLocaleString()}</span>
                </div>
              </div>

              {/* Token usage summary */}
              <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
                <span className="text-gray-500">ใช้ไป:</span>
                <span className="text-indigo-300 font-bold">{fmtTokenSummary(costSavings.totalTokens)}</span>
                <span className="text-gray-600">(input {fmtTokenSummary(costSavings.totalInputTokens)} + output {fmtTokenSummary(costSavings.totalOutputTokens)})</span>
              </div>

              {costSavings.totalTokens === 0 ? (
                <div className="glass rounded-lg p-4 border border-white/10 text-sm text-gray-400">
                  ยังไม่มี usage ในฐานข้อมูลค่ะ — ตอนนี้ section นี้จะขึ้นเสมอ แม้ยังไม่มี token log
                </div>
              ) : (
                <>
                  {/* Cost comparison — dynamic from API */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                    {(costSavings.providers ?? []).map((p) => (
                      <div key={p.id} className="glass rounded-lg p-3 text-center">
                        <div className="text-xs text-gray-500 mb-1 truncate">{p.label}</div>
                        <div className="text-lg font-bold text-red-400">{fmtUsd(p.cost)}</div>
                        <div className="text-xs text-red-500/60">{fmtThb(p.costThb)}</div>
                        <div className="text-[10px] text-gray-600 mt-1">${p.inputPrice}/${p.outputPrice} /1M</div>
                      </div>
                    ))}
                    <div className="glass rounded-lg p-3 text-center border border-emerald-500/30 bg-emerald-500/5">
                      <div className="text-xs text-emerald-400 mb-1">BCProxyAI</div>
                      <div className="text-lg font-bold text-emerald-300">$0.00</div>
                      <div className="text-xs text-emerald-500">ฟรี!</div>
                      <div className="text-[10px] text-emerald-600 mt-1">$0/$0 /1M</div>
                    </div>
                  </div>

                  {/* Total saved highlight — compare all */}
                  <div className="glass rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/5">
                    <div className="text-xs text-emerald-400 mb-2 font-semibold">ยอดสะสมที่ประหยัดได้ (เทียบแต่ละเจ้า):</div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {(costSavings.providers ?? []).map((p) => (
                        <div key={p.id} className="text-center">
                          <div className="text-xs text-gray-500">vs {p.label}</div>
                          <div className="text-lg font-black text-emerald-300">{fmtUsd(p.cost)}</div>
                          <div className="text-xs text-emerald-500">{fmtThb(p.costThb)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Stats Cards */}
          <StatsCards stats={stats} loading={loading} />
        </section>

        {/* ── Model Changes Alert ─────────────────────────────────────────── */}
        {statusData?.modelChanges && (
          (statusData.modelChanges.new.length > 0 || statusData.modelChanges.missing.length > 0 || statusData.modelChanges.warning.length > 0) && (
            <section className="animate-fade-in-up space-y-3">
              {/* โมเดลใหม่ */}
              {statusData.modelChanges.new.length > 0 && (
                <div className="glass rounded-2xl p-4 border border-emerald-500/30 bg-emerald-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🆕</span>
                    <span className="font-bold text-emerald-400">โมเดลใหม่ ({statusData.modelChanges.new.length})</span>
                    <span className="text-xs text-gray-500">ภายใน 24 ชม.</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.new.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        {m.name}
                        <span className="text-xs text-emerald-500/60">({m.provider})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* โมเดลหายชั่วคราว */}
              {statusData.modelChanges.warning.length > 0 && (
                <div className="glass rounded-2xl p-4 border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">⚠️</span>
                    <span className="font-bold text-amber-400">หายชั่วคราว ({statusData.modelChanges.warning.length})</span>
                    <span className="text-xs text-gray-500">ไม่เจอ 2-48 ชม. อาจกลับมา</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.warning.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
                        {m.name}
                        <span className="text-xs text-amber-500/60">({m.provider})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* โมเดลหายถาวร */}
              {statusData.modelChanges.missing.length > 0 && (
                <div className="glass rounded-2xl p-4 border border-red-500/30 bg-red-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">💀</span>
                    <span className="font-bold text-red-400">หายถาวร ({statusData.modelChanges.missing.length})</span>
                    <span className="text-xs text-gray-500">ไม่เจอเกิน 48 ชม.</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.missing.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 line-through opacity-70">
                        {m.name}
                        <span className="text-xs text-red-500/60">({m.provider})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )
        )}

        {/* ── Section 3: Rankings ──────────────────────────────────────────── */}
        <section id="rankings" className="animate-fade-in-up stagger-2">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </span>
              อันดับโมเดล
            </h2>
            <span className="text-sm text-gray-500">{leaderboard.length} โมเดลมีคะแนน</span>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="glass rounded-2xl p-12 text-center text-gray-500">
              <div className="text-5xl mb-3">🏆</div>
              <p>ยังไม่มีผล Benchmark — กด &quot;รันตอนนี้&quot; เพื่อเริ่ม</p>
            </div>
          ) : (
            <div className="glass rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5 text-xs text-gray-500">
                    <th className="px-4 py-3 text-left w-8">#</th>
                    <th className="px-4 py-3 text-left">ชื่อโมเดล</th>
                    <th className="px-3 py-3 text-left hidden sm:table-cell">ผู้ให้บริการ</th>
                    <th className="px-4 py-3 text-left">คะแนน</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">ความเร็ว</th>
                    <th className="px-4 py-3 text-right hidden lg:table-cell">ขนาด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.modelId} className="hover:bg-white/3 transition-colors group">
                      <td className="px-4 py-4 text-sm font-bold">
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (
                          <span className="text-gray-600">{entry.rank}</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-gray-100 text-sm group-hover:text-white transition-colors leading-tight">
                          {entry.name}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 truncate max-w-[200px]">{entry.modelId}</div>
                      </td>
                      <td className="px-3 py-4 hidden sm:table-cell">
                        <ProviderBadge provider={entry.provider} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-[80px] max-w-[120px] h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full progress-shimmer rounded-full"
                              style={{ width: `${entry.percentage}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-indigo-300 w-12 text-right">{entry.percentage}%</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">{entry.totalScore}/{entry.maxScore} คะแนน</div>
                      </td>
                      <td className="px-4 py-4 text-right hidden md:table-cell">
                        <span className="text-sm text-gray-400">{fmtMs(entry.avgLatencyMs)}</span>
                      </td>
                      <td className="px-4 py-4 text-right hidden lg:table-cell">
                        <span className={`text-xs px-2 py-0.5 rounded ${TIER_COLORS[entry.tier] ?? TIER_COLORS.small}`}>
                          {TIER_LABELS[entry.tier] ?? "S"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 3.5: Speed Race ──────────────────────────────────────── */}
        <SpeedRace models={deduped} loading={loading} />

        {/* ── Section 4: All Models Grid ───────────────────────────────────── */}
        <ModelGrid
          sortedModels={sortedModels}
          availableCount={availableModels.length}
          cooldownCount={cooldownModels.length}
          unknownCount={unknownModels.length}
          loading={loading}
        />

        {/* ── Section 5: Chat ─────────────────────────────────────────────── */}
        <section id="chat" className="animate-fade-in-up stagger-4">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </span>
            <h2 className="text-2xl font-bold text-white">แชทกับโมเดล</h2>
          </div>
          <ChatPanel availableModels={availableModels} />
        </section>

        {/* ── Section 6: Gateway Logs ──────────────────────────────────── */}
        <section id="gateway-logs" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">Gateway Log</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              LIVE
            </span>
            <span className="text-xs text-gray-500">{gatewayLogs.length} รายการ</span>
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              {gatewayLogs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-600">ยังไม่มี request เข้า Gateway</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900/90 backdrop-blur">
                    <tr className="border-b border-white/10 text-gray-500">
                      <th className="px-3 py-2 text-left">เวลา</th>
                      <th className="px-3 py-2 text-left">สถานะ</th>
                      <th className="px-3 py-2 text-left">Request Model</th>
                      <th className="px-3 py-2 text-left">Resolved</th>
                      <th className="px-3 py-2 text-left">Provider</th>
                      <th className="px-3 py-2 text-right">Latency</th>
                      <th className="px-3 py-2 text-left">ข้อความ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {gatewayLogs.map((log) => {
                      const dt = new Date(log.createdAt);
                      const timeStr = dt.toLocaleString("th-TH", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      const isOk = log.status >= 200 && log.status < 300;
                      return (
                        <tr key={log.id} className="hover:bg-white/3">
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{timeStr}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold ${
                              isOk ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                            }`}>
                              {isOk ? "✓" : "✗"} {log.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-indigo-300 font-mono">{log.requestModel}</td>
                          <td className="px-3 py-2 text-gray-300 font-mono truncate max-w-[150px]">{log.resolvedModel ?? "—"}</td>
                          <td className="px-3 py-2">
                            {log.provider && <ProviderBadge provider={log.provider} />}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-400">{fmtMs(log.latencyMs)}</td>
                          <td className="px-3 py-2 text-gray-500 truncate max-w-[200px]">
                            {log.error ? (
                              <span className="text-red-400" title={log.error}>{log.error.slice(0, 80)}</span>
                            ) : (
                              <span title={log.userMessage ?? ""}>{log.userMessage?.slice(0, 60) ?? "—"}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* ── Section 7: บันทึกการทำงาน ─────────────────────────────────── */}
        <section id="logs" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500/20 text-gray-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">บันทึกการทำงาน</span>
            <span className="text-xs text-gray-500">{logs.length} รายการล่าสุด</span>
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            <div className="font-mono text-xs divide-y divide-white/5 max-h-[500px] overflow-y-auto">
              {logs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-600">ยังไม่มีบันทึก</div>
              ) : (
                logs.map((log, i) => {
                  const dt = new Date(log.createdAt);
                  const timeStr = dt.toLocaleString("th-TH", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return (
                    <div key={i} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/3">
                      <span className="text-gray-600 shrink-0 w-36">{timeStr}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded border text-xs ${stepBadge[log.step] ?? stepBadge.worker}`}>
                        {log.step}
                      </span>
                      <span className={`${logLevelStyle[log.level] ?? "text-gray-400"} leading-relaxed`}>
                        {log.message}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="text-center text-xs text-gray-700 border-t border-white/5 pt-8 pb-4">
          BCProxyAI — Smart AI Gateway สำหรับ <span className="text-gray-500">OpenClaw</span> และ <span className="text-gray-500">HiClaw</span>
        </footer>

      </div>

      {/* ── Guide Modal ──────────────────────────────────────────────────── */}
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
}
