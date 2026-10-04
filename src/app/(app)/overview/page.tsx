"use client";

// หน้าภาพรวม — จุดเริ่มต้นของผู้ใช้ใหม่: เช็กลิสต์เริ่มต้นใช้งาน + สถานะระบบแบบเห็นภาพรวม
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getAdminAccess } from "@/components/admin-access";
import { CircuitsBanner } from "@/components/CircuitsBanner";
import { ProgressRing, Stepper } from "@/components/ui/Stepper";
import { openTour } from "@/components/ui/Tour";
import {
  Badge, Button, Callout, Card, CardHeader, CodeBlock, CountUp, LinkButton,
  PageHeader, Reveal, SectionTitle, Stat, Tabs,
} from "@/components/ui/ui";
import {
  IconAlert, IconArrowRight, IconBook, IconChat, IconCheck, IconCube, IconKey, IconPlug, IconPulse, IconSparkle,
} from "@/components/ui/icons";
import { computeOnboarding } from "@/lib/onboarding";
import type { OnboardingState } from "@/lib/onboarding";
import type { OpenRouterKeyStatus } from "@/lib/openrouter-key-status";

// ---------- data ----------

interface Health {
  checks: {
    providers: { total: number; available: number };
    gateway: { recentSuccessRate: number; avgLatencyMs: number };
    minServingModels: number;
  };
  alerts: string[];
}

interface Savings {
  totalRequests: number;
  todayRequests: number;
  totalSavedThb: number;
  providers: Array<{ id: string; label: string; costThb: number }>;
}

interface HomeData {
  loaded: boolean;
  health: Health | null;
  savings: Savings | null;
  providersWithKey: number;
  clientConnected: boolean;
}

const INITIAL: HomeData = { loaded: false, health: null, savings: null, providersWithKey: 0, clientConnected: false };
const POLL_MS = 30_000;

// /api/health ตอบ 503 พร้อม JSON เมื่อระบบ "down" — ยังต้องอ่านค่ามาแสดงเตือน
async function getJson<T>(url: string, accept503 = false): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", credentials: "include" });
    return res.ok || (accept503 && res.status === 503) ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function useHomeData(): HomeData {
  const [data, setData] = useState<HomeData>(INITIAL);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [health, savings, isAdmin] = await Promise.all([
        getJson<Health>("/api/health", true),
        getJson<Savings>("/api/cost-savings"),
        getAdminAccess(),
      ]);
      // /api/setup และ /api/admin/keys เปิดให้เฉพาะแอดมิน (คนอื่นได้ 401) — ไม่ต้องยิงถ้าไม่ใช่แอดมิน
      const [setup, keys] = isAdmin
        ? await Promise.all([getJson<Array<{ hasDbKey: boolean }>>("/api/setup"), getJson<unknown[]>("/api/admin/keys")])
        : [null, null];
      if (!alive) return;
      setData((prev) => ({
        loaded: true,
        health: health ?? prev.health,
        savings: savings ?? prev.savings,
        providersWithKey: Array.isArray(setup)
          ? setup.filter((r) => r.hasDbKey).length
          // ponytail: non-owners can't read /api/setup — models passing the exam imply at least one key
          : !isAdmin && health ? (health.checks.minServingModels > 0 ? 1 : 0) : prev.providersWithKey,
        clientConnected: !isAdmin ? false : Array.isArray(keys) ? keys.length > 0 : prev.clientConnected,
      }));
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return data;
}

// base URL ต้องรู้ origin ของเบราว์เซอร์ — useSyncExternalStore กัน hydration mismatch
const subscribeNoop = () => () => {};
const useOrigin = () => useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "https://your-domain");

// ---------- page ----------

