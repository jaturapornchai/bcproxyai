"use client";

import { useCallback, useEffect, useState } from "react";
import { NavSessionChip } from "../components/NavSessionChip";
import { getAdminAccess } from "../components/admin-access";

/** Parse user message — handle legacy JSON array format from DB */
function parseUserMsg(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("[")) return raw;
  try {
    const arr = JSON.parse(raw) as Array<{ type: string; text?: string }>;
    if (Array.isArray(arr)) {
      return arr.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("") || raw;
    }
  } catch { /* not JSON */ }
  return raw;
}

type RoutingExplain = {
  mode?: string;
  category?: string;
  fallbackUsed?: boolean;
  selected?: { provider?: string; model?: string; reason?: string };
  candidates?: Array<{ provider?: string; model?: string; accepted?: boolean; reason?: string }>;
};

function routingActivity(routingExplain: RoutingExplain | null | undefined): string {
  if (!routingExplain) return "—";
  const candidates = Array.isArray(routingExplain.candidates) ? routingExplain.candidates : [];
  const accepted = candidates.filter((c) => c.accepted).length;
  const mode = routingExplain.mode ? `mode:${routingExplain.mode}` : null;
  const category = routingExplain.category ? `cat:${routingExplain.category}` : null;
  const fallback = routingExplain.fallbackUsed ? "fallback" : null;
  return [mode, category, candidates.length ? `${accepted}/${candidates.length} candidates` : null, fallback]
    .filter(Boolean)
    .join(" · ") || "—";
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}
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
import { SpeedRace } from "../components/SpeedRace";
import { Analytics } from "../components/Analytics";
import type { AnalyticsData } from "../components/Analytics";
import { ComplaintPanel } from "../components/ComplaintPanel";
import { RoutingLearnPanel } from "../components/RoutingLearnPanel";
import { TrendPanel } from "../components/TrendPanel";
import { MascotScene } from "../components/MascotScene";
import { InfraPanel } from "../components/InfraPanel";
import { UptimePanel } from "../components/UptimePanel";
import { CostOptimizerPanel } from "../components/CostOptimizerPanel";
import { SchoolBellPanel } from "../components/SchoolBellPanel";
import { ProviderLimitsPanel } from "../components/ProviderLimitsPanel";
import { SemanticCachePanel } from "../components/SemanticCachePanel";
import { WarmupPanel } from "../components/WarmupPanel";
import { PerfInsightsPanel } from "../components/PerfInsightsPanel";
import { TeachersPanel } from "../components/TeachersPanel";
import { CodegenPanel } from "../components/CodegenPanel";
import { DevSuggestionsPanel } from "../components/DevSuggestionsPanel";
import { ExamLevelPanel } from "../components/ExamLevelPanel";
import { ProviderCatalogPanel } from "../components/ProviderCatalogPanel";
import { ControlRoomPanel } from "../components/ControlRoomPanel";
import { AutopilotPanel } from "../components/AutopilotPanel";
import { RoutingExplainPanel } from "../components/RoutingExplainPanel";
import { ReplayPanel } from "../components/ReplayPanel";

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [models, setModels] = useState<ModelData[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [, setTick] = useState(0);

  interface GatewayLog {
    id: number;
    requestModel: string;
    resolvedModel: string | null;
    provider: string | null;
    status: number;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    error: string | null;
    userMessage: string | null;
    assistantMessage: string | null;
    requestId: string | null;
    clientIp: string | null;
    routingExplain: RoutingExplain | null;
    createdAt: string;
  }
  const [gatewayLogs, setGatewayLogs] = useState<GatewayLog[]>([]);
  const [logDetail, setLogDetail] = useState<GatewayLog | null>(null);

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
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);

  interface ProviderStatus {
    provider: string;
    envVar: string;
    hasKey: boolean;
    hasDbKey: boolean;
    noKeyRequired: boolean;
    modelCount: number;
    availableCount: number;
    status: "active" | "no_key" | "no_models" | "error";
  }
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [circuitsSummary, setCircuitsSummary] = useState<{
    totalOpen: number;
    totalHalfOpen: number;
    totalWarnings: number;
    open: Array<{ provider: string; modelId: string; ttlSec: number; fails: number }>;
  } | null>(null);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    getAdminAccess().then(setIsAdmin);
  }, []);

  // Tick every second for cooldown countdowns
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const isAdmin = await getAdminAccess();
      const [s, m, l, cs, an, ps, cb] = await Promise.all([
        isAdmin ? fetch("/api/status").then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
        fetch("/api/models").then((r) => r.json()),
        fetch("/api/leaderboard").then((r) => r.json()),
        fetch("/api/cost-savings").then((r) => r.json()).catch(() => null),
        fetch("/api/analytics").then((r) => r.json()).catch(() => null),
        isAdmin ? fetch("/api/providers").then((r) => (r.ok ? r.json() : [])).catch(() => []) : Promise.resolve([]),
        // Admin-only — 401 in non-owner sessions; silently ignore so widget
        // just hides for non-admins (auth chain: master/cookie/Google).
        isAdmin ? fetch("/api/admin/circuits").then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
      ]);
      setStatusData(s && typeof s === "object" && "worker" in s ? s : null);
      setModels(Array.isArray(m) ? m : []);
      setLeaderboard(Array.isArray(l) ? l : []);
      if (cs) setCostSavings(cs);
      if (an) setAnalyticsData(an);
      if (Array.isArray(ps)) setProviderStatuses(ps);
      if (cb && cb.summary) {
        setCircuitsSummary({
          totalOpen: cb.summary.totalOpen ?? 0,
          totalHalfOpen: cb.summary.totalHalfOpen ?? 0,
          totalWarnings: cb.summary.totalWarnings ?? 0,
          open: Array.isArray(cb.open) ? cb.open : [],
        });
      } else {
        setCircuitsSummary(null);
      }
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
      if (!(await getAdminAccess())) {
        setGatewayLogs([]);
        return;
      }
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
      if (!(await getAdminAccess())) return;
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
        <div className="w-full px-2 sm:px-3">
          {/* Row 1: Logo + actions */}
          <div className="flex h-12 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg animate-glow-pulse">
                <span className="text-xs font-black text-white">BC</span>
              </div>
              <span className="font-bold text-white tracking-tight">SMLGateway</span>
              <span className="hidden sm:inline text-xs text-gray-500 border border-gray-800 rounded px-2 py-0.5">
                AI Gateway
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NavSessionChip />
              <a
                href="/admin/keys"
                className="px-3 py-1.5 rounded-lg text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 border border-amber-500/30 transition-colors text-xs"
                title="จัดการ API Key ของ gateway (admin only)"
              >
                <span className="mr-1">🔑</span>
                API Keys
              </a>
              <a
                href="/admin/providers"
                className="px-3 py-1.5 rounded-lg text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10 border border-cyan-500/30 transition-colors text-xs"
                title="แก้ base URL ของ provider — เปลี่ยน Ollama port หรือชี้ไป LLM ตัวอื่น"
              >
                <span className="mr-1">🔌</span>
                Providers
              </a>
              <a
                href="/setup"
                className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-xs"
                title="ตั้งค่า API Key"
              >
                <svg className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                ตั้งค่า
              </a>
              <a
                href="/guide"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-xs"
                title="คู่มือการใช้งาน (เปิด tab ใหม่)"
              >
                <svg className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                คู่มือ
              </a>
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
          {/* Row 2: Nav links — wrappable */}
          <div className="flex flex-wrap gap-1 pb-2">
            {[
              { id: "perf",          icon: "⚡",    label: "ประสิทธิภาพ" },
              { id: "gateway-logs",  icon: "\u{1F4DD}", label: "สมุดจดงาน" },
              { id: "codegen",       icon: "\u{1F4BE}", label: "โค้ดระบบ" },
              { id: "dev-suggestions", icon: "\u{1F4A1}", label: "คำแนะนำ Dev" },
              { id: "infra",         icon: "\u{1F3D7}", label: "โครงสร้าง" },
              { id: "status",        icon: "\u{1F3EB}", label: "ครูใหญ่" },
              { id: "exam-level",    icon: "\u{1F39A}", label: "ระดับสอบ" },
              { id: "teachers",      icon: "\u{1F3EB}", label: "คณะครู" },
              { id: "limits",        icon: "\u{1F4CA}", label: "โควต้า" },
              { id: "cache",         icon: "\u{1F9E0}", label: "แคช" },
              { id: "warmup",        icon: "\u{1F525}", label: "อุ่นเครื่อง" },
              { id: "providers",     icon: "\u{1F50C}", label: "ผู้ให้บริการ" },
              { id: "provider-catalog", icon: "\u{1F310}", label: "บัญชีรายชื่อ" },
              { id: "rankings",      icon: "\u{1F3C6}", label: "ผลงาน" },
              { id: "speed-race",    icon: "\u{1F3C1}", label: "วิ่งแข่ง" },
              { id: "analytics",     icon: "\u{1F4CA}", label: "สมุดพก" },
              { id: "all-models",    icon: "\u{1F393}", label: "นักเรียน" },
              { id: "chat",          icon: "\u{1F4AC}", label: "แชท" },
              { id: "smart-routing", icon: "\u{1F9E0}", label: "จัดห้อง" },
              { id: "trend",         icon: "\u{1F4C8}", label: "พัฒนาการ" },
              { id: "uptime",        icon: "\u{1F4CB}", label: "ขาด/ลา" },
              { id: "cost-opt",      icon: "\u{1F4B0}", label: "ค่าเทอม" },
              { id: "school-bell",   icon: "\u{1F514}", label: "ระฆัง" },
              { id: "complaints",    icon: "\u26A0\uFE0F",  label: "ร้องเรียน" },
              { id: "logs",          icon: "\u{1F4D3}", label: "บันทึกครู" },
            ].map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/8 border border-transparent hover:border-white/10 transition-all"
              >
                <span>{link.icon}</span>
                <span>{link.label}</span>
              </a>
            ))}
          </div>
        </div>
      </nav>

      <div className="w-full px-2 sm:px-3 py-3 space-y-3">

        {/* ── First-run banner: ไม่มี API key ใน DB เลย → บอกให้ Setup ก่อน ─── */}
        {providerStatuses.length > 0 && !providerStatuses.some((p) => p.hasDbKey) && (
          <section className="animate-fade-in-up">
            <div className="rounded-xl border-2 border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-5 shadow-lg shadow-amber-500/10">
              <div className="flex items-start gap-4 flex-wrap">
                <span className="text-4xl">🔑</span>
                <div className="flex-1 min-w-[260px]">
                  <div className="font-bold text-amber-200 text-lg mb-1">ยังไม่มี API key เลย!</div>
                  <div className="text-sm text-amber-100/80 mb-2">
                    SMLGateway ต้องมี API key อย่างน้อย 1 provider ถึงจะใช้งานได้ —
                    สมัครฟรีที่ <strong className="text-white">OpenRouter</strong> หรือ <strong className="text-white">Groq</strong> (แนะนำ — ฟรี ใช้ง่าย)
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer"
                       className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors">
                      🌐 สมัคร OpenRouter (ฟรี)
                    </a>
                    <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
                       className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors">
                      🏎 สมัคร Groq (ฟรี — เร็วสุด)
                    </a>
                  </div>
                </div>
                <a
                  href="/setup"
                  className="px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-bold text-sm shadow-lg shadow-amber-500/30 transition-all whitespace-nowrap inline-block"
                >
                  ⚙️ ใส่ API key ตอนนี้
                </a>
              </div>
            </div>
          </section>
        )}

        {/* ── Circuits-open warning (admin only, hidden when healthy) ─── */}
        {circuitsSummary && (circuitsSummary.totalOpen > 0 || circuitsSummary.totalHalfOpen > 0) && (
          <section className="animate-fade-in-up">
            <div className="rounded-xl border-2 border-red-500/40 bg-gradient-to-r from-red-500/10 to-orange-500/10 p-4 shadow-lg shadow-red-500/10">
              <div className="flex items-start gap-3 flex-wrap">
                <span className="text-3xl">🚨</span>
                <div className="flex-1 min-w-[260px]">
                  <div className="font-bold text-red-200 text-base mb-1">
                    Circuits open: {circuitsSummary.totalOpen}
                    {circuitsSummary.totalHalfOpen > 0 && (
                      <span className="ml-2 text-amber-300 text-sm font-normal">
                        + {circuitsSummary.totalHalfOpen} กำลัง probe (half-open)
                      </span>
                    )}
                    {circuitsSummary.totalWarnings > 0 && (
                      <span className="ml-2 text-yellow-300 text-sm font-normal">
                        · {circuitsSummary.totalWarnings} ใกล้ trip
                      </span>
                    )}
                  </div>
                  {circuitsSummary.open.length > 0 && (
                    <div className="text-xs text-red-100/80 font-mono space-y-0.5">
                      {circuitsSummary.open.slice(0, 5).map((e) => (
                        <div key={`${e.provider}/${e.modelId}`}>
                          · {e.provider}/{e.modelId} — {e.fails} fails · reopen ใน {e.ttlSec}s
                        </div>
                      ))}
                      {circuitsSummary.open.length > 5 && (
                        <div className="text-red-300/60">+ อีก {circuitsSummary.open.length - 5} ตัว</div>
                      )}
                    </div>
                  )}
                </div>
                <a
                  href="/api/admin/circuits"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-100 border border-red-500/40 transition-colors text-xs whitespace-nowrap"
                  title="ดู JSON เต็ม"
                >
                  ดูทั้งหมด →
                </a>
              </div>
            </div>
          </section>
        )}

        {/* ── Performance insights (1h rolling) ───────────────────────── */}
        <section id="perf" className="animate-fade-in-up">
          <PerfInsightsPanel />
        </section>

        {isAdmin && (
          <>
            {/* ── Live Gateway Control Room (single-call snapshot) ───────────── */}
            <section id="control-room" className="animate-fade-in-up">
              <ControlRoomPanel />
            </section>

            {/* ── AI Ops Autopilot — rule-based recommendation cards ────────── */}
            <section id="autopilot" className="animate-fade-in-up">
              <AutopilotPanel />
            </section>

            {/* ── Smart Routing Explain — recent decisions trail ────────────── */}
            <section id="routing-explain" className="animate-fade-in-up">
              <RoutingExplainPanel />
            </section>
          </>
        )}

        {/* ── Replay & Compare ─────────────────────────────────────────── */}
        <section id="replay" className="animate-fade-in-up">
          <ReplayPanel />
        </section>

        {/* ── Live Mascot Theater (data-driven from gateway logs) ───────── */}
        {isAdmin && <MascotScene />}

        {/* ── Dev Tools banner — quick links to new endpoints ───────────── */}
        <section className="animate-fade-in-up stagger-0">
          <div className="glass rounded-xl border border-indigo-500/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">🛠</span>
              <span className="font-bold text-white text-lg">เครื่องมือสำหรับนักพัฒนา</span>
              <a href="/guide#dev-tools" target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-indigo-300 hover:text-white">คู่มือเต็ม →</a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-1.5">
              {[
                { path: "/v1/models/search", label: "ค้นหา Model", icon: "🔍" },
                { path: "/v1/compare", label: "เปรียบเทียบ (≤10)", icon: "⚖️" },
                { path: "/v1/structured", label: "ผลลัพธ์ JSON", icon: "📐" },
                { path: "/v1/trace/:id", label: "ติดตามคำขอ", icon: "🔬" },
                { path: "/api/my-stats", label: "สถิติของฉัน", icon: "📊" },
                { path: "/v1/prompts", label: "คลัง Prompt", icon: "📚" },
                { path: "/api/metrics", label: "ตัวชี้วัด Prometheus", icon: "📈" },
              ].map((ep) => (
                <code key={ep.path} className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-gray-900/50 border border-white/5 text-xs">
                  <span>{ep.icon}</span>
                  <span className="text-indigo-300 truncate">{ep.label}</span>
                </code>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              เฮดเดอร์ควบคุม: <code className="text-amber-300">X-SMLGateway-Prefer</code> (เลือก) · <code className="text-amber-300">Exclude</code> (ตัดทิ้ง) · <code className="text-amber-300">Strategy: fastest|strongest</code> (กลยุทธ์) · <code className="text-amber-300">Max-Latency</code> (เวลาตอบสูงสุด)
            </p>
          </div>
        </section>

        {/* ── Gateway Config — moved to /guide page ──────────────────────── */}

        {/* ── Gateway Logs (top of dashboard, wide + big font) ──────────── */}
        {isAdmin && <section id="gateway-logs" className="animate-fade-in-up stagger-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl">📝</span>
            <span className="font-black text-white text-3xl">สมุดจดงาน</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              LIVE
            </span>
            <span className="text-sm text-gray-400">{gatewayLogs.length} หน้า</span>
          </div>

          <div className="glass rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              {gatewayLogs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-600 text-base">ยังไม่มีเด็กมาส่งการบ้าน</div>
              ) : (
                <table className="w-full text-base">
                  <thead className="bg-gray-900/95 backdrop-blur">
                    <tr className="border-b border-white/10 text-gray-400 text-sm uppercase">
                      <th className="px-2 py-1 text-left">เวลา</th>
                      <th className="px-2 py-1 text-left">สถานะ</th>
                      <th className="px-2 py-1 text-left">Request</th>
                      <th className="px-2 py-1 text-left">Resolved</th>
                      <th className="px-2 py-1 text-left">Provider</th>
                      <th className="px-2 py-1 text-right">Latency</th>
                      <th className="px-2 py-1 text-right">In/Out</th>
                      <th className="px-2 py-1 text-left">กิจกรรม</th>
                      <th className="px-2 py-1 text-left">ขาเข้า / ขาออก</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {gatewayLogs.map((log) => {
                      const raw = log.createdAt.includes("Z") || log.createdAt.includes("+") ? log.createdAt : log.createdAt + "Z";
                      const dt = new Date(raw);
                      const timeStr = dt.toLocaleString("th-TH", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
                      const isOk = log.status >= 200 && log.status < 300;
                      return (
                        <tr key={log.id} className="hover:bg-white/5">
                          <td className="px-2 py-1 text-gray-400 whitespace-nowrap font-mono">{timeStr}</td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-base font-bold ${
                              isOk ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                            }`}>
                              {isOk ? "✓" : "✗"} {log.status}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-indigo-300 font-mono">{log.requestModel}</td>
                          <td className="px-2 py-1 text-gray-200 font-mono truncate max-w-[260px]">{log.resolvedModel ?? "—"}</td>
                          <td className="px-2 py-1">
                            {log.provider ? <ProviderBadge provider={log.provider} /> : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-2 py-1 text-right text-gray-300 font-mono">{fmtMs(log.latencyMs)}</td>
                          <td className="px-2 py-1 text-right text-gray-400 font-mono whitespace-nowrap">
                            {log.inputTokens.toLocaleString()} / {log.outputTokens.toLocaleString()}
                          </td>
                          <td className="px-2 py-1 text-gray-400 min-w-[220px]">
                            <div className="text-xs leading-relaxed">
                              <div>{routingActivity(log.routingExplain)}</div>
                              <div className="text-gray-600 font-mono">req:{shortId(log.requestId)}</div>
                            </div>
                          </td>
                          <td className="px-2 py-1 text-gray-300 min-w-[520px]">
                            <button
                              className="block text-left hover:text-white transition-colors cursor-pointer w-full"
                              onClick={() => setLogDetail(log)}
                            >
                              {log.error ? (
                                <span className="text-red-400 line-clamp-2">{log.error.slice(0, 220)}</span>
                              ) : (
                                <span className="space-y-0.5">
                                  <span className="block text-cyan-200 line-clamp-2">→ {parseUserMsg(log.userMessage)?.slice(0, 180) ?? "—"}</span>
                                  <span className="block text-emerald-200/80 line-clamp-2">← {log.assistantMessage?.slice(0, 180) ?? "stream/ไม่มีข้อความที่บันทึก"}</span>
                                </span>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>}

        {/* ── Code Generation Log (moved to top — after gateway logs) ──── */}
        <section id="codegen" className="animate-fade-in-up stagger-0">
          <CodegenPanel />
        </section>

        {/* ── Dev Suggestions (things AI can't fix — human dev needs to) ── */}
        {isAdmin && <section id="dev-suggestions" className="animate-fade-in-up stagger-0">
          <DevSuggestionsPanel />
        </section>}

        {/* ── Infrastructure Monitoring ────────────────────────────────── */}
        {isAdmin && <section id="infra" className="animate-fade-in-up stagger-0">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">โครงสร้างระบบ</span>
            <span className="text-xs text-gray-400 ml-1">Postgres · Valkey · Replicas · Rate Limit</span>
          </div>
          <InfraPanel />
        </section>}

        {/* ── Section 1: Header + Worker Status ──────────────────────────── */}
        <section id="status" className="animate-fade-in-up">
          {/* Title */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-4 px-4 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-xs text-indigo-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-400" />
              </span>
              ห้องเรียน AI กำลังเปิดสอน
            </div>
            <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-white mb-3">
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent animate-gradient">
                SMLGateway
              </span>
            </h1>
            <p className="text-gray-400 text-lg">โรงเรียน AI — คัดเด็กเก่งฟรีให้ทำงานแทนคุณ 🏫</p>
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
                    <span className="font-bold text-white text-lg">ครูใหญ่</span>
                    <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${
                      workerStatus === "running" ? "bg-yellow-500/20 text-yellow-300" :
                      workerStatus === "idle"    ? "bg-indigo-500/20 text-indigo-300" :
                                                  "bg-red-500/20 text-red-300"
                    }`}>
                      {workerStatus === "running" ? "🟡 กำลังตรวจการบ้าน" :
                       workerStatus === "idle"    ? "🟢 นั่งเฝ้าห้อง" :
                                                   "🔴 ไปพักเบรก"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-gray-500">
                    <div className="flex gap-4">
                      <span>เช็คชื่อล่าสุด: <span className="text-gray-300">{fmtTime(statusData?.worker?.lastRun ?? null)}</span></span>
                      <span>เช็คชื่อถัดไป: <span className="text-gray-300">{fmtTime(statusData?.worker?.nextRun ?? null)}</span></span>
                    </div>
                    {statusData?.worker?.judgeModel && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-600">ตรวจด้วย:</span>
                        <span className="text-cyan-400 font-mono">{statusData?.worker?.judgeModel}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                      {statusData?.worker?.nextRun && workerStatus !== "running" && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-indigo-400">⏱</span>
                          <span className="text-indigo-300 font-medium">{fmtCountdown(statusData?.worker?.nextRun ?? null)}</span>
                        </div>
                      )}
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
                  สั่งเช็คชื่อเลย!
                </button>
              </div>
            </div>
          </div>

          {/* Gateway Config — ย้ายไปเป็น section แยก #gateway-config */}

          {/* Cost Savings Card */}
          {costSavings && costSavings.totalTokens > 0 && (
            <div className="mt-6 glass-bright rounded-2xl p-5 neon-border max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">💰</span>
                  <span className="font-bold text-white text-lg">ใบเสร็จค่าเทอม</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>สะสม {costSavings.totalRequests.toLocaleString()} requests</span>
                  <span>|</span>
                  <span>วันนี้ {costSavings.todayRequests.toLocaleString()}</span>
                </div>
              </div>

              {/* Token usage summary */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <span className="text-gray-500">ใช้ไป:</span>
                <span className="text-indigo-300 font-bold">{(costSavings.totalTokens / 1000).toFixed(0)}K tokens</span>
                <span className="text-gray-600">(input {(costSavings.totalInputTokens / 1000).toFixed(0)}K + output {(costSavings.totalOutputTokens / 1000).toFixed(0)}K)</span>
              </div>

              {/* Cost comparison — dynamic from API */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                {(costSavings.providers ?? []).map((p) => (
                  <div key={p.id} className="glass rounded-lg p-3 text-center">
                    <div className="text-xs text-gray-500 mb-1 truncate">{p.label}</div>
                    <div className="text-lg font-bold text-red-400">${p.cost.toFixed(2)}</div>
                    <div className="text-xs text-red-500/60">฿{p.costThb.toFixed(0)}</div>
                    <div className="text-[10px] text-gray-600 mt-1">${p.inputPrice}/${p.outputPrice} /1M</div>
                  </div>
                ))}
                <div className="glass rounded-lg p-3 text-center border border-emerald-500/30 bg-emerald-500/5">
                  <div className="text-xs text-emerald-400 mb-1">SMLGateway</div>
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
                      <div className="text-lg font-black text-emerald-300">${p.cost.toFixed(2)}</div>
                      <div className="text-xs text-emerald-500">฿{p.costThb.toFixed(0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Stats Cards */}
          <StatsCards stats={stats} loading={loading} />
        </section>

        {/* ── Exam Level Selector — เลือกระดับยาก/ง่าย + ดูตัวอย่างข้อสอบ ── */}
        <section id="exam-level" className="animate-fade-in-up stagger-1">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🎚</span>
            <span className="font-bold text-white text-2xl">ระดับสอบ</span>
            <span className="text-xs text-gray-400 ml-1">ตั้งระดับความยาก · ดูข้อสอบ · สั่งสอบใหม่ทุกคน</span>
          </div>
          <ExamLevelPanel />
        </section>

        {/* ── Provider Catalog — Auto-Discovery ─────────────────────────── */}
        <section id="provider-catalog" className="animate-fade-in-up stagger-1">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🌐</span>
            <span className="font-bold text-white text-2xl">บัญชีรายชื่อผู้ให้บริการ</span>
            <span className="text-xs text-gray-400 ml-1">ระบบค้นหาผู้ให้บริการใหม่จากอินเทอร์เน็ตอัตโนมัติ</span>
          </div>
          <ProviderCatalogPanel />
        </section>

        {/* ── Teacher Hierarchy ───────────────────────────────────────── */}
        <section id="teachers" className="animate-fade-in-up stagger-1">
          <TeachersPanel />
        </section>

        {/* ── Provider Limits (TPM/TPD) ──────────────────────────────── */}
        {isAdmin && <section id="limits" className="animate-fade-in-up stagger-1">
          <ProviderLimitsPanel />
        </section>}

        {/* ── Semantic Cache Stats ───────────────────────────────────── */}
        {isAdmin && <section id="cache" className="animate-fade-in-up stagger-1">
          <SemanticCachePanel />
        </section>}

        {/* ── Warmup Worker Stats ────────────────────────────────────── */}
        {isAdmin && <section id="warmup" className="animate-fade-in-up stagger-1">
          <WarmupPanel />
        </section>}

        {/* ── Provider Status — ทุก provider ──────────────────────────── */}
        <section id="providers" className="animate-fade-in-up stagger-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </span>
              ผู้ให้บริการทั้งหมด
            </h2>
            <span className="text-sm text-gray-500">
              {providerStatuses.filter(p => p.status === "active").length}/{providerStatuses.length} ใช้งานได้
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            {providerStatuses.map((p) => {
              const c = PROVIDER_COLORS[p.provider] ?? { text: "text-gray-300", bg: "bg-gray-700/40", border: "border-gray-600/40", glow: "rgba(156,163,175,0.5)" };
              const statusConfig = ({
                active:    { icon: "\u2705", label: `${p.availableCount}/${p.modelCount} models`, border: "border-emerald-500/30", bg: "bg-emerald-500/5" },
                no_key:    { icon: "\u{1F511}", label: "ยังไม่มี Key", border: "border-amber-500/30", bg: "bg-amber-500/5" },
                no_models: { icon: "\u23F3", label: "มี key — รอ scan", border: "border-cyan-500/30", bg: "bg-cyan-500/5" },
                error:     { icon: "\u{1F6A8}", label: `${p.modelCount} models (offline)`, border: "border-red-500/30", bg: "bg-red-500/5" },
                disabled:  { icon: "\u{1F6AB}", label: "ปิดใช้งานเอง", border: "border-gray-500/30", bg: "bg-gray-500/5" },
              } as Record<string, { icon: string; label: string; border: string; bg: string }>)[p.status]
                ?? { icon: "?", label: p.status, border: "border-gray-500/30", bg: "bg-gray-500/5" };

              return (
                <div
                  key={p.provider}
                  className={`glass rounded-xl p-4 border ${statusConfig.border} ${statusConfig.bg} hover:scale-[1.02] transition-transform cursor-pointer`}
                  onClick={() => { if (p.status !== "active") window.location.href = "/setup"; }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <ProviderBadge provider={p.provider} />
                    <span className="text-sm">{statusConfig.icon}</span>
                  </div>
                  <div className={`text-sm font-semibold capitalize ${c.text} mb-1`}>{p.provider}</div>
                  <div className="text-xs text-gray-500">{statusConfig.label}</div>
                  {p.status === "no_key" && (
                    <div className="mt-2 text-[11px] text-amber-300 font-medium">
                      {"\u2699\uFE0F"} กดเพื่อตั้งค่า
                    </div>
                  )}
                  {p.status === "error" && (
                    <div className="mt-2 text-[11px] text-red-300 font-medium">
                      มี key แล้ว — model offline
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Model Changes Alert — แบบโรงเรียน ────────────────────────── */}
        {statusData?.modelChanges && (
          (statusData.modelChanges.new.length > 0 || statusData.modelChanges.missing.length > 0 || statusData.modelChanges.warning.length > 0 || (statusData.modelChanges.expelled?.length ?? 0) > 0) && (
            <section className="animate-fade-in-up space-y-3">
              {/* นักเรียนใหม่ย้ายมา */}
              {statusData.modelChanges.new.length > 0 && (
                <div className="glass rounded-2xl p-4 border border-emerald-500/30 bg-emerald-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🎒</span>
                    <span className="font-bold text-emerald-400">นักเรียนใหม่ย้ายมา! ({statusData.modelChanges.new.length})</span>
                    <span className="text-xs text-gray-500">ภายใน 24 ชม. — ยินดีต้อนรับ!</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.new.map((m) => (
                      <span key={m.id} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:scale-105 transition-transform cursor-default ${
                        m.checked
                          ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                          : "bg-gray-500/10 border border-gray-500/20 text-gray-400"
                      }`}>
                        {m.checked ? (
                          <span className="h-2 w-2 rounded-full bg-emerald-400" title="ตรวจสุขภาพแล้ว" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-gray-500 animate-pulse" title="รอตรวจสุขภาพ" />
                        )}
                        {m.name}
                        <span className={`text-xs ${m.checked ? "text-emerald-500/60" : "text-gray-600"}`}>({m.provider})</span>
                        {m.checked && <span className="text-[10px] text-emerald-500/70">✓</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* โดดเรียน */}
              {statusData.modelChanges.warning.length > 0 && (
                <div className="glass rounded-2xl p-4 border border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🏃</span>
                    <span className="font-bold text-amber-400">โดดเรียน! ({statusData.modelChanges.warning.length})</span>
                    <span className="text-xs text-gray-500">หายไป 2-48 ชม. — อาจแอบไปนอนหลับ</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.warning.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300 hover:scale-105 transition-transform cursor-default">
                        <span className="text-xs">💤</span>
                        {m.name}
                        <span className="text-xs text-amber-500/60">({m.provider})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* ลาออกจากโรงเรียน (2-7 วัน) */}
              {statusData.modelChanges.missing.length > 0 && (
                <div className="glass rounded-2xl p-4 border border-red-500/30 bg-red-500/5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">🪦</span>
                    <span className="font-bold text-red-400">ลาออกจากโรงเรียน ({statusData.modelChanges.missing.length})</span>
                    <span className="text-xs text-gray-500">หายไป 2-7 วัน — ยังมีหวังกลับมา</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.missing.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 line-through opacity-60 hover:opacity-100 transition-opacity cursor-default">
                        <span className="text-xs">👋</span>
                        {m.name}
                        <span className="text-xs text-red-500/60">({m.provider})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* โดนไล่ออก (>7 วัน) — แสดงเสมอแม้ว่าง เพื่อให้รู้ว่ามี bucket นี้ */}
              <div className="glass rounded-2xl p-4 border border-rose-700/40 bg-gradient-to-br from-rose-950/40 to-black/60">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg animate-shake">⛔</span>
                  <span className="font-bold text-rose-500">
                    โดนไล่ออก! ({statusData.modelChanges.expelled?.length ?? 0})
                  </span>
                  <span className="text-xs text-gray-500">
                    หายเกิน 7 วัน — ต้องสมัครเรียนใหม่ถึงจะกลับมาได้
                  </span>
                </div>
                {(statusData.modelChanges.expelled?.length ?? 0) === 0 ? (
                  <div className="text-xs text-gray-600 italic px-1">
                    🎉 ยังไม่มีนักเรียนโดนไล่ออก — ทุกคนยังมาเรียนสม่ำเสมอ
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {statusData.modelChanges.expelled?.map((m) => {
                      const lastSeen = m.lastSeen ? new Date(m.lastSeen) : null;
                      const daysAgo = lastSeen
                        ? Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24))
                        : null;
                      return (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/50 border border-rose-700/40 text-sm text-rose-400 line-through opacity-50 hover:opacity-90 transition-all grayscale hover:grayscale-0 cursor-default"
                          title={`หายไป ${daysAgo ?? "?"} วัน`}
                        >
                          <span className="text-xs">🚷</span>
                          {m.name}
                          <span className="text-xs text-rose-600/70">({m.provider})</span>
                          {daysAgo !== null && (
                            <span className="text-[10px] text-rose-700/80 font-mono">
                              -{daysAgo}d
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
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
              ผลงาน — ใครเก่งสุด?
            </h2>
            <span className="text-sm text-gray-500">{leaderboard.length} โมเดล</span>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="glass rounded-2xl p-12 text-center text-gray-500">
              <div className="text-5xl mb-3">🏆</div>
              <p>ยังไม่มีข้อมูล — กด &quot;สั่งเช็คชื่อเลย!&quot; เพื่อเริ่มสแกน</p>
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
                    <th className="px-3 py-3 text-left hidden lg:table-cell">ความถนัด</th>
                    <th className="px-4 py-3 text-right hidden md:table-cell">ความเร็ว</th>
                    <th className="px-4 py-3 text-right hidden lg:table-cell">ขนาด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {leaderboard.map((entry, i) => {
                    // Category badge colors
                    const catColors: Record<string, string> = {
                      thai: "bg-emerald-500/20 text-emerald-300",
                      code: "bg-blue-500/20 text-blue-300",
                      math: "bg-purple-500/20 text-purple-300",
                      instruction: "bg-cyan-500/20 text-cyan-300",
                      creative: "bg-pink-500/20 text-pink-300",
                      knowledge: "bg-amber-500/20 text-amber-300",
                      vision: "bg-violet-500/20 text-violet-300",
                      audio: "bg-rose-500/20 text-rose-300",
                    };
                    const catEmoji: Record<string, string> = {
                      thai: "\u0E44\u0E17\u0E22", code: "</>", math: "\u03C0",
                      instruction: "\u2611", creative: "\u270D", knowledge: "\u{1F4D6}",
                      vision: "\u{1F441}", audio: "\u{1F3B5}",
                    };
                    // Top 3 categories sorted by score
                    const cats = entry.categories ? Object.entries(entry.categories)
                      .filter(([, s]) => s > 0)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 4) : [];

                    return (
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
                        <div className="text-xs text-gray-600 mt-0.5">{entry.questionsAnswered} ข้อ</div>
                      </td>
                      <td className="px-3 py-4 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {cats.map(([cat, score]) => (
                            <span key={cat} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${catColors[cat] ?? "bg-gray-500/20 text-gray-300"}`}>
                              {catEmoji[cat] ?? cat} {score.toFixed(0)}
                            </span>
                          ))}
                          {entry.supportsVision && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-violet-500/20 text-violet-300">
                              👁
                            </span>
                          )}
                        </div>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Section 3.5: Speed Race ──────────────────────────────────────── */}
        <SpeedRace models={deduped} loading={loading} />

        {/* ── Section 3.6: Charts & Analytics ─────────────────────────────── */}
        <Analytics data={analyticsData} />

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
            <h2 className="text-2xl font-bold text-white">แชท</h2>
          </div>
          <ChatPanel availableModels={availableModels} />
        </section>

        {/* ── Section: Smart Auto-Routing ───────────────────────────────── */}
        <section id="smart-routing" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">จัดห้องเรียนอัตโนมัติ</span>
            <span className="text-xs text-gray-400 ml-1">ครูเลือกเด็กเก่งให้ตามวิชา</span>
          </div>
          <RoutingLearnPanel />
        </section>

        {/* ── Section: Model Performance Trend ─────────────────────────────── */}
        <section id="trend" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">พัฒนาการนักเรียน</span>
            <span className="text-xs text-gray-400 ml-1">เก่งขึ้นหรือแย่ลง?</span>
          </div>
          <TrendPanel />
        </section>

        {/* ── Section: Provider Uptime ─────────────────────────────────────── */}
        <section id="uptime" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">สถิติขาด/ลา/มาสาย</span>
            <span className="text-xs text-gray-400 ml-1">Provider ไหนขยัน ไหนขี้เกียจ</span>
          </div>
          <UptimePanel />
        </section>

        {/* ── Section: Token Cost Optimizer ─────────────────────────────────── */}
        <section id="cost-opt" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">ค่าเทอม</span>
            <span className="text-xs text-gray-400 ml-1">ใช้ไปเท่าไหร่ ประหยัดได้อีก!</span>
          </div>
          <CostOptimizerPanel />
        </section>

        {/* ── Section: School Bell ─────────────────────────────────────────── */}
        <section id="school-bell" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/20 text-yellow-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">ระฆังโรงเรียน</span>
            <span className="text-xs text-gray-400 ml-1">School Bell Alert</span>
          </div>
          <SchoolBellPanel />
        </section>

        {/* ── Section: Complaint System ─────────────────────────────────── */}
        {isAdmin && <section id="complaints" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/20 text-red-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">ใบร้องเรียน — เด็กไหนเกเร?</span>
            <span className="text-xs text-gray-400 ml-1">ฟ้องครูเลย!</span>
          </div>
          <ComplaintPanel />
        </section>}


        {/* ── Section 7: บันทึกการทำงาน ─────────────────────────────────── */}
        <section id="logs" className="animate-fade-in-up stagger-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gray-500/20 text-gray-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </span>
            <span className="font-bold text-white text-2xl">บันทึกประจำวันของครู</span>
            <span className="text-xs text-gray-500">{logs.length} รายการล่าสุด</span>
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            <div className="font-mono text-xs divide-y divide-white/5">
              {logs.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-600">ครูยังไม่ได้จดอะไร</div>
              ) : (
                logs.map((log, i) => {
                  const rawLog = log.createdAt.includes("Z") || log.createdAt.includes("+") ? log.createdAt : log.createdAt + "Z";
                  const dt = new Date(rawLog);
                  const timeStr = dt.toLocaleString("th-TH", { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
          SMLGateway — โรงเรียน AI ที่คัดแต่เด็กเก่ง 🏫 สำหรับ <span className="text-gray-500">OpenClaw</span> และ <span className="text-gray-500">HiClaw</span>
        </footer>

      </div>

      {/* ── Guide Modal ──────────────────────────────────────────────────── */}

      {/* ── Log Detail Modal ─────────────────────────────────────────────── */}
      {logDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setLogDetail(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl max-w-5xl w-full mx-4 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                  logDetail.status >= 200 && logDetail.status < 300 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                }`}>
                  {logDetail.status}
                </span>
                {logDetail.provider && <ProviderBadge provider={logDetail.provider} />}
                <span className="text-gray-500 text-xs">{fmtMs(logDetail.latencyMs)}</span>
              </div>
              <button onClick={() => setLogDetail(null)} className="text-gray-500 hover:text-white text-lg cursor-pointer">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Request ID</div>
                  <div className="text-sm text-gray-200 font-mono break-all">{logDetail.requestId ?? "—"}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Client</div>
                  <div className="text-sm text-gray-200 font-mono break-all">{logDetail.clientIp ?? "—"}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Tokens ขาเข้า/ขาออก</div>
                  <div className="text-sm text-gray-200 font-mono">
                    {logDetail.inputTokens.toLocaleString()} / {logDetail.outputTokens.toLocaleString()}
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Model routing</div>
                <div className="text-sm text-indigo-300 font-mono break-all">{logDetail.requestModel} → {logDetail.resolvedModel ?? "—"}</div>
                <div className="text-xs text-gray-500 mt-1">{routingActivity(logDetail.routingExplain)}</div>
              </div>
              {logDetail.error && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Error</div>
                  <div className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3 font-mono whitespace-pre-wrap break-all">{logDetail.error}</div>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-xs text-cyan-300 mb-1">ขาเข้า: ข้อความผู้ใช้</div>
                  <div className="text-sm text-gray-200 bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3 whitespace-pre-wrap break-all min-h-32">
                  {parseUserMsg(logDetail.userMessage) ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-emerald-300 mb-1">ขาออก: คำตอบ AI / ผลลัพธ์</div>
                  <div className="text-sm text-gray-200 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 whitespace-pre-wrap break-all min-h-32">
                    {logDetail.assistantMessage ?? "stream/ไม่มีข้อความที่บันทึก"}
                  </div>
                </div>
              </div>
              {logDetail.routingExplain && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">กิจกรรม routing ทั้งหมด</div>
                  <div className="text-xs text-gray-300 bg-black/30 rounded-lg p-3 font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
                    {JSON.stringify(logDetail.routingExplain, null, 2)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
