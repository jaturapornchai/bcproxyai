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

export default function AdminProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [edits, setEdits] = useState<Record<string, { base_url: string; status: string }>>({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Providers</h1>
            <p className="text-sm text-slate-600">
              แก้ <code className="rounded bg-slate-100 px-1">base_url</code> ของ provider — เปลี่ยน Ollama port หรือชี้ไป LLM ตัวอื่น (vLLM / LM Studio) ได้ทันทีโดยไม่ต้อง redeploy
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <Link href="/admin/keys" className="rounded border border-slate-300 px-3 py-1 hover:bg-white">API Keys</Link>
            <Link href="/" className="rounded border border-slate-300 px-3 py-1 hover:bg-white">หน้าหลัก</Link>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="ค้นหา (name / label)"
            className="w-64 rounded border border-slate-300 px-3 py-1 text-sm"
          />
          <button onClick={fetchProviders} className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-white">
            ↻ Refresh
          </button>
          <span className="text-xs text-slate-500">{filtered.length}/{providers.length}</span>
        </div>

        {loading ? (
          <div className="text-slate-500">กำลังโหลด...</div>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Base URL (chat completions)</th>
                  <th className="px-3 py-2 w-28">Status</th>
                  <th className="px-3 py-2 w-32">Source</th>
                  <th className="px-3 py-2 w-72">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const dirty = isDirty(p);
                  const result = testResults[p.name];
                  return (
                    <tr key={p.name} className="align-top">
                      <td className="px-3 py-2">
                        <div className="font-mono font-semibold">{p.name}</div>
                        {p.label && <div className="text-xs text-slate-500">{p.label}</div>}
                        {p.env_var && <div className="text-xs text-slate-400">env: {p.env_var}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={edits[p.name]?.base_url ?? p.base_url}
                          onChange={(e) => updateEdit(p.name, "base_url", e.target.value)}
                          className={`w-full rounded border px-2 py-1 font-mono text-xs ${dirty ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                          placeholder="https://api.example.com/v1/chat/completions"
                        />
                        {result && (
                          <div className={`mt-1 text-xs ${result.ok ? "text-emerald-600" : "text-rose-600"}`}>
                            {result.ok
                              ? `✓ ${result.status} • ${result.modelCount ?? "?"} models • ${result.latencyMs}ms`
                              : `✗ ${result.error || `HTTP ${result.status}`}${result.bodyPreview ? ` — ${result.bodyPreview.slice(0, 80)}` : ""}`}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={edits[p.name]?.status ?? p.status}
                          onChange={(e) => updateEdit(p.name, "status", e.target.value)}
                          className={`w-full rounded border px-1 py-1 text-xs ${dirty ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                        >
                          <option value="active">active</option>
                          <option value="paused">paused</option>
                          <option value="pending" disabled>pending</option>
                          <option value="failed" disabled>failed</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{p.source}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => test(p)}
                            disabled={testingName === p.name}
                            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                          >
                            {testingName === p.name ? "..." : "Test"}
                          </button>
                          <button
                            onClick={() => save(p)}
                            disabled={!dirty || savingName === p.name}
                            className="rounded border border-emerald-500 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-30"
                          >
                            {savingName === p.name ? "..." : "Save"}
                          </button>
                          {savedFlash === p.name && <span className="text-xs text-emerald-600">✓ saved</span>}
                          <button
                            onClick={() => setEdits((prev) => ({ ...prev, [p.name]: { base_url: p.base_url, status: p.status } }))}
                            disabled={!dirty}
                            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-30"
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

        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <p className="font-semibold">วิธีใช้</p>
          <ol className="ml-4 mt-1 list-decimal space-y-1">
            <li>กรอก <code>base_url</code> ใหม่ (เช่น <code>http://host.docker.internal:8888/v1/chat/completions</code> สำหรับ Ollama port อื่น)</li>
            <li>กด <strong>Test</strong> → เช็คว่า provider ตอบ HTTP 200 ที่ <code>/v1/models</code> ได้ไหม</li>
            <li>ถ้าผ่านกด <strong>Save</strong> — cache 30s จะ flush ทันที (request ถัดไปใช้ URL ใหม่)</li>
            <li>Embeddings + completions URL จะ derive อัตโนมัติจาก chat URL (แทน <code>/chat/completions</code> ด้วย <code>/embeddings</code> หรือ <code>/completions</code>)</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
