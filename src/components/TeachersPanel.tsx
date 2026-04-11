"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";

interface Teacher {
  modelId: string;
  role: "principal" | "head" | "proctor";
  category: string | null;
  score: number;
  provider: string;
  modelName: string;
  appointedAt: string;
}

interface Grading {
  id: number;
  graderModelId: string;
  graderRole: string;
  questionId: string;
  category: string;
  finalScore: number;
  method: string;
  gradedAt: string;
}

interface TeachersResponse {
  principal: Teacher | null;
  heads: Teacher[];
  proctors: Teacher[];
  totals: { principal: number; heads: number; proctors: number };
  recentGradings: Grading[];
}

const CATEGORY_THAI: Record<string, string> = {
  thai: "ภาษาไทย",
  code: "เขียนโค้ด",
  math: "คณิตศาสตร์",
  tools: "เครื่องมือ",
  vision: "ดูรูป",
  safety: "ความปลอดภัย",
  reasoning: "เหตุผล",
  instruction: "ทำตามคำสั่ง",
  json: "JSON",
  extraction: "ดึงข้อมูล",
  classification: "จำแนก",
  comprehension: "อ่านจับใจความ",
};

const ROLE_META: Record<
  Teacher["role"],
  { icon: string; label: string; border: string; bg: string; text: string }
> = {
  principal: {
    icon: "👑",
    label: "ครูใหญ่",
    border: "border-amber-500/40",
    bg: "bg-gradient-to-br from-amber-500/10 to-orange-500/10",
    text: "text-amber-300",
  },
  head: {
    icon: "📋",
    label: "หัวหน้าแผนก",
    border: "border-indigo-500/40",
    bg: "bg-gradient-to-br from-indigo-500/10 to-purple-500/10",
    text: "text-indigo-300",
  },
  proctor: {
    icon: "👥",
    label: "ครูคุมสอบ",
    border: "border-cyan-500/40",
    bg: "bg-gradient-to-br from-cyan-500/10 to-teal-500/10",
    text: "text-cyan-300",
  },
};

