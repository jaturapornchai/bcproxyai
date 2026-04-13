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
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mt-6">
      {[
        { label: "โมเดลทั้งหมด",   value: stats?.totalModels ?? 0,       color: "from-indigo-500 to-purple-500",  delay: "stagger-1", suffix: "" },
        { label: "สอบผ่าน",         value: stats?.passedExam ?? 0,        color: "from-emerald-500 to-teal-500",   delay: "stagger-2", suffix: "" },
        { label: "สอบตก",           value: stats?.failedExam ?? 0,        color: "from-red-500 to-rose-500",       delay: "stagger-3", suffix: "" },
        { label: "รอสอบ",           value: (stats?.totalModels ?? 0) - examined, color: "from-amber-500 to-orange-500", delay: "stagger-4", suffix: "" },
        { label: "คะแนนเฉลี่ย",    value: stats?.avgScore ?? 0,          color: "from-cyan-500 to-sky-500",       delay: "stagger-5", suffix: "%" },
      ].map((card) => (
        <div key={card.label} className={`card-3d glass rounded-2xl p-5 animate-fade-in-up ${card.delay}`}>
          <div className={`text-4xl font-extrabold bg-gradient-to-r ${card.color} bg-clip-text text-transparent mb-1`}>
            {loading ? (
              <Skeleton className="h-10 w-16" />
            ) : (
              <span>
                <AnimatedNumber value={card.value} />
                {card.suffix && <span className="text-xl font-medium opacity-70">{card.suffix}</span>}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-400">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
