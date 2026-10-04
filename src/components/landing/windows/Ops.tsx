"use client";

// Owner-only windows (visitors never get these defs, and the public insights carry none of these fields).
//   ห้องเครื่อง: subsystem lamps, alerts, error classes + latest errors, perf counters, request-category mix
//   โควตา & การพักโมเดล: provider_limits headroom per provider, recent 429s, models cooling down
import { useMemo } from "react";
import type { PerfEvent } from "@/lib/perf-counters";
import type { PulseEvent } from "@/lib/pulse-types";
import { Heading, Lamp, Meter, Pending, ROW_BTN, StarDot, VIOLET, ago, clock, headroomColor, int, pct, secs, starName, useNow } from "./shared";
import type { WinCtx } from "./shared";

// ---------- ห้องเครื่อง ----------

const STALE_WORKER_MS = 30 * 60_000; // cycle is 15 min: two missed cycles = NO-GO
const MIN_SERVING = 3;

const PERF: { label: string; hit: PerfEvent; of?: PerfEvent[] }[] = [
  { label: "แคชตอบตรง", hit: "cache:hit", of: ["cache:hit", "cache:miss"] },
  { label: "แคชความหมาย", hit: "semantic:hit" },
  { label: "ยิงคู่ขนานชนะ", hit: "hedge:win", of: ["hedge:win", "hedge:loss"] },
  { label: "เดาล่วงหน้าชนะ", hit: "spec:win", of: ["spec:fire"] },
  { label: "ใช้โมเดลเดิม", hit: "sticky:hit" },
  { label: "หลบ rate limit", hit: "demote:rate-limit" },
];

const MIX_SHADES = [1, 0.72, 0.5, 0.34];

function categoryMix(events: PulseEvent[]) {
  const counts = new Map<string, number>();
  for (const e of events) {
    const c = e.route?.category;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 4);
  const rest = sorted.slice(4).reduce((n, [, v]) => n + v, 0);
  const total = sorted.reduce((n, [, v]) => n + v, 0);
  return { parts: rest ? [...top, ["อื่นๆ", rest] as [string, number]] : top, total };
}

const statusTone = (s: number) => (s === 429 ? "bg-amber-400/15 text-amber-200" : s >= 500 || s === 0 ? "bg-rose-400/15 text-rose-200" : "bg-white/[0.08] text-gray-300");

