"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  bodyPreview?: string;
}

type Theme = "dark" | "light";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal", "0.0.0.0"]);

function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function parseUrl(url: string): { host: string; port: string; path: string; protocol: string } | null {
  try {
    const u = new URL(url);
    const defaultPort = u.protocol === "https:" ? "443" : "80";
    return {
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || defaultPort,
      path: u.pathname + u.search,
    };
  } catch {
    return null;
  }
}

function rebuildUrl(parts: { protocol: string; host: string; port: string; path: string }): string {
  const isDefaultPort =
    (parts.protocol === "https" && parts.port === "443") ||
    (parts.protocol === "http" && parts.port === "80");
  return `${parts.protocol}://${parts.host}${isDefaultPort ? "" : `:${parts.port}`}${parts.path}`;
}

function loadTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return (localStorage.getItem("admin-theme") as Theme) || "dark";
}

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
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

  const updatePort = (name: string, currentUrl: string, newPort: string) => {
    const parts = parseUrl(currentUrl);
    if (!parts) return;
    const safePort = newPort.replace(/[^0-9]/g, "").slice(0, 5);
    const next = rebuildUrl({ ...parts, port: safePort || "0" });
    updateEdit(name, "base_url", next);
  };

  const updateHost = (name: string, currentUrl: string, newHost: string) => {
    const parts = parseUrl(currentUrl);
    if (!parts) return;
    const safeHost = newHost.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const next = rebuildUrl({ ...parts, host: safeHost || "localhost" });
    updateEdit(name, "base_url", next);
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

  const localProviders = useMemo(
    () => providers.filter((p) => isLocalUrl(edits[p.name]?.base_url ?? p.base_url)),
    [providers, edits]
  );
  const cloudProviders = useMemo(
    () => providers.filter((p) => !isLocalUrl(edits[p.name]?.base_url ?? p.base_url)),
    [providers, edits]
  );

  const filteredCloud = useMemo(() => {
    if (!filter) return cloudProviders;
    const q = filter.toLowerCase();
    return cloudProviders.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.label?.toLowerCase().includes(q) ?? false)
    );
  }, [cloudProviders, filter]);

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

  const renderLocalCard = (p: ProviderRow) => {
    const dirty = isDirty(p);
    const result = testResults[p.name];
    const currentUrl = edits[p.name]?.base_url ?? p.base_url;
    const parts = parseUrl(currentUrl);

    return (
      <div key={p.name} className={`rounded-xl border ${card} p-5 space-y-4`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏠</span>
              <h2 className="text-lg font-bold font-mono">{p.name}</h2>
              <span className={`text-[10px] px-2 py-0.5 rounded ${
                isDark ? "bg-purple-500/15 text-purple-300" : "bg-purple-100 text-purple-700"
              }`}>LOCAL AI</span>
              <span className={`text-[10px] px-2 py-0.5 rounded ${
                p.status === "active"
                  ? (isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700")
                  : (isDark ? "bg-amber-500/15 text-amber-300" : "bg-amber-100 text-amber-700")
              }`}>{p.status}</span>
            </div>
            {p.label && <div className={`text-sm ${subtle}`}>{p.label}</div>}
          </div>
          <select
            value={edits[p.name]?.status ?? p.status}
            onChange={(e) => updateEdit(p.name, "status", e.target.value)}
            className={`rounded-lg border px-2 py-1 text-xs focus:outline-none ${dirty ? inputDirty : inputBase}`}
          >
            <option value="active">เปิดใช้</option>
            <option value="paused">ปิดชั่วคราว</option>
          </select>
        </div>

        {/* Host + Port — split fields for clarity */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-3">
          <div>
            <label className={`block text-xs font-semibold mb-1 ${subtle}`}>Host</label>
            <input
              type="text"
              value={parts?.host ?? ""}
              onChange={(e) => updateHost(p.name, currentUrl, e.target.value)}
              placeholder="host.docker.internal"
              className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${dirty ? inputDirty : inputBase}`}
            />
            <div className={`mt-1 text-[10px] ${muted}`}>
              ตัวอย่าง: <code>host.docker.internal</code> (Docker → host),{" "}
              <code>localhost</code>, หรือ IP เช่น <code>192.168.1.10</code>
            </div>
          </div>
          <div>
            <label className={`block text-xs font-semibold mb-1 ${subtle}`}>Port</label>
            <input
              type="text"
              inputMode="numeric"
              value={parts?.port ?? ""}
              onChange={(e) => updatePort(p.name, currentUrl, e.target.value)}
              placeholder="11434"
              className={`w-full rounded-lg border px-3 py-2 font-mono text-sm text-center focus:outline-none ${dirty ? inputDirty : inputBase}`}
            />
            <div className={`mt-1 text-[10px] ${muted}`}>
              Ollama default: <code>11434</code>
            </div>
          </div>
        </div>

        {/* Path (read-only display) */}
        <div>
          <label className={`block text-xs font-semibold mb-1 ${subtle}`}>Path</label>
          <input
            type="text"
            value={parts?.path ?? ""}
            onChange={(e) => {
              if (!parts) return;
              updateEdit(p.name, "base_url", rebuildUrl({ ...parts, path: e.target.value || "/v1/chat/completions" }));
            }}
            className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none ${dirty ? inputDirty : inputBase}`}
          />
          <div className={`mt-1 text-[10px] ${muted}`}>
            ส่วนใหญ่ใช้ <code>/v1/chat/completions</code> (OpenAI-compatible) — embeddings/completions URL จะ derive อัตโนมัติ
          </div>
        </div>

        {/* Full URL preview */}
        <div className={`rounded-lg p-3 text-xs font-mono break-all ${
          isDark ? "bg-gray-950 border border-gray-800" : "bg-slate-100 border border-slate-200"
        }`}>
          <span className={muted}>URL เต็ม: </span>
          <span className={dirty ? (isDark ? "text-amber-300" : "text-amber-700") : (isDark ? "text-cyan-300" : "text-cyan-700")}>
            {currentUrl}
          </span>
        </div>

        {/* Test result */}
        {result && (
          <div className={`rounded-lg p-3 text-sm ${
            result.ok
              ? (isDark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700")
              : (isDark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-700")
          }`}>
            {result.ok
              ? `✓ HTTP ${result.status} • ${result.modelCount ?? "?"} models • ${result.latencyMs}ms`
              : `✗ ${result.error || `HTTP ${result.status}`}${result.bodyPreview ? ` — ${result.bodyPreview.slice(0, 120)}` : ""}`}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => test(p)}
            disabled={testingName === p.name}
            className={`px-4 py-2 rounded-lg text-sm ${btnGhost} disabled:opacity-50`}
          >
            {testingName === p.name ? "กำลังทดสอบ..." : "🧪 ทดสอบเชื่อมต่อ"}
          </button>
          <button
            onClick={() => save(p)}
            disabled={!dirty || savingName === p.name}
            className={`px-4 py-2 rounded-lg text-sm ${btnPrimary} disabled:opacity-30`}
          >
            {savingName === p.name ? "กำลังบันทึก..." : "💾 บันทึก"}
          </button>
          {savedFlash === p.name && (
            <span className={`text-sm self-center ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
              ✓ บันทึกลง database แล้ว
            </span>
          )}
          {dirty && (
            <button
              onClick={() => setEdits((prev) => ({ ...prev, [p.name]: { base_url: p.base_url, status: p.status } }))}
              className={`px-4 py-2 rounded-lg text-sm ${btnGhost}`}
            >
              ↺ Reset
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen ${bg} ${text} transition-colors`}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-10 border-b ${isDark ? "border-gray-800 bg-gray-950/90" : "border-slate-200 bg-white/90"} backdrop-blur`}>
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className={`flex items-center gap-2 ${subtle} hover:opacity-100`}>
              <span>←</span>
              <span className="text-sm">หน้าหลัก</span>
            </Link>
            <span className={muted}>/</span>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <span>🔌</span>
              <span>Local AI Providers</span>
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

      <main className="mx-auto max-w-5xl px-4 py-6 space-y-4">
        {/* ── Description ─────────────────────────────────────── */}
        <div className={`rounded-xl border ${card} p-4`}>
          <p className={`text-sm ${subtle}`}>
            แก้ host/port ของ <strong>Local AI</strong> (Ollama, LM Studio, vLLM, llama.cpp ที่รันบนเครื่อง) —
            ค่าจะถูกบันทึกลง database ทันที. Cloud provider (Groq, OpenRouter, ฯลฯ) ระบบจัดการอัตโนมัติ ไม่ต้องแก้ที่นี่.
          </p>
        </div>

        {/* ── Local Providers (default view) ──────────────────── */}
        {loading ? (
          <div className={`text-center py-12 ${subtle}`}>กำลังโหลด...</div>
        ) : localProviders.length === 0 ? (
          <div className={`rounded-xl border ${card} p-8 text-center ${subtle}`}>
            ยังไม่มี Local AI provider — ระบบจะแสดงเฉพาะ provider ที่ host เป็น{" "}
            <code className={`rounded px-1 ${isDark ? "bg-gray-800" : "bg-slate-100"}`}>localhost</code> /{" "}
            <code className={`rounded px-1 ${isDark ? "bg-gray-800" : "bg-slate-100"}`}>host.docker.internal</code>
          </div>
        ) : (
          <div className="space-y-3">
            {localProviders.map(renderLocalCard)}
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
            <li>แก้ <strong>Host</strong> หรือ <strong>Port</strong> → URL เต็มจะอัปเดตอัตโนมัติ</li>
            <li>กด <strong>🧪 ทดสอบเชื่อมต่อ</strong> — ระบบจะ probe <code>/v1/models</code> ก่อนตัดสินใจ save</li>
            <li>กด <strong>💾 บันทึก</strong> — ค่าใหม่จะเก็บลง <code>provider_catalog.base_url</code> ใน database + flush cache 30s ทันที</li>
            <li>ตั้ง <strong>ปิดชั่วคราว</strong> เพื่อหยุดใช้ provider นี้โดยไม่ลบข้อมูล</li>
          </ol>
        </div>

        {/* ── Advanced: Show cloud providers ──────────────────── */}
        <div className="pt-2">
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`text-xs px-3 py-1.5 rounded-lg ${btnGhost}`}
          >
            {showAll ? "▲ ซ่อน" : "▼ แสดง"} Cloud providers ({cloudProviders.length}) — ขั้นสูง
          </button>
          {showAll && (
            <div className={`mt-3 rounded-xl border ${card}`}>
              <div className={`px-4 py-3 border-b ${isDark ? "border-gray-800" : "border-slate-200"} flex items-center gap-2`}>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="🔍 ค้นหา..."
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs focus:outline-none ${inputBase}`}
                />
                <span className={`text-xs ${muted}`}>{filteredCloud.length}/{cloudProviders.length}</span>
              </div>
              <table className="w-full text-xs">
                <thead className={`text-left ${muted}`}>
                  <tr>
                    <th className="px-3 py-2 w-32">Name</th>
                    <th className="px-3 py-2">URL</th>
                    <th className="px-3 py-2 w-20">Status</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? "divide-gray-800" : "divide-slate-100"}`}>
                  {filteredCloud.map((p) => (
                    <tr key={p.name}>
                      <td className={`px-3 py-2 font-mono ${subtle}`}>{p.name}</td>
                      <td className={`px-3 py-2 font-mono break-all ${muted}`}>{p.base_url}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          p.status === "active"
                            ? (isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700")
                            : (isDark ? "bg-gray-700/40 text-gray-400" : "bg-slate-200 text-slate-600")
                        }`}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={`px-4 py-2 text-[10px] ${muted}`}>
                Cloud provider จัดการอัตโนมัติผ่าน worker — ไม่ต้องแก้ที่นี่
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
