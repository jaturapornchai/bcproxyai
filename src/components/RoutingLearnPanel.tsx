"use client";

import { useEffect, useState } from "react";
import { PROVIDER_COLORS } from "./shared";
import { Badge, Card, CardHeader, CountUp, EmptyState, LinkButton, Stat } from "./ui/ui";
import { IconChat, IconCompass } from "./ui/icons";

interface CategoryStat {
  prompt_category: string;
  model_id: string;
  provider: string;
  nickname: string | null;
  total: number;
  successes: number;
  success_rate: number;
  avg_latency_ms: number;
}

interface Distribution {
  prompt_category: string;
  count: number;
}

interface RoutingData {
  categories: Record<string, CategoryStat[]>;
  distribution: Distribution[];
  totalLearned: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "ทั่วไป",
  code: "โค้ด",
  thai: "ภาษาไทย",
  math: "คณิตศาสตร์",
  creative: "สร้างสรรค์",
  analysis: "วิเคราะห์",
  translate: "แปลภาษา",
};

const SEGMENT_COLORS = ["bg-violet-400", "bg-cyan-400", "bg-emerald-400", "bg-amber-400", "bg-rose-400", "bg-fuchsia-400", "bg-teal-400"];

export function RoutingLearnPanel() {
  const [data, setData] = useState<RoutingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/routing-stats");
        if (res.ok) setData(await res.json());
      } catch { /* silent */ }
      setLoading(false);
    };
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <Card className="p-5" aria-busy="true">
        <div className="skeleton h-24" />
      </Card>
    );
  }
  if (!data || data.totalLearned === 0) {
    return (
      <Card>
        <EmptyState
          icon={<IconCompass size={22} />}
          title="ระบบยังไม่ได้เรียนรู้ว่าโมเดลไหนเก่งเรื่องอะไร"
          description="ส่งคำขอผ่าน gateway สักระยะ ระบบจะจำว่าโมเดลไหนตอบหมวดไหนได้ดีและเลือกให้อัตโนมัติ"
          action={<LinkButton href="/playground" variant="primary" size="sm"><IconChat size={14} /> ลองส่งแชท</LinkButton>}
        />
      </Card>
    );
  }

  const totalDist = data.distribution.reduce((s, d) => s + d.count, 0);
  const label = (cat: string) => CATEGORY_LABELS[cat] ?? cat;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ครั้งที่ระบบจำได้" value={<CountUp value={data.totalLearned} />} tone="accent" />
        <Stat label="หมวดงาน" value={<CountUp value={Object.keys(data.categories).length} />} tone="info" />
        <Stat
          label="คู่ model-หมวด"
          value={<CountUp value={Object.values(data.categories).reduce((s, cats) => s + cats.length, 0)} />}
          tone="success"
        />
        <Stat label="ช่วงข้อมูล" value="7 วัน" tone="warning" />
      </div>

      <Card>
        <CardHeader title="สัดส่วนงานแต่ละหมวด" subtitle="หมวดไหนถูกใช้เยอะที่สุดในช่วง 7 วันที่ผ่านมา" />
        <div className="p-5">
          <div className="flex h-8 gap-1 overflow-hidden rounded-lg" role="img" aria-label="กราฟสัดส่วนงานแต่ละหมวด">
            {data.distribution.map((d, i) => {
              const pct = (d.count / totalDist) * 100;
              return (
                <div
                  key={d.prompt_category}
                  className={`${SEGMENT_COLORS[i % SEGMENT_COLORS.length]} h-full opacity-80 transition-opacity hover:opacity-100`}
                  // ponytail: width is data-driven, so it can't be a static class
                  style={{ width: `${Math.max(pct, 3)}%` }}
                  title={`${label(d.prompt_category)}: ${d.count} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-[var(--muted)]">
            {data.distribution.map((d, i) => (
              <li key={d.prompt_category} className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-sm ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} />
                {label(d.prompt_category)}
                <span className="tabular-nums text-gray-500">{d.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data.categories).map(([cat, models]) => (
          <Card key={cat} hover className="p-5">
            <h4 className="mb-3 text-[14px] font-semibold text-white">{label(cat)} <span className="font-normal text-[var(--muted)]">· โมเดลเด่นประจำหมวด</span></h4>
            <div className="space-y-2.5">
              {models.slice(0, 3).map((m, i) => {
                const colors = PROVIDER_COLORS[m.provider] ?? PROVIDER_COLORS.openrouter;
                return (
                  <div key={m.model_id} className="flex items-center gap-3">
                    <Badge tone={i === 0 ? "accent" : "neutral"}>{i + 1}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-gray-200">{m.model_id.split(":")[0]}</div>
                      <div className={`text-[11px] ${colors.text}`}>{m.provider}</div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-[13px] font-semibold text-emerald-300">{m.success_rate}%</div>
                      <div className="text-[11px] text-[var(--muted)]">{m.avg_latency_ms} ms</div>
                    </div>
                  </div>
                );
              })}
              {models.length === 0 && (
                <div className="py-2 text-center text-[12px] text-[var(--muted)]">ยังมีข้อมูลหมวดนี้ไม่พอ</div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
