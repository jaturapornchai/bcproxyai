"use client";

import { useCallback, useEffect, useState } from "react";
import { ProviderBadge } from "./shared";
import { IconCheck, IconSparkle } from "./ui/icons";
import { Badge, Card, CardHeader, EmptyState } from "./ui/ui";

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

const ROLE_META: Record<Teacher["role"], { label: string; border: string; bg: string; text: string }> = {
  principal: { label: "ครูใหญ่", border: "border-amber-400/35", bg: "bg-gradient-to-br from-amber-400/[0.12] to-orange-400/[0.05]", text: "text-amber-300" },
  head:      { label: "หัวหน้าแผนก", border: "border-violet-400/30", bg: "bg-gradient-to-br from-violet-400/[0.10] to-fuchsia-400/[0.04]", text: "text-violet-300" },
  proctor:   { label: "ครูคุมสอบ", border: "border-cyan-400/30", bg: "bg-gradient-to-br from-cyan-400/[0.10] to-teal-400/[0.04]", text: "text-cyan-300" },
};

const GRADER_ROLE_LABEL: Record<string, string> = { principal: "ครูใหญ่", head: "หัวหน้าแผนก", proctor: "ครูคุมสอบ" };

function TeacherCard({ t }: { t: Teacher }) {
  const meta = ROLE_META[t.role];
  const scorePct = t.score * 100;
  const categoryThai = t.category ? (CATEGORY_THAI[t.category] ?? t.category) : null;

  return (
    <div className={`rounded-2xl border p-3.5 transition-transform duration-300 hover:-translate-y-0.5 ${meta.border} ${meta.bg}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`text-[11px] font-medium uppercase tracking-wider ${meta.text}`}>{meta.label}</div>
          {categoryThai && <div className="mt-0.5 text-[13px] font-semibold text-white">{categoryThai}</div>}
        </div>
        <span className={`shrink-0 text-[16px] font-semibold tabular-nums ${t.role === "head" && scorePct >= 80 ? "text-emerald-300" : meta.text}`} title="คะแนน">
          {t.role === "head" ? `${scorePct.toFixed(0)}%` : scorePct.toFixed(1)}
        </span>
      </div>
      <div className="mb-1.5"><ProviderBadge provider={t.provider} /></div>
      <div className="truncate font-mono text-[11px] text-gray-300" title={t.modelId}>{t.modelId.replace(/^[a-z]+:/, "")}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)} วิ`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} น.`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ชม.`;
  return `${Math.round(diff / 86_400_000)} วัน`;
}

function methodLabel(method: string): string {
  if (method === "rule-based") return "ตามกฎ";
  if (method === "ai-grader") return "AI ตรวจ";
  if (method === "hybrid") return "ผสม";
  return method;
}

function RoleGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[13px] font-semibold text-white">{title}</span>
        <span className="text-[12px] text-[var(--muted)]">{hint}</span>
      </div>
      {children}
    </div>
  );
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
      <Card className="p-5">
        <div className="skeleton mb-4 h-6 w-48" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-24" />)}
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <EmptyState icon={<IconSparkle size={22} />} title="โหลดข้อมูลคณะครูไม่สำเร็จ" description="ลองรีเฟรชหน้านี้อีกครั้ง" />
      </Card>
    );
  }

  const noTeachers = !data.principal && data.heads.length === 0 && data.proctors.length === 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="คณะครู (ผู้ตรวจข้อสอบ)"
          subtitle="โมเดลที่คะแนนดีที่สุดจะถูกแต่งตั้งเป็นครูโดยอัตโนมัติ เพื่อคุมสอบและตรวจข้อสอบให้โมเดลอื่น"
          icon={<IconCheck size={18} />}
          action={
            <div className="flex flex-wrap justify-end gap-1.5">
              <Badge tone="warning">ครูใหญ่ {data.totals.principal}</Badge>
              <Badge tone="accent">หัวหน้า {data.totals.heads}</Badge>
              <Badge tone="info">คุมสอบ {data.totals.proctors}</Badge>
            </div>
          }
        />

        {noTeachers ? (
          <EmptyState
            icon={<IconSparkle size={22} />}
            title="ยังไม่มีครู"
            description="รอให้ worker ทำงานรอบแรกก่อน — ระบบจะแต่งตั้งครูอัตโนมัติจากผลสอบและคะแนนการใช้งานจริง"
          />
        ) : (
          <div className="space-y-6 p-5">
            {data.principal && (
              <RoleGroup title="ครูใหญ่ (Principal)" hint="ตัดสินข้อพิพาท และเป็นผู้ตรวจสำรอง">
                <div className="max-w-md"><TeacherCard t={data.principal} /></div>
              </RoleGroup>
            )}
            {data.heads.length > 0 && (
              <RoleGroup title="หัวหน้าแผนก (Heads)" hint="ตรวจข้อสอบเฉพาะหมวดวิชา">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.heads.map((h) => <TeacherCard key={h.modelId} t={h} />)}
                </div>
              </RoleGroup>
            )}
            {data.proctors.length > 0 && (
              <RoleGroup title="ครูคุมสอบ (Proctors)" hint="ยิงคำถามและจับเวลา">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.proctors.map((p) => <TeacherCard key={p.modelId} t={p} />)}
                </div>
              </RoleGroup>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="ประวัติการตรวจข้อสอบ"
          subtitle={`${data.recentGradings.length} รายการล่าสุด — ใครตรวจข้อไหน ด้วยวิธีอะไร ได้กี่คะแนนเต็ม 10`}
        />
        <div className="p-5">
          {data.recentGradings.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-[var(--muted)]">ยังไม่มีประวัติ — จะเริ่มบันทึกเมื่อ worker สอบรอบถัดไป</p>
          ) : (
            <div className="max-h-[360px] overflow-auto font-mono text-[11px]">
              {data.recentGradings.map((g) => (
                <div key={g.id} className="flex items-center gap-3 whitespace-nowrap border-b border-white/[0.05] py-1.5 last:border-0">
                  <span className="w-10 shrink-0 tabular-nums text-[var(--muted)]">{formatRelative(g.gradedAt)}</span>
                  <span className="w-20 shrink-0 text-gray-400">{GRADER_ROLE_LABEL[g.graderRole] ?? g.graderRole}</span>
                  <span className="max-w-[200px] shrink-0 truncate text-gray-300" title={g.graderModelId}>{g.graderModelId.replace(/^[a-z]+:/, "")}</span>
                  <span className="text-[var(--muted)]">→</span>
                  <span className="max-w-[140px] shrink-0 truncate text-violet-300">{g.questionId}</span>
                  <span className="shrink-0 text-[var(--muted)]">{methodLabel(g.method)}</span>
                  <span
                    className={`ml-auto shrink-0 font-semibold tabular-nums ${
                      g.finalScore >= 7 ? "text-emerald-300" : g.finalScore >= 5 ? "text-amber-300" : "text-rose-300"
                    }`}
                  >
                    {g.finalScore.toFixed(0)}/10
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
