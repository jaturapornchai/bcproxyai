"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ProviderStatus {
  provider: string;
  label: string;
  envVar: string;
  homepage: string;
  source: string;
  freeTier: boolean;
  hasKey: boolean;
  hasDbKey: boolean;
  noKeyRequired: boolean;
  enabled: boolean;
  modelCount: number;
  availableCount: number;
  status: "active" | "no_key" | "no_models" | "error" | "disabled";
  notes?: string;
  modelsUrl?: string;
  authScheme?: string;
  homepageOk?: boolean | null;
  homepageStatusCode?: number | null;
  modelsOk?: boolean | null;
  modelsStatusCode?: number | null;
  verifyNotes?: string;
  lastVerifiedAt?: string | null;
  publicModelsCount?: number | null;
  costAllowed: boolean;
  costRiskLevel: "safe" | "billable";
  costRiskMessage: string;
}

// Provider "ของไทย" = notes / label / name มีคำว่า "thai" (case-insensitive)
// ทำใน UI layer เท่านั้น — ไม่มีผลกับ routing decision (ตามกติกา no-hardcode)
const isThaiProvider = (s: ProviderStatus) =>
  /thai/i.test(s.notes ?? "") || /thai/i.test(s.label) || /thai/i.test(s.provider);

const PROVIDER_ICONS: Record<string, string> = {
  openrouter: "🌐", kilo: "⚡", google: "🔍",
  groq: "🏎️", cerebras: "🧠", sambanova: "🚀",
  mistral: "💨", ollama: "💻", github: "🐱",
  fireworks: "🎆", cohere: "📡", cloudflare: "☁️",
  huggingface: "🤗", nvidia: "🟢", chutes: "💨",
  llm7: "🔑", scaleway: "🇪🇺", pollinations: "🌸",
  ollamacloud: "☁️", siliconflow: "🔮", glhf: "🎮",
  together: "🤝", hyperbolic: "🌀", zai: "🗿",
  dashscope: "🧧", reka: "🌊",
  deepseek: "🐋", deepinfra: "📦", novita: "🌟",
  monsterapi: "👾", friendli: "🤟", xai: "𝕏",
  moonshot: "🌙", ai21: "🔣",
};

