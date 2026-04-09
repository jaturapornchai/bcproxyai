"use client";

import { useCallback, useEffect, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface K6Run {
  script: string;
  at: string;
  checks: { passes?: number; fails?: number };
  metrics: {
    http_reqs?: number;
    http_req_failed_rate?: number;
    p95?: number;
    p99?: number;
    avg?: number;
  };
  duration?: number;
  vus?: number;
}

interface InfraData {
  postgres: {
    ok: boolean;
    version: string;
    dbSizeBytes: number;
    connections: number;
    maxConnections: number;
    slowQueries: number;
  };
  redis: {
    ok: boolean;
    engine: string;
    version: string;
    memoryUsedBytes: number;
    keysTotal: number;
    uptimeSec: number;
    hits: number;
    misses: number;
    hitRatePct: number;
  };
  replicas: {
    count: number;
    instances: Array<{ hostname: string; startedAt: string; pid: number; ageSec: number }>;
  };
  rateLimit: {
    activeClients: number;
    topClients: Array<{ ip: string; count: number }>;
  };
  cooldowns: {
    providerCount: number;
    modelCount: number;
    totalModels: number;
    providers: Array<{ provider: string; reason: string; ttlSec: number }>;
  };
  failureStreaks: Array<{ provider: string; count: number }>;
  workerLeader: { hostname: string | null; ttlSec: number };
  k6: {
    scripts: Array<{ name: string; description: string }>;
    lastRuns: K6Run[];
    latest: K6Run | null;
  };
  serverTime: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function fmtTtl(sec: number): string {
  if (sec <= 0) return "หมดอายุ";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

// ─── Sub-cards ────────────────────────────────────────────────────────────────

function CardShell({ children, accent = "indigo" }: { children: React.ReactNode; accent?: string }) {
  const borders: Record<string, string> = {
    indigo: "border-indigo-500/25",
    red:    "border-red-500/25",
    cyan:   "border-cyan-500/25",
    amber:  "border-amber-500/25",
    emerald:"border-emerald-500/25",
  };
  return (
    <div
      className={`glass rounded-xl p-4 border ${borders[accent] ?? borders.indigo} flex flex-col gap-2 h-full`}
    >
      {children}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`}
    />
  );
}

function MiniBar({ pct, color = "bg-indigo-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-1.5 bg-white/8 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${color} transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

// ── Postgres card ─────────────────────────────────────────────────────────────
function PostgresCard({ d }: { d: InfraData["postgres"] }) {
  const connPct = d.maxConnections > 0 ? (d.connections / d.maxConnections) * 100 : 0;
  const connColor = connPct > 80 ? "bg-red-500" : connPct > 50 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <CardShell accent="indigo">
      <div className="flex items-center gap-2">
        <span className="text-xl">🐘</span>
        <span className="font-bold text-white text-sm">Postgres</span>
        <StatusDot ok={d.ok} />
      </div>
      {d.ok ? (
        <>
          <div className="text-xs text-gray-400">{d.version}</div>
          <div className="text-xs text-gray-300">
            ขนาด DB: <span className="text-indigo-300 font-medium">{fmtBytes(d.dbSizeBytes)}</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>การเชื่อมต่อ</span>
              <span className={connPct > 80 ? "text-red-300" : "text-gray-300"}>
                {d.connections}/{d.maxConnections}
              </span>
            </div>
            <MiniBar pct={connPct} color={connColor} />
          </div>
          {d.slowQueries > 0 && (
            <div className="text-xs text-red-400 font-medium">
              ⚠️ query ช้า: {d.slowQueries} รายการ
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-red-400">ไม่สามารถเชื่อมต่อได้</div>
      )}
    </CardShell>
  );
}

// ── Redis/Valkey card ─────────────────────────────────────────────────────────
function RedisCard({ d }: { d: InfraData["redis"] }) {
  const isValkey = d.engine === "Valkey";
  return (
    <CardShell accent="red">
      <div className="flex items-center gap-2">
        <span className="text-xl">{isValkey ? "🔷" : "🔴"}</span>
        <span className="font-bold text-white text-sm">{d.engine ?? "Redis"}</span>
        <StatusDot ok={d.ok} />
      </div>
      {d.ok ? (
        <>
          <div className="text-xs text-gray-400">v{d.version} · ทำงานมา {fmtUptime(d.uptimeSec)}</div>
          <div className="text-xs text-gray-300">
            หน่วยความจำ: <span className="text-red-300 font-medium">{fmtBytes(d.memoryUsedBytes)}</span>
            <span className="text-gray-500 mx-1">·</span>
            Keys: <span className="text-red-300 font-medium">{d.keysTotal.toLocaleString()}</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>อัตราการ cache hit</span>
              <span className={d.hitRatePct >= 80 ? "text-emerald-300" : "text-amber-300"}>
                {d.hitRatePct}%
              </span>
            </div>
            <MiniBar
              pct={d.hitRatePct}
              color={d.hitRatePct >= 80 ? "bg-emerald-500" : "bg-amber-500"}
            />
          </div>
        </>
      ) : (
        <div className="text-xs text-red-400">ไม่สามารถเชื่อมต่อได้</div>
      )}
    </CardShell>
  );
}

// ── Replicas card ─────────────────────────────────────────────────────────────
function ReplicasCard({ d, leader }: { d: InfraData["replicas"]; leader: string | null }) {
  return (
    <CardShell accent="cyan">
      <div className="flex items-center gap-2">
        <span className="text-xl">🔄</span>
        <span className="font-bold text-white text-sm">เซิร์ฟเวอร์</span>
      </div>
      <div className="text-3xl font-black text-cyan-300 leading-none">{d.count}</div>
      {d.count === 1 ? (
        <div className="text-xs text-gray-500">instance เดียว</div>
      ) : (
        <div className="text-xs text-gray-500">{d.count} containers กำลังทำงาน</div>
      )}
      <div className="flex flex-col gap-1 mt-1">
        {d.instances.slice(0, 5).map((r) => (
          <div key={r.hostname} className="flex items-center gap-1.5 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
            <span className="font-mono text-gray-300 truncate max-w-[80px]" title={r.hostname}>
              {r.hostname.slice(0, 12)}
            </span>
            {r.hostname === leader && (
              <span title="worker leader">👑</span>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Rate Limit card ───────────────────────────────────────────────────────────
function RateLimitCard({ d }: { d: InfraData["rateLimit"] }) {
  return (
    <CardShell accent="amber">
      <div className="flex items-center gap-2">
        <span className="text-xl">🛡️</span>
        <span className="font-bold text-white text-sm">จำกัดคำขอ</span>
      </div>
      <div className="text-3xl font-black text-amber-300 leading-none">{d.activeClients}</div>
      <div className="text-xs text-gray-500">IP ที่กำลังถูก track</div>
      {d.activeClients === 0 ? (
        <div className="text-xs text-emerald-400">ไม่มีการ throttle ตอนนี้</div>
      ) : (
        <div className="flex flex-col gap-1 mt-1">
          {d.topClients.slice(0, 3).map((c) => (
            <div key={c.ip} className="flex items-center justify-between text-xs">
              <span className="font-mono text-gray-400 truncate max-w-[80px]">{c.ip}</span>
              <span className="text-amber-300 font-bold">{c.count}</span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

// ── Cooldowns table ───────────────────────────────────────────────────────────
function CooldownsCard({ d }: { d: InfraData["cooldowns"] }) {
  const modelPct =
    d.totalModels > 0 ? Math.round((d.modelCount / d.totalModels) * 100) : 0;
  return (
    <CardShell accent="indigo">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="font-bold text-white text-sm">Cooldowns</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-400">
          <span>
            <span className="text-amber-300 font-bold">{d.providerCount}</span> providers
          </span>
          <span className="text-gray-600">·</span>
          <span>
            <span className="text-amber-300 font-bold">{d.modelCount}</span>
            <span className="text-gray-600">/{d.totalModels}</span> models
            {d.totalModels > 0 && (
              <span className="text-gray-600"> ({modelPct}%)</span>
            )}
          </span>
        </div>
      </div>
      {d.providerCount === 0 ? (
        <div className="text-sm text-emerald-400 py-2">
          ทุก provider พร้อมใช้งาน 🎉
          {d.modelCount > 0 && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              มี {d.modelCount} model ระดับ model-cooldown แต่ provider ทั้งหมดยังใช้ได้
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1 font-medium">Provider</th>
                <th className="text-left py-1 font-medium">เหตุผล</th>
                <th className="text-right py-1 font-medium">TTL</th>
              </tr>
            </thead>
            <tbody>
              {d.providers.map((p) => (
                <tr key={p.provider} className="border-b border-white/5">
                  <td className="py-1 text-indigo-300 font-medium">{p.provider}</td>
                  <td className="py-1 text-gray-400 max-w-[140px] truncate" title={p.reason}>
                    {p.reason.slice(0, 30) || "—"}
                  </td>
                  <td
                    className={`py-1 text-right font-mono font-bold ${
                      p.ttlSec < 60 ? "text-red-400" : "text-amber-300"
                    }`}
                  >
                    {fmtTtl(p.ttlSec)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

// ── Failure Streaks card ──────────────────────────────────────────────────────
function FailureStreaksCard({ d }: { d: InfraData["failureStreaks"] }) {
  return (
    <CardShell accent="red">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">📉</span>
        <span className="font-bold text-white text-sm">ความล้มเหลวต่อเนื่อง</span>
      </div>
      {d.length === 0 ? (
        <div className="text-sm text-emerald-400 py-2">ทุก provider ทำงานปกติ</div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {d.map((s) => (
            <span
              key={s.provider}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-xs text-red-300 font-medium"
            >
              {s.provider} ×{s.count}
            </span>
          ))}
        </div>
      )}
    </CardShell>
  );
}

// ─── K6 Card ──────────────────────────────────────────────────────────────────
function K6Card({ d }: { d: InfraData["k6"] }) {
  const scriptsCount = d.scripts.length;
  const ranCount = d.lastRuns.length;
  const latest = d.latest;

  const fmtAgo = (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <CardShell accent="cyan">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧪</span>
          <span className="font-bold text-white">ทดสอบโหลด</span>
        </div>
        <span
          className={`h-2 w-2 rounded-full ${
            ranCount > 0 ? "bg-cyan-400" : "bg-gray-600"
          }`}
        />
      </div>

      <div className="text-3xl font-bold text-cyan-300">
        {ranCount}
        <span className="text-sm text-gray-500 font-normal">/{scriptsCount}</span>
      </div>
      <div className="text-[10px] text-gray-500">สคริปต์ที่รันแล้ว / ทั้งหมด</div>

      {latest ? (
        <div className="mt-2 text-xs space-y-0.5">
          <div className="text-gray-300 font-medium">
            <span className="text-cyan-400">{latest.script}</span>
            <span className="text-gray-600"> · {fmtAgo(latest.at)}</span>
          </div>
          {latest.metrics.p95 !== undefined && (
            <div className="text-gray-500">
              p95 <span className="text-gray-300">{Math.round(latest.metrics.p95)}ms</span>
              {latest.metrics.http_reqs !== undefined && (
                <>
                  {" · "}
                  <span className="text-gray-300">{latest.metrics.http_reqs}</span> req
                </>
              )}
            </div>
          )}
          {(latest.checks.passes !== undefined || latest.checks.fails !== undefined) && (
            <div className="text-gray-500">
              ✓ <span className="text-emerald-400">{latest.checks.passes ?? 0}</span>{" "}
              ✗ <span className="text-rose-400">{latest.checks.fails ?? 0}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-gray-600">
          รัน <code className="text-cyan-400">npm run loadtest:smoke</code> เพื่อเริ่มทดสอบ
        </div>
      )}
    </CardShell>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function InfraPanel() {
  const [data, setData] = useState<InfraData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [fetchFlash, setFetchFlash] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/infra", { cache: "no-store" });
      if (res.ok) {
        setData(await res.json());
        setLastFetch(new Date());
        setFetchFlash(true);
        setTimeout(() => setFetchFlash(false), 300);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 2_000); // realtime-ish: poll every 2s
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="text-gray-500 text-center py-8">กำลังโหลดข้อมูลโครงสร้างระบบ...</div>
    );
  }
  if (!data) return null;

  // ── Overall health badge ──────────────────────────────────────────────────
  const systemOk = data.postgres.ok && data.redis.ok;
  const hasCooldowns = data.cooldowns.providerCount > 0;

  let healthBadge: { icon: string; label: string; cls: string };
  if (!systemOk) {
    healthBadge = {
      icon: "🔴",
      label: "ระบบมีปัญหา",
      cls: "bg-red-500/15 border-red-500/40 text-red-300",
    };
  } else if (hasCooldowns) {
    healthBadge = {
      icon: "🟡",
      label: "มีบาง provider cooldown",
      cls: "bg-amber-500/15 border-amber-500/40 text-amber-300",
    };
  } else {
    healthBadge = {
      icon: "🟢",
      label: "สุขภาพดี",
      cls: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
    };
  }

  return (
    <div className="space-y-4">
      {/* Header row: LIVE indicator + health badge + last fetch */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* LIVE pulsing indicator */}
        <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/40 text-[10px] font-bold tracking-wider text-rose-300 uppercase">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full transition-all ${
                fetchFlash ? "bg-emerald-400 scale-150" : "bg-rose-500"
              }`}
            />
          </span>
          LIVE · 2s poll
        </span>

        <span
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold ${healthBadge.cls}`}
        >
          {healthBadge.icon} {healthBadge.label}
        </span>
        {lastFetch && (
          <span className="text-xs text-gray-600 tabular-nums">
            อัปเดต {lastFetch.toLocaleTimeString("th-TH")}
          </span>
        )}
      </div>

      {/* Row 1: Five cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <PostgresCard d={data.postgres} />
        <RedisCard d={data.redis} />
        <ReplicasCard d={data.replicas} leader={data.workerLeader.hostname} />
        <RateLimitCard d={data.rateLimit} />
        <K6Card d={data.k6} />
      </div>

      {/* Row 2: Two wider cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
        <CooldownsCard d={data.cooldowns} />
        <FailureStreaksCard d={data.failureStreaks} />
      </div>
    </div>
  );
}
