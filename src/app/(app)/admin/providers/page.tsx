"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
  Reveal,
} from "@/components/ui/ui";
import { IconAlert, IconCheck, IconKey, IconPlug, IconRefresh, IconServer } from "@/components/ui/icons";

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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal", "0.0.0.0"]);

const INPUT =
  "w-full rounded-xl border px-3.5 py-2.5 text-[14px] text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20";
const inputCls = (dirty: boolean) =>
  `${INPUT} ${dirty ? "border-amber-400/60 bg-amber-400/[0.06]" : "border-white/10 bg-white/[0.04]"}`;

const STEPS = [
  { title: "แก้ Host / Port", desc: "URL เต็มจะอัปเดตอัตโนมัติ" },
  { title: "ทดสอบเชื่อมต่อ", desc: "ระบบจะ probe /v1/models ก่อนตัดสินใจบันทึก" },
  { title: "บันทึก", desc: "เก็บลง database และล้าง cache 30 วินาทีทันที" },
  { title: "ปิดชั่วคราว (ถ้าต้องการ)", desc: "หยุดใช้ provider นี้โดยไม่ลบข้อมูล" },
];

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

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-gray-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

const codeCls = "rounded bg-white/5 px-1 py-0.5 font-mono text-[11.5px] text-gray-300";

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
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchProviders = useCallback(() => {
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
    setSaveError(null);
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
        setSaveError(`บันทึก ${p.name} ไม่สำเร็จ: ${json?.error || res.statusText}`);
      } else {
        setSavedFlash(p.name);
        setTimeout(() => setSavedFlash(null), 2000);
        fetchProviders();
      }
    } catch (err) {
      setSaveError(`บันทึก ${p.name} ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
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

  const renderLocalCard = (p: ProviderRow, n: number) => {
    const dirty = isDirty(p);
    const result = testResults[p.name];
    const currentUrl = edits[p.name]?.base_url ?? p.base_url;
    const parts = parseUrl(currentUrl);
    const busy = savingName === p.name;

    return (
      <Reveal key={p.name} i={n + 3}>
        <Card hover className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
                <IconPlug size={20} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-all font-mono text-[16px] font-semibold text-white">{p.name}</h2>
                  <Badge tone="accent">LOCAL AI</Badge>
                  <Badge tone={p.status === "active" ? "success" : "warning"} dot={p.status === "active"}>
                    {p.status}
                  </Badge>
                  {dirty && <Badge tone="warning">ยังไม่บันทึก</Badge>}
                </div>
                {p.label && <div className="mt-0.5 text-[13px] text-[var(--muted)]">{p.label}</div>}
              </div>
            </div>
            <div className="w-40 shrink-0">
              <select
                aria-label={`สถานะของ ${p.name}`}
                value={edits[p.name]?.status ?? p.status}
                onChange={(e) => updateEdit(p.name, "status", e.target.value)}
                className={`${inputCls(dirty)} [color-scheme:dark]`}
              >
                <option value="active">เปิดใช้</option>
                <option value="paused">ปิดชั่วคราว</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
            <Field
              label="Host"
              hint={
                <>
                  ตัวอย่าง: <code className={codeCls}>host.docker.internal</code> (Docker → host),{" "}
                  <code className={codeCls}>localhost</code> หรือ IP เช่น <code className={codeCls}>192.168.1.10</code>
                </>
              }
            >
              <input
                type="text"
                value={parts?.host ?? ""}
                onChange={(e) => updateHost(p.name, currentUrl, e.target.value)}
                placeholder="host.docker.internal"
                className={`${inputCls(dirty)} font-mono`}
              />
            </Field>
            <Field
              label="Port"
              hint={
                <>
                  Ollama ปกติ: <code className={codeCls}>11434</code>
                </>
              }
            >
              <input
                type="text"
                inputMode="numeric"
                value={parts?.port ?? ""}
                onChange={(e) => updatePort(p.name, currentUrl, e.target.value)}
                placeholder="11434"
                className={`${inputCls(dirty)} text-center font-mono`}
              />
            </Field>
          </div>

          <Field
            label="Path"
            hint={
              <>
                ส่วนใหญ่ใช้ <code className={codeCls}>/v1/chat/completions</code> (OpenAI-compatible) —
                embeddings/completions URL จะ derive อัตโนมัติ
              </>
            }
          >
            <input
              type="text"
              value={parts?.path ?? ""}
              onChange={(e) => {
                if (!parts) return;
                updateEdit(p.name, "base_url", rebuildUrl({ ...parts, path: e.target.value || "/v1/chat/completions" }));
              }}
              className={`${inputCls(dirty)} font-mono`}
            />
          </Field>

          <div className="break-all rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 font-mono text-[12.5px]">
            <span className="text-[var(--muted)]">URL เต็ม: </span>
            <span className={dirty ? "text-amber-300" : "text-cyan-200"}>{currentUrl}</span>
          </div>

          {result && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] ${
                result.ok
                  ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200"
                  : "border-rose-400/25 bg-rose-400/[0.07] text-rose-200"
              }`}
            >
              {result.ok ? <IconCheck size={16} className="mt-0.5 shrink-0" /> : <IconAlert size={16} className="mt-0.5 shrink-0" />}
              <span className="min-w-0 break-words tabular-nums">
                {result.ok
                  ? `เชื่อมต่อได้ · HTTP ${result.status} · ${result.modelCount ?? "?"} models · ${result.latencyMs}ms`
                  : `เชื่อมต่อไม่ได้ · ${result.error || `HTTP ${result.status}`}${result.bodyPreview ? ` — ${result.bodyPreview.slice(0, 120)}` : ""}`}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => test(p)} disabled={testingName === p.name}>
              <IconPlug size={16} /> {testingName === p.name ? "กำลังทดสอบ..." : "ทดสอบเชื่อมต่อ"}
            </Button>
            <Button variant="primary" onClick={() => save(p)} disabled={!dirty || busy}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </Button>
            {dirty && (
              <Button onClick={() => setEdits((prev) => ({ ...prev, [p.name]: { base_url: p.base_url, status: p.status } }))}>
                <IconRefresh size={16} /> รีเซ็ต
              </Button>
            )}
            {savedFlash === p.name && (
              <Badge tone="success">
                <IconCheck size={12} /> บันทึกลง database แล้ว
              </Badge>
            )}
          </div>
        </Card>
      </Reveal>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่า"
        title="จัดการผู้ให้บริการ"
        description="ตั้งค่าที่อยู่ (host/port) ของ Local AI เช่น Ollama, LM Studio, vLLM, llama.cpp ที่รันบนเครื่องของคุณ แล้วทดสอบก่อนบันทึก"
        actions={
          <LinkButton href="/admin/keys">
            <IconKey size={16} /> API key ของแอป
          </LinkButton>
        }
      />

      {saveError && (
        <div className="reveal mb-6">
          <Callout tone="warning" title="เกิดข้อผิดพลาด">
            {saveError}{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => setSaveError(null)}>
              ปิด
            </button>
          </Callout>
        </div>
      )}

      <Reveal i={1}>
        <Card className="p-5">
          <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((s, n) => (
              <li key={s.title} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-[13px] font-semibold text-white ring-1 ring-white/15">
                  {n + 1}
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-white">{s.title}</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </Reveal>

      <Reveal i={2} className="mt-6">
        <Callout title="Local AI คืออะไร?">
          โมเดลที่รันบนเครื่องของคุณเอง ค่าที่แก้ที่นี่จะถูกบันทึกลง database ทันทีที่กด “บันทึก” ส่วน Cloud provider
          (Groq, OpenRouter, ฯลฯ) ระบบจัดการอัตโนมัติ ไม่ต้องแก้ที่นี่
        </Callout>
      </Reveal>

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="skeleton h-72" />
        ) : localProviders.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconPlug size={22} />}
              title="ยังไม่มี Local AI provider"
              description={
                <>
                  ระบบจะแสดงเฉพาะ provider ที่ host เป็น <code className={codeCls}>localhost</code> /{" "}
                  <code className={codeCls}>host.docker.internal</code>
                </>
              }
              action={<LinkButton href="/setup">ไปตั้งค่า API key ผู้ให้บริการ</LinkButton>}
            />
          </Card>
        ) : (
          localProviders.map(renderLocalCard)
        )}
      </div>

      <Reveal i={4} className="mt-8">
        <Card>
          <CardHeader
            icon={<IconServer size={18} />}
            title={`Cloud providers (${cloudProviders.length})`}
            subtitle="ขั้นสูง — ดูอย่างเดียว ระบบจัดการอัตโนมัติผ่าน worker ไม่ต้องแก้ที่นี่"
            action={
              <Button size="sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
                {showAll ? "ซ่อน" : "แสดง"}
              </Button>
            }
          />
          {showAll ? (
            <div className="reveal mt-4 border-t border-white/5">
              <div className="flex items-center gap-3 px-5 py-3">
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="ค้นหา provider…"
                  aria-label="ค้นหา provider"
                  className={inputCls(false)}
                />
                <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">
                  {filteredCloud.length}/{cloudProviders.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">
                    <tr>
                      <th className="w-40 px-5 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">URL</th>
                      <th className="w-24 px-5 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredCloud.map((p) => (
                      <tr key={p.name} className="transition-colors hover:bg-white/[0.03]">
                        <td className="px-5 py-2.5 font-mono text-gray-200">{p.name}</td>
                        <td className="break-all px-3 py-2.5 font-mono text-[12px] text-[var(--muted)]">{p.base_url}</td>
                        <td className="px-5 py-2.5">
                          <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</Badge>
                        </td>
                      </tr>
                    ))}
                    {filteredCloud.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-5 py-8 text-center text-[var(--muted)]">
                          ไม่พบ provider ที่ตรงกับคำค้น
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="h-5" />
          )}
        </Card>
      </Reveal>
    </>
  );
}