export default function HomePage() {
  const data = useHomeData();
  const onboarding = data.loaded
    ? computeOnboarding({
        providersWithKey: data.providersWithKey,
        modelsPassed: data.health?.checks.minServingModels ?? 0,
        successfulRequests: data.savings?.totalRequests ?? 0,
        clientConnected: data.clientConnected,
      })
    : null;
  const current = onboarding?.steps.find((s) => s.id === onboarding.currentId);

  return (
    <>
      <PageHeader
        eyebrow="BCAiRouter"
        title="AI Gateway ฟรี ที่เลือกโมเดลให้อัตโนมัติ"
        description="ใส่ API key ฟรีของผู้ให้บริการ แล้วใช้งานผ่านที่อยู่เดียว — ระบบสอบคัดเลือก เลือก และสลับโมเดลให้เองตลอดเวลา"
        actions={
          <>
            {!onboarding ? (
              <span className="skeleton h-10 w-40 rounded-xl" aria-hidden />
            ) : (
              <LinkButton href={current?.href ?? "/playground"} variant="primary">
                {current?.cta ?? "ทดลองแชท"} <IconArrowRight size={16} />
              </LinkButton>
            )}
            <Button type="button" onClick={openTour}>
              <IconSparkle size={16} /> ทัวร์แนะนำ
            </Button>
          </>
        }
      />

      <div className="space-y-8">
        <Reveal i={0}>
          <GettingStarted state={onboarding} />
        </Reveal>

        {data.health && data.health.alerts.length > 0 && (
          <Reveal i={1}>
            <AlertsCallout alerts={data.health.alerts} />
          </Reveal>
        )}

        {/* owner-only; renders nothing when no circuit is open */}
        <CircuitsBanner />

        {/* owner-only; renders nothing unless the OpenRouter key status is warn/alert */}
        <OpenRouterBanner />

        <Reveal i={2}>
          <SectionTitle title="สถานะตอนนี้" description="อัปเดตอัตโนมัติทุก 30 วินาที" />
          <Kpis data={data} />
        </Reveal>

        <Reveal i={3}>
          <ConnectCard />
        </Reveal>

        <Reveal i={4}>
          <SectionTitle title="ไปต่อที่ไหน" description="เลือกหน้าที่ต้องการใช้งานต่อได้เลย" />
          <QuickLinks />
        </Reveal>
      </div>
    </>
  );
}

// ---------- getting started ----------

