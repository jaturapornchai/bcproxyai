"use client";

import { useEffect, useState } from "react";
import { CountUp, Stat } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconAlert, IconCheck, IconCube, IconPulse, IconRefresh, IconServer, IconSparkle } from "./ui/icons";

interface PerfInsights {
  windowHours: number;
  counts: Record<string, number>;
  rates: {
    cacheHitRate: number;
    hedgeWinRate: number;
    speculativeWinRate: number;
    stickyPinRate: number;
  };
  requestsLastHour: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
}

/** Display-only: animates a 0..1 rate as a whole percent. */
function Pct({ v }: { v: number }) {
  return <CountUp value={v * 100} suffix="%" />;
}

/** Display-only: ms below 1s, seconds above. */
function Ms({ v }: { v: number }) {
  return v < 1000 ? <CountUp value={v} suffix=" ms" /> : <CountUp value={v / 1000} decimals={1} suffix=" วินาที" />;
}

function fmtMs(v: number): string {
  return v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} วินาที`;
}

/** Stat with a native tooltip that explains the metric in plain Thai. */
function Metric({ title, ...stat }: { title: string; label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tone: Tone; loading: boolean }) {
  return (
    <div title={title}>
      <Stat {...stat} />
    </div>
  );
}

export function PerfInsightsPanel() {
  const [data, setData] = useState<PerfInsights | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/perf-insights");
        if (!res.ok) return;
        const json = await res.json() as PerfInsights;
        setData(json);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const c = data?.counts ?? {};
  const loading = !data;
  const healthy = (data?.errorRate ?? 0) < 0.05;

  return (
    <section aria-label="ประสิทธิภาพ 1 ชั่วโมงล่าสุด">
      <div className="mb-4">
        <h2 className="text-[17px] font-semibold tracking-tight text-white">ประสิทธิภาพ (1 ชม.ล่าสุด)</h2>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          {data
            ? `รวม ${data.requestsLastHour.toLocaleString()} คำขอ · เฉลี่ย ${fmtMs(data.avgLatencyMs)} · p50 ${fmtMs(data.p50LatencyMs)} · p95 ${fmtMs(data.p95LatencyMs)}`
            : "กำลังโหลดตัวชี้วัดประสิทธิภาพ..."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          title="สัดส่วนคำขอที่ตอบสำเร็จ (status ต่ำกว่า 400)"
          label="ตอบสำเร็จ"
          value={data ? <Pct v={1 - data.errorRate} /> : null}
          hint={healthy ? "สุขภาพดี" : "ตรวจ provider"}
          icon={healthy ? <IconCheck size={16} /> : <IconAlert size={16} />}
          tone={healthy ? "success" : "danger"}
          loading={loading}
        />
        <Metric
          title="ครึ่งหนึ่งของคำขอตอบเร็วกว่านี้ (p50)"
          label="p50 เวลาตอบ"
          value={data ? <Ms v={data.p50LatencyMs} /> : null}
          hint={data ? `p95 ${fmtMs(data.p95LatencyMs)}` : undefined}
          icon={<IconPulse size={16} />}
          tone="info"
          loading={loading}
        />
        <Metric
          title="จำนวนคำขอทั้งหมดใน 1 ชั่วโมงล่าสุด"
          label="ปริมาณงาน"
          value={data ? <CountUp value={data.requestsLastHour} /> : null}
          hint="คำขอ / ชม."
          icon={<IconServer size={16} />}
          tone="accent"
          loading={loading}
        />
        <Metric
          title="อัตราที่คำขอหาใน cache แล้วได้คำตอบเลย (ไม่ต้องถาม upstream)"
          label="แคชตอบทันที"
          value={data ? <Pct v={data.rates.cacheHitRate} /> : null}
          hint={`${c["cache:hit"] ?? 0}/${(c["cache:hit"] ?? 0) + (c["cache:miss"] ?? 0)} ครั้ง`}
          icon={<IconCube size={16} />}
          tone="success"
          loading={loading}
        />
        <Metric
          title="Hedge top-3: ยิงไป 3 provider พร้อมกัน ตัวที่ตอบก่อนชนะ"
          label="ยิงขนาน 3 ชนะ"
          value={data ? <Pct v={data.rates.hedgeWinRate} /> : null}
          hint={`${c["hedge:win"] ?? 0}/${(c["hedge:win"] ?? 0) + (c["hedge:loss"] ?? 0)} ครั้ง`}
          icon={<IconRefresh size={16} />}
          tone="info"
          loading={loading}
        />
        <Metric
          title="Speculative hedge: ถ้าตัวแรกไม่ตอบใน 1.5 วินาที ยิงสำรองแข่งคู่กัน"
          label="สำรองช่วย"
          value={data ? (c["spec:fire"] && c["spec:fire"] > 0 ? <Pct v={data.rates.speculativeWinRate} /> : "—") : null}
          hint={`ยิง ${c["spec:fire"] ?? 0} · ชนะ ${c["spec:win"] ?? 0}`}
          icon={<IconSparkle size={16} />}
          tone="accent"
          loading={loading}
        />
        <Metric
          title="Sticky routing: จำว่า IP + หมวดนี้ เคยใช้ model ไหน ในช่วง 30 วินาทีที่แล้ว"
          label="จำลูกค้าเก่า"
          value={data ? <CountUp value={c["sticky:hit"] ?? 0} /> : null}
          hint={data ? `${(data.rates.stickyPinRate * 100).toFixed(0)}% ของคำขอ` : undefined}
          icon={<IconCheck size={16} />}
          tone="neutral"
          loading={loading}
        />
        <Metric
          title="Auto-demote: provider โดนจำกัดอัตรา (429) อย่างน้อย 5 ครั้งใน 30 วินาที ระบบปิดใช้ชั่วคราว 5 นาที"
          label="provider ถูกพัก"
          value={data ? <CountUp value={c["demote:rate-limit"] ?? 0} /> : null}
          hint="เจอ 429 ซ้ำ → พัก 5 นาที"
          icon={<IconAlert size={16} />}
          tone="warning"
          loading={loading}
        />
      </div>
    </section>
  );
}
