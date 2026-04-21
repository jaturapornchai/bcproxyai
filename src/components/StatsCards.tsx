"use client";

import { AnimatedNumber, Skeleton } from "./shared";
import type { Stats } from "./shared";

interface StatsCardsProps {
  stats: Stats | undefined;
  loading: boolean;
}

export function StatsCards({ stats, loading }: StatsCardsProps) {
  const examined = (stats?.passedExam ?? 0) + (stats?.failedExam ?? 0);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 mt-3">
      {[
        { label: "โมเดลทั้งหมด",  value: stats?.totalModels ?? 0, color: "from-indigo-500 to-purple-500", delay: "stagger-1", suffix: "", tip: "model ทั้งหมดที่ระบบรู้จัก (รวมที่ยังไม่สอบ + สอบตก)" },
        { label: "สอบผ่าน",        value: stats?.passedExam ?? 0,  color: "from-emerald-500 to-teal-500",  delay: "stagger-2", suffix: "", tip: "model ที่ผ่านข้อสอบล่าสุด พร้อมรับงาน" },
        { label: "สอบตก",          value: stats?.failedExam ?? 0,  color: "from-red-500 to-rose-500",      delay: "stagger-3", suffix: "", tip: "model ที่สอบไม่ผ่านเกณฑ์ในรอบล่าสุด" },
        { label: "รอสอบ",          value: (stats?.totalModels ?? 0) - examined, color: "from-amber-500 to-orange-500", delay: "stagger-4", suffix: "", tip: "model ใหม่ที่ระบบยังไม่ได้ทดสอบ — worker จะสอบให้" },
        { label: "คะแนนเฉลี่ย",   value: stats?.avgScore ?? 0,    color: "from-cyan-500 to-sky-500",      delay: "stagger-5", suffix: "%", tip: "เฉลี่ยของ model ที่สอบผ่าน (0-100%)" },
      ].map((card) => (
        <div key={card.label} className={`card-3d glass rounded-xl px-3 py-2 animate-fade-in-up ${card.delay}`} title={card.tip}>
          <div className={`text-3xl font-black bg-gradient-to-r ${card.color} bg-clip-text text-transparent leading-tight`}>
            {loading ? (
              <Skeleton className="h-8 w-14" />
            ) : (
              <span>
                <AnimatedNumber value={card.value} />
                {card.suffix && <span className="text-base font-medium opacity-70">{card.suffix}</span>}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 leading-tight">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
