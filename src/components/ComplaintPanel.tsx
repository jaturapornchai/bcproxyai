"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_COLORS, fmtTime } from "./shared";
import { getAdminAccess } from "./admin-access";

interface Complaint {
  id: number;
  model_id: string;
  provider: string;
  nickname: string | null;
  category: string;
  reason: string | null;
  user_message: string | null;
  assistant_message: string | null;
  source: string;
  status: string;
  created_at: string;
  exam_score: number | null;
  exam_passed: number | null;
  exam_question: string | null;
  exam_answer: string | null;
  exam_reasoning: string | null;
}

interface ComplaintStats {
  total: number;
  pending: number;
  passed: number;
  failed: number;
  blacklisted: number;
}

interface TopComplained {
  model_id: string;
  provider: string;
  nickname: string | null;
  complaint_count: number;
}

interface ComplaintData {
  complaints: Complaint[];
  stats: ComplaintStats;
  top_complained: TopComplained[];
  categories: Record<string, string>;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "รอสอบใหม่" },
  exam_passed: { bg: "bg-green-500/20", text: "text-green-400", label: "สอบผ่าน" },
  exam_failed: { bg: "bg-red-500/20", text: "text-red-400", label: "สอบตก" },
  blacklisted: { bg: "bg-red-700/30", text: "text-red-300", label: "แบนแล้ว" },
};

const CATEGORY_ICONS: Record<string, string> = {
  wrong_answer: "X",
  gibberish: "?!",
  wrong_language: "EN",
  refused: "--",
  hallucination: "!!",
  too_short: "..",
  irrelevant: ">>",
};

