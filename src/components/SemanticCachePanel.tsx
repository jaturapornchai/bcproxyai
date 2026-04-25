"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";
import { getAdminAccess } from "./admin-access";

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
    <div className="rounded bg-gray-900/40 p-2 border border-gray-800/60">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {e.provider && <ProviderBadge provider={e.provider} />}
          {e.model && (
            <span className="text-[10px] text-gray-400 truncate font-mono">{e.model}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-fuchsia-300 font-bold">{e.hitCount} hits</span>
          <span className="text-[10px] text-gray-500">{formatRelative(e.lastUsedAt)}</span>
        </div>
      </div>
      <div className="text-[11px] text-gray-400 font-mono truncate">
        <span className="text-gray-500">#{e.queryHash}</span>{" "}
        <span className="text-gray-600">· {e.queryLength}ch</span>
        {showPreview && <span className="text-gray-300"> · {e.queryPreview}</span>}
      </div>
    </div>
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

  return (
    <div className="glass rounded-xl p-3 border border-white/10">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-black text-white flex items-center gap-2" title="จำคำถามที่คล้ายกัน (cosine similarity) แล้วตอบคำตอบเก่าทันที">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            🧠
          </span>
          แคชความหมาย (Semantic)
        </h2>
        {stats?.enabled && <span className="text-xs text-emerald-400">● pgvector พร้อม</span>}
        {stats && !stats.enabled && <span className="text-xs text-amber-400">⚠ pgvector ไม่พร้อม</span>}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500">กำลังโหลด…</div>
      ) : !stats || !stats.enabled ? (
        <div className="text-sm text-gray-500 py-2">
          ติดตั้ง extension <code className="text-fuchsia-300">pgvector</code>{" "}
          เพื่อเปิดใช้งาน — ระบบจะจำคำตอบของคำถามที่ใกล้เคียงกันโดยอัตโนมัติ
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-2" title="จำนวนรายการที่ cache ไว้ทั้งหมด">
              <div className="text-[11px] text-violet-300">รายการทั้งหมด</div>
              <div className="text-2xl font-black text-violet-200 leading-tight">{stats.total.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/20 px-3 py-2" title="จำนวนครั้งที่ cache ถูกเรียกใช้">
              <div className="text-[11px] text-fuchsia-300">ถูกใช้ซ้ำ</div>
              <div className="text-2xl font-black text-fuchsia-200 leading-tight">{stats.totalHits.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2" title="hit rate ใน 1 ชม.ล่าสุด — จาก response cache counter">
              <div className="text-[11px] text-emerald-300">Hit rate (1h)</div>
              <div className="text-2xl font-black text-emerald-200 leading-tight">{fmtPct(stats.hitRate)}</div>
              <div className="text-[10px] text-emerald-400/70">{stats.hitsLastHour}/{stats.hitsLastHour + stats.missesLastHour}</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" title="entry ที่ไม่ถูกใช้เกิน 30 วัน">
              <div className="text-[11px] text-amber-300">Stale (30d+)</div>
              <div className="text-2xl font-black text-amber-200 leading-tight">{stats.staleEntries}</div>
              <div className="text-[10px] text-amber-400/70">est. ประหยัด {stats.estimatedSavedRequests}</div>
            </div>
          </div>

          {stats.topProviders.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-gray-500 mb-1">Provider/model ที่ cache ได้ผลดี</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {stats.topProviders.slice(0, 6).map((p, i) => (
                  <div key={i} className="text-[11px] bg-black/30 border border-white/10 rounded px-2 py-1 flex items-center justify-between gap-1">
                    <span className="truncate text-gray-300 font-mono">{p.provider}/{p.model ?? "—"}</span>
                    <span className="shrink-0 text-fuchsia-300">{p.totalHits}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-1 mb-1.5">
            <button
              onClick={() => setTab("top")}
              className={`text-[11px] px-2 py-0.5 rounded ${tab === "top" ? "bg-violet-500/20 border border-violet-500/40 text-white" : "bg-black/20 border border-white/10 text-gray-400"}`}
            >
              Top {stats.topEntries.length}
            </button>
            <button
              onClick={() => setTab("stale")}
              className={`text-[11px] px-2 py-0.5 rounded ${tab === "stale" ? "bg-amber-500/20 border border-amber-500/40 text-white" : "bg-black/20 border border-white/10 text-gray-400"}`}
            >
              Stale {stats.staleSamples.length}
            </button>
          </div>

          {(tab === "top" ? stats.topEntries : stats.staleSamples).length === 0 ? (
            <div className="text-xs text-gray-500 py-2 text-center">
              {tab === "top" ? "ยังไม่มีรายการ — ระบบจะเริ่มจำเมื่อมีคำถามเข้ามา" : "ไม่มี stale entries"}
            </div>
          ) : (
            <div className="space-y-1.5">
              {(tab === "top" ? stats.topEntries : stats.staleSamples).map((e) => <EntryRow key={e.id} e={e} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
