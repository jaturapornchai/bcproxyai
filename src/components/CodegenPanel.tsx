"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardHeader, EmptyState } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconBook } from "./ui/icons";

interface CodegenEntry {
  id: number;
  filename: string;
  purpose: string;
  kind: string;
  sizeBytes: number;
  lines: number;
  source: string | null;
  outcome: string | null;
  createdAt: string;
}

interface CodegenResponse {
  entries: CodegenEntry[];
  totalCount: number;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_COLOR: Record<string, string> = {
  analysis: "text-cyan-300",
  migration: "text-violet-300",
  script: "text-amber-300",
  test: "text-pink-300",
  component: "text-indigo-300",
  api: "text-emerald-300",
  fix: "text-orange-300",
  refactor: "text-teal-300",
  feature: "text-fuchsia-300",
  other: "text-gray-300",
};

function outcomeBadge(outcome: string | null): { label: string; tone: Tone } {
  if (!outcome) return { label: "รอผล", tone: "neutral" };
  if (/success|ok|passed|200/i.test(outcome)) return { label: "สำเร็จ", tone: "success" };
  if (/fail|error|500|❌/i.test(outcome)) return { label: "ล้มเหลว", tone: "danger" };
  return { label: "รอผล", tone: "neutral" };
}

export function CodegenPanel() {
  const [data, setData] = useState<CodegenResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/codegen");
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const empty = !data || data.entries.length === 0;

  return (
    <Card>
      <CardHeader
        icon={<IconBook />}
        title="โค้ดที่ระบบสร้างขึ้น"
        subtitle="ไฟล์โค้ด สคริปต์ และผลวิเคราะห์ที่ AI สร้างขึ้นเพื่อวิเคราะห์ ปรับปรุง หรือซ่อมแซมระบบเอง (อัปเดตทุก 15 วินาที)"
        action={<Badge tone="accent">{data?.totalCount ?? 0} ไฟล์</Badge>}
      />

      {loading ? (
        <div className="space-y-2.5 p-5" aria-busy="true" aria-label="กำลังโหลดบันทึกโค้ด">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-16" />)}
        </div>
      ) : empty ? (
        <EmptyState
          icon={<IconBook size={22} />}
          title="ยังไม่มีบันทึกการสร้างโค้ด"
          description="ระบบจะเริ่มบันทึกเมื่อมีการสร้างไฟล์อัตโนมัติ — มาจาก worker วิเคราะห์อัตโนมัติ, สคริปต์ซ่อมแซมตัวเอง และ schema migration"
        />
      ) : (
        <ul className="divide-y divide-white/5 px-5 pb-2 pt-3">
          {data.entries.map((e) => {
            const color = KIND_COLOR[e.kind] ?? KIND_COLOR.other;
            const outcome = outcomeBadge(e.outcome);
            return (
              <li key={e.id} className="flex items-start gap-3 py-3">
                <span className="w-8 shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--muted)]">
                  {formatRelative(e.createdAt)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`truncate font-mono text-[13px] font-semibold ${color}`}>{e.filename}</span>
                    <Badge tone="neutral">{e.kind}</Badge>
                    <Badge tone={outcome.tone}>{outcome.label}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-gray-300">{e.purpose}</div>
                  {e.outcome && (
                    <div className="truncate text-[12px] italic text-[var(--muted)]">→ {e.outcome}</div>
                  )}
                </div>
                <div className="shrink-0 text-right font-mono text-[12px] tabular-nums text-[var(--muted)]">
                  <div>{e.lines} บรรทัด</div>
                  <div>{formatBytes(e.sizeBytes)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
