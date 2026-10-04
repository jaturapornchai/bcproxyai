"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";
import { getAdminAccess } from "./admin-access";
import { Badge, Card, CardHeader, EmptyState, Reveal, Stat, Tabs } from "./ui/ui";
import { IconAlert, IconCube } from "./ui/icons";

interface CacheEntry {
  id: number;
  queryHash: string;
  queryPreview: string;
  queryLength: number;
  provider: string | null;
  model: string | null;
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

interface ProviderAgg {
  provider: string | null;
  model: string | null;
  entries: number;
  totalHits: number;
}

interface CacheStats {
  total: number;
  totalHits: number;
  avgHits: number;
  topEntries: CacheEntry[];
  enabled: boolean;
  hitRate: number;
  hitsLastHour: number;
  missesLastHour: number;
  estimatedSavedRequests: number;
  topProviders: ProviderAgg[];
  staleEntries: number;
  staleSamples: CacheEntry[];
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)} วินาทีที่แล้ว`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ชั่วโมงที่แล้ว`;
  return `${Math.round(diff / 86_400_000)} วันที่แล้ว`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function EntryRow({ e }: { e: CacheEntry }) {
  // Default: only hash + length is shown so the panel can't leak prompts in a
  // screenshot. Setting SEMANTIC_CACHE_SHOW_PREVIEW=1 lets admins see the
  // first 40 chars of the prompt for debugging.
  const showPreview = e.queryPreview.length > 0;
  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          {e.provider && <ProviderBadge provider={e.provider} />}
          {e.model && (
            <span className="truncate font-mono text-[11px] text-[var(--muted)]">{e.model}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone="accent">{e.hitCount} hits</Badge>
          <span className="text-[11px] text-[var(--muted)]">{formatRelative(e.lastUsedAt)}</span>
        </div>
      </div>
      <div className="truncate font-mono text-[11.5px] text-[var(--muted)]">
        <span>#{e.queryHash}</span>{" "}
        <span className="opacity-70">· {e.queryLength} ตัวอักษร</span>
        {showPreview && <span className="text-gray-300"> · {e.queryPreview}</span>}
      </div>
    </li>
  );
}

export function SemanticCachePanel() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"top" | "stale">("top");

  const fetchStats = useCallback(async () => {
    try {
      if (!(await getAdminAccess())) {
        setStats(null);
        return;
      }
      const res = await fetch("/api/semantic-cache", { credentials: "include" });
      if (res.ok) setStats(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const entries = stats ? (tab === "top" ? stats.topEntries : stats.staleSamples) : [];

  return (
    <Card>
      <CardHeader
        icon={<IconCube />}
        title="แคชความหมาย (Semantic cache)"
        subtitle="จำคำถามที่ความหมายใกล้เคียงกัน แล้วตอบด้วยคำตอบเดิมทันที — ตอบเร็วขึ้นและไม่ต้องเรียกโมเดลซ้ำ"
        action={
          stats?.enabled ? (
            <Badge tone="success" dot>pgvector พร้อม</Badge>
          ) : stats ? (
            <Badge tone="warning"><IconAlert size={12} /> pgvector ไม่พร้อม</Badge>
          ) : undefined
        }
      />

      {loading ? (
        <div className="space-y-3 p-5" aria-busy="true" aria-label="กำลังโหลดข้อมูลแคช">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-28" />)}
          </div>
          <div className="skeleton h-24" />
        </div>
      ) : !stats || !stats.enabled ? (
        <EmptyState
          icon={<IconCube size={22} />}
          title="ยังไม่ได้เปิดใช้แคชความหมาย"
          description={
            <>
              ติดตั้ง extension <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-violet-200">pgvector</code>{" "}
              เพื่อเปิดใช้งาน — ระบบจะจำคำตอบของคำถามที่ใกล้เคียงกันโดยอัตโนมัติ
            </>
          }
        />
      ) : (
        <div className="space-y-6 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Reveal i={0}>
              <Stat label="รายการทั้งหมด" tone="accent" value={stats.total.toLocaleString()} hint="คำถามที่ cache ไว้" />
            </Reveal>
            <Reveal i={1}>
              <Stat label="ถูกใช้ซ้ำ" tone="info" value={stats.totalHits.toLocaleString()} hint="ครั้งที่ตอบจากแคช" />
            </Reveal>
            <Reveal i={2}>
              <Stat
                label="Hit rate (1 ชม.)"
                tone="success"
                value={fmtPct(stats.hitRate)}
                hint={`${stats.hitsLastHour}/${stats.hitsLastHour + stats.missesLastHour} ครั้ง`}
              />
            </Reveal>
            <Reveal i={3}>
              <Stat
                label="ค้างนาน (30 วัน+)"
                tone="warning"
                value={stats.staleEntries.toLocaleString()}
                hint={`ประหยัดโดยประมาณ ${stats.estimatedSavedRequests} คำขอ`}
              />
            </Reveal>
          </div>

          {stats.topProviders.length > 0 && (
            <section>
              <h4 className="text-[13px] font-semibold text-white">ผู้ให้บริการ/โมเดลที่แคชได้ผลดี</h4>
              <p className="mb-3 mt-0.5 text-[12px] text-[var(--muted)]">ตัวเลขท้ายคือจำนวนครั้งที่ตอบจากแคช</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stats.topProviders.slice(0, 6).map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px]">
                    <span className="truncate font-mono text-gray-200">{p.provider}/{p.model ?? "—"}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-violet-200">{p.totalHits}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <Tabs
              tabs={[
                { id: "top", label: `ใช้บ่อยสุด ${stats.topEntries.length}` },
                { id: "stale", label: `ค้างนาน ${stats.staleSamples.length}` },
              ]}
              value={tab}
              onChange={setTab}
            />
            {entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-[13px] text-[var(--muted)]">
                {tab === "top" ? "ยังไม่มีรายการ — ระบบจะเริ่มจำเมื่อมีคำถามเข้ามา" : "ไม่มีรายการค้างนาน"}
              </div>
            ) : (
              <ul className="space-y-2">
                {entries.map((e) => <EntryRow key={e.id} e={e} />)}
              </ul>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
