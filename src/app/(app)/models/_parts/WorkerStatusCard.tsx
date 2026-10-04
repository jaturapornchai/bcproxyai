"use client";

import { useEffect, useState } from "react";
import { CircleProgress, GlowDot, fmtCountdown, fmtTime } from "@/components/shared";
import type { WorkerStatus } from "@/components/shared";
import { IconRefresh } from "@/components/ui/icons";
import { Badge, Button, Card } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";

const STATE: Record<WorkerStatus["status"], { label: string; tone: Tone; pct: number; color: string }> = {
  running: { label: "กำลังตรวจสอบโมเดล", tone: "warning", pct: 66, color: "#fbbf24" },
  idle:    { label: "พร้อม — รอรอบถัดไป", tone: "accent", pct: 100, color: "#8b7bff" },
  error:   { label: "มีปัญหา", tone: "danger", pct: 33, color: "#fb7185" },
};

/** Re-renders only this subtree every second so the page itself stays still. */
function Countdown({ iso }: { iso: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular-nums">{fmtCountdown(iso)}</span>;
}

interface WorkerStatusCardProps {
  worker: WorkerStatus | undefined;
  isAdmin: boolean;
  triggering: boolean;
  lastRefresh: Date | null;
  onTrigger: () => void;
}

export function WorkerStatusCard({ worker, isAdmin, triggering, lastRefresh, onTrigger }: WorkerStatusCardProps) {
  const status = worker?.status ?? "idle";
  const s = STATE[status] ?? STATE.error; // unknown status from the API → red, as the old dashboard did

  return (
    <Card glow className="p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <CircleProgress pct={s.pct} color={s.color} />
            <div className="absolute inset-0 flex items-center justify-center">
              <GlowDot status={status} />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[16px] font-semibold text-white">ครูใหญ่</h3>
              <Badge tone={s.tone} dot={status === "running"}>{s.label}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-[var(--muted)]">ระบบอัตโนมัติที่คอยสอบและตรวจสุขภาพโมเดลทุกตัว</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1.5 text-[12px] sm:grid-cols-2">
              <div className="flex gap-2"><dt className="text-[var(--muted)]">ตรวจล่าสุด</dt><dd className="text-gray-200">{fmtTime(worker?.lastRun ?? null)}</dd></div>
              <div className="flex gap-2"><dt className="text-[var(--muted)]">รอบถัดไป</dt><dd className="text-gray-200">{fmtTime(worker?.nextRun ?? null)}</dd></div>
              {worker?.judgeModel && (
                <div className="flex min-w-0 gap-2 sm:col-span-2">
                  <dt className="shrink-0 text-[var(--muted)]">ผู้ตรวจ</dt>
                  <dd className="truncate font-mono text-cyan-300" title={worker.judgeModel}>{worker.judgeModel}</dd>
                </div>
              )}
              {worker?.nextRun && status !== "running" && (
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="text-[var(--muted)]">นับถอยหลัง</dt>
                  <dd className="font-medium text-violet-300"><Countdown iso={worker.nextRun} /></dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 lg:items-end">
          {isAdmin && (
            <Button variant="primary" onClick={onTrigger} disabled={triggering || status === "running"}>
              <IconRefresh size={16} className={triggering ? "animate-spin" : ""} />
              {triggering ? "กำลังสั่ง…" : "สั่งตรวจ/สอบเลยตอนนี้"}
            </Button>
          )}
          {lastRefresh && (
            <span className="text-[11px] text-[var(--muted)]">รีเฟรชข้อมูลล่าสุด {lastRefresh.toLocaleTimeString("th-TH")}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
