"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { PROVIDER_COLORS, fmtTime } from "./shared";
import { getAdminAccess } from "./admin-access";
import { Badge, Card, CardHeader, CountUp, EmptyState, Reveal, Stat } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconAlert, IconCheck, IconX } from "./ui/icons";

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

const STATUS_META: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "warning", label: "รอสอบใหม่" },
  exam_passed: { tone: "success", label: "สอบผ่าน" },
  exam_failed: { tone: "danger", label: "สอบตก" },
  blacklisted: { tone: "danger", label: "แบนแล้ว" },
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

const scoreText = (score: number | null) => ((score ?? 0) >= 5 ? "text-emerald-300" : "text-rose-300");

// ─── Report Card Modal ────────────────────────────────────────────────────────
function ModalField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[12px] text-[var(--muted)]">{label}</div>
      <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-[13px] leading-relaxed text-gray-100">{children}</div>
    </div>
  );
}

function ModalRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right text-gray-100">{children}</span>
    </div>
  );
}

function ReportCardModal({
  complaint,
  onClose,
}: {
  complaint: Complaint;
  onClose: () => void;
}) {
  const status = STATUS_META[complaint.status] ?? STATUS_META.pending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal: .card uses backdrop-filter, which would trap a position:fixed child inside the panel.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`รายละเอียดข้อร้องเรียน ${complaint.model_id}`}
        className="animate-page max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0d14] p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--muted)]">รายละเอียดข้อร้องเรียน</div>
            <h3 className="mt-1 break-all text-[17px] font-semibold text-white">{complaint.model_id}</h3>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm shrink-0" aria-label="ปิด">
            <IconX size={16} />
          </button>
        </div>

        <div className="space-y-3 text-[13px]">
          <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <ModalRow label="ผู้ให้บริการ">{complaint.provider}</ModalRow>
            <ModalRow label="ประเภทร้องเรียน"><span className="text-amber-300">{complaint.category}</span></ModalRow>
            <ModalRow label="สถานะ"><Badge tone={status.tone}>{status.label}</Badge></ModalRow>
            <ModalRow label="วันที่ร้องเรียน"><span className="tabular-nums">{fmtTime(complaint.created_at)}</span></ModalRow>
          </div>

          {complaint.reason && <ModalField label="เหตุผล">{complaint.reason}</ModalField>}
          {complaint.user_message && <ModalField label="คำถามที่ถาม">{complaint.user_message}</ModalField>}
          {complaint.assistant_message && (
            <div>
              <div className="mb-1 text-[12px] text-[var(--muted)]">คำตอบที่ได้</div>
              <div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[13px] leading-relaxed text-rose-200">{complaint.assistant_message}</div>
            </div>
          )}

          {complaint.exam_question && (
            <div className="space-y-3 border-t border-white/10 pt-4">
              <div className="text-[13px] font-semibold text-white">ผลสอบใหม่</div>
              <ModalField label="ข้อสอบ">{complaint.exam_question}</ModalField>
              {complaint.exam_answer && (
                <ModalField label="คำตอบ">{complaint.exam_answer?.slice(0, 200)}</ModalField>
              )}
              <ModalRow label="คะแนนสอบใหม่">
                <span className={`font-semibold tabular-nums ${scoreText(complaint.exam_score)}`}>
                  {complaint.exam_score?.toFixed(1) ?? "0"}/10
                </span>
              </ModalRow>
              {complaint.exam_reasoning && (
                <div className="text-[12px] italic leading-relaxed text-[var(--muted)]">{complaint.exam_reasoning}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Most-complained models ───────────────────────────────────────────────────
function TopComplainedList({ topComplained }: { topComplained: TopComplained[] }) {
  if (topComplained.length === 0) return null;

  return (
    <section>
      <h4 className="text-[13px] font-semibold text-white">โมเดลที่ถูกร้องเรียนมากสุด</h4>
      <p className="mb-3 mt-0.5 text-[12px] text-[var(--muted)]">3 อันดับแรก พร้อมระดับความรุนแรงตามจำนวนครั้งที่ถูกร้องเรียน</p>
      <div className="grid gap-3 md:grid-cols-3">
        {topComplained.slice(0, 3).map((m, i) => {
          const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
          const level = m.complaint_count >= 10
            ? { label: "แบน 24 ชม.", tone: "danger" as Tone }
            : m.complaint_count >= 5
              ? { label: "เฝ้าระวังสูง", tone: "warning" as Tone }
              : { label: "ตักเตือน", tone: "neutral" as Tone };
          return (
            <Reveal key={m.model_id} i={i}>
              <div className="flex h-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-400/10 text-[13px] font-semibold tabular-nums text-rose-300 ring-1 ring-inset ring-rose-400/25">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px] text-gray-100">{m.model_id}</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className={`text-[11px] ${colors.text}`}>{m.provider}</span>
                    <Badge tone={level.tone}>{level.label}</Badge>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[20px] font-semibold leading-none tabular-nums text-white">{m.complaint_count}</div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">ครั้ง</div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

// ─── Main ComplaintPanel ──────────────────────────────────────────────────────
function Shell({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        icon={<IconAlert />}
        title="ข้อร้องเรียนโมเดล"
        subtitle="รายการร้องเรียนคุณภาพคำตอบของโมเดล พร้อมผลสอบใหม่และสถานะการแบน — คลิกที่แถวเพื่อดูรายละเอียด"
      />
      {children}
    </Card>
  );
}

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
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <Shell>
        <div className="space-y-3 p-5" aria-busy="true" aria-label="กำลังโหลดข้อมูลร้องเรียน">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24" />)}
          </div>
          <div className="skeleton h-32" />
        </div>
      </Shell>
    );
  }
  if (!data) return null;

  const { complaints, stats, top_complained, categories } = data;

  const statItems: Array<{ label: string; value: number; tone: Tone }> = [
    { label: "ทั้งหมด", value: stats.total, tone: "neutral" },
    { label: "รอสอบใหม่", value: stats.pending, tone: "warning" },
    { label: "สอบผ่าน", value: stats.passed, tone: "success" },
    { label: "สอบตก", value: stats.failed, tone: "danger" },
    { label: "ถูกแบน", value: stats.blacklisted, tone: "danger" },
  ];

  return (
    <>
      <Shell>
        <div className="space-y-6 p-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {statItems.map((s, i) => (
              <Reveal key={s.label} i={i}>
                <Stat label={s.label} tone={s.tone} value={<CountUp value={s.value} />} />
              </Reveal>
            ))}
          </div>

          <TopComplainedList topComplained={top_complained} />

          {/* Complaint list */}
          <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="border-b border-white/5 px-4 py-3">
              <h4 className="text-[13px] font-semibold text-white">ใบร้องเรียนล่าสุด</h4>
            </div>
            {complaints.length === 0 ? (
              <EmptyState
                icon={<IconCheck size={22} />}
                title="ยังไม่มีข้อร้องเรียน"
                description="โมเดลทุกตัวยังทำงานได้ดี — เมื่อมีการร้องเรียนคุณภาพคำตอบ รายการจะแสดงที่นี่"
              />
            ) : (
              <ul className="divide-y divide-white/5">
                {complaints.map(c => {
                  const status = STATUS_META[c.status] ?? STATUS_META.pending;
                  const catIcon = CATEGORY_ICONS[c.category] ?? "?";
                  const catLabel = categories[c.category] ?? c.category;
                  const colors = PROVIDER_COLORS[c.provider] ?? PROVIDER_COLORS.openrouter;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(c)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/50"
                      >
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-400/10 font-mono text-[11px] font-bold text-rose-300 ring-1 ring-inset ring-rose-400/20">
                          {catIcon}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="truncate font-mono text-[12.5px] font-medium text-gray-100">{c.model_id}</span>
                            <span className={`text-[11px] ${colors.text}`}>{c.provider}</span>
                            {c.source === "auto" && <Badge tone="info">AUTO</Badge>}
                          </div>
                          <div className="truncate text-[12px] text-[var(--muted)]">
                            {catLabel} {c.reason ? `- ${c.reason.slice(0, 60)}` : ""}
                            <span className="tabular-nums sm:hidden"> · {fmtTime(c.created_at)}</span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={status.tone}>{status.label}</Badge>
                          {c.exam_score !== null && (
                            <span className={`text-[11px] font-medium tabular-nums ${scoreText(c.exam_score)}`}>
                              {c.exam_score?.toFixed(1)}/10
                            </span>
                          )}
                        </div>

                        <div className="hidden w-20 shrink-0 text-right text-[12px] tabular-nums text-[var(--muted)] sm:block">
                          {fmtTime(c.created_at)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </Shell>

      {selected && <ReportCardModal complaint={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
