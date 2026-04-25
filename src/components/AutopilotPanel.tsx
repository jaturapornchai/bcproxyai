"use client";

import { useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";

interface Card {
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
  cards: Card[];
}

const SEVERITY_STYLE: Record<Card["severity"], string> = {
  info: "border-sky-500/30 bg-sky-500/5",
  warn: "border-amber-500/30 bg-amber-500/5",
  critical: "border-red-500/40 bg-red-500/10",
};

const SEVERITY_EMOJI: Record<Card["severity"], string> = {
  info: "ℹ️",
  warn: "⚠️",
  critical: "🚨",
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

  if (!data) {
    return (
      <div className="glass rounded-xl p-4 border border-amber-500/15 text-sm text-gray-400">
        กำลังตรวจ Autopilot suggestions...
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 border border-amber-500/15 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🤖</span>
        <div>
          <h2 className="text-xl font-black text-white leading-tight">AI Ops Autopilot</h2>
          <p className="text-xs text-gray-400">
            Rule-based recommendations · ทุก 30 วิ · {data.cards.length} เรื่อง
          </p>
        </div>
      </div>

      {data.cards.length === 0 ? (
        <div className="text-sm text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
          ✅ ระบบดูปกติ — ไม่มี alert ใน 1 ชม.ล่าสุด
        </div>
      ) : (
        <div className="space-y-2">
          {data.cards.map((c) => (
            <div key={c.id} className={`rounded-lg border ${SEVERITY_STYLE[c.severity]} p-3`}>
              <div className="flex items-start gap-2">
                <span className="text-lg">{SEVERITY_EMOJI[c.severity]}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white">{c.title}</div>
                  <div className="text-xs text-gray-300 mt-0.5">{c.summary}</div>
                  <div className="text-xs text-gray-400 mt-1.5">
                    <span className="text-gray-500">→ </span>{c.action}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {Object.entries(c.evidence).map(([k, v]) => (
                      <span key={k} className="text-[10px] bg-black/30 border border-white/10 rounded px-1.5 py-0.5 text-gray-400">
                        {k}: <span className="text-gray-200">{String(v)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