function GettingStarted({ state }: { state: OnboardingState | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!state) {
    return (
      <Card className="p-5 sm:p-6" aria-busy="true">
        <div className="flex items-center gap-5">
          <span className="skeleton h-[76px] w-[76px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <span className="skeleton block h-5 w-40" />
            <span className="skeleton block h-3 w-64 max-w-full" />
          </div>
        </div>
        <div className="mt-6 space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <span className="skeleton h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2 pt-1">
                <span className="skeleton block h-4 w-1/3" />
                <span className="skeleton block h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const allDone = state.currentId === null;
  return (
    <Card glow={allDone} className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <ProgressRing percent={state.percent} />
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-tight text-white">
              {allDone ? "พร้อมใช้งานแล้ว" : "เริ่มต้นใช้งาน"}
            </h2>
            {allDone && <IconSparkle size={18} className="animate-pop text-violet-200" />}
            <Badge tone={allDone ? "success" : "accent"} dot={!allDone}>
              {state.completed}/{state.total} ขั้นตอน
            </Badge>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
            {allDone
              ? "ทำครบทุกขั้นตอนแล้ว — ส่งคำขอมาที่ BCAiRouter ด้วย model bcai/auto ได้เลย"
              : "ทำตามทีละขั้น ระบบจะติ๊กให้เองเมื่อคุณทำเสร็จ ไม่ต้องกดยืนยัน"}
          </p>
        </div>
        {allDone && (
          <Button type="button" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "ซ่อนขั้นตอน" : "ดูขั้นตอนทั้งหมด"}
          </Button>
        )}
      </div>
      {(!allDone || expanded) && (
        <div className="mt-6 border-t border-white/5 pt-6">
          <Stepper steps={state.steps} />
        </div>
      )}
    </Card>
  );
}

// ---------- alerts ----------

// แปลงข้อความเตือนจาก /api/health เป็นคำแนะนำภาษาง่าย ๆ (ตรวจจากคำสำคัญ)
const ALERT_ADVICE: Array<[RegExp, string]> = [
  [/model พร้อมใช้/, "ยังไม่มีโมเดลที่สอบผ่าน — ตรวจว่าใส่ API key แล้ว (ที่หน้า API key ผู้ให้บริการ) แล้วรอระบบสอบคัดเลือกประมาณ 1–3 นาที"],
  [/cooldown/, "ผู้ให้บริการอาจจำกัดจำนวนคำขอชั่วคราว — รอสักครู่ หรือเพิ่ม key ของผู้ให้บริการเจ้าอื่นเพื่อกระจายโหลด"],
  [/Success rate/, "คำขอล่าสุดล้มเหลวบ่อย — ดูสาเหตุที่หน้ามอนิเตอร์ หรือเพิ่ม key ผู้ให้บริการเพื่อให้มีโมเดลสำรอง"],
  [/Worker/, "ตัวสอบโมเดลเบื้องหลังไม่ได้ทำงาน — ผลสอบอาจเก่า ดูสถานะที่หน้ามอนิเตอร์"],
  [/Redis/, "Redis มีปัญหา — แคชและการล็อกของ worker จะไม่ทำงาน ตรวจว่า container Redis ยังรันอยู่"],
  [/Database/, "ฐานข้อมูลช้าหรือเชื่อมต่อไม่ได้ — ตรวจว่า container Postgres ยังรันอยู่"],
];

function OpenRouterBanner() {
  const [status, setStatus] = useState<OpenRouterKeyStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!(await getAdminAccess())) return; // /api/openrouter-status is 401 for non-owners
      const d = await getJson<OpenRouterKeyStatus>("/api/openrouter-status");
      if (alive && d) setStatus(d);
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!status || (status.level !== "warn" && status.level !== "alert")) return null;
  const body = (
    <>
      <ul className="mt-1 space-y-0.5">
        {status.messages.slice(0, 2).map((m) => <li key={m}>{m}</li>)}
      </ul>
      <Link href="/setup" className="mt-2 inline-flex items-center gap-1 font-medium text-white underline-offset-4 hover:underline">
        เปิดหน้าตั้งค่า <IconArrowRight size={14} />
      </Link>
    </>
  );
  return status.level === "alert" ? (
    <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3.5 text-[13px] leading-relaxed text-rose-100">
      <div className="flex items-center gap-2 font-semibold text-white">
        <IconAlert size={18} className="shrink-0 text-rose-300" /> OpenRouter: ตรวจพบเงินถูกตัด{status.disabledByTripwire ? " — ระบบปิดให้แล้ว" : ""}
      </div>
      {body}
    </div>
  ) : (
    <Callout tone="warning" title="OpenRouter: บัญชีนี้อาจเสียเงินได้">{body}</Callout>
  );
}

function AlertsCallout({ alerts }: { alerts: string[] }) {
  return (
    <Callout tone="warning" title={`พบ ${alerts.length} เรื่องที่ควรตรวจสอบ`}>
      <ul className="mt-1.5 space-y-2.5">
        {alerts.map((a) => {
          const advice = ALERT_ADVICE.find(([re]) => re.test(a))?.[1];
          return (
            <li key={a}>
              <div className="font-medium text-white">{a}</div>
              {advice && <div className="mt-0.5 opacity-90">{advice}</div>}
            </li>
          );
        })}
      </ul>
      <Link href="/monitor" className="mt-3 inline-flex items-center gap-1 font-medium text-white underline-offset-4 hover:underline">
        เปิดหน้ามอนิเตอร์ <IconArrowRight size={14} />
      </Link>
    </Callout>
  );
}

// ---------- KPIs ----------

