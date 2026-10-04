"use client";

import { useEffect, useState } from "react";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";
import { IconBook } from "@/components/ui/icons";
import type { StatusData, WorkerLog } from "@/components/shared";

const STEP_TONE: Record<string, Tone> = { scan: "info", health: "success", worker: "neutral" };
const LEVEL_TEXT: Record<string, string> = {
  info: "text-gray-300",
  warn: "text-amber-300",
  error: "text-rose-300",
  success: "text-emerald-300",
};

function fmtLogTime(iso: string): string {
  const raw = iso.includes("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(raw).toLocaleString("th-TH", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Background worker activity (model scans, health checks). Owner-only data. */
export function WorkerLogs() {
  const [logs, setLogs] = useState<WorkerLog[] | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const s = (await res.json()) as StatusData;
        setLogs(Array.isArray(s?.recentLogs) ? s.recentLogs : []);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<IconBook size={18} />}
        title="บันทึกการทำงานของ worker"
        subtitle={`ระบบเบื้องหลังที่สแกนโมเดลและตรวจสุขภาพ provider · ${logs?.length ?? 0} รายการล่าสุด`}
      />
      <div className="mt-4 max-h-[26rem] overflow-y-auto border-t border-white/5">
        {!logs ? (
          <div className="space-y-2 p-5">
            <div className="skeleton h-8" />
            <div className="skeleton h-8" />
            <div className="skeleton h-8" />
          </div>
        ) : logs.length === 0 ? (
          <EmptyState title="ยังไม่มีบันทึก" description="เมื่อ worker เริ่มทำงาน ขั้นตอนต่าง ๆ จะแสดงที่นี่" />
        ) : (
          <ul className="divide-y divide-white/5 font-mono text-[12px]">
            {logs.map((log, i) => (
              <li key={i} className="flex flex-col gap-1 px-5 py-2.5 hover:bg-white/[0.03] sm:flex-row sm:items-start sm:gap-3">
                <span className="w-44 shrink-0 tabular-nums text-[var(--muted)]">{fmtLogTime(log.createdAt)}</span>
                <span className="shrink-0"><Badge tone={STEP_TONE[log.step] ?? "neutral"}>{log.step}</Badge></span>
                <span className={`min-w-0 break-words leading-relaxed ${LEVEL_TEXT[log.level] ?? "text-gray-300"}`}>{log.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
