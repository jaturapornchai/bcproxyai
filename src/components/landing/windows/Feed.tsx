"use client";

import { memo, useMemo } from "react";
import type { PulseEvent } from "@/lib/pulse-types";
import { Badge } from "@/components/ui/ui";
import { Empty, Locked, ROW_BTN, StarDot, ago, pct, secs, starName, useNow } from "./shared";
import type { WinCtx } from "./shared";

const FEED_ROWS = 60;
const ROUTE_ROWS = 40;

function newestFirst(events: PulseEvent[], max: number, keep: (e: PulseEvent) => boolean = () => true): PulseEvent[] {
  const out: PulseEvent[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < max; i--) if (keep(events[i])) out.push(events[i]);
  return out;
}

const OkMark = ({ ok, status }: { ok: boolean; status?: number }) => (
  <span className={`shrink-0 text-[12px] font-semibold tabular-nums ${ok ? "text-emerald-300" : "text-rose-300"}`}>
    {ok ? "✓ สำเร็จ" : `✕ ล้มเหลว${status ? ` ${status}` : ""}`}
  </span>
);

// ---------- 1. live activity ----------

function FeedRow({
  e, name, owner, now, onPick,
}: { e: PulseEvent; name: string; owner: boolean; now: number; onPick: (star: string) => void }) {
  return (
    <li className="lp-feed-row">
      <button type="button" className={ROW_BTN} disabled={!e.star} onClick={() => onPick(e.star)} aria-label={`โฟกัส ${name}`}>
        <StarDot id={e.star} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12.5px] font-medium text-white">
              {name}
              {owner && e.model && <span className="font-normal text-gray-400"> · {e.model}</span>}
            </span>
            <OkMark ok={e.ok} status={owner ? e.status : undefined} />
          </span>
          <span className="flex items-center justify-between gap-2 text-[11px] tabular-nums text-[var(--muted)]">
            <span className="truncate">
              {owner && (e.tokensIn != null || e.tokensOut != null)
                ? `${e.tokensIn ?? 0}→${e.tokensOut ?? 0} โทเคน · `
                : ""}
              {secs(e.latencyMs)}
            </span>
            <span className="shrink-0">{ago(e.t, now)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function FeedWindow({ ctx }: { ctx: WinCtx }) {
  const now = useNow();
  const rows = useMemo(() => newestFirst(ctx.events, FEED_ROWS), [ctx.events]);
  if (!rows.length) return <Empty>ยังไม่มีคำขอใหม่ — จะขึ้นที่นี่ทันทีที่มีการใช้งาน</Empty>;
  return (
    <ul className="space-y-0.5" aria-label="คำขอล่าสุด">
      {rows.map((e) => (
        <FeedRow key={e.id} e={e} name={starName(ctx, e.star)} owner={ctx.owner} now={now} onPick={ctx.onFocusStar} />
      ))}
    </ul>
  );
}

// ---------- 2. router decisions ----------

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
      <div className="text-[17px] font-semibold leading-none tabular-nums text-white">{value}</div>
      <div className="mt-1 text-[10.5px] text-[var(--muted)]">{label}</div>
    </div>
  );
}

function PublicRouter({ ctx }: { ctx: WinCtx }) {
  const { stats, series } = ctx.data;
  const failed = series.reduce((n, m) => n + m.failures, 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Metric label="อัตราสำเร็จ" value={pct(stats.successRate)} />
        <Metric label="ล้มเหลว / ชม." value={String(failed)} />
        <Metric label="เวลาตอบ p50" value={stats.requestsLastHour ? secs(stats.p50LatencyMs) : "—"} />
      </div>
      <Locked>เหตุผลที่ Router เลือกผู้ให้บริการและโมเดลของแต่ละคำขอ เห็นได้เฉพาะเจ้าของระบบ</Locked>
    </div>
  );
}

const RouteRow = memo(function RouteRow({ e, name, onPick }: { e: PulseEvent; name: string; onPick: (star: string) => void }) {
  const r = e.route ?? {};
  const head = [r.mode, r.category].filter(Boolean).join(" · ");
  return (
    <li className="lp-feed-row">
      <button type="button" className={`${ROW_BTN} items-start`} disabled={!e.star} onClick={() => onPick(e.star)} aria-label={`โฟกัส ${name}`}>
        <span className="mt-1"><StarDot id={e.star} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[12.5px] font-medium text-white">{head || "—"}</span>
            <span className="flex shrink-0 items-center gap-1">
              {r.fallbackUsed && <Badge tone="warning">fallback</Badge>}
              {r.candidates != null && <Badge>{r.candidates} ตัวเลือก</Badge>}
            </span>
          </span>
          {r.reason && <span className="block truncate text-[11px] text-gray-400" title={r.reason}>{r.reason}</span>}
          <span className="block truncate text-[11px] text-[var(--muted)]">
            → {name}{e.model ? ` · ${e.model}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
});

export function RouterWindow({ ctx }: { ctx: WinCtx }) {
  const rows = useMemo(() => newestFirst(ctx.events, ROUTE_ROWS, (e) => !!e.route), [ctx.events]);
  if (!ctx.owner) return <PublicRouter ctx={ctx} />;
  if (!rows.length) return <Empty>ยังไม่มีการตัดสินใจของ Router ในช่วงนี้</Empty>;

  const fallbacks = rows.filter((e) => e.route?.fallbackUsed).length;
  const cands = rows.filter((e) => e.route?.candidates != null);
  const avg = cands.length ? cands.reduce((n, e) => n + (e.route?.candidates ?? 0), 0) / cands.length : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Metric label={`คำขอ (${rows.length} ล่าสุด)`} value={String(rows.length)} />
        <Metric label="ใช้ fallback" value={pct(fallbacks / rows.length)} />
        <Metric label="ตัวเลือกเฉลี่ย" value={avg == null ? "—" : String(Math.round(avg * 10) / 10)} />
      </div>
      <ul className="space-y-0.5" aria-label="การตัดสินใจล่าสุด">
        {rows.map((e) => (
          <RouteRow key={e.id} e={e} name={starName(ctx, e.star)} onPick={ctx.onFocusStar} />
        ))}
      </ul>
    </div>
  );
}
