"use client";

// KPI ribbon: one glass capsule between the desktop window columns, and its compact twin (Vitals) pinned in the mobile
// sheet header. Every cell is a fleet-wide aggregate; the owner's last cell (self-healed requests) is owner-only data,
// so visitors get "new models in 24 h" there instead.
import type { CSSProperties, ReactNode } from "react";
import type { InsightsData } from "@/lib/insights-types";
import { IconCheck, IconRefresh, IconSparkle } from "@/components/ui/icons";
import type { RibbonBox } from "./layout";
import { BAD, CYAN, Flash, GOOD, Meter, Ring, Spark, WARN, compact, int, pct, secs } from "./shared";
import type { WinCtx } from "./shared";

interface Cell {
  id: string;
  label: string;
  /** label in the 4-up mobile row */
  short: string;
  /** null = waiting for insights */
  value: string | null;
  /** small unit after the value */
  unit?: string;
  gradient?: boolean;
  vis?: ReactNode;
  sub: ReactNode;
  title?: string;
}

const okColor = (r: number) => (r >= 0.95 ? GOOD : r >= 0.8 ? WARN : BAD);
const Wait = () => <span className="skeleton inline-block h-2.5 w-14 align-middle" />;

function cells(ctx: WinCtx): Cell[] {
  const { stats, series } = ctx.data;
  const ins = ctx.insights;
  const hour = stats.requestsLastHour > 0;
  // insights-backed text: shimmer while loading, a dash when the endpoint is unavailable
  const later = (f: (d: InsightsData) => ReactNode) => (ins ? f(ins) : ctx.insightsFailed ? "—" : <Wait />);
  return [
    {
      id: "today",
      label: "คำขอวันนี้",
      short: "วันนี้",
      value: int(stats.requestsToday),
      vis: <Spark values={series.map((m) => m.requests)} w={40} h={20} />,
      // public tokens are floored to 100K steps (null below one step)
      sub: later((d) => (d.kpi.tokensToday == null ? "โทเคน ไม่ถึง 100K" : `โทเคน ${compact(d.kpi.tokensToday)}`)),
    },
    {
      id: "ok",
      label: "สำเร็จ · 1 ชม.",
      short: "สำเร็จ",
      value: hour ? pct(stats.successRate) : "—",
      vis: <Ring value={hour ? stats.successRate : 0} color={okColor(stats.successRate)} />,
      sub: hour ? `${int(stats.requestsLastHour)} คำขอ` : "ยังไม่มีคำขอ",
    },
    {
      id: "lat",
      label: "เวลาตอบ",
      short: "p50",
      value: hour ? secs(stats.p50LatencyMs).replace(" วิ", "") : "—",
      unit: hour ? "วิ" : undefined,
      vis: <Spark values={series.map((m) => (m.requests ? m.p50LatencyMs : 0))} w={40} h={20} color={CYAN} />,
      sub: later((d) => (d.kpi.p95LatencyMs ? `p95 ${secs(d.kpi.p95LatencyMs)}` : "p95 —")),
    },
    {
      id: "models",
      label: "โมเดลออนไลน์",
      short: "ออนไลน์",
      value: `${stats.modelsAvailable}/${stats.modelsTotal}`,
      vis: <Meter value={stats.modelsTotal ? stats.modelsAvailable / stats.modelsTotal : 0} color={GOOD} className="w-9" />,
      sub: later((d) => `พัก ${int(d.fleet.cooling)}`),
    },
    {
      id: "cost",
      label: "ค่าใช้จ่าย",
      short: "ค่าใช้จ่าย",
      value: `$${stats.spentUsd}`,
      gradient: true,
      vis: <IconCheck size={16} className="text-emerald-300" />,
      sub: "ฟรีทั้งหมด",
      title: "เพดานค่าใช้จ่ายตามนโยบาย: ใช้เฉพาะโมเดลฟรี",
    },
    ctx.owner
      ? {
          id: "last",
          label: "กู้คืนอัตโนมัติ",
          short: "กู้คืน",
          value: ins ? int(ins.kpi.selfHealed ?? 0) : ctx.insightsFailed ? "—" : null,
          vis: <IconRefresh size={16} className="text-cyan-300" />,
          sub: "1 ชม.",
          title: "สลับเส้นทางสำรองแล้วตอบสำเร็จ",
        }
      : {
          id: "last",
          label: "โมเดลใหม่",
          short: "โมเดลใหม่",
          value: ins ? int(ins.fleet.newModels24h) : ctx.insightsFailed ? "—" : null,
          vis: <IconSparkle size={16} className="text-violet-300" />,
          sub: "24 ชม.",
          title: "โมเดลฟรีที่ระบบเพิ่งค้นพบ",
        },
  ];
}

function Value({ c, size }: { c: Cell; size: string }) {
  if (c.value == null) return <span className={`skeleton inline-block h-5 w-10 ${size}`} />;
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <Flash value={c.value} className={`${size} font-semibold leading-none ${c.gradient ? "text-gradient" : "text-white"}`} />
      {c.unit && <span className="text-[11px] font-medium text-gray-400">{c.unit}</span>}
    </span>
  );
}

export function Ribbon({ ctx, box }: { ctx: WinCtx; box: RibbonBox }) {
  const list = cells(ctx).slice(0, box.cells);
  // narrow cells (1280–1440 px screens) get a smaller value so the micro-visual still fits beside it
  const size = box.w / box.cells < 120 ? "text-[19px]" : "text-[22px]";
  return (
    <section
      aria-label="ตัวชี้วัดหลัก"
      className="lp-glass lp-rise pointer-events-auto absolute flex overflow-hidden rounded-2xl"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, "--d": 200 } as CSSProperties}
    >
      {list.map((c, i) => (
        <div
          key={c.id}
          title={c.title}
          className={`relative flex min-w-0 flex-1 flex-col justify-center gap-[3px] px-3 ${i ? "before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-white/[0.08]" : ""}`}
        >
          <span className="truncate text-[10.5px] leading-none text-[var(--muted)]">{c.label}</span>
          <span className="flex min-w-0 items-center justify-between gap-1.5">
            <Value c={c} size={size} />
            {/* one 40 px right-aligned slot per cell, so every micro-visual lines up; it gives way before the value does */}
            {c.vis && <span className="flex w-10 min-w-0 shrink items-center justify-end overflow-hidden">{c.vis}</span>}
          </span>
          <span className="truncate text-[10.5px] leading-none tabular-nums text-[var(--muted)]">{c.sub}</span>
        </div>
      ))}
    </section>
  );
}

const MOBILE_ORDER = ["ok", "lat", "today", "cost", "models", "last"];

/** 4 cells visible, swipe for the rest (scroll-snap) */
export function Vitals({ ctx }: { ctx: WinCtx }) {
  const by = new Map(cells(ctx).map((c) => [c.id, c]));
  return (
    <div
      role="list"
      aria-label="ตัวชี้วัดหลัก"
      tabIndex={0}
      className="lp-fade-r flex snap-x snap-mandatory scroll-px-2 overflow-x-auto px-2 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-violet-300 [&::-webkit-scrollbar]:hidden"
    >
      {MOBILE_ORDER.map((id) => {
        const c = by.get(id)!;
        return (
          <div role="listitem" key={id} title={c.title} className="flex w-1/4 shrink-0 snap-start flex-col gap-1 px-2 py-1">
            <span className="truncate text-[10px] leading-none text-[var(--muted)]">{c.short}</span>
            <Value c={c} size="text-[16px]" />
          </div>
        );
      })}
    </div>
  );
}