// ตัวเลขเงินแสดงผลอย่างเดียว (ค่าประมาณจากเซิร์ฟเวอร์) — ห้ามนำข้อความนี้กลับไปคำนวณ
const fmtBaht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Kpis({ data }: { data: HomeData }) {
  const { health, savings, loaded } = data;
  const prov = health?.checks.providers;
  const gw = health?.checks.gateway;
  // gateway_logs ว่าง => API ส่ง 100% / 0ms เป็นค่าเริ่มต้น ไม่ใช่ข้อมูลจริง
  const hasTraffic = (gw?.avgLatencyMs ?? 0) > 0;
  const rateTone = !gw ? "neutral" : gw.recentSuccessRate >= 90 ? "success" : gw.recentSuccessRate >= 50 ? "warning" : "danger";
  const gpt = savings?.providers.find((p) => p.id === "gpt4o");
  const claude = savings?.providers.find((p) => p.id === "claude");

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5">
      <Stat
        label="โมเดลพร้อมใช้"
        loading={!loaded}
        icon={<IconCube size={16} />}
        tone={(health?.checks.minServingModels ?? 0) > 0 ? "success" : "warning"}
        value={prov ? <CountUp value={prov.available} /> : "—"}
        hint={prov ? `จาก ${prov.total} โมเดล · สอบผ่านพร้อมตอบ ${health?.checks.minServingModels ?? 0}` : "ยังโหลดข้อมูลไม่ได้"}
      />
      <Stat
        label="อัตราสำเร็จล่าสุด"
        loading={!loaded}
        icon={<IconCheck size={16} />}
        tone={hasTraffic ? rateTone : "neutral"}
        value={gw && hasTraffic ? <CountUp value={gw.recentSuccessRate} suffix="%" /> : "—"}
        hint={hasTraffic ? "จาก 100 คำขอล่าสุด" : "ยังไม่มีคำขอ"}
      />
      <Stat
        label="ความเร็วเฉลี่ย"
        loading={!loaded}
        icon={<IconPulse size={16} />}
        tone="info"
        value={gw && hasTraffic ? <CountUp value={gw.avgLatencyMs} suffix=" ms" /> : "—"}
        hint={hasTraffic ? "เวลาตอบเฉลี่ยของ 100 คำขอล่าสุด" : "ยังไม่มีคำขอ"}
      />
      <Stat
        label="คำขอวันนี้"
        loading={!loaded}
        icon={<IconChat size={16} />}
        tone="accent"
        value={savings ? <CountUp value={savings.todayRequests} /> : "—"}
        hint={savings ? `ทั้งหมด ${savings.totalRequests.toLocaleString("th-TH")} คำขอ` : undefined}
      />
      <Stat
        label="ประหยัดได้ (ประมาณ)"
        loading={!loaded}
        icon={<IconSparkle size={16} />}
        tone="success"
        value={savings ? <>฿<CountUp value={savings.totalSavedThb} decimals={2} /></> : "—"}
        hint={
          gpt && claude
            ? `ถ้าจ่ายเอง: GPT-4o ฿${fmtBaht(gpt.costThb)} · Claude ฿${fmtBaht(claude.costThb)}`
            : "เทียบราคา API ของ GPT-4o / Claude"
        }
      />
    </div>
  );
}

// ---------- connect your app ----------

type SnippetTab = "curl" | "python" | "js" | "settings";

const SNIPPET_TABS: Array<{ id: SnippetTab; label: string }> = [
  { id: "curl", label: "curl" },
  { id: "python", label: "Python" },
  { id: "js", label: "JavaScript" },
  { id: "settings", label: "OpenAI-compatible" },
];

const KEY_PLACEHOLDER = "<API key ของคุณ>";

function buildSnippet(tab: SnippetTab, baseUrl: string): { label: string; code: string } {
  switch (tab) {
    case "curl":
      return {
        label: "ส่งข้อความด้วย curl",
        code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bcai/auto",
    "messages": [{"role": "user", "content": "สวัสดี"}]
  }'`,
      };
    case "python":
      return {
        label: "Python (pip install openai)",
        code: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${KEY_PLACEHOLDER}",
)

res = client.chat.completions.create(
    model="bcai/auto",
    messages=[{"role": "user", "content": "สวัสดี"}],
)
print(res.choices[0].message.content)`,
      };
    case "js":
      return {
        label: "JavaScript (npm i openai)",
        code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${KEY_PLACEHOLDER}",
});

const res = await client.chat.completions.create({
  model: "bcai/auto",
  messages: [{ role: "user", content: "สวัสดี" }],
});
console.log(res.choices[0].message.content);`,
      };
    case "settings":
      return {
        label: "ตั้งค่าในแอปที่รองรับ OpenAI-compatible",
        code: `Base URL : ${baseUrl}
API key  : ${KEY_PLACEHOLDER}
Model    : bcai/auto`,
      };
  }
}