// ─── Report Card Modal ────────────────────────────────────────────────────────
function ReportCardModal({
  complaint,
  onClose,
}: {
  complaint: Complaint;
  onClose: () => void;
}) {
  const statusStyle = STATUS_STYLES[complaint.status] ?? STATUS_STYLES.pending;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl max-w-lg w-full p-6 border border-gray-700" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-bold text-amber-400">
            สมุดพก - {complaint.model_id}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">ผู้ให้บริการ</span>
            <span className="text-white">{complaint.provider}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">ประเภทร้องเรียน</span>
            <span className="text-orange-400">{complaint.category}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">สถานะ</span>
            <span className={`${statusStyle.text} font-bold`}>{statusStyle.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">วันที่ร้องเรียน</span>
            <span className="text-white">{fmtTime(complaint.created_at)}</span>
          </div>

          {complaint.reason && (
            <div>
              <div className="text-gray-400 mb-1">เหตุผล</div>
              <div className="bg-gray-700/50 rounded p-2 text-white">{complaint.reason}</div>
            </div>
          )}

          {complaint.user_message && (
            <div>
              <div className="text-gray-400 mb-1">คำถามที่ถาม</div>
              <div className="bg-gray-700/50 rounded p-2 text-white">{complaint.user_message}</div>
            </div>
          )}

          {complaint.assistant_message && (
            <div>
              <div className="text-gray-400 mb-1">คำตอบที่ได้</div>
              <div className="bg-red-900/30 rounded p-2 text-red-300">{complaint.assistant_message}</div>
            </div>
          )}

          {complaint.exam_question && (
            <div className="border-t border-gray-700 pt-3 mt-3">
              <div className="text-amber-400 font-bold mb-2">ผลสอบใหม่</div>
              <div className="text-gray-400 mb-1">ข้อสอบ</div>
              <div className="bg-gray-700/50 rounded p-2 text-white mb-2">{complaint.exam_question}</div>
              {complaint.exam_answer && (
                <>
                  <div className="text-gray-400 mb-1">คำตอบ</div>
                  <div className="bg-gray-700/50 rounded p-2 text-white mb-2">{complaint.exam_answer?.slice(0, 200)}</div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-gray-400">คะแนนสอบใหม่</span>
                <span className={`font-bold ${(complaint.exam_score ?? 0) >= 5 ? "text-green-400" : "text-red-400"}`}>
                  {complaint.exam_score?.toFixed(1) ?? "0"}/10
                </span>
              </div>
              {complaint.exam_reasoning && (
                <div className="mt-2 text-xs text-gray-400 italic">{complaint.exam_reasoning}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Hall of Fame/Shame ───────────────────────────────────────────────────────
function HallOfFameShame({ topComplained }: { topComplained: TopComplained[] }) {
  if (topComplained.length === 0) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(360px,1fr))] gap-4 mb-4">
      {/* Hall of Shame */}
      <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-4">
        <h4 className="text-red-400 font-bold mb-3 text-center">
          ป้ายอับอาย - Hall of Shame
        </h4>
        <div className="space-y-2">
          {topComplained.slice(0, 3).map((m, i) => {
            const dunce = i === 0 ? " - หมวกโง่" : i === 1 ? " - ตัวป่วน" : " - ขี้โกง";
            const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
            return (
              <div key={m.model_id} className="flex items-center gap-3 bg-gray-800/50 rounded-lg p-2">
                <div className="text-2xl w-8 text-center">
                  {i === 0 ? "🤡" : i === 1 ? "😭" : "😤"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-amber-300 text-sm font-medium truncate">
                    {m.model_id}
                  </div>
                  <div className={`text-xs ${colors.text}`}>{m.provider}{dunce}</div>
                </div>
                <div className="text-red-400 font-bold text-lg">
                  {m.complaint_count}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detention Board */}
      <div className="bg-orange-900/20 border border-orange-800/30 rounded-xl p-4">
        <h4 className="text-orange-400 font-bold mb-3 text-center">
          กระดานลงโทษ - Detention Board
        </h4>
        <div className="space-y-2">
          {topComplained.slice(0, 3).map((m) => {
            const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
            const severity = m.complaint_count >= 5 ? "bg-red-500/30 border-red-500/50" :
              m.complaint_count >= 3 ? "bg-orange-500/20 border-orange-500/40" :
              "bg-yellow-500/10 border-yellow-500/30";
            return (
              <div key={m.model_id} className={`${severity} border rounded-lg p-2 flex items-center gap-2`}>
                <span className="text-xl">
                  {m.complaint_count >= 5 ? "🚫" : m.complaint_count >= 3 ? "⚠️" : "📝"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm truncate">{m.model_id}</div>
                  <div className={`text-xs ${colors.text}`}>{m.provider}</div>
                </div>
                <div className="text-right">
                  <div className="text-orange-400 font-mono text-sm">{m.complaint_count} ครั้ง</div>
                  <div className="text-xs text-gray-500">
                    {m.complaint_count >= 10 ? "แบน 24 ชม." :
                     m.complaint_count >= 5 ? "อยู่ห้องกัก" :
                     "ถูกตักเตือน"}
                  </div>
                </div>
              </div>
            );
          })}
          {topComplained.length === 0 && (
            <div className="text-center text-gray-500 py-4">ยังไม่มีนักเรียนถูกลงโทษ</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main ComplaintPanel ──────────────────────────────────────────────────────
export function ComplaintPanel() {
  const [data, setData] = useState<ComplaintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Complaint | null>(null);

  const fetchData = useCallback(async () => {
    try {
      if (!(await getAdminAccess())) {
        setData(null);
        return;
      }
      const res = await fetch("/api/complaint?limit=20");
      if (res.ok) {
        setData(await res.json());
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) return <div className="text-gray-500 text-center py-8">กำลังโหลดข้อมูลร้องเรียน...</div>;
  if (!data) return null;

  const { complaints, stats, top_complained, categories } = data;

  return (
    <div>
      {/* Stats Bar */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-4">
        {[
          { label: "ร้องเรียนทั้งหมด", value: stats.total, color: "text-white" },
          { label: "รอสอบใหม่", value: stats.pending, color: "text-yellow-400" },
          { label: "สอบผ่าน", value: stats.passed, color: "text-green-400" },
          { label: "สอบตก", value: stats.failed, color: "text-red-400" },
          { label: "ถูกแบน", value: stats.blacklisted, color: "text-red-300" },
        ].map(s => (
          <div key={s.label} className="bg-gray-800/50 rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-400">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Hall of Fame/Shame + Detention Board */}
      <HallOfFameShame topComplained={top_complained} />

      {/* Complaint List */}
      <div className="bg-gray-800/30 rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700/50">
          <h4 className="text-white font-medium">ใบร้องเรียนล่าสุด</h4>
        </div>
        <div className="divide-y divide-gray-700/30">
          {complaints.length === 0 ? (
            <div className="text-center text-gray-500 py-8">ยังไม่มีใบร้องเรียน - นักเรียนทุกคนประพฤติดี!</div>
          ) : (
            complaints.map(c => {
              const statusStyle = STATUS_STYLES[c.status] ?? STATUS_STYLES.pending;
              const catIcon = CATEGORY_ICONS[c.category] ?? "?";
              const catLabel = categories[c.category] ?? c.category;
              const colors = PROVIDER_COLORS[c.provider] ?? PROVIDER_COLORS.openrouter;
              return (
                <div
                  key={c.id}
                  className="px-4 py-3 hover:bg-gray-700/20 cursor-pointer flex items-center gap-3"
                  onClick={() => setSelected(c)}
                >
                  {/* Category icon */}
                  <div className="w-9 h-9 rounded-lg bg-red-900/30 flex items-center justify-center text-red-400 font-mono text-xs font-bold shrink-0">
                    {catIcon}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-300 text-sm font-medium truncate">
                        {c.model_id}
                      </span>
                      <span className={`text-xs ${colors.text}`}>{c.provider}</span>
                      {c.source === "auto" && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 rounded">AUTO</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {catLabel} {c.reason ? `- ${c.reason.slice(0, 60)}` : ""}
                    </div>
                  </div>

                  {/* Status + Score */}
                  <div className="text-right shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                    {c.exam_score !== null && (
                      <div className={`text-xs mt-1 ${(c.exam_score ?? 0) >= 5 ? "text-green-400" : "text-red-400"}`}>
                        {c.exam_score?.toFixed(1)}/10
                      </div>
                    )}
                  </div>

                  {/* Time */}
                  <div className="text-xs text-gray-500 shrink-0 w-20 text-right">
                    {fmtTime(c.created_at)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Report Card Modal */}
      {selected && <ReportCardModal complaint={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
