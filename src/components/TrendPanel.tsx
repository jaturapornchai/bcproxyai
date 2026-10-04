"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fmtMs } from "./shared";
import { Card, CardHeader, CountUp, EmptyState, LinkButton } from "./ui/ui";
import { IconArrowRight, IconPulse } from "./ui/icons";

interface TrendData {
  dates: string[];
  benchmarkTrend: { date: string; provider: string; avg_score: number; models_tested: number }[];
  complaintTrend: { date: string; provider: string; complaints: number; failed_exams: number }[];
  latencyTrend: { date: string; provider: string; avg_latency: number; requests: number }[];
}

const PROVIDER_HEX: Record<string, string> = {
  openrouter: "#3b82f6", kilo: "#a855f7", google: "#34d399", groq: "#fb923c",
  cerebras: "#f43e5e", sambanova: "#14b8a6", mistral: "#38bdf8", ollama: "#84cc16",
};

// Combined score formula: 100 - speed_penalty - complaint_penalty
// speed_penalty: 5 points per second of latency, capped at 50
// complaint_penalty: 10 points per complaint, capped at 50
// Range: 0-100, higher = better
function computeScore(avgLatencyMs: number, complaints: number): number {
  const speedPenalty = Math.min(50, (avgLatencyMs / 1000) * 5);
  const complaintPenalty = Math.min(50, complaints * 10);
  return Math.max(0, Math.round(100 - speedPenalty - complaintPenalty));
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader
        icon={<IconPulse />}
        title="แนวโน้มคุณภาพผู้ให้บริการ"
        subtitle="คะแนนรวม อันดับ และปริมาณงานรายวันของผู้ให้บริการแต่ละราย ใช้ดูว่าใครเร็ว เสถียร และถูกร้องเรียนน้อยที่สุด"
      />
      {children}
    </Card>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
      <h4 className="text-[13px] font-semibold text-white">{title}</h4>
      {description && <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function TrendPanel() {
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/trend");
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
        <div className="space-y-4 p-5" aria-busy="true" aria-label="กำลังโหลดแนวโน้ม">
          <div className="skeleton h-48" />
          <div className="skeleton h-32" />
          <div className="skeleton h-48" />
        </div>
      </Shell>
    );
  }

  if (!data || (data.complaintTrend.length === 0 && data.latencyTrend.length === 0)) {
    return (
      <Shell>
        <EmptyState
          icon={<IconPulse size={22} />}
          title="ยังไม่มีข้อมูลแนวโน้ม"
          description="ระบบจะบันทึกคะแนนและปริมาณงานรายวันของผู้ให้บริการแต่ละรายโดยอัตโนมัติ — ลองใช้งานสักครู่แล้วกลับมาดูอีกครั้ง"
          action={<LinkButton href="/playground" variant="primary" size="sm">ลองส่งแชท <IconArrowRight size={14} /></LinkButton>}
        />
      </Shell>
    );
  }

  const { dates, complaintTrend, latencyTrend } = data;

  const allProviders = [...new Set([
    ...complaintTrend.map(c => c.provider),
    ...latencyTrend.map(l => l.provider),
  ])];

  // Build score lookup: provider -> date -> score
  const getScore = (date: string, provider: string): number | null => {
    const lat = latencyTrend.find(l => l.date === date && l.provider === provider);
    const comp = complaintTrend.find(c => c.date === date && c.provider === provider);
    if (!lat && !comp) return null;
    return computeScore(lat?.avg_latency ?? 0, comp?.complaints ?? 0);
  };

  // Tooltip detail: show breakdown
  const getDetail = (date: string, provider: string): string => {
    const lat = latencyTrend.find(l => l.date === date && l.provider === provider);
    const comp = complaintTrend.find(c => c.date === date && c.provider === provider);
    const score = computeScore(lat?.avg_latency ?? 0, comp?.complaints ?? 0);
    const parts = [`${score}/100`];
    if (lat) parts.push(`เฉลี่ย ${fmtMs(lat.avg_latency)}`);
    if (comp && comp.complaints > 0) parts.push(`ร้องเรียน ${comp.complaints}`);
    return parts.join(" · ");
  };

  // Today's leaderboard: latest score per provider, sorted desc
  const latestDate = dates[dates.length - 1];
  const leaderboard = allProviders
    .map(p => {
      // Find the most recent date that has data for this provider
      let score: number | null = null;
      let dateUsed = latestDate;
      for (let i = dates.length - 1; i >= 0; i--) {
        const s = getScore(dates[i], p);
        if (s !== null) {
          score = s;
          dateUsed = dates[i];
          break;
        }
      }
      return { provider: p, score, dateUsed };
    })
    .filter((x): x is { provider: string; score: number; dateUsed: string } => x.score !== null)
    .sort((a, b) => b.score - a.score);

  return (
    <Shell>
      <div className="space-y-4 p-5">
        <Section
          title={`คะแนนรายวัน ${dates.length} วันล่าสุด`}
          description="สีเขียว = ดี, สีแดง = ควรตรวจสอบ · คะแนน = 100 − โทษความช้า (5 คะแนนต่อวินาที สูงสุด 50) − โทษข้อร้องเรียน (10 คะแนนต่อครั้ง สูงสุด 50)"
        >
          <ScoreHeatmap dates={dates} providers={allProviders} getScore={getScore} getDetail={getDetail} />
        </Section>

        <Section title="อันดับล่าสุด" description="เรียงตามคะแนนล่าสุดของแต่ละผู้ให้บริการ — คะแนนสูงสุดอยู่บนสุด">
          <Leaderboard items={leaderboard} />
        </Section>

        <Section title="ปริมาณงาน (Requests)" description="จำนวนคำขอที่แต่ละผู้ให้บริการรับไปในแต่ละวัน ซ้อนกันเป็นชั้น">
          <StackedAreaChart
            dates={dates}
            providers={allProviders}
            getValue={(date, provider) => {
              const row = latencyTrend.find(l => l.date === date && l.provider === provider);
              return row?.requests ?? 0;
            }}
          />
        </Section>

        {/* Provider legend (shared by the charts) */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-[var(--muted)]">
          {allProviders.map(p => (
            <span key={p} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PROVIDER_HEX[p] ?? "#6366f1" }} />
              {p}
            </span>
          ))}
        </div>
      </div>
    </Shell>
  );
}

