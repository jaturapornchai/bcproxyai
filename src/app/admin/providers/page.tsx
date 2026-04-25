"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ProviderRow {
  name: string;
  label: string | null;
  base_url: string;
  env_var: string | null;
  status: string;
  source: string;
  free_tier: boolean | null;
  homepage: string | null;
  homepage_ok: boolean | null;
  models_ok: boolean | null;
  last_verified_at: string | null;
  notes: string | null;
}

interface TestResult {
  ok: boolean;
  status?: number;
  modelCount?: number | null;
  latencyMs?: number;
  error?: string;
  chatUrl?: string;
  modelsUrl?: string;
  bodyPreview?: string;
}

type Theme = "dark" | "light";

function loadTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("admin-theme") as Theme) || "dark";
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, { base_url: string; status: string }>>({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof window !== "undefined") localStorage.setItem("admin-theme", next);
  };

  const fetchProviders = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.providers)) {
          setProviders(d.providers);
          const initial: Record<string, { base_url: string; status: string }> = {};
          for (const p of d.providers) initial[p.name] = { base_url: p.base_url, status: p.status };
          setEdits(initial);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const updateEdit = (name: string, field: "base_url" | "status", value: string) => {
    setEdits((prev) => ({ ...prev, [name]: { ...prev[name], [field]: value } }));
  };

  const isDirty = (p: ProviderRow): boolean => {
    const e = edits[p.name];
    if (!e) return false;
    return e.base_url !== p.base_url || e.status !== p.status;
  };

  const save = async (p: ProviderRow) => {
    const e = edits[p.name];
    if (!e) return;
    setSavingName(p.name);
    try {
      const body: Record<string, string> = {};
      if (e.base_url !== p.base_url) body.base_url = e.base_url;
      if (e.status !== p.status) body.status = e.status;
      const res = await fetch(`/api/admin/providers/${encodeURIComponent(p.name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`Save failed: ${json?.error || res.statusText}`);
      } else {
        setSavedFlash(p.name);
        setTimeout(() => setSavedFlash(null), 2000);
        fetchProviders();
      }
    } catch (err) {
      alert(`Save error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingName(null);
    }
  };

  const test = async (p: ProviderRow) => {
    const e = edits[p.name];
    setTestingName(p.name);
    try {
      const res = await fetch(`/api/admin/providers/${encodeURIComponent(p.name)}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: e?.base_url || p.base_url }),
      });
      const json = (await res.json()) as TestResult;
      setTestResults((prev) => ({ ...prev, [p.name]: json }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [p.name]: { ok: false, error: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setTestingName(null);
    }
  };

  const filtered = providers.filter((p) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.label?.toLowerCase().includes(q) ?? false);
  });

  const stats = {
    total: providers.length,
    active: providers.filter((p) => p.status === "active").length,
    paused: providers.filter((p) => p.status === "paused").length,
    failed: providers.filter((p) => p.status === "failed").length,
  };

  // ── Theme tokens ────────────────────────────────────────────────
  const isDark = theme === "dark";
  const bg = isDark ? "bg-gray-950" : "bg-slate-50";
  const card = isDark ? "bg-gray-900 border-gray-800" : "bg-white border-slate-200";
  const text = isDark ? "text-gray-100" : "text-slate-900";
  const subtle = isDark ? "text-gray-400" : "text-slate-500";
  const muted = isDark ? "text-gray-500" : "text-slate-400";
  const inputBase = isDark
    ? "bg-gray-950 border-gray-700 text-gray-100 placeholder-gray-500 focus:border-cyan-500"
    : "bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-cyan-500";
  const inputDirty = isDark
    ? "border-amber-500 bg-amber-950/40 text-amber-100"
    : "border-amber-400 bg-amber-50 text-amber-900";
  const btnGhost = isDark
    ? "border border-gray-700 hover:bg-gray-800 text-gray-200"
    : "border border-slate-300 hover:bg-slate-100 text-slate-700";
  const btnPrimary = isDark
    ? "border border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
    : "border border-emerald-500 bg-emerald-50 hover:bg-emerald-100 text-emerald-700";
  const tableHead = isDark ? "bg-gray-900 text-gray-400" : "bg-slate-100 text-slate-600";
  const rowHover = isDark ? "hover:bg-gray-800/50" : "hover:bg-slate-50";

  const statusPill = (status: string): string => {
    if (status === "active") return isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700";
    if (status === "paused") return isDark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700";
    if (status === "failed") return isDark ? "bg-rose-500/15 text-rose-300" : "bg-rose-100 text-rose-700";
    return isDark ? "bg-gray-700/40 text-gray-400" : "bg-slate-200 text-slate-600";
  };

  return (
    <div className={`min-h-screen ${bg} ${text} transition-colors`}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-10 border-b ${isDark ? "border-gray-800 bg-gray-950/90" : "border-slate-200 bg-white/90"} backdrop-blur`}>
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className={`flex items-center gap-2 ${subtle} hover:${text}`}>
              <span>←</span>
              <span className="text-sm">หน้าหลัก</span>
            </Link>
            <span className={muted}>/</span>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <span>🔌</span>
              <span>Providers</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/keys"
              className={`text-xs px-3 py-1.5 rounded-lg ${btnGhost}`}
              title="API Keys"
            >
              🔑 API Keys
            </Link>
            <button
              onClick={toggleTheme}
              className={`text-xs px-3 py-1.5 rounded-lg ${btnGhost}`}
              title={isDark ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด"}
            >
              {isDark ? "☀️ สว่าง" : "🌙 มืด"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        {/* ── Description + Stats ─────────────────────────────── */}
        <div className={`rounded-xl border ${card} p-4`}>
          <p className={`text-sm ${subtle}`}>
            แก้ <code className={`rounded px-1 ${isDark ? "bg-gray-800" : "bg-slate-100"}`}>base_url</code> ของ provider —
            เปลี่ยน Ollama port หรือชี้ไป LLM ตัวอื่น (vLLM, LM Studio, llama.cpp) ได้ทันทีโดยไม่ต้อง redeploy
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={`px-2 py-1 rounded ${statusPill("active")}`}>● active {stats.active}</span>
            <span className={`px-2 py-1 rounded ${statusPill("paused")}`}>● paused {stats.paused}</span>
            <span className={`px-2 py-1 rounded ${statusPill("failed")}`}>● failed {stats.failed}</span>
            <span className={`px-2 py-1 rounded ${isDark ? "bg-gray-800 text-gray-400" : "bg-slate-200 text-slate-600"}`}>
              total {stats.total}
            </span>
          </div>
        </div>

        {/* ── Search ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔍 ค้นหา provider..."
            className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none ${inputBase}`}
          />
          <button onClick={fetchProviders} className={`px-3 py-2 rounded-lg text-sm ${btnGhost}`}>
            ↻ Refresh
          </button>
          <span className={`text-xs ${muted}`}>{filtered.length}/{providers.length}</span>
        </div>

        {/* ── Table ───────────────────────────────────────────── */}
        {loading ? (
          <div className={`text-center py-12 ${subtle}`}>กำลังโหลด...</div>
        ) : (
          <div className={`overflow-hidden rounded-xl border ${card}`}>
            <table className="w-full text-sm">
              <thead className={`${tableHead} text-left text-xs uppercase tracking-wide`}>
                <tr>
                  <th className="px-3 py-2.5 w-40">Name</th>
                  <th className="px-3 py-2.5">Base URL</th>
                  <th className="px-3 py-2.5 w-28">Status</th>
                  <th className="px-3 py-2.5 w-64">Action</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? "divide-gray-800" : "divide-slate-100"}`}>
                {filtered.map((p) => {
                  const dirty = isDirty(p);
                  const result = testResults[p.name];
                  return (
                    <tr key={p.name} className={`align-top ${rowHover} transition-colors`}>
                      <td className="px-3 py-3">
                        <div className="font-mono font-semibold">{p.name}</div>
                        {p.label && <div className={`text-xs ${muted}`}>{p.label}</div>}
                        {p.env_var && <div className={`text-xs ${muted} font-mono`}>{p.env_var}</div>}
                        {p.free_tier && (
                          <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${
                            isDark ? "bg-cyan-500/15 text-cyan-300" : "bg-cyan-100 text-cyan-700"
                          }`}>FREE</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="text"
                          value={edits[p.name]?.base_url ?? p.base_url}
                          onChange={(e) => updateEdit(p.name, "base_url", e.target.value)}
                          className={`w-full rounded-lg border px-2 py-1.5 font-mono text-xs focus:outline-none ${dirty ? inputDirty : inputBase}`}
                          placeholder="https://api.example.com/v1/chat/completions"
                        />
                        {result && (
                          <div className={`mt-1.5 text-xs ${result.ok
                            ? (isDark ? "text-emerald-400" : "text-emerald-600")
                            : (isDark ? "text-rose-400" : "text-rose-600")
                          }`}>
                            {result.ok
                              ? `✓ ${result.status} • ${result.modelCount ?? "?"} models • ${result.latencyMs}ms`
                              : `✗ ${result.error || `HTTP ${result.status}`}${result.bodyPreview ? ` — ${result.bodyPreview.slice(0, 80)}` : ""}`}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={edits[p.name]?.status ?? p.status}
                          onChange={(e) => updateEdit(p.name, "status", e.target.value)}
                          className={`w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none ${dirty ? inputDirty : inputBase}`}
                        >
                          <option value="active">active</option>
                          <option value="paused">paused</option>
                          <option value="pending" disabled>pending</option>
                          <option value="failed" disabled>failed</option>
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => test(p)}
                            disabled={testingName === p.name}
                            className={`px-2.5 py-1.5 rounded-lg text-xs ${btnGhost} disabled:opacity-50`}
                          >
                            {testingName === p.name ? "..." : "Test"}
                          </button>
                          <button
                            onClick={() => save(p)}
                            disabled={!dirty || savingName === p.name}
                            className={`px-2.5 py-1.5 rounded-lg text-xs ${btnPrimary} disabled:opacity-30`}
                          >
                            {savingName === p.name ? "..." : "Save"}
                          </button>
                          {savedFlash === p.name && (
                            <span className={`text-xs self-center ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                              ✓ saved
                            </span>
                          )}
                          <button
                            onClick={() => setEdits((prev) => ({ ...prev, [p.name]: { base_url: p.base_url, status: p.status } }))}
                            disabled={!dirty}
                            className={`px-2.5 py-1.5 rounded-lg text-xs ${btnGhost} disabled:opacity-30`}
                          >
                            Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Help ────────────────────────────────────────────── */}
        <div className={`rounded-xl border p-4 ${
          isDark ? "border-cyan-500/20 bg-cyan-950/20" : "border-cyan-200 bg-cyan-50"
        }`}>
          <p className={`text-sm font-semibold ${isDark ? "text-cyan-300" : "text-cyan-900"}`}>
            💡 วิธีใช้
          </p>
          <ol className={`mt-2 ml-5 text-xs space-y-1 list-decimal ${isDark ? "text-cyan-200/80" : "text-cyan-900/80"}`}>
            <li>กรอก <code className={`rounded px-1 ${isDark ? "bg-cyan-900/50" : "bg-cyan-100"}`}>base_url</code> ใหม่
              (เช่น <code className={`rounded px-1 ${isDark ? "bg-cyan-900/50" : "bg-cyan-100"}`}>http://host.docker.internal:8888/v1/chat/completions</code> สำหรับ Ollama port อื่น)</li>
            <li>กด <strong>Test</strong> → ตรวจ <code>/v1/models</code> ก่อน save</li>
            <li>กด <strong>Save</strong> → cache 30s flush ทันที</li>
            <li>Embeddings + completions URL จะ <em>derive อัตโนมัติ</em> จาก chat URL</li>
          </ol>
        </div>
      </main>
    </div>
  );
}
