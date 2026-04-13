"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_COLORS } from "./shared";

interface ProviderCost {
  provider: string;
  total_input: number;
  total_output: number;
  requests: number;
  cost: number;
  free: boolean;
}

interface ModelUsage {
  provider: string;
  model_id: string;
  nickname: string | null;
  total_input: number;
  total_output: number;
  requests: number;
}

interface Suggestion {
  message: string;
  savings_pct: number;
  priority: "high" | "medium" | "low";
}

interface CostData {
  providerCosts: ProviderCost[];
  modelUsage: ModelUsage[];
  suggestions: Suggestion[];
  summary: {
    totalCost: number;
    totalTokens: number;
    freePct: number;
    totalRequests: number;
  };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PRIORITY_STYLES = {
  high: "bg-red-500/20 border-red-500/40 text-red-300",
  medium: "bg-amber-500/20 border-amber-500/40 text-amber-300",
  low: "bg-blue-500/20 border-blue-500/40 text-blue-300",
};

export function CostOptimizerPanel() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/cost-optimizer");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) return <div className="text-gray-500 text-center py-8">กำลังวิเคราะห์ต้นทุน...</div>;
  if (!data || data.summary.totalRequests === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-gray-500">
        <div className="text-4xl mb-3">💰</div>
        <p>ยังไม่มีใบเสร็จ — เริ่มใช้งานก่อน แล้วครูจะคิดค่าเทอมให้!</p>
      </div>
    );
  }

  const { providerCosts, modelUsage, suggestions, summary } = data;
  const maxTokens = Math.max(...providerCosts.map(p => p.total_input + p.total_output), 1);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">${summary.totalCost.toFixed(4)}</div>
          <div className="text-xs text-gray-400">ค่าเทอม 30 วัน</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-cyan-400">{fmtTokens(summary.totalTokens)}</div>
          <div className="text-xs text-gray-400">tokens ทั้งหมด</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">{summary.freePct.toFixed(0)}%</div>
          <div className="text-xs text-gray-400">ใช้ฟรี</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-indigo-400">{summary.totalRequests}</div>
          <div className="text-xs text-gray-400">requests ทั้งหมด</div>
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-amber-400">ครูแนะนำวิธีประหยัดค่าเทอม</h4>
          {suggestions.map((s, i) => (
            <div key={i} className={`rounded-lg border p-3 text-sm ${PRIORITY_STYLES[s.priority]}`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-black/20">
                  {s.priority === "high" ? "สำคัญ" : s.priority === "medium" ? "แนะนำ" : "ทั่วไป"}
                </span>
                <span>{s.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-4">
        {/* Provider Cost Breakdown */}
        <div className="glass rounded-xl p-4">
          <h4 className="text-sm font-bold text-gray-300 mb-3">ต้นทุนแยกตาม Provider</h4>
          <div className="space-y-3">
            {providerCosts.map(p => {
              const colors = PROVIDER_COLORS[p.provider] ?? PROVIDER_COLORS.openrouter;
              const totalTokens = p.total_input + p.total_output;
              const pct = (totalTokens / maxTokens) * 100;
              return (
                <div key={p.provider}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold ${colors.text}`}>{p.provider}</span>
                      {p.free && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1 rounded">FREE</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-gray-400">{fmtTokens(totalTokens)} tokens</span>
                      <span className="text-gray-300 font-bold">${p.cost.toFixed(4)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-800/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: PROVIDER_COLORS[p.provider]?.glow ?? "#6366f1" }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{p.requests} requests</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Models by Token Usage */}
        <div className="glass rounded-xl p-4">
          <h4 className="text-sm font-bold text-gray-300 mb-3">Top Models (Token Usage)</h4>
          <div className="space-y-2">
            {modelUsage.slice(0, 8).map((m, i) => {
              const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
              const total = m.total_input + m.total_output;
              return (
                <div key={`${m.provider}-${m.model_id}`} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-600 w-4 text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-200 truncate">{m.model_id}</div>
                    <div className={`text-[10px] ${colors.text}`}>{m.provider}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-gray-300">{fmtTokens(total)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
