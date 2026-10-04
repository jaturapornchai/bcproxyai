"use client";

// Charts, one grammar: violet bars = volume, rose = failures, cyan line + fading area = p50 latency. Inline SVG only.
//   ChartWindow: last 60 minutes (pulse).   DayWindow: last 24 hours (insights) + incident lane.
import { useId, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { InsightsIncident } from "@/lib/insights-types";
import { BAD, Pending, WARN, int, pct, secs } from "./shared";
import type { WinCtx } from "./shared";

const W = 300;
const H = 100;

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export function ChartWindow({ ctx }: { ctx: WinCtx }) {
  const series = ctx.data.series;
  const n = Math.max(1, series.length);
  const [at, setAt] = useState<number | null>(null);
  const gid = useId();

  const maxReq = Math.max(1, ...series.map((m) => m.requests));
  const maxMs = Math.max(1, ...series.filter((m) => m.requests > 0).map((m) => m.p50LatencyMs));
  const bw = W / n;

  // p50 only means something in minutes that had traffic → the line breaks over empty minutes
  const { line, area, dots } = latencyPaths(series.map((m) => (m.requests > 0 ? H - 4 - (m.p50LatencyMs / maxMs) * (H - 12) : null)), bw, H);

  const total = series.reduce((a, m) => ({ r: a.r + m.requests, f: a.f + m.failures }), { r: 0, f: 0 });
  const hov = at != null ? series[at] : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setAt((i) => Math.min(n - 1, Math.max(0, (i ?? n) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    // the plot takes whatever height the window body has left (squeezed or stretched); text rows stay fixed
    <div className="flex h-full min-h-0 flex-col gap-2">
      <p className="min-h-[1.4em] shrink-0 truncate text-[12px] leading-snug tabular-nums text-gray-300" aria-live="off">
        {hov ? (
          <>
            <b className="text-white">{hhmm(hov.t)}</b> · {hov.requests} คำขอ ·{" "}
            <span className={hov.failures ? "text-rose-300" : ""}>{hov.failures} ล้มเหลว</span> ·{" "}
            {hov.requests ? `p50 ${secs(hov.p50LatencyMs)}` : "ไม่มีคำขอ"}
          </>
        ) : (
          <>
            60 นาทีล่าสุด: <b className="text-white">{total.r}</b> คำขอ ·{" "}
            <span className={total.f ? "text-rose-300" : ""}>{total.f} ล้มเหลว</span> · p50 {ctx.data.stats.requestsLastHour ? secs(ctx.data.stats.p50LatencyMs) : "—"}
          </>
        )}
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block min-h-8 w-full flex-[1_1_72px] cursor-crosshair touch-none rounded-lg bg-white/[0.025] focus-visible:outline-2 focus-visible:outline-violet-300"
        role="img"
        aria-label={`กราฟคำขอและความหน่วง 60 นาที: ${total.r} คำขอ ${total.f} ล้มเหลว (ใช้ลูกศรซ้ายขวาเพื่ออ่านแต่ละนาที)`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setAt(null)}
        onKeyDown={onKey}
        onBlur={() => setAt(null)}
      >
        <defs>
          <linearGradient id={`${gid}b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a99bff" />
            <stop offset="1" stopColor="#6b5cf0" />
          </linearGradient>
          <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#38d6f5" stopOpacity={0.22} />
            <stop offset="1" stopColor="#38d6f5" stopOpacity={0} />
          </linearGradient>
        </defs>
        {at != null && <rect x={at * bw} y={0} width={bw} height={H} fill="rgba(255,255,255,0.1)" />}
        {series.map((m, i) => {
          if (m.requests <= 0) return null;
          const h = Math.max(1.5, (m.requests / maxReq) * (H - 8));
          const fh = m.failures > 0 ? Math.max(2, (m.failures / maxReq) * (H - 8)) : 0;
          return (
            <g key={m.t}>
              <rect x={i * bw + 0.4} y={H - h} width={Math.max(0.5, bw - 0.8)} height={h} fill={`url(#${gid}b)`} opacity={0.85} />
              {fh > 0 && <rect x={i * bw + 0.4} y={H - fh} width={Math.max(0.5, bw - 0.8)} height={fh} fill="#fb7185" />}
            </g>
          );
        })}
        {line && (
          <>
            <path d={area} fill={`url(#${gid}a)`} />
            <path d={line} fill="none" stroke="#38d6f5" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {dots && <path d={dots} fill="none" stroke="#38d6f5" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          </>
        )}
      </svg>

      <div className="flex shrink-0 items-center justify-between text-[10.5px] text-[var(--muted)]">
        <span>{series.length ? hhmm(series[0].t) : "60 นาทีก่อน"}</span>
        <span className="flex items-center gap-2.5">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-violet-400" />คำขอ</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-rose-400" />ล้มเหลว</span>
          <span className="flex items-center gap-1"><i className="inline-block h-[2px] w-3 bg-cyan-300" />p50</span>
        </span>
        <span>{series.length ? hhmm(series[series.length - 1].t) : "ตอนนี้"}</span>
      </div>
    </div>
  );
}

// ---------- 24 hours ----------

const DW = 300;
const DH = 64;
const HOUR = 3_600_000;

/** a run of buckets with traffic → line + area under it (the line breaks over empty buckets; a lone bucket gets a dot) */
function latencyPaths(ys: (number | null)[], bw: number, base: number) {
  let line = "";
  let area = "";
  let dots = "";
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length) {
      const [x0] = run[0];
      const [x1] = run[run.length - 1];
      area += `M${x0},${base}${run.map(([x, y]) => `L${x},${y}`).join("")}L${x1},${base}Z`;
      if (run.length === 1) dots += `M${x0},${run[0][1]}h0`;
    }
    run = [];
  };
  ys.forEach((y, i) => {
    if (y == null) return flush();
    const x = +((i + 0.5) * bw).toFixed(1);
    line += `${run.length ? "L" : "M"}${x},${y.toFixed(1)}`;
    run.push([x, +y.toFixed(1)]);
  });
  flush();
  return { line, area, dots };
}

