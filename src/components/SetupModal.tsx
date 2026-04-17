"use client";

import { useCallback, useEffect, useState } from "react";
import { PROVIDER_COLORS, ProviderBadge } from "./shared";

// ─── Types ───────────────────────────────────────────────────────────────────

// Provider list มาจาก DB (provider_catalog) — ไม่มี hardcoded
// Icon/description มาจาก lookup (เหลือไว้สำหรับ provider seed) — ที่ discover ใหม่จะใช้ default

interface ProviderStatus {
  provider: string;
  label: string;          // จาก DB (provider_catalog.label)
  envVar: string;         // จาก DB
  homepage: string;       // จาก DB (provider_catalog.homepage)
  source: string;         // 'seed' | 'openrouter' | 'huggingface' | 'pattern' | 'manual'
  freeTier: boolean;
  hasKey: boolean;
  hasDbKey: boolean;
  noKeyRequired: boolean;
  enabled: boolean;
  modelCount: number;
  availableCount: number;
  status: "active" | "no_key" | "no_models" | "error" | "disabled";
}

// Icon overrides สำหรับ provider ที่รู้จักดี — ที่ไม่มีใน map ใช้ default
const PROVIDER_ICONS: Record<string, string> = {
  openrouter: "\u{1F310}", kilo: "\u26A1", google: "\u{1F50D}",
  groq: "\u{1F3CE}\uFE0F", cerebras: "\u{1F9E0}", sambanova: "\u{1F680}",
  mistral: "\u{1F4A8}", ollama: "\u{1F4BB}", github: "\u{1F431}",
  fireworks: "\u{1F386}", cohere: "\u{1F4E1}", cloudflare: "\u2601\uFE0F",
  huggingface: "\u{1F917}", nvidia: "\u{1F7E2}", chutes: "\u{1F4A8}",
  llm7: "\u{1F511}", scaleway: "\u{1F1EA}\u{1F1FA}", pollinations: "\u{1F338}",
  ollamacloud: "\u2601\uFE0F", siliconflow: "\u{1F52E}", glhf: "\u{1F3AE}",
  together: "\u{1F91D}", hyperbolic: "\u{1F300}", zai: "\u{1F5FF}",
  dashscope: "\u{1F9E7}", reka: "\u{1F30A}",
  deepseek: "\u{1F40B}", deepinfra: "\u{1F4E6}", novita: "\u{1F31F}",
  monsterapi: "\u{1F47E}", friendli: "\u{1F91F}", xai: "\u{1D54F}",
  moonshot: "\u{1F319}", ai21: "\u{1F523}",
};
const SOURCE_BADGE: Record<string, string> = {
  seed: "ในตัว", openrouter: "พบจาก OpenRouter",
  huggingface: "พบจาก HuggingFace", pattern: "พบจาก URL probe", manual: "เพิ่มเอง",
};

