"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getAdminAccess } from "./admin-access";
import { Badge, Button, Card, CardHeader, EmptyState } from "./ui/ui";
import { IconCheck, IconCompass } from "./ui/icons";

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

// chip = pill colours, accent = left edge of the suggestion card
const SEVERITY_META: Record<Severity, { label: string; chip: string; accent: string }> = {
  critical: { label: "วิกฤต", chip: "bg-rose-400/10 text-rose-300 ring-rose-400/25", accent: "border-l-rose-400" },
  high: { label: "สูง", chip: "bg-orange-400/10 text-orange-300 ring-orange-400/25", accent: "border-l-orange-400" },
  warn: { label: "เตือน", chip: "bg-amber-400/10 text-amber-300 ring-amber-400/25", accent: "border-l-amber-400" },
  info: { label: "แนะนำ", chip: "bg-cyan-400/10 text-cyan-200 ring-cyan-400/25", accent: "border-l-cyan-400" },
};

const STATUS_LABEL: Record<Status, string> = {
  open: "รอดำเนินการ",
  acknowledged: "รับทราบแล้ว",
  resolved: "แก้เสร็จแล้ว",
  dismissed: "ยกเลิกแล้ว",
};

function SeverityChip({ severity, children }: { severity: Severity; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${SEVERITY_META[severity].chip}`}>
      {children}
    </span>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted)]">{label}</div>
      {children}
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

export function DevSuggestionsPanel() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      if (!(await getAdminAccess())) {
        setData(null);
        return;
      }
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
      if (!(await getAdminAccess())) return;
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
    <Card>
      <CardHeader
        icon={<IconCompass />}
        title="คำแนะนำสำหรับนักพัฒนา"
        subtitle="ปัญหาที่ระบบ AI พบในส่วน core ซึ่งแก้ไขเองไม่ได้ (ตามกฎ no-hardcode และ no-edit-core) — บันทึกไว้ให้นักพัฒนามาปรับปรุง"
        action={
          <Button size="sm" onClick={() => setShowResolved((v) => !v)} aria-pressed={showResolved}>
            {showResolved ? "ซ่อนที่จบแล้ว" : "แสดงทั้งหมด"}
          </Button>
        }
      />

      {data && (
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          {data.counts.critical > 0 && <SeverityChip severity="critical">วิกฤต {data.counts.critical}</SeverityChip>}
          {data.counts.high > 0 && <SeverityChip severity="high">สูง {data.counts.high}</SeverityChip>}
          {data.counts.warn > 0 && <SeverityChip severity="warn">เตือน {data.counts.warn}</SeverityChip>}
          <Badge tone="neutral">{data.counts.open} รอดำเนินการ</Badge>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 p-5 lg:grid-cols-2" aria-busy="true" aria-label="กำลังโหลดคำแนะนำ">
          {[0, 1].map(i => <div key={i} className="skeleton h-40" />)}
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={<IconCheck size={22} />}
          title="ยังไม่มีคำแนะนำค้าง"
          description="ระบบอยู่ในสภาพดี หรือ worker ยังไม่ได้วิเคราะห์ — เมื่อพบปัญหาในส่วน core จะบันทึกไว้ที่นี่"
        />
      ) : (
        <div className="grid gap-3 p-5 lg:grid-cols-2">
          {data!.suggestions.map((s) => {
            const meta = SEVERITY_META[s.severity];
            const isActive = s.status === "open" || s.status === "acknowledged";
            return (
              <article
                key={s.id}
                className={`flex flex-col rounded-xl border border-l-2 border-white/10 ${meta.accent} bg-white/[0.03] p-4 ${!isActive ? "opacity-50" : ""}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <SeverityChip severity={s.severity}>{meta.label}</SeverityChip>
                  <span className="text-[12px] text-[var(--muted)]">{s.category}</span>
                  <span className="ml-auto text-[12px] tabular-nums text-[var(--muted)]">{formatRelative(s.updatedAt)}</span>
                </div>
                <h3 className="text-[15px] font-semibold leading-snug text-white">{s.title}</h3>

                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-gray-300">
                  {s.description}
                </p>

                {(s.targetFiles || s.proposedChange || s.evidence) && (
                  <div className="mt-3 space-y-3">
                    {s.targetFiles && (
                      <Detail label="ไฟล์ที่เกี่ยวข้อง">
                        <div className="break-all font-mono text-[12px] text-violet-200">{s.targetFiles}</div>
                      </Detail>
                    )}
                    {s.proposedChange && (
                      <Detail label="แนวทางแก้ไขที่เสนอ">
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-white/5 bg-black/40 p-2.5 font-mono text-[12px] text-gray-300">
                          {s.proposedChange}
                        </pre>
                      </Detail>
                    )}
                    {s.evidence && (
                      <Detail label="หลักฐาน">
                        <div className="break-all font-mono text-[12px] text-[var(--muted)]">{s.evidence}</div>
                      </Detail>
                    )}
                  </div>
                )}

                <div className="mt-auto pt-4">
                  <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                    <span className="text-[11px] text-[var(--muted)]">
                      {s.source ?? "system"} · {STATUS_LABEL[s.status]}
                    </span>
                    {s.status === "open" && (
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => updateStatus(s.id, "acknowledged")}>
                          รับทราบ
                        </Button>
                        <Button size="sm" onClick={() => updateStatus(s.id, "dismissed")}>
                          ยกเลิก
                        </Button>
                      </div>
                    )}
                    {s.status === "acknowledged" && (
                      <Button size="sm" variant="primary" className="ml-auto" onClick={() => updateStatus(s.id, "resolved")}>
                        แก้เสร็จแล้ว
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
