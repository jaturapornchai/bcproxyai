"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";

interface CacheEntry {
  id: number;
  query: string;
  provider: string | null;
  model: string | null;
  hitCount: number;
  createdAt: string;
  lastUsedAt: string;
}

interface CacheStats {
  total: number;
  totalHits: number;
  avgHits: number;
  topEntries: CacheEntry[];
  enabled: boolean;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)} วินาทีที่แล้ว`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} นาทีที่แล้ว`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ชั่วโมงที่แล้ว`;
  return `${Math.round(diff / 86_400_000)} วันที่แล้ว`;
}

export function SemanticCachePanel() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/semantic-cache");
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
        {stats?.enabled && (
          <span className="text-xs text-emerald-400">● pgvector พร้อม</span>
        )}
        {stats && !stats.enabled && (
          <span className="text-xs text-amber-400">⚠ pgvector ไม่พร้อม</span>
        )}
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
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-2" title="จำนวนรายการที่ cache ไว้ทั้งหมด">
              <div className="text-[11px] text-violet-300">
                รายการทั้งหมด
              </div>
              <div className="text-2xl font-black text-violet-200 leading-tight">
                {stats.total.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/20 px-3 py-2" title="จำนวนครั้งที่ cache ถูกเรียกใช้">
              <div className="text-[11px] text-fuchsia-300">
                ถูกใช้ซ้ำ
              </div>
              <div className="text-2xl font-black text-fuchsia-200 leading-tight">
                {stats.totalHits.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-pink-500/10 border border-pink-500/20 px-3 py-2" title="เฉลี่ยใช้ซ้ำ / 1 รายการ">
              <div className="text-[11px] text-pink-300">
                เฉลี่ย/รายการ
              </div>
              <div className="text-2xl font-black text-pink-200 leading-tight">
                {stats.avgHits.toFixed(1)}
              </div>
            </div>
          </div>

          {stats.topEntries.length === 0 ? (
            <div className="text-xs text-gray-500 py-2 text-center">
              ยังไม่มีรายการ — ระบบจะเริ่มจำเมื่อมีคำถามเข้ามา
            </div>
          ) : (
            <div>
              <div className="text-[11px] text-gray-500 mb-1.5">
                รายการที่ถูกใช้ซ้ำมากที่สุด
              </div>
              <div className="space-y-1.5">
                {stats.topEntries.map((e) => (
                  <div
                    key={e.id}
                    className="rounded bg-gray-900/40 p-2 border border-gray-800/60"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {e.provider && <ProviderBadge provider={e.provider} />}
                        {e.model && (
                          <span className="text-[10px] text-gray-400 truncate font-mono">
                            {e.model}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-fuchsia-300 font-bold">
                          {e.hitCount} hits
                        </span>
                        <span className="text-[10px] text-gray-500">
                          {formatRelative(e.lastUsedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {e.query.slice(0, 120)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
