"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { PROVIDER_COLORS } from "./shared";
import { Badge, Card, CardHeader, CountUp, EmptyState, LinkButton, Reveal, Stat } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconArrowRight, IconSparkle } from "./ui/icons";

interface ProviderCost {
  provider: string;
  total_input: number;
  total_output: number;
  requests: number;
  cost: number;
  free: boolean;
}

interface ModelUsage {
  provider: string;
  model_id: string;
  nickname: string | null;
  total_input: number;
  total_output: number;
  requests: number;
}

interface Suggestion {
  message: string;
  savings_pct: number;
  priority: "high" | "medium" | "low";
}

interface CostData {
  providerCosts: ProviderCost[];
  modelUsage: ModelUsage[];
  suggestions: Suggestion[];
  summary: {
    totalCost: number;
    totalTokens: number;
    freePct: number;
    totalRequests: number;
  };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PRIORITY_META: Record<Suggestion["priority"], { label: string; tone: Tone; box: string }> = {
  high: { label: "สำคัญ", tone: "danger", box: "border-rose-400/25 bg-rose-400/[0.06]" },
  medium: { label: "แนะนำ", tone: "warning", box: "border-amber-400/25 bg-amber-400/[0.06]" },
  low: { label: "ทั่วไป", tone: "info", box: "border-cyan-400/20 bg-cyan-400/[0.05]" },
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        icon={<IconSparkle />}
        title="ต้นทุนและการประหยัด"
        subtitle="ค่าใช้จ่ายของ token ย้อนหลัง 30 วัน แยกตามผู้ให้บริการและโมเดล พร้อมคำแนะนำให้ใช้จ่ายน้อยลง"
      />
      {children}
    </Card>
  );
}

export function CostOptimizerPanel() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/cost-optimizer");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) {
    return (
      <Shell>
        <div className="space-y-4 p-5" aria-busy="true" aria-label="กำลังวิเคราะห์ต้นทุน">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-28" />)}
          </div>
          <div className="skeleton h-40" />
        </div>
      </Shell>
    );
  }
  if (!data || data.summary.totalRequests === 0) {
    return (
      <Shell>
        <EmptyState
          icon={<IconSparkle size={22} />}
          title="ยังไม่มีข้อมูลการใช้งาน"
          description="เริ่มส่งคำขอผ่านเกตเวย์ก่อน แล้วระบบจะคำนวณต้นทุนและแนะนำวิธีประหยัดให้ที่นี่"
          action={<LinkButton href="/playground" variant="primary" size="sm">ลองส่งแชท <IconArrowRight size={14} /></LinkButton>}
        />
      </Shell>
    );
  }

  const { providerCosts, modelUsage, suggestions, summary } = data;
  const maxTokens = Math.max(...providerCosts.map(p => p.total_input + p.total_output), 1);

  return (
    <Shell>
      <div className="space-y-6 p-5">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Reveal i={0}>
            <Stat label="ค่าใช้จ่าย 30 วัน" tone="success" value={<>$<CountUp value={summary.totalCost} decimals={4} /></>} hint="สกุลเงิน USD" />
          </Reveal>
          <Reveal i={1}>
            <Stat label="Token ทั้งหมด" tone="info" value={fmtTokens(summary.totalTokens)} hint="input + output" />
          </Reveal>
          <Reveal i={2}>
            <Stat label="ใช้ฟรี" tone="warning" value={<CountUp value={summary.freePct} suffix="%" />} hint="สัดส่วนที่ไม่เสียเงิน" />
          </Reveal>
          <Reveal i={3}>
            <Stat label="คำขอทั้งหมด" tone="accent" value={<CountUp value={summary.totalRequests} />} hint="requests" />
          </Reveal>
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <section className="space-y-2.5">
            <h4 className="text-[13px] font-semibold text-white">คำแนะนำประหยัดค่าใช้จ่าย</h4>
            {suggestions.map((s, i) => {
              const meta = PRIORITY_META[s.priority];
              return (
                <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed text-gray-200 ${meta.box}`}>
                  <Badge tone={meta.tone} className="mt-0.5 shrink-0">{meta.label}</Badge>
                  <span className="min-w-0">{s.message}</span>
                </div>
              );
            })}
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Provider cost breakdown */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-[13px] font-semibold text-white">ต้นทุนแยกตามผู้ให้บริการ</h4>
            <p className="mb-4 mt-0.5 text-[12px] text-[var(--muted)]">คิดเป็น USD แม้ผู้ให้บริการจะฟรี — เก็บไว้เทียบค่าใช้จ่ายจริง</p>
            <div className="space-y-4">
              {providerCosts.map(p => {
                const colors = PROVIDER_COLORS[p.provider] ?? PROVIDER_COLORS.openrouter;
                const totalTokens = p.total_input + p.total_output;
                const pct = (totalTokens / maxTokens) * 100;
                return (
                  <div key={p.provider}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`truncate text-[13px] font-semibold ${colors.text}`}>{p.provider}</span>
                        {p.free && <Badge tone="success">FREE</Badge>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums">
                        <span className="text-[var(--muted)]">{fmtTokens(totalTokens)} token</span>
                        <span className="font-semibold text-gray-100">${p.cost.toFixed(4)}</span>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="animate-bar h-full rounded-full"
                        style={{ width: `${pct}%`, background: PROVIDER_COLORS[p.provider]?.glow ?? "#6366f1" }}
                      />
                    </div>
                    <div className="mt-1 text-[11px] tabular-nums text-[var(--muted)]">{p.requests} คำขอ</div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Top models by token usage */}
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-[13px] font-semibold text-white">โมเดลที่ใช้ token มากสุด</h4>
            <p className="mb-4 mt-0.5 text-[12px] text-[var(--muted)]">รวม input + output สูงสุด 8 อันดับ</p>
            <ol className="space-y-2.5">
              {modelUsage.slice(0, 8).map((m, i) => {
                const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
                const total = m.total_input + m.total_output;
                return (
                  <li key={`${m.provider}-${m.model_id}`} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/5 text-[11px] font-semibold tabular-nums text-[var(--muted)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12.5px] text-gray-200">{m.model_id}</div>
                      <div className={`text-[11px] ${colors.text}`}>{m.provider}</div>
                    </div>
                    <div className="shrink-0 text-[13px] font-medium tabular-nums text-gray-100">{fmtTokens(total)}</div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

      </div>
    </Shell>
  );
}