const VIRTUAL_MODELS: Array<{ id: string; name: string; desc: string }> = [
  { id: "bcai/auto", name: "เลือกให้อัตโนมัติ", desc: "ระบบเลือกโมเดลที่เหมาะที่สุดในตอนนั้นให้เอง — ค่าแนะนำสำหรับเริ่มต้น" },
  { id: "bcai/fast", name: "เร็วสุด", desc: "เน้นตอบไว เหมาะกับงานสั้น ๆ ที่ไม่ต้องคิดลึก" },
  { id: "bcai/tools", name: "รองรับ tool calling", desc: "เลือกเฉพาะโมเดลที่เรียก function/tool ได้ เหมาะกับ agent" },
  { id: "bcai/thai", name: "เก่งภาษาไทย", desc: "เลือกโมเดลที่ตอบภาษาไทยได้ดี เหมาะกับงานเขียนและแปลไทย" },
  { id: "bcai/consensus", name: "ถามหลายโมเดลแล้วสรุป", desc: "ถามหลายโมเดลพร้อมกันแล้วรวมเป็นคำตอบเดียว ช้ากว่าแต่รอบคอบกว่า" },
];

function ConnectCard() {
  const [tab, setTab] = useState<SnippetTab>("curl");
  const baseUrl = `${useOrigin()}/v1`;
  const snippet = buildSnippet(tab, baseUrl);

  return (
    <Card id="connect">
      <CardHeader
        icon={<IconPlug size={18} />}
        title="เชื่อมแอปของคุณ"
        subtitle="แอปหรือเครื่องมือที่รองรับ OpenAI API ใช้ได้ทันที — แค่เปลี่ยน base URL, API key และชื่อ model"
        action={
          <LinkButton href="/admin/keys" size="sm">
            <IconKey size={14} /> สร้าง API key
          </LinkButton>
        }
      />
      <div className="space-y-5 p-5">
        <Tabs tabs={SNIPPET_TABS} value={tab} onChange={setTab} />
        <CodeBlock code={snippet.code} label={snippet.label} />
        <Callout tone="info" title="ยังไม่มี API key?">
          สร้างได้ที่หน้า API key ของแอป แล้วแทนที่ {KEY_PLACEHOLDER} ในตัวอย่าง — เก็บ key เป็นความลับ อย่าฝังในโค้ดฝั่งเบราว์เซอร์
        </Callout>

        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-white">เลือก model ตามลักษณะงาน</h3>
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[420px] text-left text-[13px]">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Model</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">ใช้เมื่อไหร่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {VIRTUAL_MODELS.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-4 py-3 align-top">
                      <code className="rounded-md bg-violet-400/10 px-1.5 py-0.5 font-mono text-[12px] text-violet-200">{m.id}</code>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{m.name}</div>
                      <div className="mt-0.5 text-[var(--muted)]">{m.desc}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- quick links ----------

const QUICK_LINKS = [
  { href: "/playground", title: "ทดลองแชท", desc: "คุยกับ AI และดูว่าระบบเลือกโมเดลไหนตอบ", Icon: IconChat },
  { href: "/models", title: "โมเดล & อันดับ", desc: "ดูผลสอบและอันดับโมเดลทั้งหมดที่ระบบรู้จัก", Icon: IconCube },
  { href: "/monitor", title: "มอนิเตอร์", desc: "ติดตามคำขอ ความเร็ว และอัตราสำเร็จแบบเรียลไทม์", Icon: IconPulse },
  { href: "/guide", title: "คู่มือ", desc: "ตัวอย่างโค้ดและวิธีเชื่อมกับแอปต่าง ๆ", Icon: IconBook },
];

function QuickLinks() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
      {QUICK_LINKS.map(({ href, title, desc, Icon }) => (
        <Link key={href} href={href} className="card card-hover group flex flex-col gap-3 p-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
            <Icon size={18} />
          </span>
          <div>
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-white">
              {title}
              <IconArrowRight size={14} className="opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100" />
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{desc}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