// Heatmap cell colour from score 0-100: red → orange → yellow → green
function cellColor(s: number | null): string {
  if (s === null) return "bg-white/[0.04]";
  if (s >= 90) return "bg-emerald-500/85";
  if (s >= 80) return "bg-lime-500/85";
  if (s >= 70) return "bg-yellow-500/85";
  if (s >= 60) return "bg-orange-500/85";
  if (s >= 50) return "bg-rose-400/85";
  return "bg-rose-500/85";
}

const HEATMAP_LEGEND = [
  { score: 95, label: "90+ ยอดเยี่ยม" },
  { score: 85, label: "80-89 ดีมาก" },
  { score: 75, label: "70-79 ดี" },
  { score: 65, label: "60-69 พอใช้" },
  { score: 0, label: "ต่ำกว่า 60 ควรตรวจสอบ" },
];

// Score heatmap — provider × date grid, cell color = score
function ScoreHeatmap({
  dates,
  providers,
  getScore,
  getDetail,
}: {
  dates: string[];
  providers: string[];
  getScore: (date: string, provider: string) => number | null;
  getDetail: (date: string, provider: string) => string;
}) {
  const [hover, setHover] = useState<{ provider: string; date: string; detail: string } | null>(null);

  // Most recent score a provider has (-1 when it never had one)
  const latestScore = (provider: string): number => {
    for (let i = dates.length - 1; i >= 0; i--) {
      const v = getScore(dates[i], provider);
      if (v !== null) return v;
    }
    return -1;
  };

  // Sort providers by latest available score (best on top)
  const sortedProviders = [...providers].sort((a, b) => latestScore(b) - latestScore(a));

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[460px] space-y-1.5">
          {/* Header row: dates */}
          <div className="flex items-center gap-1">
            <div className="w-20 shrink-0" />
            {dates.map((d, i) => (
              <div key={d} className="min-w-[18px] flex-1 text-center font-mono text-[9px] text-[var(--muted)]">
                {i % 2 === 0 || dates.length <= 7 ? d.slice(5) : ""}
              </div>
            ))}
          </div>

          {/* Provider rows */}
          {sortedProviders.map((provider, rowIdx) => (
            <div
              key={provider}
              className="animate-fade-up flex items-center gap-1"
              style={{ animationDelay: `${rowIdx * 80}ms` }}
            >
              <div className="flex w-20 shrink-0 items-center gap-1.5 text-[12px]">
                <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDER_HEX[provider] ?? "#6366f1" }} />
                <span className="truncate text-gray-200">{provider}</span>
              </div>

              {dates.map((date, colIdx) => {
                const score = getScore(date, provider);
                const isHovered = hover?.provider === provider && hover?.date === date;
                const detail = score !== null ? getDetail(date, provider) : "ไม่มีข้อมูล";
                return (
                  <div
                    key={date}
                    role="img"
                    aria-label={`${provider} ${date.slice(5)}: ${detail}`}
                    className={`animate-pop flex h-7 min-w-[18px] flex-1 cursor-pointer items-center justify-center rounded-md transition-all ${cellColor(score)} ${
                      isHovered ? "z-10 scale-110 ring-2 ring-white" : ""
                    }`}
                    style={{ animationDelay: `${rowIdx * 80 + colIdx * 25}ms` }}
                    onMouseEnter={() => score !== null && setHover({ provider, date, detail })}
                    onMouseLeave={() => setHover(null)}
                    title={`${provider} ${date.slice(5)}: ${detail}`}
                  >
                    {score !== null && (
                      <span className="text-[9px] font-bold tabular-nums text-white drop-shadow">{score}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--muted)]">
        <span className="font-semibold text-gray-300">เกรด</span>
        {HEATMAP_LEGEND.map(l => (
          <span key={l.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-4 rounded ${cellColor(l.score)}`} />
            {l.label}
          </span>
        ))}
      </div>

      {/* Hover detail */}
      {hover && (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[12px] text-gray-200">
          <span className="font-semibold">{hover.provider}</span>
          <span className="mx-2 text-[var(--muted)]">·</span>
          <span className="font-mono text-[var(--muted)]">{hover.date.slice(5)}</span>
          <span className="mx-2 text-[var(--muted)]">·</span>
          <span>{hover.detail}</span>
        </div>
      )}
    </div>
  );
}

const RANK_BADGE = [
  "bg-gradient-to-br from-amber-200 to-yellow-500 text-black",
  "bg-gradient-to-br from-slate-100 to-slate-400 text-black",
  "bg-gradient-to-br from-orange-300 to-amber-600 text-black",
];

// Horizontal bar leaderboard with rank badges + animations
function Leaderboard({ items }: { items: { provider: string; score: number; dateUsed: string }[] }) {
  const scoreColor = (s: number) => {
    if (s >= 90) return "from-emerald-500/80 to-emerald-400/40";
    if (s >= 70) return "from-yellow-500/80 to-yellow-400/40";
    if (s >= 50) return "from-orange-500/80 to-orange-400/40";
    return "from-rose-500/80 to-rose-400/40";
  };
  return (
    <ol className="space-y-2.5">
      {items.map((item, idx) => {
        const delayMs = idx * 120;
        return (
          <li
            key={item.provider}
            className="animate-fade-up flex items-center gap-3"
            style={{ animationDelay: `${delayMs}ms` }}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold tabular-nums ${
                RANK_BADGE[idx] ?? "bg-white/5 text-[var(--muted)]"
              } ${idx === 0 ? "animate-crown" : ""}`}
            >
              {idx + 1}
            </span>
            <div className="flex w-20 shrink-0 items-center gap-1.5 text-[12px] sm:w-24">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDER_HEX[item.provider] ?? "#6366f1" }} />
              <span className="truncate text-gray-200">{item.provider}</span>
            </div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-white/5">
              <div
                className={`animate-bar h-full rounded-lg bg-gradient-to-r ${scoreColor(item.score)}`}
                style={{ width: `${item.score}%`, animationDelay: `${delayMs}ms` }}
              />
              <div className="absolute inset-0 flex items-center px-3 text-[12px] font-semibold text-white">
                <CountUp value={item.score} suffix="/100" />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Stacked area chart — one stacked layer per provider per date
function StackedAreaChart({
  dates,
  providers,
  getValue,
}: {
  dates: string[];
  providers: string[];
  getValue: (date: string, provider: string) => number;
}) {
  const W = 700;
  const H = 200;
  const PAD = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Compute totals per date for max scale
  const totals = dates.map(d =>
    providers.reduce((acc, p) => acc + getValue(d, p), 0)
  );
  const maxTotal = Math.max(...totals, 1);

  // Build cumulative stacks: stack[i][p] = cumulative sum up to and including provider p at date i
  const stacks = dates.map(d => {
    let cum = 0;
    const out: Record<string, { lo: number; hi: number }> = {};
    for (const p of providers) {
      const v = getValue(d, p);
      out[p] = { lo: cum, hi: cum + v };
      cum += v;
    }
    return out;
  });

  const xFor = (i: number) =>
    dates.length === 1 ? PAD.left + chartW / 2 : PAD.left + (i / (dates.length - 1)) * chartW;
  const yFor = (val: number) => PAD.top + chartH * (1 - val / maxTotal);

  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label="กราฟพื้นที่แสดงปริมาณคำขอรายวันของแต่ละผู้ให้บริการ"
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD.top + chartH * (1 - pct);
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.left - 5} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize="9">
                {Math.round(maxTotal * pct)}
              </text>
            </g>
          );
        })}

        {/* X-axis */}
        {dates.map((d, i) => {
          if (i % 2 !== 0 && dates.length > 7) return null;
          return (
            <text key={d} x={xFor(i)} y={H - 5} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">
              {d.slice(5)}
            </text>
          );
        })}

        {/* Stacked areas (bottom to top) */}
        {providers.map(provider => {
          const hex = PROVIDER_HEX[provider] ?? "#6366f1";
          // Build polygon path: top edge left→right, then bottom edge right→left
          const top = dates.map((_, i) => `${xFor(i)},${yFor(stacks[i][provider].hi)}`);
          const bot = dates
            .map((_, i) => `${xFor(i)},${yFor(stacks[i][provider].lo)}`)
            .reverse();
          const path = [...top, ...bot].join(" ");
          // Skip empty layers
          const total = dates.reduce((acc, _, i) => acc + (stacks[i][provider].hi - stacks[i][provider].lo), 0);
          if (total === 0) return null;
          const layerIdx = providers.indexOf(provider);
          return (
            <g key={provider}>
              <polygon
                points={path}
                fill={hex}
                fillOpacity={0.55}
                stroke={hex}
                strokeWidth={1}
                strokeOpacity={0.9}
                className="animate-area"
                style={{ animationDelay: `${layerIdx * 150}ms` }}
              />
              {/* Hover dots at top of layer */}
              {dates.map((d, i) => {
                const v = getValue(d, provider);
                if (v === 0) return null;
                return (
                  <circle
                    key={`${provider}-${d}`}
                    cx={xFor(i)}
                    cy={yFor(stacks[i][provider].hi)}
                    r={3}
                    fill={hex}
                    opacity={0}
                    className="cursor-pointer hover:opacity-100"
                    onMouseEnter={() =>
                      setHover({
                        x: xFor(i),
                        y: yFor(stacks[i][provider].hi),
                        label: `${provider}: ${v} req (${d.slice(5)})`,
                      })
                    }
                  />
                );
              })}
            </g>
          );
        })}

        {/* Tooltip */}
        {hover && (
          <g>
            <rect x={hover.x - 70} y={hover.y - 25} width={140} height={20} rx={4} fill="rgba(5,6,10,0.92)" stroke="rgba(255,255,255,0.2)" />
            <text x={hover.x} y={hover.y - 12} textAnchor="middle" fill="white" fontSize="9">{hover.label}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
