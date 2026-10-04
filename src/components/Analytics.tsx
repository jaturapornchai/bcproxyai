"use client";

import { PROVIDER_COLORS, fmtMs, ProviderBadge } from "./shared";
import { IconPulse } from "./ui/icons";
import { Card, EmptyState, Reveal } from "./ui/ui";

// ─── Types ────────────────────────────────────────────────────────────────────
// The API returns Postgres numerics as strings in places, so every number is
// coerced with Number() before use.

export interface ProviderStat {
  provider: string | null;
  total: number | string;
  success: number | string;
  successRate: number | string;
  avgLatencyMs: number | string;
}

export interface HourlyVolume {
  hour: string;
  total: number;
  success: number;
  failed: number;
}

export interface TopModel {
  model: string;
  provider: string;
  count: number | string;
  avgLatencyMs: number | string;
}

export interface DailyToken {
  date: string;
  input: number | string;
  output: number | string;
}

export interface AnalyticsData {
  providerStats: ProviderStat[];
  hourlyVolume: HourlyVolume[];
  topModels: TopModel[];
  dailyTokens: DailyToken[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Solid-ish brand colour for a provider, derived from the shared PROVIDER_COLORS glow value. */
export function providerColor(provider: string | null, alpha = 1): string {
  const glow = (provider && PROVIDER_COLORS[provider]?.glow) || "rgba(99,102,241,0.5)";
  return glow.replace(/[\d.]+\)$/, `${alpha})`);
}

function ChartCard({ title, hint, dot, children }: { title: string; hint: string; dot: string; children: React.ReactNode }) {
  return (
    <Card className="p-5" title={hint}>
      <h3 className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-white">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {title}
      </h3>
      {children}
    </Card>
  );
}

const NO_DATA = <p className="py-6 text-center text-[13px] text-[var(--muted)]">ยังไม่มีข้อมูล</p>;

// ─── Component ────────────────────────────────────────────────────────────────

export function Analytics({ data, loading }: { data: AnalyticsData | null; loading?: boolean }) {
  if (!data) {
    return loading ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-56" />)}
      </div>
    ) : (
      <Card>
        <EmptyState
          icon={<IconPulse size={22} />}
          title="โหลดสถิติไม่สำเร็จ"
          description="ลองรีเฟรชหน้านี้อีกครั้ง หากยังไม่ขึ้น ให้ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่"
        />
      </Card>
    );
  }

  const { providerStats, hourlyVolume, topModels, dailyTokens } = data;

  const maxHourly = Math.max(...hourlyVolume.map((h) => h.total), 1);
  const maxModelCount = Math.max(...topModels.map((m) => Number(m.count)), 1);
  const maxDailyTotal = Math.max(...dailyTokens.map((d) => Number(d.input) + Number(d.output)), 1);

  const hasAnyData =
    providerStats.length > 0 ||
    hourlyVolume.some((h) => h.total > 0) ||
    topModels.length > 0 ||
    dailyTokens.length > 0;