export default function SetupPage() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveResult, setSaveResult] = useState<Record<string, "ok" | "error" | undefined>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok?: boolean; models?: number; error?: string; warn?: string } | undefined>>({});
  const [filter, setFilter] = useState<"all" | "active" | "no_key" | "free" | "thai" | "broken">("all");
  const [riskyProviderCount, setRiskyProviderCount] = useState(0);
  const [acceptedRisk, setAcceptedRisk] = useState<Record<string, boolean>>({});

  const fetchStatuses = useCallback(() => {
    fetch("/api/providers")
      .then(async (r) => {
        setRiskyProviderCount(Number(r.headers.get("X-SMLGateway-Risky-Providers") ?? 0));
        return r.json();
      })
      .then((d) => { if (Array.isArray(d)) setStatuses(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStatuses();
    // Auto-refresh every 30s so verify results show up without manual action
    const id = setInterval(fetchStatuses, 30_000);
    return () => clearInterval(id);
  }, [fetchStatuses]);

  // Test → if valid, auto-save. One click does both.
  const handleTestAndSave = async (provider: string) => {
    const apiKey = keyInputs[provider]?.trim();
    if (!apiKey) return;
    const status = statuses.find((s) => s.provider === provider);
    if (status && !status.costAllowed && !acceptedRisk[provider]) return;
    setTesting((p) => ({ ...p, [provider]: true }));
    setTestResult((p) => ({ ...p, [provider]: undefined }));
    setSaveResult((p) => ({ ...p, [provider]: undefined }));
    let testData: { ok?: boolean; models?: number; error?: string } | undefined;
    try {
      const res = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, acceptCostRisk: acceptedRisk[provider] === true }),
      });
      testData = await res.json();
      setTestResult((p) => ({ ...p, [provider]: testData }));
    } catch {
      setTestResult((p) => ({ ...p, [provider]: { ok: false, error: "Network error" } }));
    } finally {
      setTesting((p) => ({ ...p, [provider]: false }));
    }

    if (!testData || testData.ok !== true) return;

    // Test passed → save immediately
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

  const activeCount = statuses.filter((s) => s.status === "active").length;
  const noKeyCount = statuses.filter((s) => s.status === "no_key").length;
  const freeCount = statuses.filter((s) => s.freeTier).length;
  const thaiCount = statuses.filter(isThaiProvider).length;
  const brokenCount = statuses.filter((s) => s.homepageOk === false || s.modelsOk === false).length;

  const filtered = statuses.filter((s) => {
    if (filter === "active") return s.status === "active";
    if (filter === "no_key") return s.status === "no_key";
    if (filter === "free") return s.freeTier;
    if (filter === "thai") return isThaiProvider(s);
    if (filter === "broken") return s.homepageOk === false || s.modelsOk === false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Sticky top bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-gray-950/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            กลับหน้าหลัก
          </Link>
          <div className="h-5 w-px bg-white/10" />
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <span>⚙️</span>
            <span>ตั้งค่ารหัส API</span>
          </h1>
          <span className="text-xs text-gray-500 hidden sm:inline">
            ใส่รหัส API ของผู้ให้บริการที่อยากใช้ — รายการ model พร้อมใช้ทันที (hardcoded ฟรีเท่านั้น)
          </span>

          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-emerald-400 font-bold">✓ ใช้ได้ {activeCount}</span>
            <span className="text-amber-400">ยังไม่มีรหัส {noKeyCount}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* MEGA WARNING — credit card safety, always visible */}
        <section className="relative overflow-hidden rounded-2xl border-2 border-red-500/80 bg-gradient-to-br from-red-700/40 via-red-900/30 to-orange-800/30 shadow-2xl shadow-red-600/40 ring-2 ring-red-400/50">
          {/* Diagonal hazard stripe */}
          <div className="absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(45deg,#fbbf24_0,#fbbf24_12px,#000_12px,#000_24px)]" />
          <div className="absolute inset-x-0 bottom-0 h-2 bg-[repeating-linear-gradient(45deg,#fbbf24_0,#fbbf24_12px,#000_12px,#000_24px)]" />

          <div className="relative p-5 sm:p-7">
            <div className="flex items-start gap-3 sm:gap-5">
              <span className="text-5xl sm:text-6xl leading-none shrink-0 animate-pulse drop-shadow-[0_0_12px_rgba(248,113,113,0.8)]">⛔</span>
              <div className="flex-1 space-y-4 min-w-0">
                <div>
                  <div className="inline-block px-3 py-1 mb-2 rounded-full bg-yellow-400 text-black text-xs sm:text-sm font-black tracking-wider uppercase">
                    🚨 อันตราย ระดับกินเงิน 🚨
                  </div>
                  <h2 className="text-2xl sm:text-4xl font-black text-yellow-100 tracking-tight leading-tight drop-shadow-lg">
                    ก่อนสมัคร provider — อ่านให้จบ
                    <br className="hidden sm:block" />
                    <span className="text-red-200">ป้องกันบัตรเครดิตโดนตัด</span>
                  </h2>
                </div>

                <div className="text-base sm:text-xl font-bold text-yellow-50 bg-red-950/60 rounded-lg p-4 border-2 border-yellow-400/50 leading-relaxed">
                  ⚡ provider AI หลายเจ้า <span className="underline decoration-yellow-300 decoration-4 underline-offset-2">ข้ามจาก free tier ไปตัดบัตรเครดิตเงียบๆ</span> เมื่อ quota หมด
                  <br />
                  ไม่เตือน · ไม่ confirm · <span className="bg-yellow-300 text-black px-2 py-0.5 rounded font-black">SMLGateway ห้ามไม่ได้</span>
                </div>

                <div className="space-y-2.5">
                  <div className="text-sm sm:text-base font-bold text-yellow-200 uppercase tracking-wider">
                    📋 กฎเหล็ก 4 ข้อก่อนกรอก API key:
                  </div>
                  <ul className="text-sm sm:text-base text-red-50 space-y-2.5 font-semibold">
                    <li className="flex gap-3 bg-black/30 rounded-lg p-3 border-l-4 border-yellow-400">
                      <span className="text-2xl shrink-0 leading-none">1️⃣</span>
                      <span><strong className="text-yellow-200">ใช้ email สำรอง</strong> เท่านั้น — email/Google account ที่ <strong className="underline decoration-yellow-300 decoration-2">ไม่เคยใส่บัตรเครดิต</strong> ไม่มียอดเติมเงินค้าง ไม่ผูก Google Pay/Apple Pay</span>
                    </li>
                    <li className="flex gap-3 bg-black/30 rounded-lg p-3 border-l-4 border-yellow-400">
                      <span className="text-2xl shrink-0 leading-none">2️⃣</span>
                      <span>ถ้าตอนสมัคร provider ให้ <strong className="text-emerald-300">SKIP ใส่บัตรได้</strong> (กดข้ามได้) → <strong className="text-emerald-300">ใช้ได้</strong> ปลอดภัย</span>
                    </li>
                    <li className="flex gap-3 bg-black/30 rounded-lg p-3 border-l-4 border-red-500">
                      <span className="text-2xl shrink-0 leading-none">3️⃣</span>
                      <span>ถ้า provider <strong className="text-red-300">บังคับใส่บัตร</strong> ตั้งแต่สมัคร (verify บัตร / require payment method) → <strong className="underline decoration-red-400 decoration-2">ไม่แนะนำให้สมัคร</strong> ข้ามตัวนั้นไปเลย ใช้เจ้าอื่นแทน</span>
                    </li>
                    <li className="flex gap-3 bg-black/30 rounded-lg p-3 border-l-4 border-red-500">
                      <span className="text-2xl shrink-0 leading-none">4️⃣</span>
                      <span>ถ้าเผลอผูกบัตรไปแล้ว ให้ <strong className="text-yellow-200">ลบบัตรออก</strong> หรือตั้ง <strong className="text-yellow-200">spending limit = $0</strong> ที่หน้า billing ของ provider <strong className="text-red-300">ก่อน</strong>กรอก API key ตรงนี้</span>
                    </li>
                  </ul>
                </div>

                <div className="text-xs sm:text-sm text-yellow-100/90 bg-black/40 rounded-lg p-3 border border-yellow-400/30 leading-relaxed">
                  <strong className="text-yellow-200">SMLGateway จะ cooldown provider</strong> เมื่อ free tier หมด/ชน limit/error
                  แต่ <strong className="text-red-300">ไม่ได้คุย billing API กับ provider</strong> — ถ้า provider เลือกเก็บเงินกับบัตร gateway ห้ามไม่ได้
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick start guide */}
        <section className="rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-cyan-500/5 p-4">
          <div className="text-sm font-bold text-indigo-300 mb-2">เริ่มต้นง่ายๆ 3 ขั้น (หลังอ่านคำเตือนข้างบนแล้ว)</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-300">
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none shrink-0">1️⃣</span>
              <span>กด <strong className="text-cyan-300">เปิดหน้าเว็บ</strong> ของผู้ให้บริการ แล้วสมัครด้วย <strong className="text-yellow-300">email สำรอง</strong> รับรหัส API ฟรี</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none shrink-0">2️⃣</span>
              <span>วางรหัสในช่องแล้วกด <strong className="text-emerald-300">บันทึก</strong> (กด <strong>ทดสอบ</strong> ก่อนได้)</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none shrink-0">3️⃣</span>
              <span>เสร็จแล้ว — รายการ model <strong className="text-emerald-300">พร้อมใช้ทันที</strong> ผ่าน <code className="text-xs bg-white/10 px-1 rounded">/v1/chat/completions</code></span>
            </div>
          </div>
          {riskyProviderCount > 0 && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              มี {riskyProviderCount} รายการที่อยู่นอก whitelist ฟรีและอาจตัดเครดิต/คิดเงิน
              ดูคำเตือนข้างบนก่อนตัดสินใจสมัคร
            </div>
          )}
        </section>

        {/* Filter chips */}
        <section className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">กรอง:</span>
          {([
            { id: "all",     label: `ทั้งหมด (${statuses.length})` },
            { id: "active",  label: `✓ ใช้ได้ (${activeCount})` },
            { id: "no_key",  label: `🔑 ยังไม่มีรหัส (${noKeyCount})` },
            { id: "free",    label: `🆓 ฟรี (${freeCount})` },
            { id: "thai",    label: `🇹🇭 ของไทย (${thaiCount})` },
            { id: "broken",  label: `⚠️ ลิงก์เสีย (${brokenCount})` },
          ] as const).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 rounded-full text-xs transition-colors ${
                filter === f.id
                  ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/40"
                  : "bg-white/5 text-gray-400 hover:bg-white/10 border border-transparent"
              }`}
            >
              {f.label}
            </button>
          ))}
        </section>

        {/* Provider grid */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="shimmer rounded-xl h-32 bg-gray-800/60" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filtered.map((st) => {
              const icon = PROVIDER_ICONS[st.provider] ?? "🌐";
              const isActive = st.status === "active";
              const isSaving = saving[st.provider] ?? false;
              const isTesting = testing[st.provider] ?? false;
              const testRes = testResult[st.provider];
              const result = saveResult[st.provider];

              let statusBadge: { text: string; cls: string };
              switch (st.status) {
                case "disabled":
                  statusBadge = { text: "ปิดอยู่", cls: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
                  break;
                case "active":
                  statusBadge = { text: `ใช้ได้ ${st.availableCount}/${st.modelCount} model`, cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" };
                  break;
                case "error":
                  statusBadge = { text: `${st.modelCount} model ใช้ไม่ได้`, cls: "bg-red-500/20 text-red-300 border-red-500/30" };
                  break;
                case "no_models": {
                  const pub = st.publicModelsCount;
                  statusBadge = pub && pub > 0
                    ? { text: `มีรหัสแล้ว — รอสแกน (${pub} model)`, cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" }
                    : { text: "มีรหัสแล้ว — รอค้นหา", cls: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" };
                  break;
                }
                default: { // no_key
                  const pub = st.publicModelsCount;
                  statusBadge = pub && pub > 0
                    ? { text: `ยังไม่มีรหัส — ${pub} model พร้อมสแกน`, cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" }
                    : { text: "ยังไม่มีรหัส", cls: "bg-amber-500/20 text-amber-300 border-amber-500/30" };
                }
              }

              return (
                <div
                  key={st.provider}
                  className={`rounded-xl p-4 border transition-all ${
                    !st.enabled ? "border-gray-600/20 bg-gray-800/20 opacity-60" :
                    isActive ? "border-emerald-500/30 bg-emerald-500/[0.03]" :
                    st.status === "error" ? "border-red-500/20 bg-red-500/[0.03]" :
                    "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                  }`}
                >
                  {/* Header row */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-white/5 border border-white/10 text-2xl shrink-0">
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white">{st.label}</span>
                        {st.freeTier && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">🆓 ฟรี</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusBadge.cls}`}>{statusBadge.text}</span>
                        {st.costAllowed ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">ปลอดภัยตาม whitelist</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/25" title={st.costRiskMessage}>
                            เสี่ยงเสียเงิน
                          </span>
                        )}
                        {st.homepageOk === false && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25" title={`homepage HTTP ${st.homepageStatusCode ?? "?"} — ${st.verifyNotes ?? ""}`}>
                            ⚠️ ลิงก์สมัครเสีย
                          </span>
                        )}
                        {st.modelsOk === false && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/25" title={`models HTTP ${st.modelsStatusCode ?? "?"} — ${st.verifyNotes ?? ""}`}>
                            ⚠️ endpoint เสีย
                          </span>
                        )}
                        {result === "ok" && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse">บันทึกแล้ว!</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 font-mono truncate">
                        {st.envVar || st.provider}
                      </div>
                      {st.lastVerifiedAt && (
                        <div className="text-[10px] text-gray-600 mt-0.5" title={st.verifyNotes}>
                          ตรวจล่าสุด: {new Date(st.lastVerifiedAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                          {st.homepageOk !== null && st.homepageOk !== undefined && (
                            <span className="ml-1">— หน้าเว็บ {st.homepageOk ? "✓" : `✗ (${st.homepageStatusCode ?? "?"})`}</span>
                          )}
                          {st.modelsOk !== null && st.modelsOk !== undefined && (
                            <span className="ml-1">/ models {st.modelsOk ? "✓" : `✗ (${st.modelsStatusCode ?? "?"})`}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggleEnabled(st.provider, !st.enabled)}
                        disabled={isSaving}
                        title={st.enabled ? "ปิดผู้ให้บริการนี้" : "เปิดผู้ให้บริการนี้"}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                          st.enabled ? "bg-emerald-500/70" : "bg-gray-600/60"
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          st.enabled ? "translate-x-4" : "translate-x-0.5"
                        }`} />
                      </button>
                      {st.homepage && (
                        <a href={st.homepage} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-300 hover:text-white whitespace-nowrap">
                          เปิดหน้าเว็บ →
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Key input row */}
                  {st.noKeyRequired ? (
                    <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      ไม่ต้องใช้รหัส — ใช้งานได้เลย
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {!st.costAllowed && (
                        <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-[11px] text-red-100 space-y-1">
                          <div className="font-bold text-red-200">คำเตือน: provider นี้อาจตัดเครดิต/คิดเงิน</div>
                          <div>{st.costRiskMessage}</div>
                          <div>
                            วิธีทำงานที่ปลอดภัยคือใช้ quota ฟรีจนหมด; ถ้าหมดหรือชน limit ระบบ provider จะบอกเอง
                            และ SMLGateway จะ cooldown แล้วกลับมาใช้ใหม่เมื่อพร้อม.
                          </div>
                          <div>แต่ถ้าบัญชีนี้ผูกบัตรไว้ provider บางเจ้าอาจข้ามไปตัดบัตรเครดิตได้ อันตรายมาก.</div>
                          <div>แนะนำให้สมัครด้วย email/account ใหม่ที่ไม่ผูกบัตรและไม่มีเครดิตเติมเงิน เพื่อกันเงินรั่วจากบัญชีหลัก.</div>
                          <label className="flex items-start gap-2 pt-1 text-red-50">
                            <input
                              type="checkbox"
                              checked={acceptedRisk[st.provider] === true}
                              onChange={(e) => setAcceptedRisk((p) => ({ ...p, [st.provider]: e.target.checked }))}
                              className="mt-0.5"
                            />
                            <span>ฉันเข้าใจความเสี่ยง และยืนยันว่าจะทดสอบ/บันทึก provider นี้ด้วยความรับผิดชอบของฉันเอง</span>
                          </label>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          placeholder={st.hasKey ? "••••••••••••" : "วางรหัส API ที่นี่..."}
                          value={keyInputs[st.provider] ?? ""}
                          onChange={(e) => {
                            setKeyInputs((p) => ({ ...p, [st.provider]: e.target.value }));
                            setTestResult((p) => ({ ...p, [st.provider]: undefined }));
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") handleTestAndSave(st.provider); }}
                          className="flex-1 min-w-0 text-xs font-mono bg-gray-900/80 border border-white/10 rounded-lg px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                        />
                        <button
                          onClick={() => handleTestAndSave(st.provider)}
                          disabled={isTesting || isSaving || !(keyInputs[st.provider]?.trim()) || (!st.costAllowed && acceptedRisk[st.provider] !== true)}
                          title="ทดสอบรหัส ถ้าใช้ได้จะบันทึกให้อัตโนมัติ"
                          className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {isTesting ? "กำลังทดสอบ…" : isSaving ? "กำลังบันทึก…" : "ทดสอบ + บันทึก"}
                        </button>
                        {st.hasDbKey && (
                          <button
                            onClick={() => handleDeleteKey(st.provider)}
                            disabled={isSaving}
                            className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                            title="ลบรหัสออกจากฐานข้อมูล"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                      {testRes?.ok === true && result === "ok" && (
                        <div className="text-[11px] text-emerald-300 flex items-center gap-1.5 font-semibold">
                          ✅ ทดสอบผ่าน ({testRes.models ?? 0} model) — บันทึกสำเร็จ
                        </div>
                      )}
                      {testRes?.ok === true && (testRes as { warn?: string }).warn && (
                        <div className="text-[11px] text-amber-300">
                          ⚠️ {(testRes as { warn?: string }).warn}
                        </div>
                      )}
                      {testRes?.ok === true && result !== "ok" && isSaving && (
                        <div className="text-[11px] text-cyan-300 flex items-center gap-1.5">
                          ✓ ทดสอบผ่าน ({testRes.models ?? 0} model) — กำลังบันทึก…
                        </div>
                      )}
                      {testRes?.ok === false && (
                        <div className="text-[11px] text-red-300 flex items-center gap-1.5" title={testRes.error}>
                          ✗ ทดสอบไม่ผ่าน: {testRes.error?.slice(0, 80) ?? "ไม่ทราบสาเหตุ"}
                        </div>
                      )}
                      {result === "error" && (
                        <div className="text-[11px] text-red-300 flex items-center gap-1.5">
                          ✗ บันทึกไม่สำเร็จ — ลองใหม่
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-gray-500 text-sm py-12">ไม่มีผู้ให้บริการในกลุ่มนี้</div>
            )}
          </div>
        )}

        {/* Footer note */}
        <section className="rounded-xl border border-gray-500/20 bg-gray-500/5 p-4 text-xs text-gray-400 space-y-1">
          <div className="font-bold text-gray-300 mb-1">หมายเหตุ</div>
          <ul className="list-disc list-inside space-y-0.5">
            <li>รหัส API ทั้งหมดเก็บในฐานข้อมูล (ตาราง <code className="text-indigo-300">api_keys</code>) — ระบบไม่อ่านจากไฟล์ .env.local</li>
            <li>รายชื่อ model มาจาก <code className="text-indigo-300">free-model-catalog.ts</code> ที่ฝังในโค้ด — ไม่มีระบบค้นหา/discovery ที่ runtime</li>
            <li>สวิตซ์ปิด/เปิดผู้ให้บริการได้ — ปิดแล้วระบบจะไม่ส่งคำขอไปที่นั่น</li>
            <li>เพิ่ม/ลบ model ต้องแก้ไฟล์ catalog แล้ว redeploy — ทุก model ในนี้คัดมาว่าฟรีจริง (rate-limited, ไม่ตัดบัตร)</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
