"use client";

import { useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";
import { Badge, Card, CardHeader, CountUp, Stat } from "./ui/ui";
import { IconPulse, IconServer } from "./ui/icons";

interface ControlRoom {
  windowMin: number;
  worker: { status: string; lastRun: string | null; nextRun: string | null; judgeModel: string | null };
  requests: { total: number; errors: number; errorRate: number; avgMs: number; p50Ms: number; p95Ms: number };
  cooldownModels: number;
  providers: Array<{ provider: string; total: number; errors: number; errorRate: number; avgMs: number; p95Ms: number }>;
  topModels: Array<{ model: string; provider: string; total: number; errors: number; errorRate: number; avgMs: number }>;
  recentErrors: Array<{ model: string; provider: string | null; status: number; error: string | null; at: string }>;
  cache: { responseCache: { hits: number; misses: number; hitRate: number }; semanticEntries: number };
  circuits: { open: number; halfOpen: number };
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} วิ`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

const TH = "pb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted)]";

export function ControlRoomPanel() {
  const [data, setData] = useState<ControlRoom | null>(null);
  const [windowMin, setWindowMin] = useState(60);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!(await getAdminAccess())) {
          if (!cancelled) setData(null);
          return;
        }
        const res = await fetch(`/api/control-room?windowMin=${windowMin}`, { credentials: "include" });
        if (!res.ok) return;
        const json = await res.json() as ControlRoom;
        if (!cancelled) setData(json);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [windowMin]);

  const windowSelect = (
    <select
      value={windowMin}
      onChange={(e) => setWindowMin(Number(e.target.value))}
      aria-label="ช่วงเวลาที่ดู"
      className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[13px] text-gray-200"
    >
      <option value={15}>15 นาที</option>
      <option value={60}>1 ชม.</option>
      <option value={360}>6 ชม.</option>
      <option value={1440}>24 ชม.</option>
    </select>
  );

  if (!data) {
    return (
      <Card>
        <CardHeader icon={<IconPulse size={18} />} title="Control Room สด" subtitle="กำลังโหลด..." action={windowSelect} />
        <div className="space-y-2 p-5">
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<IconPulse size={18} />}
          title="Control Room สด"
          subtitle={`${data.requests.total.toLocaleString()} คำขอ · ผิดพลาด ${fmtPct(data.requests.errorRate)} · p95 ${fmtMs(data.requests.p95Ms)} · cooldown ${data.cooldownModels}`}
          action={windowSelect}
        />
        <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-4">
          <Stat label="Worker" value={<span className="text-[22px]">{data.worker.status}</span>} tone="accent" icon={<IconServer size={16} />} />
          <Stat
            label="Cache hit"
            value={<CountUp value={data.cache.responseCache.hitRate * 100} decimals={1} suffix="%" />}
            hint={`${data.cache.responseCache.hits} / ${data.cache.responseCache.hits + data.cache.responseCache.misses}`}
            tone="success"
          />
          <Stat
            label="Circuits"
            value={`${data.circuits.open} เปิด`}
            hint={`${data.circuits.halfOpen} half-open`}
            tone={data.circuits.open > 0 ? "danger" : "success"}
          />
          <Stat label="Semantic" value={<CountUp value={data.cache.semanticEntries} />} hint="entries" tone="info" />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Provider" subtitle="ผู้ให้บริการที่รับงานมากที่สุด" />
          <div className="overflow-x-auto px-5 pb-5 pt-3">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>Provider</th>
                  <th className={`${TH} text-right`}>Req</th>
                  <th className={`${TH} text-right`}>Err</th>
                  <th className={`${TH} text-right`}>p95</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {data.providers.slice(0, 8).map((p) => (
                  <tr key={p.provider} className="border-t border-white/5">
                    <td className="py-1.5">{p.provider}</td>
                    <td className="text-right">{p.total}</td>
                    <td className={`text-right ${p.errorRate > 0.1 ? "text-rose-300" : ""}`}>{fmtPct(p.errorRate)}</td>
                    <td className="text-right">{fmtMs(p.p95Ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Top models" subtitle="โมเดลที่ถูกเรียกใช้บ่อยที่สุด" />
          <div className="overflow-x-auto px-5 pb-5 pt-3">
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>Model</th>
                  <th className={`${TH} text-right`}>Req</th>
                  <th className={`${TH} text-right`}>Err</th>
                  <th className={`${TH} text-right`}>avg</th>
                </tr>
              </thead>
              <tbody className="text-gray-200">
                {data.topModels.slice(0, 8).map((m) => (
                  <tr key={`${m.provider}/${m.model}`} className="border-t border-white/5">
                    <td className="max-w-[200px] truncate py-1.5">{m.provider}/{m.model}</td>
                    <td className="text-right">{m.total}</td>
                    <td className={`text-right ${m.errorRate > 0.1 ? "text-rose-300" : ""}`}>{fmtPct(m.errorRate)}</td>
                    <td className="text-right">{fmtMs(m.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {data.recentErrors.length > 0 && (
        <Card>
          <CardHeader title="ข้อผิดพลาดล่าสุด" subtitle="5 รายการล่าสุดในช่วงเวลาที่เลือก" />
          <ul className="space-y-2 p-5 text-[13px]">
            {data.recentErrors.slice(0, 5).map((e, i) => (
              <li key={i} className="flex items-start gap-2 border-l-2 border-rose-400/40 pl-3 text-gray-300">
                <Badge tone="danger">{e.status}</Badge>
                <span className="min-w-0 break-words">
                  <span className="text-gray-400">{e.provider}/{e.model}</span>{" "}
                  <span className="text-[var(--muted)]">— {e.error?.slice(0, 100) ?? "no detail"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