  if (!hasAnyData) {
    return (
      <Card>
        <EmptyState
          icon={<IconPulse size={22} />}
          title="ยังไม่มีสถิติการใช้งาน"
          description="เมื่อมีแอปเรียกใช้ gateway สถิติ 24 ชั่วโมงล่าสุดจะแสดงที่นี่"
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 1. Provider success rate */}
      <Reveal i={0}>
        <ChartCard title="อัตราสำเร็จต่อผู้ให้บริการ" hint="สัดส่วนคำขอที่สำเร็จต่อ provider (24 ชม.ล่าสุด)" dot="bg-violet-400">
          {providerStats.length === 0 ? NO_DATA : (
            <div className="space-y-4">
              {providerStats.map((p, i) => (
                <div key={p.provider ?? `unknown-${i}`}>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {p.provider ? <ProviderBadge provider={p.provider} /> : <span className="text-[12px] text-[var(--muted)]">ไม่ระบุ</span>}
                      <span className="text-[12px] tabular-nums text-[var(--muted)]">{p.total} คำขอ</span>
                    </div>
                    <span className="text-[13px] font-semibold tabular-nums text-white">{p.successRate}%</span>
                  </div>
                  {/* width + colour are data-driven, so they stay as inline style */}
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="animate-bar h-full rounded-full"
                      style={{
                        width: `${Number(p.successRate)}%`,
                        background: `linear-gradient(90deg, ${providerColor(p.provider, 0.5)}, ${providerColor(p.provider)})`,
                      }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] tabular-nums text-[var(--muted)]">เฉลี่ย {fmtMs(Number(p.avgLatencyMs))}</div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </Reveal>

      {/* 2. Hourly request volume */}
      <Reveal i={1}>
        <ChartCard title="ปริมาณคำขอรายชั่วโมง" hint="แท่งเขียว = สำเร็จ, แท่งแดง = ล้มเหลว" dot="bg-emerald-400">
          <div className="flex h-36 items-end gap-[3px]">
            {hourlyVolume.map((h) => {
              const totalPct = (h.total / maxHourly) * 100;
              return (
                <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 group-hover:block">
                    <div className="whitespace-nowrap rounded-lg border border-white/10 bg-[#0b0d14] px-2 py-1 text-[11px] text-gray-300 shadow-xl">
                      {h.hour}:00 น. — {h.total} คำขอ (สำเร็จ {h.success}, ล้มเหลว {h.failed})
                    </div>
                  </div>
                  {h.total > 0 && (
                    <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-[3px] transition-all duration-500" style={{ height: `${totalPct}%` }}>
                      <div className={`w-full bg-rose-400/70 ${h.failed > 0 ? "min-h-[2px]" : ""}`} style={{ height: `${(h.failed / h.total) * 100}%` }} />
                      <div className="w-full flex-1 bg-gradient-to-b from-emerald-400/80 to-emerald-400/35" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-[3px]">
            {hourlyVolume.map((h, i) => (
              <div key={h.hour} className="flex-1 text-center text-[9px] tabular-nums text-[var(--muted)]">
                {i % 3 === 0 ? h.hour : ""}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--muted)]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400/80" />สำเร็จ</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-rose-400/70" />ล้มเหลว</span>
          </div>
        </ChartCard>
      </Reveal>

      {/* 3. Top models by usage */}
      <Reveal i={2}>
        <ChartCard title="โมเดลที่ใช้บ่อยสุด" hint="โมเดลที่ถูกเรียกใช้บ่อยสุดใน 24 ชม." dot="bg-fuchsia-400">
          {topModels.length === 0 ? NO_DATA : (
            <div className="space-y-3">
              {topModels.map((m, i) => (
                <div key={`${m.model}-${m.provider}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted)]">{i + 1}</span>
                      <span className="truncate text-[13px] text-gray-100" title={m.model}>{m.model}</span>
                      <ProviderBadge provider={m.provider} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[13px] font-semibold tabular-nums text-white">{m.count}</span>
                      <span className="text-[11px] tabular-nums text-[var(--muted)]">{fmtMs(Number(m.avgLatencyMs))}</span>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="animate-bar h-full rounded-full"
                      style={{
                        width: `${(Number(m.count) / maxModelCount) * 100}%`,
                        background: `linear-gradient(90deg, ${providerColor(m.provider, 0.4)}, ${providerColor(m.provider)})`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </Reveal>

      {/* 4. Daily token usage */}
      <Reveal i={3}>
        <ChartCard title="ปริมาณ token 7 วันล่าสุด" hint="ปริมาณ token ต่อวัน แบ่ง input / output" dot="bg-amber-400">
          {dailyTokens.length === 0 ? NO_DATA : (
            <>
              <div className="flex h-36 items-end gap-2">
                {dailyTokens.map((d) => {
                  const input = Number(d.input);
                  const output = Number(d.output);
                  const total = input + output;
                  const totalPct = (total / maxDailyTotal) * 100;
                  return (
                    <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 group-hover:block">
                        <div className="whitespace-nowrap rounded-lg border border-white/10 bg-[#0b0d14] px-2 py-1 text-[11px] text-gray-300 shadow-xl">
                          {d.date} — รับเข้า {fmtK(input)} / ส่งออก {fmtK(output)}
                        </div>
                      </div>
                      {total > 0 && (
                        <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-[4px] transition-all duration-500" style={{ height: `${totalPct}%` }}>
                          <div className="w-full bg-amber-400/70" style={{ height: `${(output / total) * 100}%` }} />
                          <div className="w-full flex-1 bg-gradient-to-b from-violet-400/80 to-violet-400/35" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex gap-2">
                {dailyTokens.map((d) => (
                  <div key={d.date} className="flex-1 text-center text-[10px] tabular-nums text-[var(--muted)]">{d.date.slice(5)}</div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-violet-400/80" />รับเข้า</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400/70" />ส่งออก</span>
                <span className="ml-auto tabular-nums">
                  รวม {fmtK(dailyTokens.reduce((s, d) => s + Number(d.input) + Number(d.output), 0))} token
                </span>
              </div>
            </>
          )}
        </ChartCard>
      </Reveal>
    </div>
  );
}