export function OpsWindow({ ctx }: { ctx: WinCtx }) {
  const now = useNow(5000) + ctx.skewMs;
  const mix = useMemo(() => categoryMix(ctx.events), [ctx.events]);
  const ins = ctx.insights;
  if (!ins) return <Pending ctx={ctx} />;
  const { systems: sys, worker, fleet, errors, perf } = ins;
  const lastRun = worker.lastRun ? Date.parse(worker.lastRun) : NaN;
  const workerGo = worker.status === "running" || (worker.status !== "error" && Number.isFinite(lastRun) && now - lastRun < STALE_WORKER_MS);
  const alerts = sys?.alerts ?? [];
  const cls = errors?.classes;
  const chips = cls
    ? ([["429", cls.rateLimited, "bg-amber-400/15 text-amber-200"], ["5xx", cls.server, "bg-rose-400/15 text-rose-200"], ["4xx", cls.client, "bg-white/[0.08] text-gray-200"], ["หมดเวลา", cls.timeout, "bg-rose-400/15 text-rose-200"]] as const).filter(([, n]) => n > 0)
    : [];

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-1.5" aria-label="สถานะระบบ">
        {sys ? (
          <>
            <Lamp go={sys.database.ok} label="ฐานข้อมูล" detail={sys.database.ok ? secs(sys.database.latencyMs) : "เชื่อมต่อไม่ได้"} />
            <Lamp go={sys.redis.ok} label="Redis" detail={sys.redis.ok ? "ปกติ" : "เชื่อมต่อไม่ได้"} />
          </>
        ) : (
          <p className="col-span-2 text-[11px] text-[var(--muted)]">ยังอ่านสถานะฐานข้อมูลไม่ได้</p>
        )}
        <Lamp go={workerGo} label="ตัวตรวจ" detail={worker.status === "running" ? "กำลังตรวจ" : worker.lastRun ? ago(worker.lastRun, now, "ที่แล้ว") : "ยังไม่เคยรัน"} />
        <Lamp go={fleet.serving >= MIN_SERVING} label="พร้อมเสิร์ฟ" detail={`${int(fleet.serving)} · ต้อง ≥${MIN_SERVING}`} />
      </section>

      {alerts.length > 0 && (
        <ul className="space-y-0.5 rounded-xl border border-amber-300/25 bg-amber-400/[0.08] px-2.5 py-2 text-[11px] leading-snug text-amber-100" aria-label="การแจ้งเตือน">
          {alerts.slice(0, 3).map((a) => <li key={a} className="truncate" title={a}>• {a}</li>)}
          {alerts.length > 3 && <li className="text-amber-200/80">+{alerts.length - 3} รายการ</li>}
        </ul>
      )}

      <section className="space-y-1.5">
        <Heading>ข้อผิดพลาด 60 นาที</Heading>
        {!errors ? (
          <p className="text-[11px] text-[var(--muted)]">ยังอ่านไม่ได้</p>
        ) : chips.length === 0 ? (
          <p className="text-[11.5px] text-emerald-300">ไม่มีข้อผิดพลาด ✓</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {chips.map(([k, n, tone]) => (
                <span key={k} className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>{k} ×{n}</span>
              ))}
            </div>
            <ul className="space-y-1" aria-label="ข้อผิดพลาดล่าสุด">
              {errors.recent.map((e, i) => (
                <li key={`${e.t}-${i}`} className="rounded-lg bg-white/[0.025] px-2 py-1">
                  <span className="flex items-center gap-1.5 text-[11.5px]">
                    <span className={`shrink-0 rounded px-1 text-[10.5px] font-bold tabular-nums ${statusTone(e.status)}`}>{e.status || "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-200">{e.provider ? starName(ctx, e.provider) : "ไม่มีผู้ให้บริการ"} · {e.model}</span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--muted)]">{ago(e.t, now)}</span>
                  </span>
                  {e.error && <span className="block truncate font-mono text-[11px] text-gray-400" title={e.error}>{e.error}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {perf && (
        <section className="space-y-1.5">
          <Heading aside="~1 ชม.">ประสิทธิภาพ</Heading>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {PERF.map(({ label, hit, of }) => {
              const den = of ? of.reduce((n, k) => n + (perf[k] ?? 0), 0) : 0;
              const v = perf[hit] ?? 0;
              return (
                <div key={label} className="min-w-0">
                  <span className="flex items-baseline justify-between gap-1 text-[11px]">
                    <span className="truncate text-gray-400">{label}</span>
                    <b className="shrink-0 font-semibold tabular-nums text-white">{of ? (den ? pct(v / den) : "—") : int(v)}</b>
                  </span>
                  {of && <Meter value={den ? v / den : 0} color={VIOLET} className="mt-0.5" />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <Heading aside={mix.total ? `${int(mix.total)} คำขอล่าสุด` : undefined}>หมวดคำขอ</Heading>
        {!mix.total ? (
          <p className="text-[11px] text-[var(--muted)]">ยังไม่มีข้อมูลหมวดคำขอ</p>
        ) : (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              {mix.parts.map(([c, n], i) => (
                <span key={c} style={{ width: `${(n / mix.total) * 100}%`, background: i < 4 ? `rgba(169,155,255,${MIX_SHADES[i]})` : "rgba(255,255,255,0.18)" }} />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-gray-400">
              {mix.parts.map(([c, n], i) => (
                <li key={c} className="flex items-center gap-1">
                  <i className="inline-block h-2 w-2 rounded-sm" style={{ background: i < 4 ? `rgba(169,155,255,${MIX_SHADES[i]})` : "rgba(255,255,255,0.18)" }} />
                  {c} <span className="tabular-nums text-gray-500">{Math.round((n / mix.total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

// ---------- โควตา & การพักโมเดล ----------

const RECENT_429_MS = 15 * 60_000;

function Headroom({ label, v }: { label: string; v: number | null }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px]">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <Meter value={v ?? 1} color={v == null ? "rgba(255,255,255,0.18)" : headroomColor(v)} className="min-w-0 flex-1" />
      <span className="w-8 shrink-0 text-right tabular-nums text-gray-300">{v == null ? "—" : `${Math.round(v * 100)}%`}</span>
    </span>
  );
}

export function LimitsWindow({ ctx }: { ctx: WinCtx }) {
  const now = useNow() + ctx.skewMs;
  const ins = ctx.insights;
  if (!ins) return <Pending ctx={ctx} />;
  const limits = ins.limits ?? [];
  const cool = ins.cooldowns;

  return (
    <div className="space-y-3">
      {!limits.length ? (
        <p className="rounded-xl border border-emerald-300/20 bg-emerald-400/[0.06] px-3 py-2.5 text-center text-[12px] text-emerald-200">ทุกผู้ให้บริการยังมีโควตา ✓</p>
      ) : (
        <ul className="space-y-0.5" aria-label="โควตาผู้ให้บริการ">
          {limits.map((l) => {
            const reset = l.nextReset ? Date.parse(l.nextReset) - now : NaN;
            const hit = l.last429 ? now - Date.parse(l.last429) : NaN;
            return (
              <li key={l.provider}>
                <button type="button" onClick={() => ctx.onFocusStar(l.provider)} className={`${ROW_BTN} flex-col items-stretch gap-1`} aria-label={`โฟกัส ${starName(ctx, l.provider)}`}>
                  <span className="flex items-center gap-2">
                    <StarDot id={l.provider} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white">{starName(ctx, l.provider)}</span>
                    {hit < RECENT_429_MS && (
                      <span className="shrink-0 rounded bg-rose-400/15 px-1.5 text-[10px] font-semibold tabular-nums text-rose-200">429 · {Math.max(1, Math.round(hit / 60_000))} นาที</span>
                    )}
                    {Number.isFinite(reset) && <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--muted)]">{reset > 0 ? `รีเซ็ต ${clock(reset)}` : "รีเซ็ตแล้ว"}</span>}
                  </span>
                  {l.tpmLeft == null && l.tpdLeft == null ? (
                    <span className="text-[11px] text-[var(--muted)]">ยังไม่มีข้อมูลโควตา</span>
                  ) : (
                    <span className="flex gap-3">
                      <Headroom label="นาที" v={l.tpmLeft} />
                      <Headroom label="วัน" v={l.tpdLeft} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <section className="space-y-1.5">
        <Heading aside={cool?.total ? `${int(cool.total)} โมเดล` : undefined}>พักเครื่อง</Heading>
        {!cool?.items.length ? (
          <p className="text-[11px] text-[var(--muted)]">ไม่มีโมเดลที่พักอยู่</p>
        ) : (
          <ul className="space-y-1" aria-label="โมเดลที่พักอยู่">
            {cool.items.map((c) => (
              <li key={`${c.provider}/${c.model}`} className="flex items-center gap-2 text-[11.5px]" title={c.error ?? undefined}>
                <StarDot id={c.provider} size={6} />
                <span className="min-w-0 flex-1 truncate text-gray-300">
                  {starName(ctx, c.provider)} · <span className="text-gray-400">{c.model}</span>
                </span>
                <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-cyan-200">{clock(Date.parse(c.until) - now)}</span>
              </li>
            ))}
            {cool.total > cool.items.length && <li className="text-[10.5px] text-[var(--muted)]">และอีก {int(cool.total - cool.items.length)} โมเดล</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
