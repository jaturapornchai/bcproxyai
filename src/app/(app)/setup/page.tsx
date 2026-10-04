"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_COLORS } from "@/components/shared";
import { IconAlert, IconArrowRight, IconCheck, IconKey, IconLock, IconRefresh, IconX } from "@/components/ui/icons";
import { Badge, Button, Callout, Card, EmptyState, LinkButton, PageHeader, Reveal, SectionTitle, Tabs } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";
import type { OpenRouterKeyStatus } from "@/lib/openrouter-key-status";

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

interface TestResult {
  ok?: boolean;
  models?: number;
  error?: string;
  warn?: string;
}

type Phase = "idle" | "testing" | "saving" | "done" | "error";
type Filter = "all" | "active" | "no_key" | "free" | "thai" | "broken";

// Provider "ของไทย" = notes / label / name มีคำว่า "thai" (case-insensitive)
// ทำใน UI layer เท่านั้น — ไม่มีผลกับ routing decision (ตามกติกา no-hardcode)
const isThaiProvider = (s: ProviderStatus) =>
  /thai/i.test(s.notes ?? "") || /thai/i.test(s.label) || /thai/i.test(s.provider);

const isBroken = (s: ProviderStatus) => s.homepageOk === false || s.modelsOk === false;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400/80";
const INPUT_CLS =
  "w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-[13px] text-gray-100 placeholder:text-gray-600 outline-none transition focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/25";

const FLOW_STEPS = ["เลือกผู้ให้บริการ", "สมัคร / คัดลอก key", "วาง key และบันทึก"];

function statusBadge(st: ProviderStatus): { tone: Tone; text: string } {
  switch (st.status) {
    case "disabled":
      return { tone: "neutral", text: "ปิดอยู่" };
    case "active":
      return { tone: "success", text: `ใช้ได้ ${st.availableCount}/${st.modelCount} model` };
    case "error":
      return { tone: "danger", text: `${st.modelCount} model ใช้ไม่ได้` };
    case "no_models":
      return { tone: "info", text: st.publicModelsCount && st.publicModelsCount > 0 ? `มี key แล้ว — รอสแกน (${st.publicModelsCount} model)` : "มี key แล้ว — รอค้นหา model" };
    default:
      return { tone: "warning", text: "ยังไม่มี key" };
  }
}

// Account-side settings that make charging impossible (audit 2026-10-04) — the gateway cannot enforce these for you.
const NO_BILLING = ["ไม่มีระบบเก็บเงิน — ไม่ต้องตั้งค่าเพิ่ม"];
const NO_SPEND_STEPS: Record<string, string[]> = {
  openrouter: ["คงยอดเครดิต $0 และปิด auto top-up (บังคับ — เป็นตัวกันเดียวที่ OpenRouter รับรองว่าตัดก่อนเรียก)", "เสริม: ตั้ง credit limit = $0 ให้ทุก key ที่ใส่ไว้ ที่ openrouter.ai/settings/keys"],
  groq: ["อยู่ Free plan — ไม่ใส่ payment method"],
  mistral: ["ใช้ Experiment (ฟรี) plan — ปิด pay-as-you-go"],
  cohere: ["ใช้ Trial key เท่านั้น — ห้ามใช้ Production key"],
  sambanova: ["ไม่ใส่ payment method"],
  cerebras: ["ห้ามซื้อเครดิต pay-as-you-go"],
  ollamacloud: ["ห้ามซื้อ usage credits"],
  nvidia: NO_BILLING,
  typhoon: NO_BILLING,
  thaillm: NO_BILLING,
  sealion: NO_BILLING,
};

