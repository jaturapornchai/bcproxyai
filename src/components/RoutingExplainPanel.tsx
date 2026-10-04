"use client";

import { useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";
import { Badge, Card, CardHeader, EmptyState } from "./ui/ui";
import { IconCheck, IconCompass } from "./ui/icons";

interface Candidate {
  provider: string;
  model: string;
  accepted: boolean;
  reason: string;
  detail?: string;
}

interface Explain {
  mode: string;
  category: string | null;
  candidates: Candidate[];
  selected: { provider: string; model: string; reason: string } | null;
  fallbackUsed: boolean;
}

interface Entry {
  requestId: string | null;
  requestModel: string;
  resolvedModel: string | null;
  provider: string | null;
  status: number;
  latencyMs: number;
  explain: Explain | null;
  at: string;
}

interface Resp {
  total: number;
  entries: Entry[];
}

function normalizeResp(value: Resp): Resp {
  return {
    total: Number.isFinite(value.total) ? value.total : 0,
    entries: Array.isArray(value.entries)
      ? value.entries.map((entry) => ({
          ...entry,
          explain: entry.explain
            ? {
                ...entry.explain,
                candidates: Array.isArray(entry.explain.candidates) ? entry.explain.candidates : [],
                selected: entry.explain.selected ?? null,
                fallbackUsed: entry.explain.fallbackUsed === true,
              }
            : null,
        }))
      : [],
  };
}

const FILTERS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "fallback", label: "ใช้ตัวสำรอง" },
  { id: "error", label: "ผิดพลาด" },
] as const;

export function RoutingExplainPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [filter, setFilter] = useState<"all" | "fallback" | "error">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        if (!(await getAdminAccess())) {
          if (!cancelled) setData(null);
          return;
        }
        const params = new URLSearchParams();
        params.set("limit", "30");
        if (filter === "fallback") params.set("fallback", "1");
        if (filter === "error") params.set("error", "1");
        const res = await fetch(`/api/routing-explain?${params.toString()}`, { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as Resp;
        if (!cancelled) setData(normalizeResp(json));
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [filter]);

  return (
    <Card>
      <CardHeader
        icon={<IconCompass size={18} />}
        title="Smart Routing Explain"
        subtitle={data ? `เหตุผลที่ระบบเลือกโมเดลในแต่ละคำขอ · ${data.total} รายการ · อัปเดตทุก 15 วินาที` : "กำลังโหลดเหตุผลการเลือกโมเดล..."}
        action={
          <div className="flex gap-1" role="group" aria-label="กรองรายการ">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                  filter === f.id
                    ? "border-violet-400/40 bg-violet-400/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:text-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="max-h-[28rem] space-y-2 overflow-y-auto p-5">
        {!data && <div className="skeleton h-12" />}
        {data && data.entries.length === 0 && (
          <EmptyState title="ยังไม่มีข้อมูล" description="เมื่อมีคำขอผ่าน gateway เหตุผลการเลือกโมเดลจะแสดงที่นี่" />
        )}
        {data?.entries.map((e) => {
          const id = e.requestId ?? "";
          const isOpen = openId === id;
          const candidates = Array.isArray(e.explain?.candidates) ? e.explain.candidates : [];
          return (
            <div key={id || e.at} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
              <button
                onClick={() => setOpenId(isOpen ? null : id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition-colors hover:bg-white/5"
              >
                <Badge tone={e.status >= 400 ? "danger" : "success"}>{e.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-gray-200">
                  {e.provider}/{e.resolvedModel ?? e.requestModel}
                </span>
                <span className="hidden shrink-0 text-[12px] text-[var(--muted)] sm:inline">
                  {e.explain?.mode ?? "—"}
                </span>
                {e.explain?.fallbackUsed && <Badge tone="warning">fallback</Badge>}
                <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">{e.latencyMs} ms</span>
              </button>
              {isOpen && e.explain && (
                <div className="space-y-2 border-t border-white/5 bg-black/20 px-3.5 py-3 text-[13px]">
                  <div className="text-[var(--muted)]">
                    mode=<span className="text-gray-200">{e.explain.mode}</span>{" "}
                    category=<span className="text-gray-200">{e.explain.category ?? "—"}</span>{" "}
                    selected=<span className="text-emerald-300">{e.explain.selected?.reason ?? "—"}</span>
                  </div>
                  <div>
                    <div className="mb-1 text-[var(--muted)]">Candidates ({candidates.length})</div>
                    <ol className="ml-1 space-y-1">
                      {candidates.map((c, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-gray-300">
                          <span className={`mt-0.5 shrink-0 ${c.accepted ? "text-emerald-300" : "text-gray-600"}`}>
                            {c.accepted ? <IconCheck size={14} /> : <span aria-hidden>·</span>}
                          </span>
                          <span className="min-w-0 break-words">
                            {c.provider}/{c.model}{" "}
                            <span className="text-[var(--muted)]">— {c.reason}{c.detail ? ` (${c.detail})` : ""}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {id && (
                    <div className="break-all text-[var(--muted)]">
                      Trace: <a href={`/v1/trace/${id}`} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">{id}</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