export function DayWindow({ ctx }: { ctx: WinCtx }) {
  const [at, setAt] = useState<number | null>(null);
  const gid = useId();
  const ins = ctx.insights;
  if (!ins) return <Pending ctx={ctx} rows={1} />;

  const day = ins.day;
  const n = Math.max(1, day.length);
  const bw = DW / n;
  const maxReq = Math.max(1, ...day.map((b) => b.requests));
  const maxMs = Math.max(1, ...day.filter((b) => b.requests > 0).map((b) => b.p50LatencyMs));
  const total = day.reduce((a, b) => ({ r: a.r + b.requests, f: a.f + b.failures, inc: a.inc + b.incidents, capped: a.capped || b.incidents >= 9 }), { r: 0, f: 0, inc: 0, capped: false });
  const { line, area, dots } = latencyPaths(day.map((b) => (b.requests > 0 ? DH - 4 - (b.p50LatencyMs / maxMs) * (DH - 12) : null)), bw, DH);

  // owner: incidents (newest first) dropped into their hour bucket
  const t0 = day.length ? Date.parse(day[0].t) : 0;
  const marks = new Map<number, InsightsIncident[]>();
  for (const inc of ins.incidents ?? []) {
    const i = Math.floor((Date.parse(inc.t) - t0) / HOUR);
    if (i >= 0 && i < n) marks.set(i, [...(marks.get(i) ?? []), inc]);
  }

  const hov = at != null ? day[at] : null;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setAt((i) => Math.min(n - 1, Math.max(0, (i ?? n) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    <div className="space-y-1.5">
      <p className="truncate text-[12px] leading-snug tabular-nums text-gray-300" aria-live="off">
        {hov ? (
          <>
            <b className="text-white">{at === n - 1 ? "ชั่วโมงนี้ (ยังไม่ครบ)" : `${hhmm(hov.t)}–${hhmm(new Date(Date.parse(hov.t) + HOUR).toISOString())}`}</b> ·{" "}
            {int(hov.requests)} คำขอ · <span className={hov.failures ? "text-rose-300" : ""}>ล้มเหลว {hov.failures}</span>
            {hov.requests > 0 && ` · p50 ${secs(hov.p50LatencyMs)}`}
            {hov.incidents > 0 && <span className="text-amber-300"> · เหตุ {hov.incidents >= 9 ? "9+" : hov.incidents}</span>}
          </>
        ) : (
          <>
            <b className="text-white">{int(total.r)}</b> คำขอ · สำเร็จ {total.r ? pct(1 - total.f / total.r) : "—"} ·{" "}
            <span className={total.inc ? "text-amber-300" : ""}>เหตุขัดข้อง {total.inc}{total.capped ? "+" : ""}</span>
          </>
        )}
      </p>

      <div className="relative">
        <svg
          viewBox={`0 0 ${DW} ${DH}`}
          preserveAspectRatio="none"
          className="lp-bars block h-[64px] w-full cursor-crosshair touch-none rounded-lg bg-white/[0.025] focus-visible:outline-2 focus-visible:outline-violet-300"
          role="img"
          aria-label={`กราฟ 24 ชั่วโมง: ${total.r} คำขอ ${total.f} ล้มเหลว เหตุขัดข้อง ${total.inc} (ใช้ลูกศรซ้ายขวาเพื่ออ่านแต่ละชั่วโมง)`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setAt(null)}
          onKeyDown={onKey}
          onBlur={() => setAt(null)}
        >
          <defs>
            <linearGradient id={`${gid}b`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a99bff" />
              <stop offset="1" stopColor="#6b5cf0" />
            </linearGradient>
            <linearGradient id={`${gid}a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#38d6f5" stopOpacity={0.22} />
              <stop offset="1" stopColor="#38d6f5" stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((k) => (
            <line key={k} x1={0} x2={DW} y1={DH * k} y2={DH * k} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
          ))}
          {at != null && <rect x={at * bw} y={0} width={bw} height={DH} fill="rgba(255,255,255,0.08)" />}
          {day.map((b, i) => {
            // sqrt scale: one busy hour must not flatten the rest of the day
            const h = b.requests > 0 ? Math.max(1.5, Math.sqrt(b.requests / maxReq) * (DH - 6)) : 0;
            const fh = b.failures > 0 ? Math.min(h, Math.max(1.5, (h * b.failures) / Math.max(1, b.requests))) : 0;
            const x = i * bw + bw * 0.14;
            const w = bw * 0.72;
            return (
              <g key={b.t} opacity={i === n - 1 ? 0.55 : 0.9}>
                <rect x={x} width={w} fill={`url(#${gid}b)`} style={{ y: DH - h, height: h }} />
                {fh > 0 && <rect x={x} width={w} fill="#fb7185" style={{ y: DH - h, height: fh }} />}
              </g>
            );
          })}
          {line && (
            <>
              <path d={area} fill={`url(#${gid}a)`} />
              <path d={line} fill="none" stroke="#38d6f5" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {dots && <path d={dots} fill="none" stroke="#38d6f5" strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
            </>
          )}
        </svg>
        {total.r === 0 && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-[11.5px] text-[var(--muted)]">ยังไม่มีคำขอใน 24 ชั่วโมง</p>
        )}
      </div>

      <div className="grid h-3.5 items-center" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-label="เหตุขัดข้องรายชั่วโมง">
        {day.map((b, i) => {
          const list = ctx.owner ? marks.get(i) : undefined;
          if (list) {
            const target = list.find((x) => x.provider)?.provider ?? null;
            const err = list.some((x) => x.severity === "error");
            return (
              <button
                key={b.t}
                type="button"
                title={list.map((x) => `${hhmm(x.t)} ${x.title}`).join("\n")}
                aria-label={`เหตุขัดข้อง ${hhmm(b.t)}: ${list[0].title}${list.length > 1 ? ` และอีก ${list.length - 1}` : ""}`}
                onClick={() => target && ctx.onFocusStar(target)}
                className="mx-auto grid h-3.5 w-full place-items-center rounded text-[9px] leading-none transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-violet-300"
                style={{ color: err ? BAD : WARN, textShadow: `0 0 6px ${err ? BAD : WARN}` }}
              >
                ◆
              </button>
            );
          }
          if (!b.incidents) return <span key={b.t} />;
          return b.incidents > 1 ? (
            <span key={b.t} className="text-center text-[10px] font-semibold leading-none tabular-nums text-amber-300">{b.incidents >= 9 ? "9+" : b.incidents}</span>
          ) : (
            <span key={b.t} className="mx-auto block h-[5px] w-[5px] rounded-full bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10.5px] text-[var(--muted)]">
        <span>24 ชม.ก่อน</span>
        <span>12 ชม.</span>
        <span>ตอนนี้</span>
      </div>
    </div>
  );
}
