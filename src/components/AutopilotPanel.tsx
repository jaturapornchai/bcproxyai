"use client";

import { useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";
import { Badge, Callout, Card, CardHeader } from "./ui/ui";
import type { Tone } from "./ui/ui";
import { IconAlert, IconInfo, IconSparkle } from "./ui/icons";

interface AutopilotCard {
  id: string;
  severity: "info" | "warn" | "critical";
  title: string;
  summary: string;
  action: string;
  evidence: Record<string, number | string>;
}

interface Resp {
  generatedAt: string;
  windowMin: number;
  cards: AutopilotCard[];
}

const SEVERITY: Record<AutopilotCard["severity"], { box: string; tone: Tone; label: string }> = {
  info: { box: "border-cyan-400/20 bg-cyan-400/[0.05]", tone: "info", label: "ข้อมูล" },
  warn: { box: "border-amber-400/25 bg-amber-400/[0.06]", tone: "warning", label: "เฝ้าระวัง" },
  critical: { box: "border-rose-400/30 bg-rose-400/[0.08]", tone: "danger", label: "เร่งด่วน" },
};

export function AutopilotPanel() {
  const [data, setData] = useState<Resp | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!(await getAdminAccess())) {
          if (!cancelled) setData(null);
          return;
        }
        const res = await fetch("/api/autopilot", { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as Resp;
        if (!cancelled) setData(json);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  return (
    <Card>
      <CardHeader
        icon={<IconSparkle size={18} />}
        title="AI Ops Autopilot"
        subtitle={data ? `คำแนะนำอัตโนมัติจากกฎของระบบ · อัปเดตทุก 30 วินาที · ${data.cards.length} เรื่อง` : "กำลังตรวจคำแนะนำ..."}
      />
      <div className="space-y-3 p-5">
        {!data ? (
          <div className="skeleton h-16" />
        ) : data.cards.length === 0 ? (
          <Callout tone="success">ระบบดูปกติ — ไม่มีการแจ้งเตือนใน 1 ชั่วโมงล่าสุด</Callout>
        ) : (
          data.cards.map((c) => {
            const s = SEVERITY[c.severity];
            return (
              <div key={c.id} className={`rounded-xl border p-4 ${s.box}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-gray-300">
                    {c.severity === "info" ? <IconInfo size={18} /> : <IconAlert size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-white">{c.title}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-gray-300">{c.summary}</p>
                    <p className="mt-1.5 text-[13px] text-[var(--muted)]">
                      <span className="text-violet-300">แนะนำ: </span>{c.action}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(c.evidence).map(([k, v]) => (
                        <span key={k} className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                          {k}: <span className="text-gray-200">{String(v)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
