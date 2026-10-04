"use client";

import type { ReactNode } from "react";
import { ProviderBadge, TIER_LABELS, fmtMs } from "@/components/shared";
import type { LeaderboardEntry } from "@/components/shared";
import { IconSparkle } from "@/components/ui/icons";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";

const CATEGORY_LABEL: Record<string, string> = {
  thai: "ไทย", code: "โค้ด", math: "เลข", instruction: "ทำตามสั่ง", creative: "สร้างสรรค์",
  knowledge: "ความรู้", vision: "ภาพ", audio: "เสียง", json: "JSON", safety: "ปลอดภัย",
  classification: "จำแนก", reasoning: "เหตุผล", tools: "เครื่องมือ", extraction: "ดึงข้อมูล", comprehension: "อ่านจับใจความ",
};

const MEDAL = [
  "bg-amber-300/20 text-amber-200 ring-amber-300/40",
  "bg-slate-300/15 text-slate-200 ring-slate-300/30",
  "bg-orange-400/15 text-orange-200 ring-orange-400/30",
];

const TIER_TONE: Record<string, Tone> = { large: "accent", medium: "info", small: "neutral" };

// category scores are 0–10
const catTone = (s: number): Tone => (s >= 8 ? "success" : s >= 5 ? "info" : s >= 3 ? "warning" : "danger");

interface LeaderboardProps {
  leaderboard: LeaderboardEntry[];
  loading: boolean;
  /** CTA shown when there is no data yet */
  emptyAction: ReactNode;
}

export function Leaderboard({ leaderboard, loading, emptyAction }: LeaderboardProps) {
  return (
    <Card>
      <CardHeader
        title="ใครเก่งที่สุด"
        subtitle="จัดอันดับจากคะแนนสอบเฉลี่ยทุกหมวด — เปอร์เซ็นต์สูง = ตอบถูกมาก · ใช้เลือกโมเดลที่เหมาะกับงานของคุณ"
        icon={<IconSparkle size={18} />}
        action={!loading && leaderboard.length > 0 ? <Badge tone="accent">{leaderboard.length} โมเดล</Badge> : undefined}
      />

      {loading ? (
        <div className="space-y-3 p-5">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-14" />)}
        </div>
      ) : leaderboard.length === 0 ? (
        <EmptyState
          icon={<IconSparkle size={22} />}
          title="ยังไม่มีผลสอบ"
          description="ระบบยังไม่ได้สอบโมเดลรอบแรก — รอรอบอัตโนมัติ หรือสั่งสอบทันทีที่แท็บ “ผลสอบ”"
          action={emptyAction}
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-white/[0.06] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th scope="col" className="w-12 px-3 py-2.5 sm:px-5 font-medium">#</th>
                <th scope="col" className="px-3 py-2.5 font-medium">โมเดล</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">ผู้ให้บริการ</th>
                <th scope="col" className="px-3 py-2.5 font-medium">คะแนน</th>
                <th scope="col" className="hidden px-3 py-2.5 font-medium lg:table-cell">ความถนัด</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right font-medium md:table-cell">ความเร็ว</th>
                <th scope="col" className="hidden px-5 py-2.5 text-right font-medium lg:table-cell">ขนาด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {leaderboard.map((entry, i) => {
                const cats = entry.categories
                  ? Object.entries(entry.categories).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 4)
                  : [];
                return (
                  <tr key={entry.modelId} className="group transition-colors hover:bg-white/[0.03]">
                    <td className="px-3 py-3.5 sm:px-5">
                      {i < 3 ? (
                        <span className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold ring-1 ring-inset ${MEDAL[i]}`}>{entry.rank}</span>
                      ) : (
                        <span className="pl-2 text-[13px] tabular-nums text-[var(--muted)]">{entry.rank}</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="text-[14px] font-medium leading-tight text-gray-100 group-hover:text-white">{entry.name}</div>
                      <div className="mt-0.5 max-w-[150px] truncate font-mono sm:max-w-[220px] text-[11px] text-[var(--muted)]" title={entry.modelId}>{entry.modelId}</div>
                    </td>
                    <td className="hidden px-3 py-3.5 sm:table-cell"><ProviderBadge provider={entry.provider} /></td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-2 w-14 overflow-hidden rounded-full bg-white/[0.06] sm:w-28">
                          {/* width is data-driven */}
                          <div className="animate-bar h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300" style={{ width: `${entry.percentage}%` }} />
                        </div>
                        <span className="w-10 text-right text-[13px] font-semibold tabular-nums text-white">{entry.percentage}%</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--muted)]">{entry.questionsAnswered} ข้อ</div>
                    </td>
                    <td className="hidden px-3 py-3.5 lg:table-cell">
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {cats.map(([cat, score]) => (
                          <Badge key={cat} tone={catTone(score)}>{CATEGORY_LABEL[cat] ?? cat} {score.toFixed(1)}</Badge>
                        ))}
                        {entry.supportsVision && <Badge tone="accent">ดูรูปได้</Badge>}
                      </div>
                    </td>
                    <td className="hidden px-3 py-3.5 text-right text-[13px] tabular-nums text-gray-300 md:table-cell">{fmtMs(entry.avgLatencyMs)}</td>
                    <td className="hidden px-5 py-3.5 text-right lg:table-cell">
                      <Badge tone={TIER_TONE[entry.tier] ?? "neutral"}>{TIER_LABELS[entry.tier] ?? "S"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
