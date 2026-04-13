"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";

interface ProviderLimit {
  provider: string;
  modelId: string;
  limitTpm: number | null;
  limitTpd: number | null;
  limitRpm?: number | null;
  remainingTpm: number | null;
  remainingTpd: number | null;
  remainingRpm?: number | null;
  resetTpmAt: string | null;
  resetTpdAt: string | null;
  source: string;
  lastUpdated: number;
}

interface LimitsResponse {
  limits: ProviderLimit[];
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function pct(remaining: number | null | undefined, limit: number | null | undefined): number | null {
  if (remaining == null || limit == null || limit <= 0) return null;
  return Math.min(100, Math.max(0, (remaining / limit) * 100));
}

function barColor(p: number | null): string {
  if (p == null) return "bg-gray-600";
  if (p < 20) return "bg-red-500";
  if (p < 50) return "bg-amber-500";
  return "bg-emerald-500";
}

function formatSource(source: string): string {
  const map: Record<string, string> = {
    header: "Header",
    "error-tpd": "429 TPD",
    "error-tpm": "429 TPM",
    "error-unknown": "429",
    "error-generic": "429",
    unknown: "—",
  };
  return map[source] ?? source;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "เมื่อกี้";
  const s = Math.floor(diff / 1000);
  if (s < 5) return "เมื่อกี้";
  if (s < 60) return `${s} วิ ที่แล้ว`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาที ที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  const d = Math.floor(h / 24);
  return `${d} วัน ที่แล้ว`;
}

interface BarProps {
  label: string;
  remaining: number | null | undefined;
  limit: number | null | undefined;
}

function LimitBar({ label, remaining, limit }: BarProps) {
  const p = pct(remaining, limit);
  const width = p == null ? "0%" : p.toFixed(0) + "%";
  return (
    <div className="mb-2">
      <div className="flex justify-between text-sm text-gray-300 mb-1">
        <span className="font-bold">{label}</span>
        <span className="font-mono text-gray-400">
          {formatNum(remaining ?? null)} / {formatNum(limit ?? null)}
          {p != null && <span className="ml-2 text-gray-500">({p.toFixed(0)}%)</span>}
        </span>
      </div>
      <div className="h-3 bg-gray-800 rounded overflow-hidden">
        <div
          className={`h-full ${barColor(p)} transition-all`}
          style={{ width }}
        />
      </div>
    </div>
  );
}

export function ProviderLimitsPanel() {
  const [limits, setLimits] = useState<ProviderLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const fetchLimits = useCallback(async () => {
    try {
      const res = await fetch("/api/provider-limits");
      if (res.ok) {
        const data: LimitsResponse = await res.json();
        setLimits(Array.isArray(data.limits) ? data.limits : []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLimits();
    const interval = setInterval(fetchLimits, 5_000);
    return () => clearInterval(interval);
  }, [fetchLimits]);

  // Tick every 15s so relative time re-renders without extra fetch
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Sort by TPM remaining % DESC (models with no TPM info sink to bottom)
  const sorted = [...limits].sort((a, b) => {
    const pa = pct(a.remainingTpm, a.limitTpm) ?? -1;
    const pb = pct(b.remainingTpm, b.limitTpm) ?? -1;
    return pb - pa;
  });

  return (
    <div className="glass rounded-2xl p-4 border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-3xl font-black text-white flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white text-xl">
            📊
          </span>
          โควต้า Provider
        </h2>
        <span className="text-sm text-gray-400">
          {limits.length} models · อัพเดททุก 5 วินาที
        </span>
      </div>

      {loading ? (
        <div className="text-base text-gray-400 py-4 text-center">กำลังโหลด…</div>
      ) : sorted.length === 0 ? (
        <div className="text-base text-gray-400 py-6 text-center">
          ยังไม่มีข้อมูล limit — ระบบกำลังเรียนรู้
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-3">
          {sorted.map((l, i) => (
            <div
              key={`${l.provider}-${l.modelId}-${i}`}
              className="rounded-xl bg-gray-900/40 p-4 border border-white/10"
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ProviderBadge provider={l.provider} />
                  <span className="text-base text-white font-mono truncate font-bold">
                    {l.modelId}
                  </span>
                </div>
                <span className="text-xs text-gray-500 shrink-0">
                  {formatSource(l.source)}
                </span>
              </div>

              {l.limitTpm != null && (
                <LimitBar label="TPM" remaining={l.remainingTpm} limit={l.limitTpm} />
              )}
              {l.limitTpd != null && (
                <LimitBar label="TPD" remaining={l.remainingTpd} limit={l.limitTpd} />
              )}
              {l.limitRpm != null && (
                <LimitBar label="RPM" remaining={l.remainingRpm} limit={l.limitRpm} />
              )}
              {l.limitTpm == null && l.limitTpd == null && l.limitRpm == null && (
                <div className="text-sm text-gray-500 italic py-1">
                  ยังไม่มีข้อมูล limit ตัวเลข
                </div>
              )}

              <div className="mt-2 text-xs text-gray-500 text-right">
                {formatRelative(l.lastUpdated)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ProviderLimitsPanel;
