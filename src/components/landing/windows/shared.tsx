"use client";

// Helpers every window shares: the context the page hands them, anonymised naming, formatting, small atoms.
// Atoms are inline SVG/CSS only (no chart library); their motion lives in landing.css.
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { InsightsData } from "@/lib/insights-types";
import type { PulseData, PulseEvent, PulseStar, ProviderStatus } from "@/lib/pulse-types";
import type { Tone } from "@/components/ui/ui";
import { IconLock } from "@/components/ui/icons";
import { providerColor } from "../palette";

export interface WinCtx {
  data: PulseData;
  /** oldest first, at most 200 */
  events: PulseEvent[];
  owner: boolean;
  stars: Map<string, PulseStar>;
  focusStarId: string | null;
  onFocusStar: (id: string | null) => void;
  refresh: () => void;
  /** slow aggregates (polled every 30 s); null until the first answer */
  insights: InsightsData | null;
  /** no insights yet and the last fetch failed (404 before the route exists, 5xx, offline) */
  insightsFailed: boolean;
  /** server clock minus browser clock, for countdowns against server timestamps */
  skewMs: number;
}

/** Visitors only ever get "ดาว <daily-rotating id>"; the owner sees the real provider name. */
export function starName(ctx: Pick<WinCtx, "owner" | "stars">, id: string): string {
  if (!id) return "ไม่มีผู้ให้บริการ";
  return ctx.owner ? (ctx.stars.get(id)?.label ?? id) : `ดาว ${id}`;
}

export const STATUS_VIEW: Record<ProviderStatus, { label: string; tone: Tone; dot: string }> = {
  up: { label: "ออนไลน์", tone: "success", dot: "#34d399" },
  degraded: { label: "ทำงานบางส่วน", tone: "warning", dot: "#fbbf24" },
  down: { label: "ขัดข้อง", tone: "danger", dot: "#fb7185" },
  nokey: { label: "ยังไม่ได้ตรวจ", tone: "neutral", dot: "#6b7280" },
};

/** state colours (emerald / amber / rose) — never used for volume or latency */
export const GOOD = "#34d399";
export const WARN = "#fbbf24";
export const BAD = "#fb7185";
export const VIOLET = "#a99bff";
export const CYAN = "#38d6f5";

