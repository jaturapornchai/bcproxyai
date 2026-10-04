"use client";

import { useMemo } from "react";
import type { PulseEvent } from "@/lib/pulse-types";
import { Empty, STATUS_VIEW, Spark, StarDot, pct, secs, starName, useNow } from "./shared";
import type { WinCtx } from "./shared";

// ---------- 3. provider health ----------

const TILE_MIN = 15;

/** per star, from the live events in the last 15 minutes: 1-minute request buckets, ✓/✕ and p50 */
function starStats(events: PulseEvent[], now: number) {
  const from = now - TILE_MIN * 60_000;
  const out = new Map<string, { spark: number[]; ok: number; fail: number; ms: number[] }>();
  for (const e of events) {
    const t = Date.parse(e.t);
    if (!(t >= from) || !e.star) continue;
    let s = out.get(e.star);
    if (!s) out.set(e.star, (s = { spark: Array<number>(TILE_MIN).fill(0), ok: 0, fail: 0, ms: [] }));
    s.spark[Math.min(TILE_MIN - 1, Math.floor((t - from) / 60_000))]++;
    if (e.ok) s.ok++;
    else s.fail++;
    s.ms.push(e.latencyMs);
  }
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};
const EMPTY_SPARK = Array<number>(TILE_MIN).fill(0);

export function HealthWindow({ ctx }: { ctx: WinCtx }) {
  const { stats } = ctx.data;
  const now = useNow(5000);
  const stars = useMemo(
    () => [...ctx.data.stars].sort((a, b) => b.load - a.load || a.id.localeCompare(b.id)),
    [ctx.data.stars],
  );
  const per = useMemo(() => starStats(ctx.events, now), [ctx.events, now]);
  const maxLoad = Math.max(1, ...stars.map((s) => s.load));
  return (
    <div className="space-y-2">
      <p className="px-0.5 text-[11.5px] text-[var(--muted)]">
        ออนไลน์ <b className="tabular-nums text-gray-200">{stats.providersUp}/{stats.providersTotal}</b> · โมเดลออนไลน์{" "}
        <b className="tabular-nums text-gray-200">{stats.modelsAvailable}/{stats.modelsTotal}</b> · กราฟ 15 นาที
      </p>
      {!stars.length ? (
        <Empty>ยังไม่มีข้อมูลผู้ให้บริการ</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5" aria-label="ผู้ให้บริการ">
          {stars.map((s) => {
            const v = STATUS_VIEW[s.status];
            const on = ctx.focusStarId === s.id;
            const st = per.get(s.id);
            const name = starName(ctx, s.id);
            return (
              <li key={s.id} className="min-w-0">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${name}: ${v.label}`}
                  onClick={() => ctx.onFocusStar(on ? null : s.id)}
                  className={`relative flex w-full flex-col gap-1 overflow-hidden rounded-xl border px-2 pb-2 pt-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-300 ${on ? "border-violet-300/30 bg-violet-400/[0.09]" : "border-white/[0.06] bg-white/[0.025] hover:bg-white/[0.05]"}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StarDot id={s.id} size={7} />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-white">{name}</span>
                    {/* owner only (public stars carry no model counts); on the name row so owner tiles keep the public height */}
                    {s.models !== undefined && <span title="โมเดลพร้อมใช้" className="shrink-0 text-[10.5px] tabular-nums text-gray-400">{s.available}/{s.models}</span>}
                    <span title={v.label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status === "down" ? "lp-blink" : ""}`} style={{ background: v.dot, boxShadow: `0 0 6px ${v.dot}` }} />
                  </span>
                  <span className="flex items-end justify-between gap-1">
                    <Spark values={st?.spark ?? EMPTY_SPARK} w={64} h={18} />
                    <span className="text-right text-[10.5px] leading-tight tabular-nums text-[var(--muted)]">
                      <span className="block">{st ? `p50 ${secs(median(st.ms))}` : "ไม่มีคำขอ"}</span>
                      {st && (
                        <span className="block">
                          <span className="text-emerald-300">✓{st.ok}</span> <span className={st.fail ? "text-rose-300" : ""}>✕{st.fail}</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.04]">
                    <span className="block h-full bg-gradient-to-r from-violet-400 to-cyan-300 transition-[width] duration-500" style={{ width: `${(s.load / maxLoad) * 100}%` }} title={`${s.load} คำขอใน 60 นาที`} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- 5. top models (owner only) ----------

export function ModelsWindow({ ctx }: { ctx: WinCtx }) {
  const rows = ctx.data.topModels ?? [];
  const max = Math.max(1, ...rows.map((m) => m.requests));
  if (!rows.length) return <Empty>ยังไม่มีสถิติโมเดล</Empty>;
  return (
    <ol className="space-y-1" aria-label="โมเดลยอดนิยม">
      {rows.map((m, i) => (
        <li key={`${m.provider}/${m.model}`} className="relative overflow-hidden rounded-lg px-2 py-1.5">
          <span aria-hidden className="absolute inset-y-0 left-0 bg-violet-400/[0.12]" style={{ width: `${(m.requests / max) * 100}%` }} />
          <span className="relative flex items-baseline gap-2">
            <span className="w-4 shrink-0 text-[11px] tabular-nums text-[var(--muted)]">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white" title={`${m.provider} · ${m.model}`}>
              {m.provider} · {m.model}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-gray-300">{m.requests}</span>
          </span>
          <span className="relative mt-0.5 flex justify-between pl-6 text-[10.5px] tabular-nums text-[var(--muted)]">
            <span>สำเร็จ {pct(m.successRate)}</span>
            <span>p50 {secs(m.p50LatencyMs)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
