"use client";

import { useCallback, useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";
import { Badge, Card } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconAlert, IconCheck, IconCube, IconLock, IconPulse, IconRefresh, IconServer } from "./ui/icons";

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

function CardShell({
  icon,
  title,
  tip,
  right,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tip?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card hover className="flex h-full flex-col gap-2.5 p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white" title={tip}>{title}</span>
        {right}
      </div>
      {children}
    </Card>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      role="img"
      aria-label={ok ? "ปกติ" : "ผิดปกติ"}
      className={`pulse-dot inline-block h-2 w-2 rounded-full ${ok ? "text-emerald-400 bg-emerald-400" : "text-rose-400 bg-rose-400"}`}
    />
  );
}

function MiniBar({ pct, color = "bg-violet-400" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full ${color} transition-all duration-500`}
        // ponytail: width is data-driven, so it can't be a static class
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

// ── Postgres card ─────────────────────────────────────────────────────────────
function PostgresCard({ d }: { d: InfraData["postgres"] }) {
  const connPct = d.maxConnections > 0 ? (d.connections / d.maxConnections) * 100 : 0;
  const connColor = connPct > 80 ? "bg-rose-400" : connPct > 50 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <CardShell
      icon={<IconServer size={16} />}
      title="ฐานข้อมูล (Postgres)"
      tip="ฐานข้อมูลหลัก — เก็บ model/teacher/exam/logs"
      right={<StatusDot ok={d.ok} />}
    >
      {d.ok ? (
        <>
          <div className="truncate text-[12px] text-[var(--muted)]" title={d.version}>{d.version}</div>
          <div className="text-[13px] text-gray-300">
            ขนาด DB: <span className="font-medium text-violet-200">{fmtBytes(d.dbSizeBytes)}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[12px] text-[var(--muted)]">
              <span>การเชื่อมต่อ</span>
              <span className={`tabular-nums ${connPct > 80 ? "text-rose-300" : "text-gray-300"}`}>
                {d.connections}/{d.maxConnections}
              </span>
            </div>
            <MiniBar pct={connPct} color={connColor} />
          </div>
          {d.slowQueries > 0 && (
            <div className="text-[12px] font-medium text-rose-300">query ช้า: {d.slowQueries} รายการ</div>
          )}
        </>
      ) : (
        <div className="text-[13px] text-rose-300">ไม่สามารถเชื่อมต่อได้</div>
      )}
    </CardShell>
  );
}

// ── Redis/Valkey card ─────────────────────────────────────────────────────────
function RedisCard({ d }: { d: InfraData["redis"] }) {
  return (
    <CardShell icon={<IconCube size={16} />} title={d.engine ?? "Redis"} tip="แคชและตัวนับ rate limit" right={<StatusDot ok={d.ok} />}>
      {d.ok ? (
        <>
          <div className="text-[12px] text-[var(--muted)]">v{d.version} · ทำงานมา {fmtUptime(d.uptimeSec)}</div>
          <div className="text-[13px] text-gray-300">
            หน่วยความจำ: <span className="font-medium text-violet-200">{fmtBytes(d.memoryUsedBytes)}</span>
            <span className="mx-1 text-gray-600">·</span>
            คีย์: <span className="font-medium text-violet-200">{d.keysTotal.toLocaleString()}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[12px] text-[var(--muted)]">
              <span>อัตราการ cache hit</span>
              <span className={`tabular-nums ${d.hitRatePct >= 80 ? "text-emerald-300" : "text-amber-300"}`}>
                {d.hitRatePct}%
              </span>
            </div>
            <MiniBar pct={d.hitRatePct} color={d.hitRatePct >= 80 ? "bg-emerald-400" : "bg-amber-400"} />
          </div>
        </>
      ) : (
        <div className="text-[13px] text-rose-300">ไม่สามารถเชื่อมต่อได้</div>
      )}
    </CardShell>
  );
}

// ── Replicas card ─────────────────────────────────────────────────────────────
function ReplicasCard({ d, leader }: { d: InfraData["replicas"]; leader: string | null }) {
  return (
    <CardShell icon={<IconRefresh size={16} />} title="เซิร์ฟเวอร์" tip="จำนวน container ที่ให้บริการอยู่">
      <div className="text-[28px] font-semibold leading-none tabular-nums text-white">{d.count}</div>
      <div className="text-[12px] text-[var(--muted)]">
        {d.count === 1 ? "instance เดียว" : `${d.count} containers กำลังทำงาน`}
      </div>
      <div className="mt-1 flex flex-col gap-1.5">
        {d.instances.slice(0, 5).map((r) => (
          <div key={r.hostname} className="flex items-center gap-1.5 text-[12px]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="max-w-[110px] truncate font-mono text-gray-300" title={r.hostname}>
              {r.hostname.slice(0, 12)}
            </span>
            {r.hostname === leader && <Badge tone="accent">worker leader</Badge>}
          </div>
        ))}
      </div>
    </CardShell>
  );
}

// ── Rate Limit card ───────────────────────────────────────────────────────────
function RateLimitCard({ d }: { d: InfraData["rateLimit"] }) {
  return (
    <CardShell icon={<IconLock size={16} />} title="จำกัดคำขอ" tip="IP ที่กำลังถูกจำกัดอัตราคำขอ">
      <div className="text-[28px] font-semibold leading-none tabular-nums text-white">{d.activeClients}</div>
      <div className="text-[12px] text-[var(--muted)]">IP ที่กำลังถูก track</div>
      {d.activeClients === 0 ? (
        <div className="text-[12px] text-emerald-300">ไม่มีการ throttle ตอนนี้</div>
      ) : (
        <div className="mt-1 flex flex-col gap-1.5">
          {d.topClients.slice(0, 3).map((c) => (
            <div key={c.ip} className="flex items-center justify-between text-[12px]">
              <span className="max-w-[110px] truncate font-mono text-[var(--muted)]">{c.ip}</span>
              <span className="font-semibold tabular-nums text-amber-300">{c.count}</span>
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
    <CardShell
      icon={<IconAlert size={16} />}
      title="รายชื่อที่ถูกพัก"
      tip="model/provider ที่ถูกพักใช้งานชั่วคราว เพราะล้มเหลว/เกิน rate limit"
      right={
        <span className="text-[11px] text-[var(--muted)]">
          <span className="font-semibold text-amber-300">{d.providerCount}</span> ผู้ให้บริการ
          <span className="mx-1.5 text-gray-600">·</span>
          <span className="font-semibold text-amber-300">{d.modelCount}</span>
          <span className="text-gray-600">/{d.totalModels}</span> model
          {d.totalModels > 0 && <span className="text-gray-600"> ({modelPct}%)</span>}
        </span>
      }
    >
      {d.providerCount === 0 ? (
        <div className="py-1 text-[13px] text-emerald-300">
          ผู้ให้บริการพร้อมใช้งานครบ
          {d.modelCount > 0 && (
            <div className="mt-0.5 text-[11px] text-[var(--muted)]">
              มี {d.modelCount} model ถูกพักรายตัว แต่ผู้ให้บริการทั้งหมดยังใช้ได้
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">
                <th className="py-1.5 text-left font-medium">ผู้ให้บริการ</th>
                <th className="py-1.5 text-left font-medium">เหตุผล</th>
                <th className="py-1.5 text-right font-medium">เวลาเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {d.providers.map((p) => (
                <tr key={p.provider} className="border-b border-white/5">
                  <td className="py-1.5 font-medium text-violet-200">{p.provider}</td>
                  <td className="max-w-[160px] truncate py-1.5 text-[var(--muted)]" title={p.reason}>
                    {p.reason.slice(0, 30) || "—"}
                  </td>
                  <td className={`py-1.5 text-right font-mono font-semibold tabular-nums ${p.ttlSec < 60 ? "text-rose-300" : "text-amber-300"}`}>
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
    <CardShell icon={<IconPulse size={16} />} title="ความล้มเหลวต่อเนื่อง" tip="provider ที่ล้มเหลวติดกันหลายครั้ง">
      {d.length === 0 ? (
        <div className="py-1 text-[13px] text-emerald-300">ทุก provider ทำงานปกติ</div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {d.map((s) => (
            <Badge key={s.provider} tone="danger">{s.provider} ×{s.count}</Badge>
          ))}
        </div>
      )}
    </CardShell>
  );
}

// ─── K6 Card ──────────────────────────────────────────────────────────────────
function K6Card({ d, serverTime }: { d: InfraData["k6"]; serverTime: string }) {
  const scriptsCount = d.scripts.length;
  const ranCount = d.lastRuns.length;
  const latest = d.latest;

  const fmtAgo = (iso: string) => {
    const diff = (new Date(serverTime).getTime() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <CardShell
      icon={<IconCheck size={16} />}
      title="ทดสอบโหลด"
      tip="ผลทดสอบโหลดด้วย k6"
      right={<span className={`h-2 w-2 rounded-full ${ranCount > 0 ? "bg-cyan-400" : "bg-gray-600"}`} />}
    >
      <div className="text-[28px] font-semibold leading-none tabular-nums text-white">
        {ranCount}
        <span className="text-[14px] font-normal text-[var(--muted)]">/{scriptsCount}</span>
      </div>
      <div className="text-[12px] text-[var(--muted)]">สคริปต์ที่รันแล้ว / ทั้งหมด</div>

      {latest ? (
        <div className="mt-1 space-y-0.5 text-[12px]">
          <div className="font-medium text-gray-300">
            <span className="text-cyan-300">{latest.script}</span>
            <span className="text-gray-600"> · {fmtAgo(latest.at)}</span>
          </div>
          {latest.metrics.p95 !== undefined && (
            <div className="text-[var(--muted)]">
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
            <div className="text-[var(--muted)]">
              ผ่าน <span className="text-emerald-300">{latest.checks.passes ?? 0}</span>{" "}
              ไม่ผ่าน <span className="text-rose-300">{latest.checks.fails ?? 0}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1 text-[12px] text-[var(--muted)]">
          รัน <code className="text-cyan-300">npm run loadtest:smoke</code> เพื่อเริ่มทดสอบ
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
      if (!(await getAdminAccess())) {
        setData(null);
        return;
      }
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-32" />)}
      </div>
    );
  }
  if (!data) return null;

  // ── Overall health badge ──────────────────────────────────────────────────
  const systemOk = data.postgres.ok && data.redis.ok;
  const hasCooldowns = data.cooldowns.providerCount > 0;
  const health: { tone: Tone; label: string } = !systemOk
    ? { tone: "danger", label: "ระบบมีปัญหา" }
    : hasCooldowns
      ? { tone: "warning", label: "มีบาง provider cooldown" }
      : { tone: "success", label: "สุขภาพดี" };

  return (
    <div className="space-y-4">
      {/* Header row: LIVE indicator + health badge + last fetch */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="danger" dot className={`uppercase tracking-wider transition-transform ${fetchFlash ? "scale-105" : ""}`}>
          LIVE · 2s poll
        </Badge>
        <Badge tone={health.tone}>{health.label}</Badge>
        {lastFetch && (
          <span className="text-[12px] tabular-nums text-[var(--muted)]">
            อัปเดต {lastFetch.toLocaleTimeString("th-TH")}
          </span>
        )}
      </div>

      {/* Row 1: Five cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <PostgresCard d={data.postgres} />
        <RedisCard d={data.redis} />
        <ReplicasCard d={data.replicas} leader={data.workerLeader.hostname} />
        <RateLimitCard d={data.rateLimit} />
        <K6Card d={data.k6} serverTime={data.serverTime} />
      </div>

      {/* Row 2: Two wider cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3">
        <CooldownsCard d={data.cooldowns} />
        <FailureStreaksCard d={data.failureStreaks} />
      </div>
    </div>
  );
}
