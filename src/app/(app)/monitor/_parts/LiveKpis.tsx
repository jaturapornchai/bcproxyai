"use client";

import { useEffect, useState } from "react";
import { CountUp, Stat } from "@/components/ui/ui";
import { IconAlert, IconCheck, IconPulse, IconServer } from "@/components/ui/icons";

interface Perf {
  requestsLastHour: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
}

/** Display-only: ms below 1s, seconds above. */
function Ms({ v }: { v: number }) {
  return v < 1000 ? <CountUp value={v} suffix=" ms" /> : <CountUp value={v / 1000} decimals={1} suffix=" วิ" />;
}

/** Live headline numbers for the last hour (public endpoint, refreshed every 5s). */
export function LiveKpis() {
  const [d, setD] = useState<Perf | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/perf-insights");
        if (res.ok) setD((await res.json()) as Perf);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, []);

  const ok = d ? d.errorRate < 0.05 : true;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label="ตอบสำเร็จ"
        value={d ? <CountUp value={(1 - d.errorRate) * 100} decimals={1} suffix="%" /> : null}
        hint={ok ? "สุขภาพดี" : "ตรวจ provider ในแท็บ \"ระบบ\""}
        icon={ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
        tone={ok ? "success" : "danger"}
        loading={!d}
      />
      <Stat
        label="เวลาตอบ p50"
        value={d ? <Ms v={d.p50LatencyMs} /> : null}
        hint="ครึ่งหนึ่งของคำขอเร็วกว่านี้"
        icon={<IconPulse size={16} />}
        tone="info"
        loading={!d}
      />
      <Stat
        label="เวลาตอบ p95"
        value={d ? <Ms v={d.p95LatencyMs} /> : null}
        hint="95% ของคำขอเร็วกว่านี้"
        icon={<IconPulse size={16} />}
        tone="warning"
        loading={!d}
      />
      <Stat
        label="คำขอใน 1 ชม."
        value={d ? <CountUp value={d.requestsLastHour} /> : null}
        hint="อัปเดตทุก 5 วินาที"
        icon={<IconServer size={16} />}
        tone="accent"
        loading={!d}
      />
    </div>
  );
}
