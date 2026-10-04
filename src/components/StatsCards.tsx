"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCube, IconPulse, IconSparkle, IconX } from "./ui/icons";
import { CountUp, Reveal, Stat } from "./ui/ui";
import type { Tone } from "./ui/ui";
import type { Stats } from "./shared";

/** Counts up once on first paint, then updates in place so periodic refreshes do not replay the animation. */
export function LiveNumber({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 1200);
    return () => clearTimeout(t);
  }, []);
  return settled ? <span className="tabular-nums">{value.toFixed(decimals)}{suffix}</span> : <CountUp value={value} decimals={decimals} suffix={suffix} />;
}

interface StatsCardsProps {
  stats: Stats | undefined;
  loading: boolean;
}

export function StatsCards({ stats, loading }: StatsCardsProps) {
  const examined = (stats?.passedExam ?? 0) + (stats?.failedExam ?? 0);

  const cards: Array<{ label: string; value: number; suffix?: string; hint: string; tone: Tone; icon: React.ReactNode }> = [
    { label: "โมเดลทั้งหมด", value: stats?.totalModels ?? 0, hint: "ที่ระบบรู้จัก", tone: "accent", icon: <IconCube size={16} /> },
    { label: "สอบผ่าน", value: stats?.passedExam ?? 0, hint: "พร้อมรับงาน", tone: "success", icon: <IconCheck size={16} /> },
    { label: "สอบตก", value: stats?.failedExam ?? 0, hint: "ไม่ถึงเกณฑ์", tone: "danger", icon: <IconX size={16} /> },
    { label: "รอสอบ", value: Math.max(0, (stats?.totalModels ?? 0) - examined), hint: "ยังไม่ได้สอบ", tone: "warning", icon: <IconPulse size={16} /> },
    { label: "คะแนนเฉลี่ย", value: stats?.avgScore ?? 0, suffix: "%", hint: "ของผู้สอบผ่าน", tone: "info", icon: <IconSparkle size={16} /> },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((c, i) => (
        <Reveal key={c.label} i={i}>
          <Stat
            label={c.label}
            tone={c.tone}
            icon={c.icon}
            hint={c.hint}
            loading={loading}
            value={<LiveNumber value={c.value} suffix={c.suffix} />}
          />
        </Reveal>
      ))}
    </div>
  );
}