export const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;
export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** 1234 → "1.2K", 1_250_000 → "1.3M" */
export function compact(n: number): string {
  const [div, unit] = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""];
  const v = n / div;
  return `${div === 1 || v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
}

/** latency in Thai seconds: 850 → "0.85 วิ", 1234 → "1.2 วิ" */
export const secs = (ms: number) => `${ms >= 10_000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(ms >= 1000 ? 1 : 2)} วิ`;

/** remaining time as m:ss (h:mm:ss past an hour); never negative */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** share left: emerald ≥ 50 %, amber 20–50 %, rose below */
export const headroomColor = (v: number) => (v >= 0.5 ? GOOD : v >= 0.2 ? WARN : BAD);

/** "12 วิ" / "3 นาที" / "2 ชม." + suffix (e.g. "ที่แล้ว"); under 5 s just "เมื่อครู่" */
export function ago(iso: string, now: number, suffix = ""): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "เมื่อครู่";
  if (s < 60) return `${s} วิ${suffix}`;
  if (s < 3600) return `${Math.floor(s / 60)} นาที${suffix}`;
  return `${Math.floor(s / 3600)} ชม.${suffix}`;
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Same neon the galaxy uses for this star id. */
export function StarDot({ id, size = 8 }: { id: string; size?: number }) {
  const c = id ? providerColor(id) : "#6b7280";
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: c, boxShadow: `0 0 8px 1px ${c}` }}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[12.5px] leading-relaxed text-[var(--muted)]">{children}</p>;
}

/** Public placeholder for owner-only detail, with the login CTA. */
export function Locked({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[0.06] p-3 text-[12.5px] leading-relaxed text-gray-300">
      <span className="flex items-center gap-2 font-medium text-violet-200">
        <IconLock size={14} /> เฉพาะเจ้าของระบบ
      </span>
      <span>{children}</span>
      <Link href="/login" className="text-[12px] font-medium text-violet-200 underline-offset-2 hover:underline">
        เข้าสู่ระบบด้วย Google →
      </Link>
    </div>
  );
}

export const ROW_BTN =
  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-300";

/** Insights not here yet: shimmer while loading, an honest line when the endpoint is unavailable. */
export function Pending({ ctx, rows = 3 }: { ctx: Pick<WinCtx, "insightsFailed">; rows?: number }) {
  if (ctx.insightsFailed) return <Empty>ข้อมูลสรุปยังไม่พร้อม — จะลองใหม่อัตโนมัติ</Empty>;
  return (
    <div aria-busy="true" aria-label="กำลังโหลด" className="space-y-2.5 pt-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: `${92 - i * 17}%` }} />
      ))}
      <div className="skeleton h-14" />
    </div>
  );
}

/** Small muted section heading inside a window. */
export function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h3 className="flex items-baseline justify-between gap-2 text-[10.5px] font-semibold tracking-wide text-[var(--muted)]">
      <span>{children}</span>
      {aside != null && <span className="font-normal tabular-nums">{aside}</span>}
    </h3>
  );
}

/** Re-mounts when the value changes, so it flashes once (.lp-flash). */
export function Flash({ value, className = "" }: { value: string; className?: string }) {
  return <span key={value} className={`lp-flash tabular-nums ${className}`}>{value}</span>;
}

/** progress ring (0..1); draws itself in on mount, then eases between values */
export function Ring({ value, color, size = 22, stroke = 3 }: { value: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const len = c * clamp01(value);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} />
      {len > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${len} ${c}`}
          className="lp-ring-arc"
          style={{ "--len": len } as CSSProperties}
        />
      )}
    </svg>
  );
}

/** sparkline: line + fading area; flat baseline when there is nothing to draw */
export function Spark({ values, w = 64, h = 18, color = VIOLET }: { values: number[]; w?: number; h?: number; color?: string }) {
  const id = useId();
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = n > 1 ? values.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 1.5 - (v / max) * (h - 3)).toFixed(1)}`).join(" ") : `0,${h - 1.5} ${w},${h - 1.5}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden className="shrink-0 overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.25} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={max > 1 || values.some((v) => v > 0) ? 1 : 0.35} />
    </svg>
  );
}

/** 3 px bar; `color` usually from headroomColor() */
export function Meter({ value, color, className = "" }: { value: number; color: string; className?: string }) {
  return (
    <span aria-hidden className={`block h-[3px] overflow-hidden rounded-full bg-white/[0.08] ${className}`}>
      <span className="block h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${clamp01(value) * 100}%`, background: color }} />
    </span>
  );
}

/** status lamp with a GO / NO-GO badge; NO-GO blinks */
export function Lamp({ go, label, detail }: { go: boolean; label: string; detail: ReactNode }) {
  const c = go ? GOOD : BAD;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${go ? "" : "lp-blink"}`} style={{ background: c, boxShadow: `0 0 8px 1px ${c}` }} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[11.5px] font-medium text-white">{label}</span>
        <span className="block truncate text-[10.5px] tabular-nums text-[var(--muted)]">{detail}</span>
      </span>
      <span className={`shrink-0 rounded px-1.5 py-[3px] text-[10.5px] font-bold leading-none tracking-wide ${go ? "bg-emerald-400/[0.12] text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
        {go ? "GO" : "NO-GO"}
      </span>
    </div>
  );
}

/** conic countdown ring; p = elapsed share 0..1, children sit in the middle */
export function Countdown({ p, color = CYAN, size = 64, spin = false, children }: { p: number; color?: string; size?: number; spin?: boolean; children: ReactNode }) {
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span aria-hidden className="lp-countdown absolute inset-0" data-spin={spin} style={{ "--p": clamp01(p), "--c": color } as CSSProperties} />
      <span className="relative text-center leading-tight">{children}</span>
    </div>
  );
}
