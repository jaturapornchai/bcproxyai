"use client";

import { useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";

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

  if (!data) {
    return (
      <div className="glass rounded-xl p-4 border border-cyan-500/15 text-sm text-gray-400">
        กำลังโหลด Control Room...
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-4 border border-cyan-500/15 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🛰️</span>
          <div>
            <h2 className="text-xl font-black text-white leading-tight">Live Control Room</h2>
            <p className="text-xs text-gray-400">
              {data.requests.total.toLocaleString()} คำขอ · ผิดพลาด {fmtPct(data.requests.errorRate)} · p95 {fmtMs(data.requests.p95Ms)} · cooldown {data.cooldownModels}
            </p>
          </div>
        </div>
        <select
          value={windowMin}
          onChange={(e) => setWindowMin(Number(e.target.value))}
          className="bg-black/30 border border-white/10 text-xs rounded px-2 py-1 text-gray-200"
        >
          <option value={15}>15 นาที</option>
          <option value={60}>1 ชม.</option>
          <option value={360}>6 ชม.</option>
          <option value={1440}>24 ชม.</option>
        </select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Worker" value={data.worker.status} color="indigo" />
        <Stat label="Cache hit" value={fmtPct(data.cache.responseCache.hitRate)} sub={`${data.cache.responseCache.hits} / ${data.cache.responseCache.hits + data.cache.responseCache.misses}`} color="emerald" />
        <Stat label="Circuits" value={`${data.circuits.open} เปิด`} sub={`${data.circuits.halfOpen} half-open`} color={data.circuits.open > 0 ? "red" : "emerald"} />
        <Stat label="Semantic" value={`${data.cache.semanticEntries}`} sub="entries" color="violet" />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-gray-400 mb-1">Provider</div>
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left">Provider</th>
                <th className="text-right">Req</th>
                <th className="text-right">Err</th>
                <th className="text-right">p95</th>
              </tr>
            </thead>
            <tbody className="text-gray-200">
              {data.providers.slice(0, 8).map((p) => (
                <tr key={p.provider} className="border-t border-white/5">
                  <td className="py-1">{p.provider}</td>
                  <td className="text-right">{p.total}</td>
                  <td className={`text-right ${p.errorRate > 0.1 ? "text-red-400" : ""}`}>{fmtPct(p.errorRate)}</td>
                  <td className="text-right">{fmtMs(p.p95Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Top models</div>
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left">Model</th>
                <th className="text-right">Req</th>
                <th className="text-right">Err</th>
                <th className="text-right">avg</th>
              </tr>
            </thead>
            <tbody className="text-gray-200">
              {data.topModels.slice(0, 8).map((m) => (
                <tr key={`${m.provider}/${m.model}`} className="border-t border-white/5">
                  <td className="py-1 truncate max-w-[200px]">{m.provider}/{m.model}</td>
                  <td className="text-right">{m.total}</td>
                  <td className={`text-right ${m.errorRate > 0.1 ? "text-red-400" : ""}`}>{fmtPct(m.errorRate)}</td>
                  <td className="text-right">{fmtMs(m.avgMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.recentErrors.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-1">Recent errors</div>
          <ul className="space-y-1 text-xs">
            {data.recentErrors.slice(0, 5).map((e, i) => (
              <li key={i} className="border-l-2 border-red-500/40 pl-2 text-gray-300">
                <span className="text-red-400">{e.status}</span>{" "}
                <span className="text-gray-400">{e.provider}/{e.model}</span>{" "}
                <span className="text-gray-500">— {e.error?.slice(0, 100) ?? "no detail"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  const colorMap: Record<string, string> = {
    indigo: "border-indigo-500/30 bg-indigo-500/5",
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    red: "border-red-500/30 bg-red-500/5",
    violet: "border-violet-500/30 bg-violet-500/5",
  };
  return (
    <div className={`rounded-lg border ${colorMap[color] ?? colorMap.indigo} px-3 py-2`}>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
      {sub && <div className="text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}
