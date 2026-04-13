"use client";

import { useCallback, useEffect, useState } from "react";

type Severity = "info" | "warn" | "high" | "critical";
type Status = "open" | "acknowledged" | "resolved" | "dismissed";

interface Suggestion {
  id: number;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  targetFiles: string | null;
  proposedChange: string | null;
  evidence: string | null;
  status: Status;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Counts {
  total: number;
  open: number;
  critical: number;
  high: number;
  warn: number;
}

interface Response {
  suggestions: Suggestion[];
  counts: Counts;
}

const SEVERITY_META: Record<
  Severity,
  { label: string; icon: string; border: string; bg: string; text: string }
> = {
  critical: {
    label: "วิกฤต",
    icon: "🚨",
    border: "border-red-500/50",
    bg: "bg-red-500/10",
    text: "text-red-300",
  },
  high: {
    label: "สูง",
    icon: "⚠️",
    border: "border-orange-500/50",
    bg: "bg-orange-500/10",
    text: "text-orange-300",
  },
  warn: {
    label: "เตือน",
    icon: "💡",
    border: "border-amber-500/50",
    bg: "bg-amber-500/10",
    text: "text-amber-300",
  },
  info: {
    label: "แนะนำ",
    icon: "ℹ️",
    border: "border-blue-500/50",
    bg: "bg-blue-500/10",
    text: "text-blue-300",
  },
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

export function DevSuggestionsPanel() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const url = showResolved ? "/api/dev-suggestions" : "/api/dev-suggestions?status=open";
      const res = await fetch(url);
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 20_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const updateStatus = async (id: number, status: Status) => {
    try {
      await fetch("/api/dev-suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      fetchData();
    } catch {
      /* ignore */
    }
  };

  const isEmpty = !data || data.suggestions.length === 0;

  return (
    <div className="glass rounded-lg p-2 border border-white/10">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-2xl">💡</span>
        <h2 className="text-3xl font-black text-white">คำแนะนำสำหรับ Dev</h2>
        {data && (
          <div className="flex items-center gap-2 text-sm">
            {data.counts.critical > 0 && (
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-bold">
                🚨 {data.counts.critical}
              </span>
            )}
            {data.counts.high > 0 && (
              <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/40 font-bold">
                ⚠️ {data.counts.high}
              </span>
            )}
            {data.counts.warn > 0 && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                💡 {data.counts.warn}
              </span>
            )}
            <span className="text-gray-500">{data.counts.open} open</span>
          </div>
        )}
        <button
          onClick={() => setShowResolved((v) => !v)}
          className="ml-auto text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded px-2 py-1"
        >
          {showResolved ? "ซ่อน resolved" : "แสดงทั้งหมด"}
        </button>
      </div>

      <p className="text-sm text-gray-400 mb-2">
        ระบบ AI พบปัญหาในส่วน core ที่ตัวเองแตะไม่ได้ (ตามกฎ no-hardcode + no-edit-core) —
        บันทึกไว้ให้ Dev มนุษย์มาปรับปรุง
      </p>

      {loading ? (
        <div className="text-base text-gray-500 py-3">กำลังโหลด…</div>
      ) : isEmpty ? (
        <div className="text-base text-gray-500 py-6 text-center">
          🎉 ยังไม่มีคำแนะนำค้าง — ระบบ healthy หรือ worker ยังไม่ได้วิเคราะห์
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-3">
          {data!.suggestions.map((s) => {
            const meta = SEVERITY_META[s.severity];
            const isActive = s.status === "open" || s.status === "acknowledged";
            return (
              <div
                key={s.id}
                className={`rounded-lg border ${meta.border} ${meta.bg} p-3 ${!isActive ? "opacity-50" : ""}`}
              >
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-2xl shrink-0">{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs uppercase font-bold ${meta.text}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-gray-500">· {s.category}</span>
                      <span className="text-xs text-gray-600 ml-auto">
                        {formatRelative(s.updatedAt)}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-100 leading-tight mt-0.5">
                      {s.title}
                    </h3>
                  </div>
                </div>

                <p className="text-sm text-gray-300 mb-2 whitespace-pre-wrap">
                  {s.description}
                </p>

                {s.targetFiles && (
                  <div className="mb-2">
                    <div className="text-[10px] uppercase text-gray-500 tracking-wide">
                      target files
                    </div>
                    <div className="text-xs font-mono text-indigo-300 break-all">
                      {s.targetFiles}
                    </div>
                  </div>
                )}

                {s.proposedChange && (
                  <div className="mb-2">
                    <div className="text-[10px] uppercase text-gray-500 tracking-wide">
                      proposed change
                    </div>
                    <pre className="text-xs font-mono text-gray-300 bg-black/40 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
                      {s.proposedChange}
                    </pre>
                  </div>
                )}

                {s.evidence && (
                  <div className="mb-2">
                    <div className="text-[10px] uppercase text-gray-500 tracking-wide">
                      evidence
                    </div>
                    <div className="text-xs font-mono text-gray-400 break-all">
                      {s.evidence}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-800/50">
                  <span className="text-[10px] text-gray-500">
                    {s.source ?? "system"} · {s.status}
                  </span>
                  {s.status === "open" && (
                    <>
                      <button
                        onClick={() => updateStatus(s.id, "acknowledged")}
                        className="ml-auto text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/40"
                      >
                        รับทราบ
                      </button>
                      <button
                        onClick={() => updateStatus(s.id, "dismissed")}
                        className="text-xs px-2 py-0.5 rounded bg-gray-700/40 text-gray-400 hover:bg-gray-700/60"
                      >
                        ยกเลิก
                      </button>
                    </>
                  )}
                  {s.status === "acknowledged" && (
                    <button
                      onClick={() => updateStatus(s.id, "resolved")}
                      className="ml-auto text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/40"
                    >
                      แก้เสร็จแล้ว
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
