"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtMs } from "./shared";

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

export function TrendPanel() {
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/trend");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) return <div className="text-gray-500 text-center py-8">กำลังโหลดแนวโน้ม...</div>;
  if (!data) return null;

  const { dates, complaintTrend, latencyTrend } = data;

  const allProviders = [...new Set([
    ...complaintTrend.map(c => c.provider),
    ...latencyTrend.map(l => l.provider),
  ])];

  const hasData = complaintTrend.length > 0 || latencyTrend.length > 0;
  if (!hasData) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-gray-500">
        <div className="text-4xl mb-3">📈</div>
        <p>ยังไม่มี report card — ครูจะเริ่มบันทึกพัฒนาการนักเรียนอัตโนมัติ</p>
      </div>
    );
  }

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
    if (lat) parts.push(`⚡${fmtMs(lat.avg_latency)}`);
    if (comp && comp.complaints > 0) parts.push(`⚠️${comp.complaints}`);
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
    <div className="space-y-4">
      {/* CHART 1: Score heatmap (provider × date grid) */}
      <div className="glass rounded-xl p-5">
        <ScoreHeatmap
          dates={dates}
          providers={allProviders}
          getScore={getScore}
          getDetail={getDetail}
        />
      </div>

      {/* CHART 2: Today's leaderboard */}
      <div className="glass rounded-xl p-5">
        <Leaderboard items={leaderboard} />
      </div>

      {/* CHART 3: Stacked area — request volume per provider */}
      <div className="glass rounded-xl p-5">
        <StackedAreaChart
          title="📊 ปริมาณงาน (Requests) — ใครรับงานเยอะแค่ไหน"
          dates={dates}
          providers={allProviders}
          getValue={(date, provider) => {
            const row = latencyTrend.find(l => l.date === date && l.provider === provider);
            return row?.requests ?? 0;
          }}
        />
      </div>

      {/* Provider Legend (shared) */}
      <div className="flex flex-wrap gap-3 text-[10px] text-gray-500">
        {allProviders.map(p => {
          const hex = PROVIDER_HEX[p] ?? "#6366f1";
          return (
            <span key={p} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: hex }} />
              {p}
            </span>
          );
        })}
      </div>
    </div>
  );
}

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

  // Color from score 0-100: red → orange → yellow → green
  const cellColor = (s: number | null): string => {
    if (s === null) return "rgba(255,255,255,0.04)";
    if (s >= 90) return "rgba(16, 185, 129, 0.85)";   // emerald
    if (s >= 80) return "rgba(132, 204, 22, 0.85)";   // lime
    if (s >= 70) return "rgba(234, 179, 8, 0.85)";    // yellow
    if (s >= 60) return "rgba(249, 115, 22, 0.85)";   // orange
    if (s >= 50) return "rgba(251, 113, 133, 0.85)";  // rose-300
    return "rgba(244, 63, 94, 0.85)";                 // rose-500
  };

  // Sort providers by latest available score (best on top)
  const sortedProviders = [...providers].sort((a, b) => {
    const sA = (() => {
      for (let i = dates.length - 1; i >= 0; i--) {
        const v = getScore(dates[i], a);
        if (v !== null) return v;
      }
      return -1;
    })();
    const sB = (() => {
      for (let i = dates.length - 1; i >= 0; i--) {
        const v = getScore(dates[i], b);
        if (v !== null) return v;
      }
      return -1;
    })();
    return sB - sA;
  });

  return (
    <div>
      <h4 className="text-sm font-bold text-gray-300 mb-3">
        🗓️ ตารางเกรด 14 วัน — สีเขียว = เก่ง, สีแดง = แย่
      </h4>

      <div className="space-y-1.5">
        {/* Header row: dates */}
        <div className="flex items-center gap-1 pl-20">
          {dates.map((d, i) => (
            <div
              key={d}
              className="flex-1 text-center text-[9px] text-gray-500 font-mono"
              style={{ minWidth: 18 }}
            >
              {i % 2 === 0 || dates.length <= 7 ? d.slice(5) : ""}
            </div>
          ))}
        </div>

        {/* Provider rows */}
        {sortedProviders.map((provider, rowIdx) => {
          const hex = PROVIDER_HEX[provider] ?? "#6366f1";
          return (
            <div
              key={provider}
              className="flex items-center gap-1 animate-fade-up"
              style={{ animationDelay: `${rowIdx * 80}ms` }}
            >
              {/* Provider label */}
              <div className="w-20 flex items-center gap-1.5 text-xs">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: hex }} />
                <span className="text-gray-300 truncate">{provider}</span>
              </div>

              {/* Heatmap cells */}
              {dates.map((date, colIdx) => {
                const score = getScore(date, provider);
                const isHovered =
                  hover?.provider === provider && hover?.date === date;
                return (
                  <div
                    key={date}
                    className={`flex-1 h-7 rounded transition-all cursor-pointer flex items-center justify-center animate-pop ${
                      isHovered ? "ring-2 ring-white scale-110 z-10" : ""
                    }`}
                    style={{
                      background: cellColor(score),
                      minWidth: 18,
                      animationDelay: `${rowIdx * 80 + colIdx * 25}ms`,
                    }}
                    onMouseEnter={() =>
                      score !== null &&
                      setHover({
                        provider,
                        date,
                        detail: getDetail(date, provider),
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    title={
                      score !== null
                        ? `${provider} ${date.slice(5)}: ${getDetail(date, provider)}`
                        : `${provider} ${date.slice(5)}: ไม่มีข้อมูล`
                    }
                  >
                    {score !== null && (
                      <span className="text-[9px] font-bold text-white drop-shadow tabular-nums">
                        {score}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
        <span className="font-bold text-gray-300">เกรด:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded" style={{ background: "rgba(16,185,129,0.85)" }} />
          90+ ยอดเยี่ยม
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded" style={{ background: "rgba(132,204,22,0.85)" }} />
          80-89 ดีมาก
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded" style={{ background: "rgba(234,179,8,0.85)" }} />
          70-79 ดี
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded" style={{ background: "rgba(249,115,22,0.85)" }} />
          60-69 พอใช้
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded" style={{ background: "rgba(244,63,94,0.85)" }} />
          &lt;60 แย่
        </span>
      </div>

      {/* Hover detail */}
      {hover && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs text-gray-200">
          <span className="font-bold">{hover.provider}</span>
          <span className="text-gray-500 mx-2">·</span>
          <span className="font-mono text-gray-400">{hover.date.slice(5)}</span>
          <span className="text-gray-500 mx-2">·</span>
          <span>{hover.detail}</span>
        </div>
      )}
    </div>
  );
}

// Count-up hook — animates a number from 0 to target
function useCountUp(target: number, duration = 1200, delay = 0): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const startTimeout = window.setTimeout(() => {
      const tick = (t: number) => {
        if (!start) start = t;
        const elapsed = t - start;
        const pct = Math.min(1, elapsed / duration);
        // ease-out cubic
        const eased = 1 - Math.pow(1 - pct, 3);
        setVal(Math.round(target * eased));
        if (pct < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(startTimeout);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, delay]);
  return val;
}

// Horizontal bar leaderboard with medals + animations
function Leaderboard({ items }: { items: { provider: string; score: number; dateUsed: string }[] }) {
  const medals = ["🥇", "🥈", "🥉"];
  const scoreColor = (s: number) => {
    if (s >= 90) return "from-emerald-500/80 to-emerald-400/40";
    if (s >= 70) return "from-yellow-500/80 to-yellow-400/40";
    if (s >= 50) return "from-orange-500/80 to-orange-400/40";
    return "from-rose-500/80 to-rose-400/40";
  };
  return (
    <div>
      <h4 className="text-sm font-bold text-gray-300 mb-3">🏆 อันดับล่าสุด — ใครเก่งสุดตอนนี้</h4>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <LeaderboardRow
            key={item.provider}
            item={item}
            idx={idx}
            medal={medals[idx]}
            colorClass={scoreColor(item.score)}
          />
        ))}
      </div>
      <div className="mt-3 text-[10px] text-gray-500">
        Crown 🥇 = #1 today · bars animate · scores count up
      </div>
    </div>
  );
}

function LeaderboardRow({
  item,
  idx,
  medal,
  colorClass,
}: {
  item: { provider: string; score: number };
  idx: number;
  medal?: string;
  colorClass: string;
}) {
  const delayMs = idx * 120;
  const animatedScore = useCountUp(item.score, 1100, delayMs);
  const hex = PROVIDER_HEX[item.provider] ?? "#6366f1";
  return (
    <div
      className="flex items-center gap-3 animate-fade-up"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="w-8 text-center text-base">
        {medal ? (
          <span className={idx === 0 ? "animate-crown inline-block" : "inline-block"}>{medal}</span>
        ) : (
          <span className="text-xs text-gray-500">#{idx + 1}</span>
        )}
      </div>
      <div className="w-20 flex items-center gap-1.5 text-xs">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: hex }} />
        <span className="text-gray-300 truncate">{item.provider}</span>
      </div>
      <div className="flex-1 h-6 bg-white/5 rounded-lg overflow-hidden relative">
        <div
          className={`h-full bg-gradient-to-r ${colorClass} rounded-lg animate-bar`}
          style={{ width: `${item.score}%`, animationDelay: `${delayMs}ms` }}
        />
        <div className="absolute inset-0 flex items-center px-3 text-xs font-bold text-white tabular-nums">
          {animatedScore}/100
        </div>
      </div>
    </div>
  );
}

// Stacked area chart — one stacked layer per provider per date
function StackedAreaChart({
  title,
  dates,
  providers,
  getValue,
}: {
  title: string;
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
    <div>
      <h4 className="text-sm font-bold text-gray-300 mb-3">{title}</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD.top + chartH * (1 - pct);
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.left - 5} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">
                {Math.round(maxTotal * pct)}
              </text>
            </g>
          );
        })}

        {/* X-axis */}
        {dates.map((d, i) => {
          if (i % 2 !== 0 && dates.length > 7) return null;
          return (
            <text key={d} x={xFor(i)} y={H - 5} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">
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
            <rect x={hover.x - 70} y={hover.y - 25} width={140} height={20} rx={4} fill="rgba(0,0,0,0.85)" stroke="rgba(255,255,255,0.2)" />
            <text x={hover.x} y={hover.y - 12} textAnchor="middle" fill="white" fontSize="9">{hover.label}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// Mini line chart using SVG
function TrendChart({
  title,
  dates,
  providers,
  getData,
  getTooltip,
  maxValue,
  formatValue,
  color: _color,
  invert = false,
}: {
  title: string;
  dates: string[];
  providers: string[];
  getData: (date: string, provider: string) => number | null;
  getTooltip?: (date: string, provider: string) => string;
  maxValue: number;
  formatValue: (v: number) => string;
  color: string;
  invert?: boolean;
}) {
  const W = 700;
  const H = 200;
  const PAD = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  // When invert=true, lower raw values appear higher on chart (faster = better = up)
  const yFor = (val: number) =>
    invert
      ? PAD.top + chartH * (val / maxValue)
      : PAD.top + chartH * (1 - val / maxValue);

  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(null);

  return (
    <div>
      <h4 className="text-sm font-bold text-gray-300 mb-3">{title}</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = PAD.top + chartH * (1 - pct);
          // When inverted: top of chart = low raw value (fast), bottom = high raw value (slow)
          const labelValue = invert ? maxValue * (1 - pct) : maxValue * pct;
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.left - 5} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.3)" fontSize="9">
                {formatValue(labelValue)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {dates.map((d, i) => {
          if (i % 2 !== 0 && dates.length > 7) return null;
          const x = PAD.left + (i / (dates.length - 1)) * chartW;
          return (
            <text key={d} x={x} y={H - 5} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">
              {d.slice(5)}
            </text>
          );
        })}

        {/* Lines per provider */}
        {providers.map(provider => {
          const hex = PROVIDER_HEX[provider] ?? "#6366f1";
          const points: string[] = [];

          dates.forEach((d, i) => {
            const val = getData(d, provider);
            if (val !== null) {
              const x = PAD.left + (i / (dates.length - 1)) * chartW;
              const y = yFor(val);
              points.push(`${x},${y}`);
            }
          });

          if (points.length < 2) return null;

          return (
            <g key={provider}>
              <polyline
                points={points.join(" ")}
                fill="none"
                stroke={hex}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
                className="animate-draw animate-glow"
                style={{ color: hex }}
              />
              {/* Dots — pop in after line draws */}
              {dates.map((d, i) => {
                const val = getData(d, provider);
                if (val === null) return null;
                const x = PAD.left + (i / (dates.length - 1)) * chartW;
                const y = yFor(val);
                return (
                  <circle
                    key={`${provider}-${d}`}
                    cx={x} cy={y} r={3.5}
                    fill={hex}
                    className="cursor-pointer animate-pop hover:r-5"
                    style={{ animationDelay: `${1200 + i * 60}ms` }}
                    onMouseEnter={() => setHover({ x, y, label: getTooltip ? getTooltip(d, provider) : `${provider}: ${formatValue(val)} (${d.slice(5)})` })}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Tooltip */}
        {hover && (
          <g>
            <rect x={hover.x - 60} y={hover.y - 25} width={120} height={20} rx={4} fill="rgba(0,0,0,0.8)" stroke="rgba(255,255,255,0.2)" />
            <text x={hover.x} y={hover.y - 12} textAnchor="middle" fill="white" fontSize="9">{hover.label}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