function NoSpendChecklist({ provider }: { provider: string }) {
  const steps = NO_SPEND_STEPS[provider];
  if (!steps) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2 text-[12px] leading-relaxed text-emerald-100">
      <div className="font-semibold text-emerald-200">กันเสียเงิน</div>
      <ul className="space-y-0.5">
        {steps.map((s) => (
          <li key={s} className="flex gap-1.5">
            <IconCheck size={13} className="mt-[3px] shrink-0" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
      {provider === "openrouter" && <Badge tone="success">ระบบล็อก max_price = 0 + ตัด server tools / ไฟล์ PDF ให้อัตโนมัติ (max_price คุมแค่ราคา token/request/image)</Badge>}
    </div>
  );
}

const OR_LEVEL: Record<OpenRouterKeyStatus["level"], { box: string; tone: Tone; label: string; bar: string }> = {
  ok: { box: "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-100", tone: "success", label: "ปลอดภัย", bar: "bg-emerald-400" },
  warn: { box: "border-amber-400/25 bg-amber-400/[0.07] text-amber-100", tone: "warning", label: "ควรตรวจ", bar: "bg-amber-400" },
  alert: { box: "border-rose-400/30 bg-rose-400/[0.09] text-rose-100", tone: "danger", label: "อันตราย", bar: "bg-rose-400" },
  unknown: { box: "border-white/10 bg-white/[0.03] text-gray-300", tone: "neutral", label: "ตรวจไม่ได้", bar: "bg-gray-400" },
};
const fmtUsd = (n: number) => `$${n === 0 ? "0" : n.toFixed(4)}`;

/** Live OpenRouter key status (GET /api/openrouter-status): level, Thai messages, free-quota bar, usage / limit. */
function OpenRouterStatusPanel({ status }: { status: OpenRouterKeyStatus | null }) {
  if (!status?.configured) return null;
  const st = OR_LEVEL[status.level];
  const { freeUsedToday: used, freeDailyLimit: cap } = status;
  const pct = used !== undefined && cap ? Math.min(100, Math.round((used / cap) * 100)) : null;
  return (
    <div className={`space-y-2 rounded-xl border px-3 py-2 text-[12px] leading-relaxed ${st.box}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-white">สถานะบัญชี OpenRouter</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {status.messages.length > 0 && (
        <ul className="space-y-0.5">
          {status.messages.map((m) => <li key={m}>• {m}</li>)}
        </ul>
      )}
      {pct !== null && (
        <div>
          <div className="mb-1 flex justify-between text-[11px]">
            <span>โควตา model ฟรีวันนี้</span>
            <span className="tabular-nums">{used}/{cap}</span>
          </div>
          <div role="progressbar" aria-label="โควตา model ฟรีที่ใช้วันนี้" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className={`h-full rounded-full ${st.bar}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="font-mono text-[11px] opacity-80">
        ใช้จริงสะสม {status.usage !== undefined ? fmtUsd(status.usage) : "—"} · วันนี้ {status.usageDaily !== undefined ? fmtUsd(status.usageDaily) : "—"} · limit {status.limit === null ? "ไม่จำกัด" : status.limit !== undefined ? fmtUsd(status.limit) : "—"}
      </div>
    </div>
  );
}

function formatVerified(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

/** Horizontal 3-step progress: 1 = pick, 2 = sign up / copy key, 3 = paste + save, 4 = all done. */
function FlowSteps({ current }: { current: number }) {
  return (
    <ol className="grid grid-cols-3" aria-label="ขั้นตอนการตั้งค่า API key">
      {FLOW_STEPS.map((label, idx) => {
        const n = idx + 1;
        const done = current > n;
        const active = current === n;
        return (
          <li key={label} className="relative flex flex-col items-center gap-2 text-center" aria-current={active ? "step" : undefined}>
            {idx > 0 && (
              <span aria-hidden className="absolute left-[-50%] right-[50%] top-[17px] h-px bg-white/10">
                <span className={`block h-full bg-gradient-to-r from-violet-400 to-cyan-300 transition-[width] duration-700 ${current >= n ? "w-full" : "w-0"}`} />
              </span>
            )}
            <span
              className={`relative z-10 grid h-[34px] w-[34px] place-items-center rounded-full text-[13px] font-semibold tabular-nums ring-1 transition-all duration-500 ${
                done
                  ? "bg-gradient-to-br from-violet-500 to-cyan-400 text-white ring-transparent"
                  : active
                    ? "bg-violet-500/25 text-white ring-violet-400/70 shadow-[0_0_24px_-4px_rgba(139,123,255,0.85)]"
                    : "bg-[#0b0d14] text-[var(--muted)] ring-white/10"
              }`}
            >
              {done ? <IconCheck size={16} className="check-draw" /> : n}
            </span>
            <span className={`px-1 text-[12px] font-medium leading-snug transition-colors sm:text-[13px] ${done || active ? "text-white" : "text-[var(--muted)]"}`}>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Avatar({ provider, label, large }: { provider: string; label: string; large?: boolean }) {
  const c = PROVIDER_COLORS[provider] ?? { text: "text-violet-200", bg: "bg-violet-500/15", border: "border-violet-400/30" };
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-xl border font-semibold uppercase ${c.bg} ${c.text} ${c.border} ${large ? "h-12 w-12 text-lg" : "h-10 w-10 text-[15px]"}`}
    >
      {label.slice(0, 1)}
    </span>
  );
}

interface PanelProps {
  st: ProviderStatus;
  maskedKey?: string;
  draft: string;
  phase: Phase;
  testRes?: TestResult;
  errorMsg: string | null;
  retriggered: number | null;
  riskAccepted: boolean;
  onDraft: (v: string) => void;
  onRisk: (v: boolean) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function KeyPanel({ st, maskedKey, draft, phase, testRes, errorMsg, retriggered, riskAccepted, onDraft, onRisk, onSubmit, onClose }: PanelProps) {
  const busy = phase === "testing" || phase === "saving";
  const canSubmit = draft.trim().length > 0 && !busy && (st.costAllowed || riskAccepted);

  return (
    <Card glow className="animate-page p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Avatar provider={st.provider} label={st.label} large />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold tracking-tight text-white">
            {phase === "done" ? `บันทึก key ของ ${st.label} แล้ว` : `ตั้งค่า ${st.label}`}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {st.hasKey && phase !== "done" ? <>มี key อยู่แล้ว <code className="font-mono text-gray-300">{maskedKey ?? "••••••••"}</code> — วาง key ใหม่เพื่อแทนที่</> : "ทำตาม 3 ขั้นด้านล่าง ใช้เวลาไม่ถึง 2 นาที"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="ปิดแผงตั้งค่า" className={`btn btn-ghost btn-sm !p-2 ${FOCUS}`}>
          <IconX size={16} />
        </button>
      </div>

      {phase === "done" ? (
        <div className="mt-6 flex flex-col items-center gap-4 text-center">
          <span className="animate-pop grid h-16 w-16 place-items-center rounded-full bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path className="check-draw" d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div>
            <div className="text-[15px] font-semibold text-white">ทดสอบผ่าน ({testRes?.models ?? 0} model) และบันทึกเรียบร้อย</div>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-[var(--muted)]">
              {retriggered && retriggered > 0
                ? `ระบบเริ่มสอบ model ของ ${st.label} ใหม่อัตโนมัติแล้ว (${retriggered} model เข้าคิวสอบ)`
                : `ระบบจะสแกนและสอบ model ของ ${st.label} ให้อัตโนมัติ ไม่ต้องกดอะไรเพิ่ม`}
              {" "}— ผลสอบจะขึ้นที่หน้า <strong className="text-gray-200">โมเดล &amp; อันดับ</strong> ภายในไม่กี่นาที
            </p>
          </div>
          {testRes?.warn && <Callout tone="warning">{testRes.warn}</Callout>}
          <div className="flex flex-wrap justify-center gap-2">
            <LinkButton href="/models" variant="primary">
              ไปดูผลสอบ model <IconArrowRight size={16} />
            </LinkButton>
            <Button type="button" onClick={onClose}>เพิ่มผู้ให้บริการอื่น</Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-5 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <ol className="space-y-3.5">
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/5 text-[12px] font-semibold text-violet-200 ring-1 ring-white/10">1</span>
              <div className="min-w-0 text-[13px] leading-relaxed text-gray-300">
                <div className="font-medium text-white">สมัครบัญชีด้วย email สำรอง</div>
                <p className="mt-0.5 text-[var(--muted)]">ถ้าเว็บบังคับใส่บัตรเครดิตตั้งแต่สมัคร ให้ข้ามเจ้านี้ไปใช้เจ้าอื่นแทน</p>
                {st.homepage ? (
                  <a
                    href={st.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`btn btn-ghost btn-sm mt-2 ${FOCUS}`}
                  >
                    สมัคร / ขอ API Key <IconArrowRight size={14} className="-rotate-45" />
                  </a>
                ) : (
                  <p className="mt-1 text-[12px] text-[var(--muted)]">ยังไม่มีลิงก์สมัครในระบบ — ค้นหา “{st.label} API key” ในเว็บเพื่อหาหน้าสมัคร</p>
                )}
                {isBroken(st) && (
                  <p className="mt-1 text-[12px] text-amber-300" title={st.verifyNotes}>
                    ตรวจพบว่าลิงก์/endpoint ของเจ้านี้อาจใช้ไม่ได้ในตอนนี้ (หน้าเว็บ {st.homepageStatusCode ?? "?"} / models {st.modelsStatusCode ?? "?"})
                  </p>
                )}
                <div className="mt-2"><NoSpendChecklist provider={st.provider} /></div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/5 text-[12px] font-semibold text-violet-200 ring-1 ring-white/10">2</span>
              <div className="min-w-0 text-[13px] leading-relaxed text-gray-300">
                <div className="font-medium text-white">สร้าง API key แล้วคัดลอก</div>
                <p className="mt-0.5 text-[var(--muted)]">
                  หาเมนู API keys ในบัญชี แล้วกดสร้าง key ใหม่ (ชื่อมาตรฐาน <code className="font-mono text-gray-300">{st.envVar || st.provider}</code>)
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/5 text-[12px] font-semibold text-violet-200 ring-1 ring-white/10">3</span>
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-gray-300">
                <label htmlFor="setup-key-input" className="font-medium text-white">วาง key แล้วกดทดสอบ + บันทึก</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="setup-key-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="วาง API key ที่นี่..."
                    value={draft}
                    onChange={(e) => onDraft(e.target.value)}
                    disabled={busy}
                    className={INPUT_CLS}
                  />
                  <Button type="submit" variant="primary" disabled={!canSubmit} className={`sm:shrink-0 ${FOCUS}`}>
                    {busy ? <IconRefresh size={16} className="animate-spin" /> : <IconLock size={16} />}
                    {phase === "testing" ? "กำลังทดสอบ…" : phase === "saving" ? "กำลังบันทึก…" : "ทดสอบ + บันทึก"}
                  </Button>
                </div>
              </div>
            </li>
          </ol>

          {!st.costAllowed && (
            <div className="space-y-1.5 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] p-3.5 text-[12.5px] leading-relaxed text-rose-100">
              <div className="font-semibold text-rose-200">คำเตือน: provider นี้อาจตัดเครดิต/คิดเงิน</div>
              <p>{st.costRiskMessage}</p>
              <p>วิธีที่ปลอดภัยคือใช้ quota ฟรีจนหมด ถ้าหมดหรือชน limit provider จะแจ้งเอง และ BCAiRouter จะ cooldown แล้วกลับมาใช้ใหม่เมื่อพร้อม แต่ถ้าบัญชีนี้ผูกบัตรไว้ provider บางเจ้าอาจข้ามไปตัดบัตรเครดิตได้ อันตรายมาก</p>
              <p>แนะนำให้สมัครด้วย email/account ใหม่ที่ไม่ผูกบัตรและไม่มีเครดิตเติมเงิน เพื่อกันเงินรั่วจากบัญชีหลัก</p>
              <label className="flex items-start gap-2 pt-1 text-rose-50">
                <input type="checkbox" checked={riskAccepted} onChange={(e) => onRisk(e.target.checked)} className="mt-0.5 accent-violet-400" />
                <span>ฉันเข้าใจความเสี่ยง และยืนยันว่าจะทดสอบ/บันทึก provider นี้ด้วยความรับผิดชอบของฉันเอง</span>
              </label>
            </div>
          )}

          <div aria-live="polite" className="space-y-2">
            {busy && testRes?.ok === true && (
              <div className="text-[12.5px] text-cyan-200">ทดสอบผ่าน ({testRes.models ?? 0} model) — กำลังบันทึก…</div>
            )}
            {testRes?.ok === true && testRes.warn && <Callout tone="warning">{testRes.warn}</Callout>}
            {testRes?.ok === false && (
              <Callout tone="warning" title="ทดสอบไม่ผ่าน">
                {testRes.error?.slice(0, 160) ?? "ไม่ทราบสาเหตุ"} — ตรวจว่าคัดลอก key ครบและเป็นของ {st.label} แล้วลองใหม่
              </Callout>
            )}
            {errorMsg && <Callout tone="warning" title="บันทึกไม่สำเร็จ">{errorMsg}</Callout>}
          </div>

          <p className="text-[12px] leading-relaxed text-[var(--muted)]">
            หลังบันทึก ระบบจะเริ่มสอบ model ของ provider นี้อัตโนมัติ ผลสอบจะแสดงที่หน้า <strong className="text-gray-300">โมเดล &amp; อันดับ</strong>
          </p>
        </form>
      )}
    </Card>
  );
}

export default function SetupPage() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [masks, setMasks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [riskyProviderCount, setRiskyProviderCount] = useState(0);
  const [acceptedRisk, setAcceptedRisk] = useState<Record<string, boolean>>({});
  const [orStatus, setOrStatus] = useState<OpenRouterKeyStatus | null>(null);

  // Key flow — one provider panel open at a time
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [testRes, setTestRes] = useState<TestResult | undefined>();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retriggered, setRetriggered] = useState<number | null>(null);

  // Toggle / delete on configured providers
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const flowToken = useRef(0); // invalidates in-flight submit when user switches/closes the panel

  const fetchStatuses = useCallback(async () => {
    try {
      const r = await fetch("/api/providers");
      setRiskyProviderCount(Number(r.headers.get("X-BCAiRouter-Risky-Providers") ?? 0));
      const d = await r.json();
      if (Array.isArray(d)) setStatuses(d);
    } catch { /* keep last list */ }
    finally { setLoading(false); }
  }, []);

  // Masked keys come from the owner-only GET /api/setup; if it fails the card falls back to dots
  const fetchMasks = useCallback(async () => {
    try {
      const d = await (await fetch("/api/setup")).json();
      if (Array.isArray(d)) {
        setMasks(Object.fromEntries((d as Array<{ provider: string; maskedKey: string }>).map((k) => [k.provider, k.maskedKey])));
      }
    } catch { /* ignore */ }
  }, []);

  // Owner-only; the server caches the OpenRouter call for ~5 min, so polling once a minute is cheap
  const fetchOrStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/openrouter-status", { cache: "no-store" });
      const d = (await r.json()) as OpenRouterKeyStatus;
      if (r.ok && typeof d.level === "string") setOrStatus(d);
    } catch { /* keep last status */ }
  }, []);

  useEffect(() => {
    fetchStatuses();
    fetchMasks();
    fetchOrStatus();
    // Auto-refresh every 30s so verify results show up without manual action
    const id = setInterval(fetchStatuses, 30_000);
    const orId = setInterval(fetchOrStatus, 60_000);
    return () => { clearInterval(id); clearInterval(orId); };
  }, [fetchStatuses, fetchMasks, fetchOrStatus]);

  useEffect(() => {
    if (selected) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  const resetFlow = () => {
    flowToken.current++;
    setDraft("");
    setPhase("idle");
    setTestRes(undefined);
    setErrorMsg(null);
    setRetriggered(null);
  };
  const openPanel = (provider: string) => {
    resetFlow();
    setConfirmDelete(null);
    setSelected(provider);
  };
  const closePanel = () => {
    resetFlow();
    setSelected(null);
  };
  const changeDraft = (v: string) => {
    setDraft(v);
    if (phase === "error") setPhase("idle");
    setTestRes(undefined);
    setErrorMsg(null);
  };

  const selectedSt = selected ? statuses.find((s) => s.provider === selected) : undefined;
  const currentStep = phase === "done" ? 4 : !selectedSt ? 1 : draft.trim() ? 3 : 2;

  // Test → if valid, auto-save. One click does both.
  const handleSubmit = async () => {
    if (!selectedSt) return;
    const { provider, costAllowed } = selectedSt;
    const apiKey = draft.trim();
    if (!apiKey || phase === "testing" || phase === "saving") return;
    if (!costAllowed && !acceptedRisk[provider]) return;

    const token = ++flowToken.current;
    setPhase("testing");
    setTestRes(undefined);
    setErrorMsg(null);

    let result: TestResult;
    try {
      const res = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, acceptCostRisk: acceptedRisk[provider] === true }),
      });
      result = await res.json();
    } catch {
      result = { ok: false, error: "Network error" };
    }
    if (flowToken.current !== token) return;
    setTestRes(result);
    if (result.ok !== true) {
      setPhase("error");
      return;
    }

    setPhase("saving");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; retriggeredExams?: number };
      if (res.ok) {
        fetchStatuses();
        fetchMasks();
        fetchOrStatus();
      }
      if (flowToken.current !== token) return;
      if (res.ok) {
        setRetriggered(typeof body.retriggeredExams === "number" ? body.retriggeredExams : null);
        setDraft("");
        setPhase("done");
      } else {
        setErrorMsg(body.error ?? "ลองใหม่อีกครั้ง");
        setPhase("error");
      }
    } catch {
      if (flowToken.current !== token) return;
      setErrorMsg("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง");
      setPhase("error");
    }
  };

  const mutateProvider = async (provider: string, body: { enabled: boolean } | { apiKey: "" }, failText: string) => {
    setBusy((p) => ({ ...p, [provider]: true }));
    setNotice(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...body }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice(`${failText}: ${d.error ?? `HTTP ${res.status}`}`);
      }
      await Promise.all([fetchStatuses(), fetchMasks(), fetchOrStatus()]);
    } catch {
      setNotice(`${failText}: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้`);
    } finally {
      setBusy((p) => ({ ...p, [provider]: false }));
    }
  };

  const handleDelete = async (provider: string) => {
    setConfirmDelete(null);
    await mutateProvider(provider, { apiKey: "" }, "ลบ key ไม่สำเร็จ");
  };

  const activeCount = statuses.filter((s) => s.status === "active").length;
  const noKeyCount = statuses.filter((s) => s.status === "no_key").length;
  const freeCount = statuses.filter((s) => s.freeTier).length;
  const thaiCount = statuses.filter(isThaiProvider).length;
  const brokenCount = statuses.filter(isBroken).length;

  const filtered = statuses.filter((s) => {
    if (filter === "active") return s.status === "active";
    if (filter === "no_key") return s.status === "no_key";
    if (filter === "free") return s.freeTier;
    if (filter === "thai") return isThaiProvider(s);
    if (filter === "broken") return isBroken(s);
    return true;
  });
  const configured = filtered.filter((s) => s.hasKey);
  const available = filtered.filter((s) => !s.hasKey);

  // Recommend from live data: free + whitelisted + no key yet, richest catalog first
  const recommended = statuses
    .filter((s) => s.freeTier && s.costAllowed && !s.hasKey && s.enabled)
    .sort((a, b) => b.modelCount - a.modelCount)
    .slice(0, 3);

  const filterTabs: Array<{ id: Filter; label: string }> = [
    { id: "all", label: `ทั้งหมด (${statuses.length})` },
    { id: "active", label: `ใช้ได้ (${activeCount})` },
    { id: "no_key", label: `ยังไม่มี key (${noKeyCount})` },
    { id: "free", label: `ฟรี (${freeCount})` },
    { id: "thai", label: `ของไทย (${thaiCount})` },
    { id: "broken", label: `ลิงก์เสีย (${brokenCount})` },
  ];

  return (
    <>
      <PageHeader
        eyebrow="ขั้นตอนที่ 1 · เริ่มต้นใช้งาน"
        title="API key ผู้ให้บริการ"
        description="ใส่ API key ของผู้ให้บริการ AI ที่คุณสมัครไว้ ระบบจะทดสอบ key ให้ บันทึก และเริ่มสอบ model อัตโนมัติ — ใส่แค่ 1–2 เจ้าก็เริ่มใช้งานได้"
        actions={
          <>
            <Badge tone="success" dot>ใช้ได้ {activeCount}</Badge>
            <Badge tone="warning">ยังไม่มี key {noKeyCount}</Badge>
          </>
        }
      />

      <div className="space-y-6">
        {orStatus?.disabledByTripwire && (
          <div role="alert" className="space-y-1.5 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3.5 text-[13px] leading-relaxed text-rose-100">
            <div className="flex items-center gap-2 font-semibold text-white">
              <IconAlert size={18} className="shrink-0 text-rose-300" /> ระบบปิด OpenRouter ให้อัตโนมัติ — ตรวจพบว่ามีเงินถูกตัด
            </div>
            <p>ยอดใช้งานจริง (usage) ของ key เพิ่มขึ้นหลังจากเริ่มเฝ้าดู แปลว่ามีค่าใช้จ่ายเกิดขึ้น ระบบจึงหยุดส่งคำขอไป OpenRouter เพื่อกันเงินรั่วต่อ</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              <li>เปิด openrouter.ai/activity และ openrouter.ai/settings/credits ดูว่าเงินถูกตัดจากอะไร</li>
              <li>คงยอดเครดิต $0 + ปิด auto top-up และตั้ง credit limit = $0 ให้ทุก key ที่ openrouter.ai/settings/keys</li>
              <li>เมื่อตรวจบัญชีแล้วมั่นใจ ค่อยเปิดสวิตช์ OpenRouter คืนที่การ์ดด้านล่าง — ระบบจะเริ่มนับยอดใหม่</li>
            </ol>
          </div>
        )}

        <Reveal i={0}>
          <Card className="px-4 py-5 sm:px-8">
            <FlowSteps current={currentStep} />
          </Card>
        </Reveal>

        <Reveal i={1}>
          <div className="space-y-3">
            <Callout tone="warning" title="ก่อนสมัคร — อ่านให้จบเพื่อกันบัตรเครดิตโดนตัด">
              <p>
                provider AI หลายเจ้าข้ามจาก free tier ไปตัดบัตรเครดิตเงียบๆ เมื่อ quota หมด โดยไม่เตือนและไม่ถามยืนยัน — BCAiRouter ห้ามไม่ได้
              </p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                <li><strong className="text-white">ใช้ email สำรอง</strong> ที่ไม่เคยใส่บัตรเครดิต ไม่มียอดเติมเงินค้าง ไม่ผูก Google Pay/Apple Pay</li>
                <li>ถ้าตอนสมัครกด <strong className="text-white">ข้ามการใส่บัตร</strong> ได้ — ใช้ได้ ปลอดภัย</li>
                <li>ถ้า provider <strong className="text-white">บังคับใส่บัตร</strong> ตั้งแต่สมัคร — ไม่แนะนำ ข้ามตัวนั้นไปใช้เจ้าอื่นแทน</li>
                <li>ถ้าเผลอผูกบัตรไปแล้ว ให้ลบบัตรออก หรือตั้ง <strong className="text-white">spending limit = $0</strong> ที่หน้า billing ของ provider ก่อนกรอก key ตรงนี้</li>
              </ol>
              <p className="mt-2 text-[12px] opacity-80">
                BCAiRouter จะ cooldown provider เมื่อ free tier หมด/ชน limit/error แต่ไม่ได้คุย billing API กับ provider — ถ้า provider เลือกเก็บเงินกับบัตร gateway ห้ามไม่ได้
              </p>
            </Callout>
            {riskyProviderCount > 0 && (
              <Callout tone="warning">
                มี {riskyProviderCount} รายการที่อยู่นอก whitelist ฟรีและอาจตัดเครดิต/คิดเงิน — ดูคำเตือนข้างบนก่อนตัดสินใจสมัคร
              </Callout>
            )}
          </div>
        </Reveal>

        {notice && <Callout tone="warning" title="ทำรายการไม่สำเร็จ">{notice}</Callout>}

        <div ref={panelRef}>
          {selectedSt ? (
            <KeyPanel
              key={selectedSt.provider}
              st={selectedSt}
              maskedKey={masks[selectedSt.provider]}
              draft={draft}
              phase={phase}
              testRes={testRes}
              errorMsg={errorMsg}
              retriggered={retriggered}
              riskAccepted={acceptedRisk[selectedSt.provider] === true}
              onDraft={changeDraft}
              onRisk={(v) => setAcceptedRisk((p) => ({ ...p, [selectedSt.provider]: v }))}
              onSubmit={handleSubmit}
              onClose={closePanel}
            />
          ) : (
            !loading && recommended.length > 0 && (
              <Reveal i={2}>
                <Callout tone="info" title="ไม่รู้จะเริ่มจากเจ้าไหน? ลองเริ่มจาก 3 เจ้านี้">
                  <p>เป็นผู้ให้บริการที่ฟรีตาม whitelist ของ gateway และมี model ในแคตตาล็อกมากที่สุด กดชื่อเพื่อเริ่มตั้งค่าได้เลย</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {recommended.map((p) => (
                      <button key={p.provider} type="button" onClick={() => openPanel(p.provider)} className={`btn btn-ghost btn-sm ${FOCUS}`}>
                        <Avatar provider={p.provider} label={p.label} />
                        {p.label} · {p.modelCount} model
                      </button>
                    ))}
                  </div>
                </Callout>
              </Reveal>
            )
          )}
        </div>

        <Reveal i={3}>
          <Tabs tabs={filterTabs} value={filter} onChange={setFilter} />
        </Reveal>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="กำลังโหลดรายชื่อผู้ให้บริการ">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton h-36" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconKey size={22} />}
              title="ไม่มีผู้ให้บริการในกลุ่มนี้"
              description="ลองเลือกตัวกรองอื่น หรือกลับไปดูทั้งหมด"
              action={<Button type="button" onClick={() => setFilter("all")}>ดูทั้งหมด</Button>}
            />
          </Card>
        ) : (
          <>
            {configured.length > 0 && (
              <section aria-labelledby="configured-title">
                <div id="configured-title"><SectionTitle title={`ตั้งค่าแล้ว (${configured.length})`} description="เปิด/ปิดการใช้งาน เปลี่ยน key หรือลบ key ได้จากตรงนี้" /></div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {configured.map((st, idx) => {
                    const badge = statusBadge(st);
                    const isBusy = busy[st.provider] ?? false;
                    const confirming = confirmDelete === st.provider;
                    return (
                      <Reveal key={st.provider} i={Math.min(idx, 8)} className="h-full">
                        <Card className={`flex h-full flex-col gap-3 p-4 transition-opacity ${st.enabled ? "" : "opacity-60"} ${selected === st.provider ? "ring-1 ring-violet-400/60" : ""}`}>
                          <div className="flex items-start gap-3">
                            <Avatar provider={st.provider} label={st.label} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[15px] font-semibold text-white">{st.label}</div>
                              <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{st.envVar || st.provider}</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={st.enabled}
                              aria-label={`${st.enabled ? "ปิด" : "เปิด"}ผู้ให้บริการ ${st.label}`}
                              title={st.enabled ? "ปิดผู้ให้บริการนี้" : "เปิดผู้ให้บริการนี้"}
                              disabled={isBusy}
                              onClick={() => mutateProvider(st.provider, { enabled: !st.enabled }, "เปลี่ยนสถานะไม่สำเร็จ")}
                              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${FOCUS} ${st.enabled ? "bg-emerald-500/70" : "bg-white/10"}`}
                            >
                              <span className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-300 ${st.enabled ? "translate-x-[22px]" : "translate-x-[3px]"}`} />
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone="success">{st.noKeyRequired ? "ไม่ต้องใช้ key" : "มี key แล้ว"}</Badge>
                            <Badge tone={badge.tone} dot={st.status === "active"}>{badge.text}</Badge>
                            {st.freeTier && <Badge tone="info">โควตาฟรี</Badge>}
                            {!st.costAllowed && <Badge tone="danger"><span title={st.costRiskMessage}>เสี่ยงเสียเงิน</span></Badge>}
                            {st.homepageOk === false && <Badge tone="warning"><span title={`homepage HTTP ${st.homepageStatusCode ?? "?"} — ${st.verifyNotes ?? ""}`}>ลิงก์สมัครเสีย</span></Badge>}
                            {st.modelsOk === false && <Badge tone="danger"><span title={`models HTTP ${st.modelsStatusCode ?? "?"} — ${st.verifyNotes ?? ""}`}>endpoint เสีย</span></Badge>}
                          </div>

                          {st.provider === "openrouter" && <OpenRouterStatusPanel status={orStatus} />}
                          <NoSpendChecklist provider={st.provider} />

                          {!st.noKeyRequired && (
                            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/25 px-3 py-2 font-mono text-[12px] text-gray-300">
                              <IconKey size={14} className="shrink-0 text-[var(--muted)]" />
                              <span className="truncate">{masks[st.provider] ?? "••••••••••••"}</span>
                            </div>
                          )}

                          {st.lastVerifiedAt && (
                            <div className="text-[11px] text-[var(--muted)]" title={st.verifyNotes}>
                              ตรวจล่าสุด {formatVerified(st.lastVerifiedAt)}
                              {st.homepageOk != null && ` · หน้าเว็บ ${st.homepageOk ? "ปกติ" : `ผิดปกติ (${st.homepageStatusCode ?? "?"})`}`}
                              {st.modelsOk != null && ` · models ${st.modelsOk ? "ปกติ" : `ผิดปกติ (${st.modelsStatusCode ?? "?"})`}`}
                            </div>
                          )}

                          {!st.noKeyRequired && (
                            <div className="mt-auto pt-1">
                              {confirming ? (
                                <div role="alertdialog" aria-label={`ยืนยันลบ key ของ ${st.label}`} className="space-y-2 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] p-3">
                                  <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-rose-100">
                                    <IconAlert size={16} className="mt-0.5 shrink-0" />
                                    ลบ key ของ {st.label}? ระบบจะหยุดใช้ผู้ให้บริการนี้จนกว่าจะใส่ key ใหม่
                                  </p>
                                  <div className="flex gap-2">
                                    <Button type="button" size="sm" disabled={isBusy} onClick={() => handleDelete(st.provider)} className={`border-rose-400/40! bg-rose-500/20! text-rose-100! ${FOCUS}`}>
                                      ยืนยันลบ
                                    </Button>
                                    <Button type="button" size="sm" onClick={() => setConfirmDelete(null)} className={FOCUS}>ยกเลิก</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <Button type="button" size="sm" onClick={() => openPanel(st.provider)} className={FOCUS}>
                                    <IconRefresh size={14} /> เปลี่ยน key
                                  </Button>
                                  {st.hasDbKey && (
                                    <Button type="button" size="sm" disabled={isBusy} onClick={() => setConfirmDelete(st.provider)} aria-label={`ลบ key ของ ${st.label}`} title="ลบ key ออกจากฐานข้อมูล" className={`text-rose-300! ${FOCUS}`}>
                                      <IconX size={14} /> ลบ key
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </Card>
                      </Reveal>
                    );
                  })}
                </div>
              </section>
            )}

            {available.length > 0 && (
              <section aria-labelledby="available-title">
                <div id="available-title"><SectionTitle title={`ผู้ให้บริการที่ยังไม่มี key (${available.length})`} description="กดการ์ดเพื่อเริ่มตั้งค่า — ใส่ key ได้ทีละเจ้า ไม่ต้องครบทุกตัว" /></div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {available.map((st, idx) => {
                    const pub = st.publicModelsCount;
                    return (
                      <Reveal key={st.provider} i={Math.min(idx, 8)} className="h-full">
                        <Card
                          hover
                          onClick={() => openPanel(st.provider)}
                          className={`flex h-full cursor-pointer flex-col gap-3 p-4 ${st.enabled ? "" : "opacity-60"} ${selected === st.provider ? "ring-1 ring-violet-400/60" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <Avatar provider={st.provider} label={st.label} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[15px] font-semibold text-white">{st.label}</div>
                              <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{st.envVar || st.provider}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone="warning">ยังไม่มี key</Badge>
                            {st.freeTier && <Badge tone="info">โควตาฟรี</Badge>}
                            {st.costAllowed ? <Badge tone="success">ตาม whitelist ฟรี</Badge> : <Badge tone="danger"><span title={st.costRiskMessage}>เสี่ยงเสียเงิน</span></Badge>}
                            {!st.enabled && <Badge tone="neutral">ปิดอยู่</Badge>}
                            {st.homepageOk === false && <Badge tone="warning"><span title={`homepage HTTP ${st.homepageStatusCode ?? "?"} — ${st.verifyNotes ?? ""}`}>ลิงก์สมัครเสีย</span></Badge>}
                            {st.modelsOk === false && <Badge tone="danger"><span title={`models HTTP ${st.modelsStatusCode ?? "?"} — ${st.verifyNotes ?? ""}`}>endpoint เสีย</span></Badge>}
                          </div>
                          <NoSpendChecklist provider={st.provider} />
                          <p className="text-[12.5px] text-[var(--muted)]">
                            {st.modelCount} model ในแคตตาล็อก{pub && pub > 0 ? ` · ${pub} model พร้อมสแกน` : ""}
                          </p>
                          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                            <Button type="button" variant="primary" size="sm" aria-label={`ตั้งค่า ${st.label}`} className={FOCUS}>
                              ตั้งค่า <IconArrowRight size={14} />
                            </Button>
                            {st.homepage && (
                              <a
                                href={st.homepage}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={`btn btn-ghost btn-sm ${FOCUS}`}
                              >
                                สมัคร / ขอ API Key <IconArrowRight size={14} className="-rotate-45" />
                              </a>
                            )}
                          </div>
                        </Card>
                      </Reveal>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}

        <Reveal i={4}>
          <Card className="p-5">
            <div className="text-[13px] font-semibold text-white">หมายเหตุ</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-[var(--muted)]">
              <li>API key ทั้งหมดเก็บในฐานข้อมูล (ตาราง <code className="font-mono text-violet-200">api_keys</code>) — ระบบไม่อ่านจากไฟล์ .env.local</li>
              <li>รายชื่อ model มาจาก <code className="font-mono text-violet-200">free-model-catalog.ts</code> ที่ฝังในโค้ด — ไม่มีระบบค้นหา/discovery ที่ runtime</li>
              <li>สวิตช์ปิด/เปิดผู้ให้บริการได้ — ปิดแล้วระบบจะไม่ส่งคำขอไปที่นั่น</li>
              <li>เพิ่ม/ลบ model ต้องแก้ไฟล์ catalog แล้ว redeploy — ทุก model ในนี้คัดมาว่าฟรีจริง (rate-limited)</li>
            </ul>
          </Card>
        </Reveal>
      </div>
    </>
  );
}
