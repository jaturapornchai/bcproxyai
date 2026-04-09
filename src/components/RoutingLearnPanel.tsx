"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_COLORS } from "./shared";

interface CategoryStat {
  prompt_category: string;
  model_id: string;
  provider: string;
  nickname: string | null;
  total: number;
  successes: number;
  success_rate: number;
  avg_latency_ms: number;
}

interface Distribution {
  prompt_category: string;
  count: number;
}

interface RoutingData {
  categories: Record<string, CategoryStat[]>;
  distribution: Distribution[];
  totalLearned: number;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  general:   { label: "ทั่วไป", icon: "💬" },
  code:      { label: "โค้ด", icon: "💻" },
  thai:      { label: "ภาษาไทย", icon: "🇹🇭" },
  math:      { label: "คณิตศาสตร์", icon: "🔢" },
  creative:  { label: "สร้างสรรค์", icon: "🎨" },
  analysis:  { label: "วิเคราะห์", icon: "🔍" },
  translate: { label: "แปลภาษา", icon: "🌐" },
};

export function RoutingLearnPanel() {
  const [data, setData] = useState<RoutingData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/routing-stats");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) return <div className="text-gray-500 text-center py-8">กำลังโหลดข้อมูล Smart Routing...</div>;
  if (!data || data.totalLearned === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-gray-500">
        <div className="text-4xl mb-3">🧠</div>
        <p>ครูยังไม่รู้จักนักเรียน — ส่งการบ้านมาก่อน แล้วครูจะจำได้ว่าใครเก่งวิชาไหน!</p>
      </div>
    );
  }

  const totalDist = data.distribution.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-indigo-400">{data.totalLearned}</div>
          <div className="text-xs text-gray-400">ครั้งที่ครูจำได้</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-cyan-400">{Object.keys(data.categories).length}</div>
          <div className="text-xs text-gray-400">วิชาที่สอน</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">
            {Object.values(data.categories).reduce((s, cats) => s + cats.length, 0)}
          </div>
          <div className="text-xs text-gray-400">model-category pairs</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">7 วัน</div>
          <div className="text-xs text-gray-400">ช่วงข้อมูล</div>
        </div>
      </div>

      {/* Prompt Distribution */}
      <div className="glass rounded-xl p-4">
        <h4 className="text-sm font-bold text-gray-300 mb-3">ตารางสอน — วิชาอะไรเรียนเยอะสุด?</h4>
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
          {data.distribution.map(d => {
            const pct = (d.count / totalDist) * 100;
            const cat = CATEGORY_LABELS[d.prompt_category] ?? { label: d.prompt_category, icon: "?" };
            const colors = ["bg-indigo-500", "bg-cyan-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-purple-500", "bg-teal-500"];
            const idx = data.distribution.indexOf(d) % colors.length;
            return (
              <div
                key={d.prompt_category}
                className={`${colors[idx]} relative group`}
                style={{ width: `${Math.max(pct, 3)}%` }}
                title={`${cat.icon} ${cat.label}: ${d.count} (${pct.toFixed(1)}%)`}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10">
                  <div className="glass rounded px-2 py-1 text-[10px] text-white whitespace-nowrap border border-white/10">
                    {cat.icon} {cat.label}: {d.count} ({pct.toFixed(1)}%)
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-500">
          {data.distribution.map((d, i) => {
            const cat = CATEGORY_LABELS[d.prompt_category] ?? { label: d.prompt_category, icon: "?" };
            const colors = ["bg-indigo-500", "bg-cyan-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-purple-500", "bg-teal-500"];
            return (
              <span key={d.prompt_category} className="flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-sm ${colors[i % colors.length]}`} />
                {cat.icon} {cat.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Best Models per Category */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-4">
        {Object.entries(data.categories).map(([cat, models]) => {
          const catInfo = CATEGORY_LABELS[cat] ?? { label: cat, icon: "?" };
          return (
            <div key={cat} className="bg-gray-800/30 rounded-xl border border-gray-700/50 p-4">
              <h4 className="text-sm font-bold text-white mb-3">
                {catInfo.icon} {catInfo.label} — เด็กเก่งประจำวิชา
              </h4>
              <div className="space-y-2">
                {models.slice(0, 3).map((m, i) => {
                  const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
                  return (
                    <div key={m.model_id} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-5 text-center">{i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-200 truncate">{m.model_id.split(":")[0]}</div>
                        <div className={`text-[10px] ${colors.text}`}>{m.provider}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-emerald-400">{m.success_rate}%</div>
                        <div className="text-[10px] text-gray-500">{m.avg_latency_ms}ms</div>
                      </div>
                    </div>
                  );
                })}
                {models.length === 0 && (
                  <div className="text-xs text-gray-600 text-center py-2">ยังไม่มีเด็กเรียนวิชานี้พอ</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
