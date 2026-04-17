"use client";

import { useCallback, useEffect, useState } from "react";

interface CatalogProvider {
  name: string;
  label: string | null;
  base_url: string;
  env_var: string | null;
  homepage: string | null;
  status: "active" | "pending" | "failed" | "paused";
  source: string;
  notes: string | null;
  free_tier: boolean;
  last_probed_at: string | null;
  probe_status_code: number | null;
  discovered_at: string;
  updated_at: string;
}

interface CatalogResponse {
  summary: {
    total: number;
    active: number;
    pending: number;
    free_tier: number;
    sources: Record<string, number>;
  };
  providers: CatalogProvider[];
}

const STATUS_STYLE: Record<CatalogProvider["status"], { label: string; cls: string }> = {
  active:  { label: "✓ ใช้งาน",     cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  pending: { label: "⌛ รอ wire",   cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  failed:  { label: "✗ พังแล้ว",   cls: "bg-red-500/20 text-red-300 border-red-500/30" },
  paused:  { label: "⏸ หยุด",      cls: "bg-gray-500/20 text-gray-300 border-gray-500/30" },
};

const SOURCE_EMOJI: Record<string, string> = {
  seed:        "🌱",
  openrouter:  "🛣",
  huggingface: "🤗",
  pattern:     "🔍",
  manual:      "✋",
};

export function ProviderCatalogPanel() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "pending">("all");
  const [discovering, setDiscovering] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/provider-catalog", { cache: "no-store" });
      const json = (await res.json()) as CatalogResponse;
      setData(json);
    } catch (err) {
      console.error("[ProviderCatalogPanel] fetch error", err);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
    const t = setInterval(fetchCatalog, 30_000);
    return () => clearInterval(t);
  }, [fetchCatalog]);

  const onDiscover = async () => {
    setDiscovering(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/provider-catalog", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setStatusMsg({
        kind: "ok",
        text: `🔎 สแกนเสร็จ — ตรวจ ${json.scanned} รายการ, พบใหม่ ${json.newFound} ${json.newFound > 0 ? `(${json.newProviders.join(", ")})` : ""}`,
      });
      await fetchCatalog();
    } catch (err) {
      setStatusMsg({ kind: "err", text: `สแกนล้มเหลว: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setDiscovering(false);
    }
  };

  if (!data) {
    return (
      <div className="glass rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <span className="animate-pulse">⏳</span> กำลังโหลด catalog…
        </div>
      </div>
    );
  }

  const filtered = data.providers.filter((p) => {
    if (filter === "all") return true;
    return p.status === filter;
  });

  return (
    <div className="glass rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-purple-500/5 to-indigo-500/5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl">🌐</span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-bold text-white text-lg">Provider Catalog (Auto-Discovery)</div>
            <div className="text-xs text-gray-400">
              ระบบหา provider ใหม่จากอินเทอร์เน็ตอัตโนมัติทุก worker cycle (15 นาที)
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
              ✓ {data.summary.active} active
            </span>
            <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">
              ⌛ {data.summary.pending} pending
            </span>
            <span className="px-2 py-1 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">
              🆓 {data.summary.free_tier} free
            </span>
            <span className="text-gray-500">รวม {data.summary.total}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500 flex-wrap">
          <span>แหล่ง:</span>
          {Object.entries(data.summary.sources).map(([src, count]) => (
            <span key={src} className="px-1.5 py-0.5 rounded bg-white/5">
              {SOURCE_EMOJI[src] ?? "?"} {src} ({count})
            </span>
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div className="px-4 py-3 border-t border-white/5 bg-black/20 flex items-center gap-2 flex-wrap">
        <button
          onClick={onDiscover}
          disabled={discovering}
          className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="สแกน internet หา provider ใหม่ทันที (ไม่รอ worker cycle)"
        >
          {discovering ? "🔎 กำลังค้นหา…" : "🔎 ค้นหา provider ใหม่จาก internet"}
        </button>
        <div className="flex items-center gap-1 ml-auto">
          {(["all", "active", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-xs ${
                filter === f
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "text-gray-500 hover:text-white"
              }`}
            >
              {f === "all" ? "ทั้งหมด" : f === "active" ? "ใช้งาน" : "รอ wire"}
            </button>
          ))}
        </div>
        {statusMsg && (
          <span
            className={`text-xs px-2 py-1 rounded w-full ${
              statusMsg.kind === "ok"
                ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20"
                : "text-red-300 bg-red-500/10 border border-red-500/20"
            }`}
          >
            {statusMsg.text}
          </span>
        )}
      </div>

      {/* Provider list */}
      <div className="p-3 max-h-[480px] overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {filtered.map((p) => {
            const stat = STATUS_STYLE[p.status];
            return (
              <div
                key={p.name}
                className={`rounded-lg border p-2.5 text-xs ${
                  p.status === "active" ? "border-white/10 bg-white/2" : "border-amber-500/20 bg-amber-500/5"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">{SOURCE_EMOJI[p.source] ?? "?"}</span>
                  <span className="font-bold text-white truncate">{p.label ?? p.name}</span>
                  {p.free_tier && <span className="text-[10px] text-cyan-300">🆓</span>}
                  <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] border ${stat.cls}`}>
                    {stat.label}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 font-mono truncate" title={p.base_url}>
                  {p.base_url}
                </div>
                {p.env_var && (
                  <div className="text-[10px] text-gray-600 mt-0.5 font-mono">env: {p.env_var}</div>
                )}
                {p.notes && <div className="text-[11px] text-gray-400 mt-1 line-clamp-2">{p.notes}</div>}
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-600">
                  <span>source: {p.source}</span>
                  {p.homepage && (
                    <a
                      href={p.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-indigo-300 hover:text-white"
                    >
                      เว็บ →
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-xs text-gray-500 italic col-span-full">ไม่มี provider ในกลุ่มนี้</div>
          )}
        </div>
      </div>
    </div>
  );
}
