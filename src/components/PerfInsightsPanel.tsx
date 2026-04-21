"use client";

import { useEffect, useState } from "react";

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

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function fmtMs(v: number): string {
  if (v < 1000) return `${v} ms`;
  return `${(v / 1000).toFixed(1)} วินาที`;
}

function StatCard({
  emoji, label, value, subtext, color, title,
}: {
  emoji: string; label: string; value: string; subtext?: string; color: string; title?: string;
}) {
  return (
    <div
      className={`rounded-lg border ${color} px-3 py-2 flex flex-col gap-0.5`}
      title={title}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 leading-tight">
        <span className="text-sm">{emoji}</span>
        <span>{label}</span>
      </div>
      <div className="text-2xl font-black text-white leading-tight">{value}</div>
      {subtext && <div className="text-[11px] text-gray-500 leading-tight">{subtext}</div>}
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

  if (!data) {
    return (
      <div className="glass rounded-xl p-4 border border-indigo-500/15 text-sm text-gray-400">
        กำลังโหลดตัวชี้วัดประสิทธิภาพ...
      </div>
    );
  }

  const c = data.counts;

  return (
    <div className="glass rounded-xl p-4 border border-indigo-500/15 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">⚡</span>
        <div>
          <h2 className="text-xl font-black text-white leading-tight">ประสิทธิภาพ (1 ชม.ล่าสุด)</h2>
          <p className="text-xs text-gray-400 leading-tight">
            รวม {data.requestsLastHour.toLocaleString()} คำขอ · เฉลี่ย {fmtMs(data.avgLatencyMs)} · p50 {fmtMs(data.p50LatencyMs)} · p95 {fmtMs(data.p95LatencyMs)} · ผิดพลาด {fmtPct(data.errorRate)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <StatCard
          emoji="💾"
          label="แคชตอบทันที"
          value={fmtPct(data.rates.cacheHitRate)}
          subtext={`${c["cache:hit"] ?? 0}/${(c["cache:hit"] ?? 0) + (c["cache:miss"] ?? 0)} ครั้ง`}
          color="border-emerald-500/30 bg-emerald-500/5"
          title="อัตราที่คำขอหาใน cache แล้วได้เลย (ไม่ต้องถาม upstream)"
        />
        <StatCard
          emoji="🏁"
          label="ยิงขนาน 3 ชนะ"
          value={fmtPct(data.rates.hedgeWinRate)}
          subtext={`${c["hedge:win"] ?? 0}/${(c["hedge:win"] ?? 0) + (c["hedge:loss"] ?? 0)} ครั้ง`}
          color="border-cyan-500/30 bg-cyan-500/5"
          title="Hedge top-3: ยิงไป 3 provider พร้อมกัน ตัวที่ตอบก่อนชนะ"
        />
        <StatCard
          emoji="⚡"
          label="สำรองช่วย"
          value={c["spec:fire"] && c["spec:fire"] > 0 ? fmtPct(data.rates.speculativeWinRate) : "—"}
          subtext={`ยิง ${c["spec:fire"] ?? 0} · ชนะ ${c["spec:win"] ?? 0}`}
          color="border-violet-500/30 bg-violet-500/5"
          title="Speculative hedge: ถ้าตัวแรกไม่ตอบใน 1.5 วินาที ยิงสำรองแข่งคู่กัน"
        />
        <StatCard
          emoji="📌"
          label="จำลูกค้าเก่า"
          value={`${c["sticky:hit"] ?? 0}`}
          subtext={`${fmtPct(data.rates.stickyPinRate)} ของคำขอ`}
          color="border-indigo-500/30 bg-indigo-500/5"
          title="Sticky routing: จำว่า IP + หมวดนี้ เคยใช้ model ไหน ในช่วง 30 วินาทีที่แล้ว"
        />
        <StatCard
          emoji="🚫"
          label="provider ถูกพัก"
          value={`${c["demote:rate-limit"] ?? 0}`}
          subtext="เจอ 429 ซ้ำ → พัก 5 นาที"
          color="border-amber-500/30 bg-amber-500/5"
          title="Auto-demote: provider ถูกจำกัดอัตรา (429) ≥ 5 ครั้งใน 30 วินาที → ระบบปิดใช้ชั่วคราว 5 นาที"
        />
        <StatCard
          emoji="📈"
          label="p50 เวลาตอบ"
          value={fmtMs(data.p50LatencyMs)}
          subtext={`p95 ${fmtMs(data.p95LatencyMs)}`}
          color="border-teal-500/30 bg-teal-500/5"
          title="ครึ่งนึงของคำขอตอบเร็วกว่านี้ (p50) / 95% เร็วกว่านี้ (p95)"
        />
        <StatCard
          emoji="📊"
          label="ปริมาณงาน"
          value={`${data.requestsLastHour.toLocaleString()}`}
          subtext="คำขอ / ชม."
          color="border-blue-500/30 bg-blue-500/5"
          title="จำนวน request ทั้งหมดใน 1 ชั่วโมงล่าสุด"
        />
        <StatCard
          emoji={data.errorRate < 0.05 ? "✅" : "⚠️"}
          label="อัตราผิดพลาด"
          value={fmtPct(data.errorRate)}
          subtext={data.errorRate < 0.05 ? "สุขภาพดี" : "เช็ค provider"}
          color={data.errorRate < 0.05 ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}
          title="สัดส่วนคำขอที่ตอบไม่สำเร็จ (status ≥ 400)"
        />
      </div>
    </div>
  );
}