function TeacherCard({ t, highlight = false }: { t: Teacher; highlight?: boolean }) {
  const meta = ROLE_META[t.role];
  const scorePct = t.score * 100;
  const categoryThai = t.category ? (CATEGORY_THAI[t.category] ?? t.category) : null;
  const scoreColor =
    t.role === "head"
      ? scorePct >= 80
        ? "text-emerald-300"
        : "text-cyan-300"
      : meta.text;

  return (
    <div
      className={`rounded-lg border ${meta.border} ${meta.bg} p-3 ${highlight ? "shadow-lg shadow-amber-500/10" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{meta.icon}</span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className={`text-[10px] uppercase tracking-wide ${meta.text}`}>
            {meta.label}
          </span>
          {categoryThai && (
            <span className={`text-xs font-semibold ${scoreColor}`}>
              {categoryThai}
            </span>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <ProviderBadge provider={t.provider} />
          </div>
        </div>
        {t.role === "head" && (
          <span
            className={`text-base font-bold shrink-0 ${scoreColor}`}
            title="exam category score"
          >
            {scorePct.toFixed(0)}%
          </span>
        )}
      </div>
      <div className="text-xs text-gray-300 font-mono truncate" title={t.modelId}>
        {t.modelId.replace(/^[a-z]+:/, "")}
      </div>
      {t.role !== "head" && (
        <div className="flex justify-between items-center mt-2">
          <span className="text-[10px] text-gray-500">score</span>
          <span className={`text-sm font-bold ${meta.text}`}>
            {scorePct.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

function methodIcon(method: string): string {
  if (method === "rule-based") return "📐";
  if (method === "ai-grader") return "🧠";
  if (method === "hybrid") return "🔀";
  return "❔";
}

export function TeachersPanel() {
  const [data, setData] = useState<TeachersResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/teachers");
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-4 text-gray-500 text-sm">
        กำลังโหลดข้อมูลคณะครู…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="glass rounded-2xl p-4 text-gray-500 text-sm">
        ไม่สามารถโหลดข้อมูลคณะครูได้
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass rounded-2xl p-4 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white text-base">
              🏫
            </span>
            คณะครู (Teacher Hierarchy)
          </h2>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
              {data.totals.principal} 👑
            </span>
            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
              {data.totals.heads} 📋
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
              {data.totals.proctors} 👥
            </span>
          </div>
        </div>

        {!data.principal && data.heads.length === 0 && data.proctors.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            ยังไม่มีครู — รอให้ worker cycle รันก่อน (แต่งตั้งอัตโนมัติจาก exam + live score)
          </div>
        ) : (
          <>
            {/* Principal — center spotlight */}
            {data.principal && (
              <div className="mb-4">
                <div className="text-[10px] text-amber-400 uppercase tracking-wide mb-2">
                  👑 ครูใหญ่ (Principal) — ตัดสินข้อพิพาท, fallback judge
                </div>
                <div className="max-w-md">
                  <TeacherCard t={data.principal} highlight />
                </div>
              </div>
            )}

            {/* Heads — per category */}
            {data.heads.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-indigo-400 uppercase tracking-wide mb-2">
                  📋 หัวหน้าแผนก (Heads) — ตรวจข้อสอบเฉพาะหมวด
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2">
                  {data.heads.map((h) => (
                    <TeacherCard key={h.modelId} t={h} />
                  ))}
                </div>
              </div>
            )}

            {/* Proctors — list */}
            {data.proctors.length > 0 && (
              <div>
                <div className="text-[10px] text-cyan-400 uppercase tracking-wide mb-2">
                  👥 ครูคุมสอบ (Proctors) — ยิงคำถาม วัดเวลา
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2">
                  {data.proctors.map((p) => (
                    <TeacherCard key={p.modelId} t={p} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Recent Gradings */}
      <div className="glass rounded-2xl p-4 border border-white/10">
        <h3 className="text-base font-bold text-gray-200 flex items-center gap-2 mb-3">
          📜 ประวัติการตรวจ (Grading History)
          <span className="text-xs text-gray-500 font-normal">
            {data.recentGradings.length} records
          </span>
        </h3>

        {data.recentGradings.length === 0 ? (
          <div className="text-sm text-gray-500 py-3 text-center">
            ยังไม่มีประวัติการตรวจ — จะเริ่มบันทึกเมื่อ worker รอบถัดไปสอบ
          </div>
        ) : (
          <div className="space-y-1 max-h-[320px] overflow-y-auto pr-2 font-mono text-[11px]">
            {data.recentGradings.map((g) => {
              const roleIcon =
                g.graderRole === "principal"
                  ? "👑"
                  : g.graderRole === "head"
                    ? "📋"
                    : g.graderRole === "proctor"
                      ? "👥"
                      : "📐";
              return (
                <div
                  key={g.id}
                  className="flex items-start gap-2 py-1 border-b border-gray-800/40 last:border-0"
                >
                  <span className="text-gray-600 shrink-0 w-10">
                    {formatRelative(g.gradedAt)}
                  </span>
                  <span className="shrink-0" title={g.graderRole}>
                    {roleIcon}
                  </span>
                  <span className="shrink-0 text-gray-400 truncate max-w-[200px]">
                    {g.graderModelId.replace(/^[a-z]+:/, "")}
                  </span>
                  <span className="text-gray-600">→</span>
                  <span className="shrink-0 text-indigo-300 truncate max-w-[120px]">
                    {g.questionId}
                  </span>
                  <span className="text-gray-500 shrink-0">
                    {methodIcon(g.method)}
                  </span>
                  <span
                    className={`ml-auto shrink-0 font-bold ${
                      g.finalScore >= 7
                        ? "text-emerald-300"
                        : g.finalScore >= 5
                          ? "text-amber-300"
                          : "text-red-300"
                    }`}
                  >
                    {g.finalScore.toFixed(0)}/10
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