interface SetupModalProps {
  open: boolean;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SetupModal({ open, onClose }: SetupModalProps) {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveResult, setSaveResult] = useState<Record<string, "ok" | "error">>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; models?: number; error?: string }>>({});
  const [scanning, setScanning] = useState(false);

  const fetchStatuses = useCallback(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setStatuses(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaveResult({});
    fetchStatuses();
  }, [open, fetchStatuses]);

  const handleTestKey = async (provider: string) => {
    const apiKey = keyInputs[provider]?.trim();
    if (!apiKey) return;

    setTesting((p) => ({ ...p, [provider]: true }));
    setTestResult((p) => ({ ...p, [provider]: undefined as any }));
    try {
      const res = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = await res.json();
      setTestResult((p) => ({ ...p, [provider]: data }));
    } catch {
      setTestResult((p) => ({ ...p, [provider]: { ok: false, error: "Network error" } }));
    } finally {
      setTesting((p) => ({ ...p, [provider]: false }));
    }
  };

  const handleSaveKey = async (provider: string) => {
    const apiKey = keyInputs[provider]?.trim();
    if (!apiKey) return;

    setSaving((p) => ({ ...p, [provider]: true }));
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      if (res.ok) {
        setSaveResult((p) => ({ ...p, [provider]: "ok" }));
        setKeyInputs((p) => ({ ...p, [provider]: "" }));
        setTestResult((p) => ({ ...p, [provider]: undefined as any }));
        // Refresh statuses
        fetchStatuses();
      } else {
        setSaveResult((p) => ({ ...p, [provider]: "error" }));
      }
    } catch {
      setSaveResult((p) => ({ ...p, [provider]: "error" }));
    } finally {
      setSaving((p) => ({ ...p, [provider]: false }));
    }
  };

  const handleToggleEnabled = async (provider: string, enabled: boolean) => {
    setSaving((p) => ({ ...p, [provider]: true }));
    try {
      await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, enabled }),
      });
      fetchStatuses();
    } catch { /* ignore */ }
    finally {
      setSaving((p) => ({ ...p, [provider]: false }));
    }
  };

  const handleDeleteKey = async (provider: string) => {
    setSaving((p) => ({ ...p, [provider]: true }));
    try {
      await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: "" }),
      });
      fetchStatuses();
    } catch { /* ignore */ }
    finally {
      setSaving((p) => ({ ...p, [provider]: false }));
    }
  };

  const handleScanNow = async () => {
    setScanning(true);
    try {
      await fetch("/api/worker", { method: "POST" });
      // Wait a bit then refresh
      setTimeout(() => {
        fetchStatuses();
        setScanning(false);
      }, 3000);
    } catch {
      setScanning(false);
    }
  };

  if (!open) return null;

  const statusMap = new Map(statuses.map((s) => [s.provider, s]));
  const activeCount = statuses.filter((s) => s.status === "active").length;
  const disabledCount = statuses.filter((s) => s.status === "disabled").length;
  const noKeyCount = statuses.filter((s) => s.status === "no_key").length;
  const hasSavedAny = Object.values(saveResult).some((v) => v === "ok");

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-8 pb-8 overflow-y-auto" onClick={onClose}>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl mx-4 glass-bright rounded-2xl border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-6 pb-4 border-b border-white/10 bg-gray-900/95 backdrop-blur rounded-t-2xl">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white text-lg">
                {"\u2699\uFE0F"}
              </span>
              ตั้งค่าผู้ให้บริการ
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              วาง API Key แล้วกดบันทึก — ระบบจะ scan อัตโนมัติ ไม่ต้องรีสตาร์ท
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-xs">
              <div className="text-emerald-400 font-bold">{activeCount} ใช้ได้</div>
              {disabledCount > 0 && <div className="text-gray-400">{disabledCount} ปิดเอง</div>}
              <div className="text-amber-400">{noKeyCount} ยังไม่มี key</div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* How to setup */}
        <div className="p-6 pb-3">
          <div className="glass rounded-xl p-4 border border-indigo-500/20 bg-indigo-500/5">
            <div className="text-sm font-bold text-indigo-300 mb-2">วิธีตั้งค่า (ฟรีทุกเจ้า!)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-300">
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0">1️⃣</span>
                <span>กด <strong className="text-cyan-300">สมัครฟรี</strong> เพื่อไปสมัครและรับ API Key</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0">2️⃣</span>
                <span>วาง API Key ในช่องแล้วกด <strong className="text-emerald-300">บันทึก</strong></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none shrink-0">3️⃣</span>
                <span>กด <strong className="text-amber-300">Scan เลย!</strong> ระบบจะค้นหา model ให้อัตโนมัติ</span>
              </div>
            </div>
          </div>
        </div>

        {/* Provider list */}
        <div className="p-6 pt-3 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="shimmer rounded-xl h-24 bg-gray-800/60" />
              ))}
            </div>
          ) : (
            statuses.map((st) => {
              const info = {
                provider: st.provider,
                label: st.label,
                envVar: st.envVar,
                signupUrl: st.homepage || "#",
                icon: PROVIDER_ICONS[st.provider] ?? "\u{1F310}",
                description: `${SOURCE_BADGE[st.source] ?? st.source}${st.freeTier ? " · 🆓 free tier" : ""}`,
              };
              const isActive = st.status === "active";
              const hasKey = st.hasKey;
              const hasDbKey = st.hasDbKey;
              const noKeyReq = st.noKeyRequired;
              const c = PROVIDER_COLORS[info.provider] ?? { text: "text-gray-300", bg: "bg-gray-700/40", border: "border-gray-600/40", glow: "rgba(156,163,175,0.5)" };
              const isSaving = saving[info.provider] ?? false;
              const isTesting = testing[info.provider] ?? false;
              const testPassed = testResult[info.provider]?.ok === true;
              const testRes = testResult[info.provider];
              const result = saveResult[info.provider];

              const isEnabled = st.enabled;
              let statusBadge: { text: string; cls: string };
              switch (st.status) {
                case "disabled":
                  statusBadge = { text: "ปิดใช้งานเอง", cls: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
                  break;
                case "active":
                  statusBadge = { text: `${st.availableCount}/${st.modelCount} models`, cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" };
                  break;
                case "error":
                  statusBadge = { text: `${st.modelCount} models (offline)`, cls: "bg-red-500/20 text-red-300 border-red-500/30" };
                  break;
                case "no_models":
                  statusBadge = { text: "มี key แล้ว — รอ scan", cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" };
                  break;
                default:
                  statusBadge = { text: "ยังไม่มี key", cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" };
              }

              return (
                <div
                  key={info.provider}
                  className={`glass rounded-xl p-4 border transition-all ${
                    !isEnabled ? "border-gray-600/20 bg-gray-800/20 opacity-60" :
                    isActive ? "border-emerald-500/20 bg-emerald-500/[0.02]" :
                    st.status === "error" ? "border-red-500/10 bg-red-500/[0.02]" :
                    "border-white/5 hover:border-white/10"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div
                      className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0 text-2xl mt-0.5"
                      style={{ background: `${c.glow}15`, border: `1px solid ${c.glow}30` }}
                    >
                      {info.icon}
                    </div>

                    {/* Info + Input */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className={`font-bold text-sm ${c.text}`}>{info.label}</span>
                        <ProviderBadge provider={info.provider} />
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>
                          {statusBadge.text}
                        </span>
                        {result === "ok" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">
                            บันทึกแล้ว!
                          </span>
                        )}
                        {/* Toggle switch */}
                        <button
                          onClick={() => handleToggleEnabled(info.provider, !isEnabled)}
                          disabled={isSaving}
                          title={isEnabled ? "คลิกเพื่อปิด provider" : "คลิกเพื่อเปิด provider"}
                          className={`ml-auto relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                            isEnabled ? "bg-emerald-500/70" : "bg-gray-600/60"
                          }`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            isEnabled ? "translate-x-4" : "translate-x-0.5"
                          }`} />
                        </button>
                        <span className={`text-[10px] font-bold ${isEnabled ? "text-emerald-400" : "text-gray-500"}`}>
                          {isEnabled ? "เปิด" : "ปิด"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2">{info.description}</p>

                      {/* Key input row */}
                      {noKeyReq ? (
                        <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          ไม่ต้องใช้ key — รันบนเครื่องตัวเอง
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-[11px] font-mono text-gray-500 shrink-0">{info.envVar}=</code>
                          <input
                            type="password"
                            placeholder={hasKey ? "••••••••••••" : "วาง API Key ที่นี่..."}
                            value={keyInputs[info.provider] ?? ""}
                            onChange={(e) => {
                              setKeyInputs((p) => ({ ...p, [info.provider]: e.target.value }));
                              setTestResult((p) => ({ ...p, [info.provider]: undefined as any }));
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") handleTestKey(info.provider); }}
                            className="flex-1 min-w-0 text-xs font-mono bg-gray-800/80 border border-white/10 rounded-lg px-3 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                          />
                          <button
                            onClick={() => handleTestKey(info.provider)}
                            disabled={isTesting || !(keyInputs[info.provider]?.trim())}
                            className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                          >
                            {isTesting ? "..." : "ทดสอบ"}
                          </button>
                          <button
                            onClick={() => handleSaveKey(info.provider)}
                            disabled={isSaving || !testPassed}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                          >
                            {isSaving ? "..." : "บันทึก"}
                          </button>
                          {testRes?.ok === true && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              ✓ ใช้ได้ ({testRes.models} models)
                            </span>
                          )}
                          {testRes?.ok === false && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30" title={testRes.error}>
                              ✗ ใช้ไม่ได้
                            </span>
                          )}
                          {hasDbKey && (
                            <button
                              onClick={() => handleDeleteKey(info.provider)}
                              disabled={isSaving}
                              className="px-2 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 text-xs transition-colors shrink-0"
                              title="ลบ key จาก DB"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Sign up link */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <a
                        href={info.signupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 ${
                          isActive
                            ? "bg-gray-700/50 text-gray-400 hover:text-white"
                            : "bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white shadow-lg shadow-indigo-500/20"
                        }`}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        สมัครฟรี
                      </a>
                      {isActive && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-300 text-xs font-bold">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                          ใช้งานได้
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Scan Now button */}
        {hasSavedAny && (
          <div className="px-6 pb-4">
            <button
              onClick={handleScanNow}
              disabled={scanning}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold text-sm disabled:opacity-50 transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40"
            >
              {scanning ? (
                <>
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  กำลัง Scan หา model...
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Scan เลย! — ค้นหา model จาก provider ที่เพิ่ง setup
                </>
              )}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="p-6 pt-2 border-t border-white/5">
          <div className="glass rounded-xl p-4 border border-gray-500/20 bg-gray-500/5">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-bold">หมายเหตุ</span>
            </div>
            <ul className="text-xs text-gray-500 space-y-1 list-disc list-inside">
              <li>Key ที่กรอกบันทึกลง database — ไม่ต้องรีสตาร์ท</li>
              <li>ระบบ <strong className="text-amber-300">ไม่อ่าน .env.local</strong> สำหรับ API key — ตั้งค่าผ่านหน้านี้เท่านั้น</li>
              <li>Provider list มาจาก DB (รวม provider ที่ระบบ auto-discovery จาก internet)</li>
              <li>กด <strong className="text-white">Scan เลย!</strong> หลังบันทึก key เพื่อค้นหา model ทันที</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
