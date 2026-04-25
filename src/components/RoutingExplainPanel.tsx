"use client";

import { useEffect, useState } from "react";

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

export function RoutingExplainPanel() {
  const [data, setData] = useState<Resp | null>(null);
  const [filter, setFilter] = useState<"all" | "fallback" | "error">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams();
        params.set("limit", "30");
        if (filter === "fallback") params.set("fallback", "1");
        if (filter === "error") params.set("error", "1");
        const res = await fetch(`/api/routing-explain?${params.toString()}`, { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as Resp;
        if (!cancelled) setData(json);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [filter]);

  if (!data) {
    return (
      <div className="glass rounded-xl p-4 border border-violet-500/15 text-sm text-gray-400">
        กำลังโหลด routing explain...
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 border border-violet-500/15 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🧭</span>
          <div>
            <h2 className="text-xl font-black text-white leading-tight">Smart Routing Explain</h2>
            <p className="text-xs text-gray-400">{data.total} decisions · ทุก 15 วิ</p>
          </div>
        </div>
        <div className="flex gap-1">
          {(["all", "fallback", "error"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded border ${filter === f ? "bg-violet-500/20 border-violet-500/40 text-white" : "bg-black/20 border-white/10 text-gray-400"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1 max-h-96 overflow-y-auto">
        {data.entries.length === 0 && (
          <div className="text-sm text-gray-500 py-4 text-center">ไม่มีข้อมูล</div>
        )}
        {data.entries.map((e) => {
          const id = e.requestId ?? "";
          const isOpen = openId === id;
          return (
            <div key={id || e.at} className="border border-white/5 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenId(isOpen ? null : id)}
                className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 text-xs"
              >
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${e.status >= 400 ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                  {e.status}
                </span>
                <span className="text-gray-300 truncate flex-1">
                  {e.provider}/{e.resolvedModel ?? e.requestModel}
                </span>
                <span className="text-gray-500 text-[10px]">
                  {e.explain?.mode ?? "—"}
                  {e.explain?.fallbackUsed && <span className="text-amber-400"> ⚠️ fallback</span>}
                </span>
                <span className="text-gray-500 text-[10px]">{e.latencyMs}ms</span>
              </button>
              {isOpen && e.explain && (
                <div className="px-3 py-2 bg-black/20 text-xs space-y-1.5">
                  <div className="text-gray-400">
                    mode=<span className="text-gray-200">{e.explain.mode}</span>{" "}
                    category=<span className="text-gray-200">{e.explain.category ?? "—"}</span>{" "}
                    selected=<span className="text-emerald-300">{e.explain.selected?.reason ?? "—"}</span>
                  </div>
                  <div>
                    <div className="text-gray-500">Candidates ({e.explain.candidates.length}):</div>
                    <ol className="space-y-0.5 ml-3">
                      {e.explain.candidates.map((c, i) => (
                        <li key={i} className="text-gray-300">
                          {c.accepted ? "✅" : "·"} {c.provider}/{c.model}{" "}
                          <span className="text-gray-500">— {c.reason}{c.detail ? ` (${c.detail})` : ""}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {id && (
                    <div className="text-gray-500">
                      Trace: <a href={`/v1/trace/${id}`} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">{id}</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
