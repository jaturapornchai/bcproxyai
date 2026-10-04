"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Badge, Callout, Card, CodeBlock, LinkButton, PageHeader, Reveal, Tabs } from "@/components/ui/ui";
import {
  IconAlert,
  IconArrowRight,
  IconBook,
  IconCheck,
  IconChat,
  IconCompass,
  IconCube,
  IconHome,
  IconLock,
  IconPlug,
  IconPulse,
  IconServer,
  IconSparkle,
  IconX,
} from "@/components/ui/icons";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

// ─── Layout primitives ───────────────────────────────────────────────────────

function Section({ id, i = 0, icon, title, summary, children }: { id: string; i?: number; icon: ReactNode; title: string; summary?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <Reveal i={i}>
        <div className="card p-5 sm:p-7">
          <div className="mb-5 flex items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
              {icon}
            </span>
            <div className="min-w-0">
              <h2 className="text-[19px] font-semibold tracking-tight text-white">{title}</h2>
              {summary && <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]">{summary}</p>}
            </div>
          </div>
          <div className="space-y-4">{children}</div>
        </div>
      </Reveal>
    </section>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-7 flex items-center gap-2 text-[15px] font-semibold text-white first:mt-0">
      <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-full bg-gradient-to-b from-violet-400 to-cyan-300" />
      {children}
    </h3>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[13.5px] leading-relaxed text-gray-300">{children}</p>;
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-violet-200 ring-1 ring-inset ring-white/10 [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

const linkCls = "rounded-sm text-violet-300 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400";

function A({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className={linkCls}>{children}</Link>;
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={linkCls}>{children}</a>;
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-gray-300 marker:text-violet-300">{children}</ul>;
}

function DocTable({ head, rows }: { head?: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[480px] text-left text-[13px]">
        {head && (
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.08em] text-[var(--muted)]">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-white/5 text-gray-300">
          {rows.map((r, ri) => (
            <tr key={ri} className="transition-colors hover:bg-white/[0.025]">
              {r.map((c, ci) => (
                <td key={ci} className="px-4 py-2.5 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical numbered step with a connector line to the next one. */
function Step({ num, title, last, children }: { num: number; title: string; last?: boolean; children: ReactNode }) {
  return (
    <div className="relative pl-12">
      <span className="absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-[13px] font-bold text-white shadow-[0_6px_18px_-6px_rgba(139,123,255,0.9)]">
        {num}
      </span>
      {!last && <span aria-hidden className="absolute -bottom-5 left-[15px] top-9 w-px bg-gradient-to-b from-white/20 to-transparent" />}
      <div className="space-y-2">
        <div className="pt-1 text-[14px] font-semibold text-white">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Same code in several variants (language / scenario) behind Tabs. */
function VariantTabs({ items }: { items: Array<{ label: string; note?: ReactNode; code: string }> }) {
  const [id, setId] = useState("0");
  const item = items[Number(id)];
  return (
    <div className="space-y-3">
      <Tabs tabs={items.map((it, n) => ({ id: String(n), label: it.label }))} value={id} onChange={setId} />
      {item.note && <P>{item.note}</P>}
      <CodeBlock key={id} code={item.code} />
    </div>
  );
}

function MiniCard({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3.5">
      <div className={cx("mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]", tone)}>{title}</div>
      <div className="space-y-0.5 text-[12.5px] text-gray-300">{children}</div>
    </div>
  );
}

function Yes() {
  return <Badge tone="success"><IconCheck size={12} />ได้</Badge>;
}
function No() {
  return <Badge tone="danger"><IconX size={12} />ไม่ได้</Badge>;
}

const METHOD_TONE = { GET: "info", POST: "success", PUT: "warning", DELETE: "danger" } as const;

// ─── Code snippets for Quick Connect ─────────────────────────────────────────

type Lang = "nextjs" | "python" | "curl" | "langchain" | "thclaws" | "hermes" | "openclaw" | "any";

function buildSnippets(base: string, key: string): Record<Lang, { label: string; code: string; note?: string }> {
  return {
  nextjs: {
    label: "Next.js / Node",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${base}",
  apiKey: "${key}",
});

// auto — gateway เลือก model ที่ดีที่สุดให้
const chat = await client.chat.completions.create({
  model: "bcai/auto",
  messages: [{ role: "user", content: "สวัสดีครับ" }],
});
console.log(chat.choices[0].message.content);

// tool calling
const tools = await client.chat.completions.create({
  model: "bcai/tools",
  messages: [{ role: "user", content: "กรุงเทพอากาศเป็นยังไง" }],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "ดูสภาพอากาศ",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  }],
});

// streaming
const stream = await client.chat.completions.create({
  model: "bcai/auto",
  messages: [{ role: "user", content: "เล่านิทานสั้นๆ" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
    note: "npm install openai",
  },
  python: {
    label: "Python",
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${base}",
    api_key="${key}",
)

chat = client.chat.completions.create(
    model="bcai/auto",
    messages=[{"role": "user", "content": "สวัสดีครับ"}],
)
print(chat.choices[0].message.content)

# streaming
stream = client.chat.completions.create(
    model="bcai/auto",
    messages=[{"role": "user", "content": "เล่านิทานสั้นๆ"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
    note: "pip install openai",
  },
  curl: {
    label: "cURL",
    code: `curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "bcai/auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}]
  }'

# streaming
curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "bcai/auto",
    "messages": [{"role": "user", "content": "เล่านิทานสั้นๆ"}],
    "stream": true
  }'`,
  },
  langchain: {
    label: "LangChain",
    code: `from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="${base}",
    api_key="${key}",
    model="bcai/auto",
)

response = llm.invoke("สวัสดีครับ")
print(response.content)

# with tools
from langchain_core.tools import tool

@tool
def get_weather(city: str) -> str:
    """ดูสภาพอากาศ"""
    return f"{city}: 35°C แดดจัด"

llm_with_tools = llm.bind_tools([get_weather])
result = llm_with_tools.invoke("กรุงเทพอากาศเป็นยังไง")
print(result.tool_calls)`,
    note: "pip install langchain-openai",
  },
  thclaws: {
    label: "thClaws",
    code: `# thClaws CLI ใน Docker — ให้ BCAiRouter เลือก provider/model จริงเอง
docker run --rm \\
  -e DASHSCOPE_BASE_URL=${base} \\
  -e DASHSCOPE_API_KEY=${key} \\
  -e THCLAWS_DISABLE_KEYCHAIN=1 \\
  -v "$PWD:/workspace" -w /workspace \\
  thclaws-bcairouter:local \\
  -p -m bcai/auto --permission-mode auto \\
  "สรุปโปรเจกต์นี้"

# เลือก virtual model ตามงาน:
#   bcai/auto  = ค่าเริ่มต้น ให้ gateway route เอง
#   bcai/fast  = งานสั้นที่ต้องการ latency ต่ำ
#   bcai/tools = workflow ที่ต้องใช้ function/tool calling
#
# อย่า lock เป็น provider/model เฉพาะ เว้นแต่ต้องการ debug upstream โดยตรง`,
    note: "ใช้ DashScope-compatible env เพื่อชี้ thClaws เข้า OpenAI-compatible BCAiRouter",
  },
  hermes: {
    label: "Hermes Agent",
    code: `# Hermes Agent (Nous Research) — self-improving open-source AI agent
# Windows users: ต้องใช้ WSL2 + Ubuntu (native Windows ยังไม่รองรับ)
#   wsl --install -d Ubuntu-24.04
# macOS / Linux / WSL2: รัน installer ตรงๆ
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc && hermes --version   # → Hermes Agent v0.10.0+

# ── Point Hermes at BCAiRouter (provider = custom) ──
hermes config set model.provider custom
hermes config set model.base_url ${base}
hermes config set model.default bcai/auto
# ใช้ bcai/tools ถ้า workflow ต้องเรียก tools หนัก ๆ

# Hermes อ่าน API key จาก OPENAI_API_KEY ใน .env (custom provider)
cat >> ~/.hermes/.env <<EOF
OPENAI_BASE_URL=${base}
OPENAI_API_KEY=${key}
EOF

# ปิด tool family ที่ยังไม่ได้ config (optional — กัน model ยิง tool แปลกๆ)
hermes config set tools.disabled "browser,discord,homeassistant,messaging,web,rl,image_gen"

# Verify + doctor
hermes config show | grep Model:
hermes doctor

# ── Use it ──
hermes chat -q "run: df -h | head -5"   # one-shot
hermes chat                               # interactive
hermes chat --continue                    # ต่อ session ล่าสุด

# gateway auto-patches [system, tool, ...] message order for Mistral
# และ repair JSON-style tool calls เป็น OpenAI tool_calls shape`,
    note: "ปล่อยให้ BCAiRouter route ผ่าน bcai/auto หรือใช้ bcai/tools เมื่อต้องการ tool calling ชัดเจน",
  },
  openclaw: {
    label: "OpenClaw",
    code: `# Docker — OpenClaw อยู่คนละ container
docker exec <openclaw-container> \\
  openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url ${base.replace("localhost", "host.docker.internal")} \\
  --custom-model-id bcai/auto \\
  --custom-api-key ${key} \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui

# Local — OpenClaw รันบนเครื่องเดียวกัน
openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url ${base} \\
  --custom-model-id bcai/auto \\
  --custom-api-key ${key} \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`,
    note: "Docker ใช้ host.docker.internal แทน localhost",
  },
  any: {
    label: "ทุก Framework",
    code: `Endpoint:    ${base}/chat/completions
API Key:     ${key}
Model:       bcai/auto  (หรือเลือก model เฉพาะ)

รองรับ:
  POST /v1/chat/completions   — Chat (text, vision, tools, stream)
  GET  /v1/models              — รายชื่อ model ทั้งหมด
  GET  /v1/models/search       — ค้นหา model ตาม category, context, tools, ฯลฯ
  POST /v1/embeddings          — Embeddings (provider ที่รองรับ)

ตัวอย่างค้นหา model:
  GET /v1/models/search?category=thai&min_context=200000&top=3
  GET /v1/models/search?category=code&supports_tools=1&top=5
  GET /v1/models/search?category=vision&supports_vision=1&top=3

Dev tools เพิ่มเติม:
  POST /v1/compare                   ยิง prompt ไปหลาย model พร้อมกัน (max 10)
  POST /v1/structured                Chat + JSON schema validation + auto-retry
  GET  /v1/trace/:reqId              ดู log ของ request เดิม (เจ้าของ)
  GET  /api/my-stats?window=24h      สรุปใช้งานของ IP ตัวเอง (p50/p95/p99)
  GET  /v1/prompts                   รายการ system prompts ที่บันทึกไว้ (เจ้าของ)
  POST /v1/prompts                   สร้าง/เขียนทับ { name, content, description? } (เจ้าของ)
  GET|PUT|DELETE /v1/prompts/:name   ดึง/แก้/ลบ (เจ้าของ)

ใช้ prompt ที่บันทึกไว้ในแชท:
  { "model": "bcai/auto", "prompt": "my-prompt-name", "messages": [...] }

Dev controls (headers):
  X-BCAiRouter-Prefer:   groq,cerebras       ดัน provider ขึ้นบน
  X-BCAiRouter-Exclude:  mistral              ตัดออก
  X-BCAiRouter-Max-Latency: 3000              กรอง model ที่ช้าเกิน
  X-BCAiRouter-Strategy: fastest|strongest    หรือใช้ preset

ตัวอย่าง config ใน framework ต่างๆ:
  Vercel AI SDK:  createOpenAI({ baseURL, apiKey: "dummy" })
  LiteLLM:        model="openai/bcai/auto", api_base="..."
  Dify:           Custom Model Provider → OpenAI-compatible
  LobeChat:       Settings → OpenAI → Base URL
  AutoGen:        config_list: [{ base_url, api_key: "dummy" }]
  Continue.dev:   models: [{ provider: "openai", apiBase, apiKey: "${key}" }]`,
  },
  };
}

const LANG_TABS: Lang[] = ["nextjs", "python", "curl", "langchain", "thclaws", "hermes", "openclaw", "any"];

function QuickConnect({ origin, isProd }: { origin: string; isProd: boolean }) {
  const [lang, setLang] = useState<Lang>("nextjs");
  const apiBase = `${origin}/v1`;
  const snippets = buildSnippets(apiBase, isProd ? "<GATEWAY_API_KEY>" : "dummy");
  const snippet = snippets[lang];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {[
          { label: "Base URL", value: apiBase, color: "text-violet-200" },
          { label: "API Key", value: isProd ? "Bearer <key จาก owner>" : "dummy (local ไม่เช็ค)", color: "text-amber-300" },
          { label: "Model", value: "bcai/auto", color: "text-emerald-300" },
        ].map((info) => (
          <div key={info.label} className="min-w-0 rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5">
            <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">{info.label}</div>
            <code className={cx("mt-0.5 block font-mono text-[13px] [overflow-wrap:anywhere]", info.color)}>{info.value}</code>
          </div>
        ))}
      </div>

      <Tabs tabs={LANG_TABS.map((t) => ({ id: t, label: snippets[t].label }))} value={lang} onChange={setLang} />
      <CodeBlock key={lang} code={snippet.code} label={snippet.label} />
      {snippet.note && <p className="text-[12.5px] text-amber-300/90">* {snippet.note}</p>}
    </div>
  );
}

// ─── Navigation (TOC + scroll-spy) ───────────────────────────────────────────

const NAV_GROUPS = [
  {
    title: "เริ่มต้น",
    items: [
      { id: "quickstart", label: "เริ่มต้นใน 3 นาที" },
      { id: "quick-connect", label: "เชื่อมต่อเร็ว" },
      { id: "overview", label: "ภาพรวมระบบ" },
    ],
  },
  {
    title: "ใช้งาน",
    items: [
      { id: "models", label: "โมเดลพิเศษ" },
      { id: "install", label: "ติดตั้ง" },
      { id: "auth", label: "ยืนยันตัวตน" },
    ],
  },
  {
    title: "เชื่อมต่อ client",
    items: [
      { id: "thclaws", label: "thClaws" },
      { id: "openclaw", label: "OpenClaw" },
      { id: "hermes", label: "Hermes Agent" },
    ],
  },
  {
    title: "อ้างอิง",
    items: [
      { id: "api", label: "API Reference" },
      { id: "dev-tools", label: "Dev Tools" },
      { id: "benchmark", label: "ระบบสอบ" },
      { id: "troubleshoot", label: "แก้ปัญหา" },
    ],
  },
];
const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const NAV_IDS = NAV_ITEMS.map((n) => n.id);

function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

/** Highlights the first section currently inside the upper reading band of the viewport. */
function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-96px 0px -60% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids]);
  return active;
}

function Toc({ active, onNavigate }: { active: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="สารบัญคู่มือ" className="space-y-5">
      {NAV_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{g.title}</div>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const on = item.id === active;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={on ? "location" : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate?.();
                      // wait one frame so a collapsing mobile TOC doesn't shift the scroll target
                      requestAnimationFrame(() => goTo(item.id));
                    }}
                    className={cx(
                      "relative block rounded-lg px-3 py-1.5 text-[13px] transition-colors before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-violet-400 before:transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400",
                      on ? "bg-violet-400/10 font-medium text-white before:opacity-100" : "text-[var(--muted)] before:opacity-0 hover:bg-white/5 hover:text-gray-200",
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// Every code block swaps in the real server origin so docs stay accurate when
// the droplet / domain moves. Server snapshot = "" → localhost placeholder on SSR.
const noopSubscribe = () => () => {};
function useOrigin() {
  const o = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
  const isProd = o !== "" && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(o);
  return { origin: isProd ? o : "http://localhost:3334", isProd };
}

// ─── Main page ───────────────────────────────────────────────────────────────

function QuickStepCard({ n, title, href, cta, onCta, children }: { n: number; title: string; href?: string; cta: string; onCta?: () => void; children: ReactNode }) {
  const ctaCls = "mt-auto inline-flex items-center gap-1.5 pt-3 text-[13px] font-medium text-violet-300 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400";
  return (
    <Card hover className="flex flex-col p-5">
      <span className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 text-[14px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(139,123,255,0.9)]">
        {n}
      </span>
      <div className="text-[14.5px] font-semibold text-white">{title}</div>
      <div className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{children}</div>
      {href ? (
        <Link href={href} className={ctaCls}>{cta} <IconArrowRight size={14} /></Link>
      ) : (
        <button type="button" onClick={onCta} className={ctaCls}>{cta} <IconArrowRight size={14} /></button>
      )}
    </Card>
  );
}

function LevelCard({ dot, name, detail, isDefault }: { dot: string; name: string; detail: string; isDefault?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/25 p-3.5">
      <span aria-hidden className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 text-[13px]">
        <div className="flex flex-wrap items-center gap-2 font-semibold text-white">
          {name}
          {isDefault && <Badge tone="accent">default</Badge>}
        </div>
        <div className="mt-0.5 text-gray-300">{detail}</div>
      </div>
    </div>
  );
}

export default function GuidePage() {
  const { origin: apiBase, isProd } = useOrigin();
  const active = useScrollSpy(NAV_IDS);
  const [tocOpen, setTocOpen] = useState(false);
  const activeLabel = NAV_ITEMS.find((n) => n.id === active)?.label;

  return (
    <>
      <PageHeader
        eyebrow="คู่มือ & ตัวอย่างโค้ด"
        title="คู่มือ BCAiRouter"
        description={
          <>
            AI Gateway รวมผู้ให้บริการ AI ฟรี 30+ เจ้าไว้ที่เดียว — OpenAI-compatible API
            เชื่อมต่อ OpenAI SDK, LangChain, thClaws, Hermes Agent, OpenClaw ได้ทุก framework
            ใช้ <InlineCode>bcai/auto</InlineCode> ระบบเลือก model ที่ดีที่สุดให้อัตโนมัติ
          </>
        }
        actions={
          <>
            <LinkButton href="/playground">ทดลองแชท</LinkButton>
            <a href="https://github.com/jaturapornchai/bcproxyai" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
              GitHub <IconArrowRight size={14} />
            </a>
          </>
        }
      />

      <Reveal i={1}>
        <Callout title="Local กับ Production ต่างกันที่ API key">
          <strong>Local</strong>: ไม่มี auth ใช้ <InlineCode>apiKey: &quot;dummy&quot;</InlineCode> ได้เลย &middot;{" "}
          <strong>Production</strong>: ต้องใช้ Bearer key (<InlineCode>GATEWAY_API_KEY</InlineCode> จาก owner)
          หรือ login ด้วย Google เข้าใช้ UI อย่างเดียว — endpoint <InlineCode>/v1/*</InlineCode> จำกัดเฉพาะ owner
        </Callout>
      </Reveal>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[216px_minmax(0,1fr)] lg:gap-10">
        {/* TOC: collapsible card on mobile, sticky rail on desktop */}
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <div className="card lg:hidden">
            <button
              type="button"
              onClick={() => setTocOpen((o) => !o)}
              aria-expanded={tocOpen}
              aria-controls="guide-toc-mobile"
              className="flex w-full items-center justify-between gap-3 rounded-[inherit] px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            >
              <span className="min-w-0">
                <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">สารบัญ</span>
                <span className="block truncate text-[14px] font-medium text-white">กำลังอ่าน: {activeLabel}</span>
              </span>
              <IconArrowRight size={16} className={cx("shrink-0 text-[var(--muted)] transition-transform duration-300", tocOpen ? "-rotate-90" : "rotate-90")} />
            </button>
            {tocOpen && (
              <div id="guide-toc-mobile" className="animate-page border-t border-white/10 px-2 py-4">
                <Toc active={active} onNavigate={() => setTocOpen(false)} />
              </div>
            )}
          </div>
          <div className="hidden lg:block">
            <Toc active={active} />
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <Section
            id="quickstart"
            i={2}
            icon={<IconSparkle size={20} />}
            title="เริ่มต้นใน 3 นาที"
            summary="ทำตาม 3 ขั้นนี้ แล้วแอปของคุณจะเรียก AI ฟรีผ่าน API เดียวได้ทันที"
          >
            <div className="grid gap-3 md:grid-cols-3">
              <QuickStepCard n={1} title="ใส่ API key ของผู้ให้บริการ" href="/setup" cta="ไปหน้า Setup">
                วาง key ของ provider ที่มี (ไม่ต้องครบทุกเจ้า) กดปุ่ม <strong className="text-gray-200">Test</strong> เช็คก่อน save ได้
              </QuickStepCard>
              <QuickStepCard n={2} title="เตรียม API key สำหรับแอป" href="/admin/keys" cta="ไปหน้า API key ของแอป">
                Production ใช้ Bearer key <InlineCode>bcai_live_...</InlineCode> ที่ออกจากหน้านี้ · Local ใช้ <InlineCode>dummy</InlineCode> ได้เลย
              </QuickStepCard>
              <QuickStepCard n={3} title="ชี้แอปมาที่ Base URL" cta="ดูตัวอย่างโค้ด" onCta={() => goTo("quick-connect")}>
                ตั้ง <InlineCode>baseURL</InlineCode> เป็น <InlineCode>{apiBase}/v1</InlineCode> และใช้ model <InlineCode>bcai/auto</InlineCode> — ระบบเลือก model ที่ดีที่สุดให้
              </QuickStepCard>
            </div>
            <Callout tone="success" title="อยากลองก่อนเขียนโค้ด?">
              เปิด <A href="/playground">ทดลองแชท</A> เพื่อคุยกับ <InlineCode>bcai/auto</InlineCode> ได้ทันที — ถ้าตอบกลับมา แปลว่าระบบพร้อมใช้งาน
            </Callout>
          </Section>

          <Section
            id="quick-connect"
            i={3}
            icon={<IconPlug size={20} />}
            title="เชื่อมต่อเร็ว"
            summary="เลือกภาษา/เครื่องมือที่ใช้ แล้วกดคัดลอกโค้ดไปวางได้เลย"
          >
            <P>
              BCAiRouter เป็น OpenAI-compatible API — client library ทุกตัวที่ใช้ OpenAI SDK ได้
              ชี้ <InlineCode>baseURL</InlineCode> มาที่ <InlineCode>{apiBase}/v1</InlineCode> ก็ใช้ได้ทันที
            </P>
            <QuickConnect origin={apiBase} isProd={isProd} />
          </Section>

          <Section id="overview" icon={<IconHome size={20} />} title="ภาพรวมระบบ" summary="ระบบทำงานอย่างไรเบื้องหลัง">
            <P>
              BCAiRouter เป็น &ldquo;ตัวกลาง&rdquo; ระหว่าง client กับ AI provider ฟรี 26 เจ้า
              (OpenRouter, Kilo, Google, Groq, Cerebras, SambaNova, Mistral, Ollama, GitHub,
              Fireworks, Cohere, Cloudflare, HuggingFace, NVIDIA, Chutes, LLM7, Scaleway,
              Pollinations, Ollama Cloud, SiliconFlow, glhf, Together, Hyperbolic, Z.AI,
              Alibaba Qwen, Reka)
            </P>
            <P>
              ระบบมี worker หลังบ้านคอย scan model ใหม่ ทดสอบสอบวัดผลตามระดับที่ตั้งไว้
              (ประถม/มัธยมต้น/มัธยมปลาย/มหาลัย) และเลือกครู (teachers) ที่เก่งในแต่ละหมวดไว้เป็น grader
            </P>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MiniCard title="Ports" tone="text-emerald-300">
                <div className="font-mono">3333 — external Caddy (300s timeout)</div>
                <div className="font-mono">3334 — in-compose Caddy (LB)</div>
                <div className="font-mono">5434 — Postgres</div>
                <div className="font-mono">6382 — Redis</div>
              </MiniCard>
              <MiniCard title="Worker cycle" tone="text-violet-300">
                <div>ทุก 15 นาที:</div>
                <div>1. Scan providers</div>
                <div>2. Health check + exam</div>
                <div>3. Appoint teachers</div>
              </MiniCard>
              <MiniCard title="Warmup" tone="text-amber-300">
                <div>ทุก 2 นาที:</div>
                <div>ping model ที่ผ่านสอบ</div>
                <div>รักษา connection warm</div>
              </MiniCard>
            </div>
          </Section>

          <Section id="models" icon={<IconCube size={20} />} title="โมเดลพิเศษ (Virtual Models)" summary="ชื่อลัดที่ให้ gateway เลือก model จริงแทนคุณ">
            <P>
              ไม่ใช่ model จริง แต่เป็น &ldquo;ชื่อลัด&rdquo; ที่ gateway จะเลือก model จริงให้อัตโนมัติตามบริบท
            </P>
            <DocTable
              head={["Model", "คำอธิบาย"]}
              rows={[
                ["bcai/auto", "เลือก model ที่ดีที่สุดอัตโนมัติ — แนะนำใช้ตัวนี้"],
                ["bcai/fast", "เลือกตัวที่ latency ต่ำสุด (สำหรับงานสั้นๆ ต้องการคำตอบเร็ว)"],
                ["bcai/tools", "เลือกเฉพาะ model ที่รองรับ tool/function calling"],
                ["bcai/thai", "เลือก model ที่เก่งภาษาไทย (คะแนน exam หมวด thai สูงสุด)"],
                ["bcai/consensus", "ส่งไปหลาย model พร้อมกัน เปรียบเทียบคำตอบ"],
              ].map(([id, desc]) => [<InlineCode key={id}>{id}</InlineCode>, desc])}
            />
            <Callout title="ใช้ bcai/auto อย่างเดียวก็พอ">
              ถ้า request มี <InlineCode>tools</InlineCode>, <InlineCode>image_url</InlineCode>, หรือ <InlineCode>response_format</InlineCode>{" "}
              ระบบจะ auto-detect แล้วเลือก model ที่รองรับให้
            </Callout>

            <SubTitle>เจาะจง model ตรงๆ</SubTitle>
            <P>ถ้าอยากใช้ model เฉพาะตัว ระบุ provider + model ID ได้:</P>
            <CodeBlock code={`groq/llama-3.3-70b-versatile
openrouter/qwen/qwen3-coder:free
cerebras/qwen-3-235b-a22b-instruct-2507
mistral/mistral-large-2411`} />

            <SubTitle>Thai-native models (ของคนไทย)</SubTitle>
            <P>2 providers ฟรี — สมัครที่ <A href="/setup">/setup</A> แล้วเรียกตรงๆ:</P>
            <CodeBlock code={`# Typhoon (SCB 10X) — sign up: https://opentyphoon.ai
typhoon/typhoon-v2.5-30b-a3b-instruct

# ThaiLLM (NSTDA national platform) — sign up: https://playground.thaillm.or.th
# 4 โมเดลของคนไทยใต้ endpoint เดียว:
thaillm/OpenThaiGPT-ThaiLLM-8B-Instruct-v7.2     # AIEAT
thaillm/Typhoon-S-ThaiLLM-8B-Instruct            # SCB 10X
thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0    # NECTEC — มี thinking!
thaillm/THaLLE-0.2-ThaiLLM-8B-fa                 # KBTG`} />

            <SubTitle>Thinking / Reasoning Mode</SubTitle>
            <P>
              Gateway <strong className="text-white">auto-enable</strong> สำหรับ model ที่ scan แล้วพบว่ารองรับ reasoning
              (เก็บใน <InlineCode>models.supports_reasoning</InlineCode>):
            </P>
            <Bullets>
              <li><strong className="text-white">Source 1:</strong> OpenRouter metadata <InlineCode>supported_parameters</InlineCode> includes <InlineCode>reasoning</InlineCode></li>
              <li><strong className="text-white">Source 2:</strong> regex จับชื่อ model — <InlineCode>qwen3 / o1 / o3 / o4 / deepseek-r1 / thinking / magistral / pathumma-think / lfm-thinking</InlineCode></li>
            </Bullets>

            <P>เวลายิง gateway จะใส่ให้เอง:</P>
            <CodeBlock code={`{
  "reasoning": { "effort": "medium" },     // OpenRouter / Anthropic / OpenAI o-series
  "enable_thinking": true,                  // Qwen3 / DashScope / vLLM
  "max_tokens": 2000                        // เผื่อพื้นที่ trace
}`} />

            <P><strong className="text-white">Opt-out</strong> (ถ้าไม่อยากให้ thinking):</P>
            <CodeBlock code={`{
  "model": "thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0",
  "messages": [...],
  "reasoning": false      // หรือ "enable_thinking": false
}`} />

            <Callout title="ดูในบันทึกการทำงานของ worker (มอนิเตอร์ › ระบบ)">
              log exam ที่ใช้ thinking mode จะมี 🧠 tag กำกับ:
              <code className="mt-1 block font-mono text-[12px] [overflow-wrap:anywhere]">📝 เริ่มสอบ [middle] 🧠 thinking: thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0</code>
            </Callout>
          </Section>

          <Section id="install" icon={<IconServer size={20} />} title="ติดตั้ง" summary="ติดตั้งและรันด้วย Docker Compose ทีละขั้น">
            <SubTitle>วิธีที่แนะนำ — Docker Compose</SubTitle>
            <div className="space-y-6">
              <Step num={1} title="ติดตั้ง Docker Desktop">
                <P>
                  ดาวน์โหลดจาก <InlineCode>https://www.docker.com/products/docker-desktop/</InlineCode>{" "}
                  ติดตั้งแล้วเปิดค้างไว้ (ต้องเห็นวาฬสีเขียว)
                </P>
              </Step>
              <Step num={2} title="Clone + ตั้งค่า">
                <CodeBlock code={`git clone <repo-url> bcai-router
cd bcai-router
cp .env.example .env.local`} />
                <P>แก้ <InlineCode>.env.local</InlineCode> ใส่ API key ของ provider ที่อยากใช้ (ไม่ต้องใส่ครบทุกตัว)</P>
              </Step>
              <Step num={3} title="Build + Start">
                <CodeBlock code={`docker compose up -d --build`} />
                <P>รอ build ครั้งแรก 3-10 นาที จากนั้นเปิด <InlineCode>{apiBase}/</InlineCode></P>
              </Step>
              <Step num={4} title="ใส่ API keys ผ่านหน้าเว็บ">
                <P>
                  ไปที่หน้า <A href="/setup">API key ผู้ให้บริการ</A> ใส่ API key ของแต่ละ provider
                  (หรือกดปุ่ม <strong className="text-white">Test</strong> ข้างๆ เพื่อเช็คว่า key ใช้ได้ก่อน save)
                </P>
              </Step>
              <Step num={5} title="รอ worker สแกน" last>
                <P>
                  หลังใส่ key worker จะ scan + exam model อัตโนมัติใน 1-2 นาที
                  (ดู progress ได้จาก “บันทึกการทำงานของ worker” ในหน้า <A href="/monitor#system">มอนิเตอร์ › ระบบ</A>)
                </P>
              </Step>
            </div>

            <SubTitle>Reset ข้อมูล (เริ่มใหม่)</SubTitle>
            <CodeBlock code={`docker compose down
docker volume rm bcai-router_bcai-router-data
docker compose up -d --build`} />
          </Section>

          <Section id="auth" icon={<IconLock size={20} />} title="การยืนยันตัวตน — 3 แบบเลือกใช้" summary="เลือกวิธี login ที่เหมาะกับสภาพแวดล้อมของคุณ">
            <P>
              ระบบรองรับ 3 วิธี login admin. <strong className="text-white">Auto-detect จาก <InlineCode>.env</InlineCode></strong> —
              ตั้ง env ของ method ไหน = method นั้นเปิด. ไม่มี <InlineCode>AUTH_MODE</InlineCode> flag.
            </P>

            <SubTitle>3 แบบ</SubTitle>
            <DocTable
              head={["แบบ", "Trigger env", "เหมาะกับ", "Session"]}
              rows={[
                [
                  <span key="a"><span className="font-bold text-blue-400">①</span> Google OAuth</span>,
                  <span key="b" className="font-mono text-[11px]">GOOGLE_CLIENT_ID<br />+ GOOGLE_CLIENT_SECRET<br />+ NEXTAUTH_SECRET<br />+ NEXTAUTH_URL</span>,
                  "ทีมที่มี Gmail, audit per-email",
                  "JWT 30 วัน",
                ],
                [
                  <span key="a"><span className="font-bold text-amber-400">②</span> Admin Password</span>,
                  <span key="b" className="font-mono text-[11px]">ADMIN_PASSWORD</span>,
                  "ไม่มี Gmail / airgap / break-glass",
                  "HMAC cookie 7 วัน",
                ],
                [
                  <span key="a"><span className="font-bold text-gray-400">③</span> Bearer Key</span>,
                  <span key="b" className="font-mono text-[11px]">GATEWAY_API_KEY</span>,
                  "CI / SDK / curl / automation",
                  "stateless (ใส่ทุก request)",
                ],
              ]}
            />

            <Callout title="Local mode">
              ไม่ตั้ง env ของวิธีใดเลย → UI + API เปิดหมด ไม่มี auth — เหมาะสำหรับ Docker Desktop
            </Callout>

            <SubTitle>3 สถานการณ์ใช้งานจริง</SubTitle>
            <VariantTabs
              items={[
                {
                  label: "A · เครื่องตัวเอง",
                  note: <><strong className="text-white">A) เล่นบนเครื่องตัวเอง</strong> — <InlineCode>.env.local</InlineCode> ปล่อยว่าง</>,
                  code: `# เครื่องส่วนตัว — ไม่มี auth ทุก endpoint เปิด
# ว่างเปล่า = local mode`,
                },
                {
                  label: "B · VPS + Password",
                  note: <><strong className="text-white">B) VPS + Password</strong> — ง่ายสุด ไม่ต้องพึ่ง Google</>,
                  code: `# .env.production บน VPS
GATEWAY_API_KEY=sk-gw-<generate>         # SDK / curl
ADMIN_PASSWORD=<random-24-base64>        # admin UI login (7-day cookie)
AUTH_OWNER_EMAIL=admin@example.com       # metadata (แสดง audit)

# Generate:
#   node -e "console.log('sk-gw-' + require('crypto').randomBytes(32).toString('hex'))"
#   node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[+/=]/g,''))"`,
                },
                {
                  label: "C · VPS + Google OAuth",
                  note: <><strong className="text-white">C) VPS + Domain + HTTPS + Google OAuth</strong> — production-grade</>,
                  code: `# .env.production บน VPS
GATEWAY_API_KEY=sk-gw-<generate>
ADMIN_PASSWORD=<random-24-base64>        # fallback เผื่อ Google ล่ม

AUTH_OWNER_EMAIL=alice@gmail.com,bob@gmail.com,cto@gmail.com
GOOGLE_CLIENT_ID=<google-console>
GOOGLE_CLIENT_SECRET=<google-console>
NEXTAUTH_SECRET=<random-32-base64>
NEXTAUTH_URL=https://your-domain.com

# Google Console redirect URI:
#   {NEXTAUTH_URL}/api/auth/callback/google`,
                },
              ]}
            />

            <SubTitle>Auth chain (first match wins)</SubTitle>
            <CodeBlock code={`/admin/* + mutating /api/*  →  1. Bearer GATEWAY_API_KEY     →  pass
                           →  2. Signed bcai_admin cookie  →  pass  (password)
                           →  3. Google session + owner   →  pass  (OAuth)
                           →  else  →  /login (page) หรือ 401 (API)

/v1/*   →  Bearer sk-gw-* (master) หรือ Bearer bcai_live_* เท่านั้น`} />

            <SubTitle>2 ชนิด Bearer key สำหรับ <InlineCode>/v1/*</InlineCode></SubTitle>
            <DocTable
              head={["Key", "/v1/*", "/api/admin/*", "ที่มา"]}
              rows={[
                [<span key="k"><InlineCode>sk-gw-...</InlineCode> (master)</span>, <Yes key="a" />, <Yes key="b" />, "ตั้งใน .env"],
                [<InlineCode key="k">bcai_live_...</InlineCode>, <Yes key="a" />, <No key="b" />, "admin ออกที่ /admin/keys"],
              ]}
            />

            <SubTitle>Admin ออก key ให้ client</SubTitle>
            <P>
              Admin login (Google หรือ Password) → เข้า <A href="/admin/keys">/admin/keys</A>{" "}
              → กรอก label + expiry (optional) → กด <strong className="text-white">+ สร้าง key</strong>
              → แสดง <InlineCode>bcai_live_...</InlineCode> ครั้งเดียว (copy ส่ง client)
            </P>
            <P>
              Key เก็บใน DB เป็น SHA-256 hash — ดูย้อนหลังไม่ได้, revoke/pause ได้รายตัว, มี <InlineCode>last_used_at</InlineCode> audit
            </P>

            <Callout title="เพิ่ม admin email ใหม่">
              แก้ <InlineCode>AUTH_OWNER_EMAIL</InlineCode> ใน <InlineCode>.env</InlineCode> → restart
              <span className="mt-1 block text-[12.5px]">
                ssh droplet → <InlineCode>nano /opt/bcai-router/.env.production</InlineCode> → <InlineCode>bash scripts/deploy-droplet.sh</InlineCode>
              </span>
            </Callout>

            <SubTitle>Admin API (ops / automation)</SubTitle>
            <P>ทุก endpoint ต้อง auth เหมือนหน้า admin (master Bearer / cookie / Google):</P>
            <CodeBlock code={`# จัดการ gateway keys
GET    /api/admin/keys                 → รายการ (hash เท่านั้น ไม่มี plaintext)
POST   /api/admin/keys                 → สร้าง { label, expiresAt?, notes? } — ส่ง token ครั้งเดียว
PATCH  /api/admin/keys/:id             → { enabled: true|false }
DELETE /api/admin/keys/:id             → revoke ถาวร

# Circuit breaker (per-model)
GET    /api/admin/circuits             → { open[], halfOpen[], warnings[], summary }
DELETE /api/admin/circuits?provider=X&modelId=Y   → reset 1 คู่
DELETE /api/admin/circuits             → reset ทั้งหมด (nuclear)

# Performance insights (public — for dashboard widget)
GET    /api/perf-insights              → {
  requestsLastHour, p50/p95 latency, errorRate,
  counts: { cache:hit/miss, hedge:win/loss, spec:fire/win, sticky:hit, demote:rate-limit },
  rates:  { cacheHitRate, hedgeWinRate, speculativeWinRate, stickyPinRate }
}`} />
            <p className="text-[12.5px] leading-relaxed text-[var(--muted)]">
              <strong className="text-gray-300">warnings</strong> = (provider, model) ที่มี fail streak ≥ 3 ใน 30 วินาที แต่ยังไม่ trip — early warning ก่อน circuit open.
              หน้า <A href="/monitor#perf">มอนิเตอร์ › ประสิทธิภาพ</A> แสดง 8 cards real-time (refresh 15s) + การ์ดเตือน <strong className="text-gray-300">circuit open</strong> (เฉพาะเจ้าของระบบ, แสดงที่หน้าภาพรวมด้วย) เมื่อมี trip &gt; 0
            </p>
          </Section>

          <Section id="thclaws" icon={<IconChat size={20} />} title="เชื่อม thClaws" summary="ใช้ thClaws กับ BCAiRouter ผ่าน OpenAI-compatible endpoint">
            <Callout>
              thClaws ใช้ BCAiRouter ผ่าน OpenAI-compatible endpoint และปล่อยให้ gateway route model จริงด้วย virtual model
              อย่าง <InlineCode>bcai/auto</InlineCode>, <InlineCode>bcai/fast</InlineCode>, หรือ <InlineCode>bcai/tools</InlineCode>
            </Callout>

            <SubTitle>Docker / headless</SubTitle>
            <P>
              ใช้ DashScope-compatible env เพื่อชี้ thClaws เข้า BCAiRouter แล้วระบุ model เป็น <InlineCode>bcai/auto</InlineCode>.
              ไม่ต้อง lock เป็น provider/model เฉพาะ ยกเว้นต้องการ debug upstream โดยตรง.
            </P>
            <CodeBlock code={`docker run --rm \\
  -e DASHSCOPE_BASE_URL=${apiBase}/v1 \\
  -e DASHSCOPE_API_KEY=dummy \\
  -e THCLAWS_DISABLE_KEYCHAIN=1 \\
  -v "$PWD:/workspace" -w /workspace \\
  thclaws-bcairouter:local \\
  -p -m bcai/auto --permission-mode auto \\
  "สรุปโปรเจกต์นี้"`} />

            <SubTitle>เลือก virtual model ให้เหมาะกับงาน</SubTitle>
            <DocTable
              rows={[
                ["bcai/auto", "ค่าเริ่มต้น ให้ BCAiRouter เลือก provider/model จากคะแนนจริง"],
                ["bcai/fast", "งานสั้นที่ต้องการ latency ต่ำ"],
                ["bcai/tools", "งาน agent ที่ต้องใช้ function/tool calling"],
              ].map(([id, desc]) => [<InlineCode key={id}>{id}</InlineCode>, desc])}
            />

            <Callout title="Tool call ที่ model ส่งมาเป็น JSON">
              ถ้า model upstream ส่ง function call เป็น JSON ใน <InlineCode>message.content</InlineCode>,
              BCAiRouter จะ repair เป็น OpenAI <InlineCode>tool_calls</InlineCode> shape เมื่อชื่อ function ตรงกับ schema ที่ client ส่งมา.
            </Callout>
          </Section>

          <Section id="openclaw" icon={<IconPulse size={20} />} title="เชื่อม OpenClaw" summary="AI coding assistant บน terminal ที่ใช้ model ฟรีผ่าน BCAiRouter">
            <Callout>
              OpenClaw เป็น AI coding assistant ที่รันบน terminal — เชื่อมกับ BCAiRouter เพื่อใช้ model ฟรีได้ไม่จำกัด
            </Callout>

            <SubTitle>ขั้นที่ 1 — ตั้งค่าด้วย onboard</SubTitle>
            <VariantTabs
              items={[
                {
                  label: "วิธีที่ 1 · Docker",
                  note: <>OpenClaw รันบน Docker — ถ้าอยู่คนละ container กับ gateway ต้องใช้ <InlineCode>host.docker.internal</InlineCode>:</>,
                  code: `openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://host.docker.internal:3334/v1 \\
  --custom-model-id bcai/auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`,
                },
                {
                  label: "วิธีที่ 2 · Native",
                  note: "OpenClaw บนเครื่องโดยตรง (Native)",
                  code: `openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url ${apiBase}/v1 \\
  --custom-model-id bcai/auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`,
                },
              ]}
            />

            <SubTitle>ขั้นที่ 2 — ตรวจสอบ openclaw.json</SubTitle>
            <P>หลัง onboard ไฟล์ <InlineCode>~/.openclaw/openclaw.json</InlineCode> จะหน้าตาแบบนี้:</P>
            <CodeBlock code={`{
  "models": {
    "providers": {
      "custom-host-docker-internal-3334": {
        "baseUrl": "http://host.docker.internal:3334/v1",
        "apiKey": "dummy",
        "api": "openai-completions",
        "models": [{ "id": "bcai/auto", "contextWindow": 131072 }]
      }
    }
  }
}`} />
            <Callout tone="warning" title="ตรวจ contextWindow และ api">
              ถ้า <InlineCode>contextWindow</InlineCode> น้อยกว่า 131072 ให้แก้เป็น 131072 เพราะ OpenClaw
              ส่ง system prompt ใหญ่มาก &bull; <InlineCode>api</InlineCode> ต้องเป็น{" "}
              <InlineCode>openai-completions</InlineCode>
            </Callout>

            <SubTitle>แก้ปัญหา &ldquo;origin not allowed&rdquo;</SubTitle>
            <CodeBlock code={`{
  "apiProvider": "openai-completions",
  "openAiBaseUrl": "http://host.docker.internal:3334/v1",
  "openAiModelId": "bcai/auto",
  "openAiApiKey": "dummy",
  "contextWindow": 131072,
  "gateway": {
    "bind": "lan",
    "allowedOrigins": [
      "http://host.docker.internal:3334",
      "${apiBase}"
    ]
  }
}`} />
          </Section>

          <Section id="hermes" icon={<IconSparkle size={20} />} title="เชื่อม Hermes Agent" summary="AI agent ที่เรียนรู้ skill ข้ามเซสชัน — ตั้ง base_url ตัวเดียวก็ใช้ได้">
            <Callout>
              <Ext href="https://github.com/NousResearch/hermes-agent">Hermes Agent</Ext>{" "}
              — self-improving AI agent จาก Nous Research (ปล่อย ก.พ. 2026, ≥95k⭐)
              มี built-in tools (terminal, file, web search, memory) + เรียนรู้ skill ข้ามเซสชัน
              เชื่อมกับ BCAiRouter ด้วยการตั้ง <InlineCode>base_url</InlineCode> ใน <InlineCode>~/.hermes/config.toml</InlineCode> ตัวเดียว
            </Callout>

            <div className="space-y-6 pt-2">
              <Step num={1} title="ติดตั้ง Hermes">
                <P>ต้องมี Python 3.11+ (Windows ใช้ WSL2 เท่านั้น — native ไม่รองรับ)</P>
                <CodeBlock code={`curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# ตรวจว่าติดตั้งสำเร็จ
hermes --version`} />
                <P>
                  ทางเลือก manual: <InlineCode>git clone</InlineCode> repo → <InlineCode>python -m venv venv</InlineCode> → <InlineCode>pip install -r requirements.txt</InlineCode> → <InlineCode>python setup.py</InlineCode>
                </P>
              </Step>

              <Step num={2} title="Config ให้ชี้มา BCAiRouter">
                <P>แก้ <InlineCode>~/.hermes/config.toml</InlineCode> ตรงๆ (base_url override provider built-in เสมอ):</P>
                <CodeBlock code={`# ~/.hermes/config.toml
[model]
provider = "custom"
base_url = "${apiBase}/v1"
api_key_env = "BCAI_ROUTER_KEY"
model = "bcai/auto"

# ถ้าอยาก Thai-first ให้ fallback ไป bcai/thai เมื่อ primary ตก
[model.fallback]
provider = "custom"
base_url = "${apiBase}/v1"
model = "bcai/thai"

[agent]
name = "Hermes"
memory = true
skills_dir = "~/.hermes/skills"`} />
              </Step>

              <Step num={3} title="ใส่ API Key">
                <CodeBlock code={`echo 'BCAI_ROUTER_KEY=<bcai_live_xxxxxxxxxxxx>' >> ~/.hermes/.env

# Local mode (no auth) — ใช้ dummy ได้
# echo 'BCAI_ROUTER_KEY=dummy' >> ~/.hermes/.env`} />
                <P>Key สร้างได้ที่ <A href="/admin/keys">/admin/keys</A> (owner only)</P>
              </Step>

              <Step num={4} title="ใช้งาน / เปลี่ยน model" last>
                <CodeBlock code={`hermes "refactor this repo to use async/await"

# สลับ model ระหว่างใช้งาน (Hermes รองรับ live switch)
hermes model   # เลือกจาก list
hermes tools   # เปิด/ปิด built-in tools
hermes setup   # wizard แก้ทุกอย่างพร้อมกัน`} />
              </Step>
            </div>

            <Callout tone="warning" title="ข้อบังคับ Hermes">
              model ต้องมี context ≥ 64k tokens — ถ้าต่ำกว่านั้น
              Hermes จะ reject ที่ startup. <InlineCode>bcai/auto</InlineCode> ของ BCAiRouter กรอง context &lt; 32k
              ทิ้งไปแล้ว ดังนั้นส่วนใหญ่ผ่านเกณฑ์ แต่ถ้า route ไปเจอ model 32k อาจขัด —
              ใช้ header <InlineCode>X-BCAiRouter-Max-Latency</InlineCode> + preset <InlineCode>strongest</InlineCode> ช่วยคัด
            </Callout>

            <SubTitle>ตัวเลือก: ใช้ Nous Portal เป็น fallback</SubTitle>
            <P>
              ถ้าอยาก dual-provider (BCAiRouter เป็นหลัก + Nous Portal เป็น backup) ตั้งใน config.toml:
            </P>
            <CodeBlock code={`[model.fallback]
provider = "nous-portal"
api_key_env = "NOUS_API_KEY"
model = "Hermes-3-Llama-3.1-405B"`} />
          </Section>

          <Section id="api" icon={<IconBook size={20} />} title="API Reference" summary="Endpoint, response header และตัวอย่างการเรียกใช้">
            <SubTitle>Endpoints</SubTitle>
            <DocTable
              head={["Method", "Path", "คำอธิบาย"]}
              rows={[
                ["POST", "/v1/chat/completions", "Chat — text / vision / tools / streaming"],
                ["GET", "/v1/models", "รายชื่อ model ทั้งหมด (OpenAI format)"],
                ["GET", "/v1/models/:id", "ดึงข้อมูล model — รองรับ ID มี / เช่น bcai/tools, groq/vendor/model"],
                ["GET", "/v1/models/search", "ค้นหา/จัดอันดับ model ตาม category, context, ฯลฯ"],
                ["POST", "/v1/compare", "ยิง prompt ไปหลาย model พร้อมกัน (≤10)"],
                ["POST", "/v1/structured", "Chat + JSON schema validation + auto-retry"],
                ["GET", "/v1/trace/:reqId", "ดู log ของ request เดิม (เจ้าของ)"],
                ["GET", "/v1/prompts", "รายการ system prompts ที่บันทึกไว้ (เจ้าของ)"],
                ["POST", "/v1/prompts", "สร้าง/เขียนทับ prompt (เจ้าของ)"],
                ["GET", "/v1/prompts/:name", "ดึง prompt (เจ้าของ)"],
                ["PUT", "/v1/prompts/:name", "แก้ไข (เจ้าของ)"],
                ["DELETE", "/v1/prompts/:name", "ลบ (เจ้าของ)"],
                ["GET", "/api/my-stats", "สรุปการใช้งานของ IP ตัวเอง"],
                ["POST", "/v1/embeddings", "Embeddings (mistral / cohere / nvidia / openrouter)"],
                ["POST", "/v1/completions", "Legacy completions"],
              ].map(([m, p, d]) => [
                <Badge key={`${m}-${p}`} tone={METHOD_TONE[m as keyof typeof METHOD_TONE]} className="font-mono">{m}</Badge>,
                <InlineCode key="p">{p}</InlineCode>,
                d,
              ])}
            />

            <SubTitle>Response Headers พิเศษ</SubTitle>
            <DocTable
              rows={[
                ["X-BCAiRouter-Model", "model จริงที่ถูกเลือกใช้"],
                ["X-BCAiRouter-Provider", "provider ที่เรียกจริง (groq/nvidia/cerebras/...)"],
                ["X-BCAiRouter-Request-Id", "ใช้กับ /v1/trace/:reqId เพื่อดูรายละเอียด"],
                ["X-BCAiRouter-Hedge", "true ถ้า response มาจาก hedge winner"],
                ["X-BCAiRouter-Cache", "HIT ถ้าดึงจาก semantic cache"],
                ["X-BCAiRouter-Consensus", "รายชื่อ model (เฉพาะ bcai/consensus)"],
                ["X-Resceo-Backoff", "true ถ้ายิงถี่เกิน soft limit (hint, ไม่บล็อก)"],
              ].map(([h, d]) => [<InlineCode key={h}>{h}</InlineCode>, d])}
            />

            <SubTitle>ตัวอย่าง: Vision (ส่งรูป)</SubTitle>
            <CodeBlock code={`curl ${apiBase}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bcai/auto",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "อธิบายรูปนี้"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }]
  }'`} />

            <SubTitle>ตัวอย่าง: Tool Calling</SubTitle>
            <CodeBlock code={`curl ${apiBase}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bcai/tools",
    "messages": [{"role": "user", "content": "กรุงเทพอากาศเป็นยังไง"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "ดูสภาพอากาศเมือง",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"]
        }
      }
    }]
  }'`} />
          </Section>

          <Section id="dev-tools" icon={<IconCompass size={20} />} title="Dev Tools — สิ่งพิเศษสำหรับนักพัฒนา" summary="ไม่ต้องเขียน retry ไม่ต้องรู้จัก model ทุกตัว ไม่ต้องเก็บ prompt ยาวๆ ใน code">
            <P>
              BCAiRouter มี endpoint ช่วย dev ทำงานได้เร็วขึ้น — ไม่ต้องเขียน retry,
              ไม่ต้องรู้จัก model ทุกตัว, ไม่ต้องเก็บ prompt ยาวๆ ใน code
            </P>

            <SubTitle>1. ค้นหา Model ตาม Capability</SubTitle>
            <P>
              หา model ที่เก่งด้านที่ต้องการ — category, context, tools support ฯลฯ
            </P>
            <CodeBlock code={`# หา model ภาษาไทยที่รับ context 200K+ ท็อป 3
curl "${apiBase}/v1/models/search?category=thai&min_context=200000&top=3"

# หา model tools calling
curl "${apiBase}/v1/models/search?category=code&supports_tools=1&top=5"`} />
            <P>
              Query params: <InlineCode>category</InlineCode> (thai / code / tools / vision / math /
              reasoning / json / instruction / extraction / classification / comprehension / safety),{" "}
              <InlineCode>min_context</InlineCode>, <InlineCode>max_context</InlineCode>,{" "}
              <InlineCode>supports_tools</InlineCode>, <InlineCode>supports_vision</InlineCode>,{" "}
              <InlineCode>provider</InlineCode>, <InlineCode>tier</InlineCode>,{" "}
              <InlineCode>exclude_cooldown</InlineCode>, <InlineCode>top</InlineCode>
            </P>

            <SubTitle>2. เปรียบเทียบ Model</SubTitle>
            <P>
              ยิง prompt เดียวไปหลาย model พร้อมกัน → เปรียบเทียบ content + latency
            </P>
            <CodeBlock code={`curl -X POST ${apiBase}/v1/compare \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{"role":"user","content":"อธิบาย recursion"}],
    "models": [
      "groq/moonshotai/kimi-k2-instruct-0905",
      "cerebras/qwen-3-235b-a22b-instruct-2507",
      "nvidia/meta/llama-4-maverick-17b-128e-instruct"
    ],
    "max_tokens": 200,
    "timeout_ms": 30000
  }'`} />

            <SubTitle>3. Structured Output (JSON Schema + Auto-retry)</SubTitle>
            <P>
              ต้องการ JSON ตาม schema ที่กำหนด — ระบบ validate + retry (default 2 ครั้ง) ให้
              ไม่ต้องเขียน parse/retry logic เอง
            </P>
            <CodeBlock code={`curl -X POST ${apiBase}/v1/structured \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bcai/auto",
    "messages": [{"role":"user","content":"Describe a fruit"}],
    "schema": {
      "type": "object",
      "required": ["name", "color", "taste"],
      "properties": {
        "name": {"type": "string"},
        "color": {"type": "string"},
        "sweetness": {"type": "integer"}
      }
    },
    "max_retries": 2
  }'

# Response: { ok, attempts, data: { name, color, taste, sweetness }, model, provider, latency_ms, request_ids }`} />

            <SubTitle>4. Prompt Library</SubTitle>
            <P>
              เก็บ system prompt ยาวๆ ไว้เรียกใช้ด้วยชื่อ — ไม่ต้องฝังใน client code · สร้าง/แก้/ลบได้เฉพาะเจ้าของ (master key) ส่วน key <InlineCode>bcai_live_</InlineCode> ใช้ชื่อ prompt ในแชทได้อย่างเดียว
            </P>
            <CodeBlock code={`# สร้าง
curl -X POST ${apiBase}/v1/prompts \\
  -H "Content-Type: application/json" \\
  -d '{"name":"pirate","content":"You are a pirate. Short answers only.","description":"Pirate persona"}'

# ใช้ในแชท — แค่ใส่ "prompt": "pirate"
curl -X POST ${apiBase}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"bcai/auto","prompt":"pirate","messages":[{"role":"user","content":"how to fish"}]}'

# รายการทั้งหมด
curl ${apiBase}/v1/prompts

# แก้ไข / ลบ
curl -X PUT    ${apiBase}/v1/prompts/pirate -d '{...}'
curl -X DELETE ${apiBase}/v1/prompts/pirate`} />

            <SubTitle>5. Trace — Debug Request ย้อนหลัง</SubTitle>
            <P>
              ทุก response มี <InlineCode>X-BCAiRouter-Request-Id</InlineCode> → เอาไปเรียก
              trace endpoint ดูได้ว่าเกิดอะไรกับ request นั้นๆ
            </P>
            <CodeBlock code={`# ยิง chat ธรรมดา
curl -D - ${apiBase}/v1/chat/completions \\
  -d '{"model":"bcai/auto","messages":[{"role":"user","content":"hi"}]}'
# → response headers มี: X-BCAiRouter-Request-Id: 5m3obi

# ดู trace
curl ${apiBase}/v1/trace/5m3obi
# → { requestId, found, entry: { resolved_model, provider, latency_ms, input_tokens, ... } }`} />

            <SubTitle>6. Usage Stats ของ IP ตัวเอง</SubTitle>
            <CodeBlock code={`curl "${apiBase}/api/my-stats?window=24h"
# → { total, success, p50_latency_ms, p95_latency_ms, p99_latency_ms,
#     top_models: [...], by_hour: [...] }
# window: 1h | 6h | 24h | 7d | 30d`} />

            <SubTitle>7. Control Headers — บังคับ/หลีกเลี่ยง Provider</SubTitle>
            <DocTable
              head={["Header", "ค่าตัวอย่าง", "ผล"]}
              rows={[
                ["X-BCAiRouter-Prefer", "groq,cerebras", "ดัน provider เหล่านี้ขึ้นบนสุด"],
                ["X-BCAiRouter-Exclude", "mistral", "ตัด provider เหล่านี้ออก"],
                ["X-BCAiRouter-Max-Latency", "3000", "กรอง model ที่ avg_latency เกินนี้ (ms)"],
                ["X-BCAiRouter-Strategy", "fastest", "เรียงตาม latency asc"],
                ["X-BCAiRouter-Strategy", "strongest", "เรียงตาม tier + context desc"],
              ].map(([h, v, d], n) => [<InlineCode key={`h${n}`}>{h}</InlineCode>, <InlineCode key={`v${n}`}>{v}</InlineCode>, d])}
            />
            <CodeBlock code={`curl -X POST ${apiBase}/v1/chat/completions \\
  -H "X-BCAiRouter-Prefer: groq,cerebras" \\
  -H "X-BCAiRouter-Exclude: mistral" \\
  -H "X-BCAiRouter-Strategy: fastest" \\
  -H "X-BCAiRouter-Max-Latency: 3000" \\
  -d '{"model":"bcai/auto","messages":[...]}'`} />
          </Section>

          <Section id="benchmark" icon={<IconCheck size={20} />} title="ระบบสอบ (Benchmark)" summary="ใช้ AI ตรวจ AI เพื่อคัดเฉพาะ model ที่ตอบได้ถูกต้องจริง">
            <P>
              BCAiRouter มีระบบสอบวัดผล model อัตโนมัติ — ใช้ &ldquo;AI ตรวจ AI&rdquo;
              (model หนึ่งเป็นนักเรียน อีกตัวเป็นครู) เพื่อคัดเฉพาะ model ที่ตอบคำถามได้ถูกต้องจริง
            </P>

            <SubTitle>โครงสร้างโรงเรียน</SubTitle>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-[13px] text-gray-300">
                <Badge tone="warning">Principal</Badge>
                <div className="mt-2 font-semibold text-white">ครูใหญ่</div>
                <div className="mt-0.5">1 ตัว, model ที่คะแนนรวมสูงสุด มี tools รองรับ (ใช้ตัดสินข้อพิพาท)</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-[13px] text-gray-300">
                <Badge tone="accent">Head</Badge>
                <div className="mt-2 font-semibold text-white">ครูประจำวิชา</div>
                <div className="mt-0.5">1 ตัวต่อหมวด, model ที่ทำคะแนน &ge; 80% ในหมวดนั้น (classification, code, comprehension, extraction, instruction, json, math, reasoning, safety, thai, tools, vision)</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 p-3.5 text-[13px] text-gray-300">
                <Badge tone="info">Proctor</Badge>
                <div className="mt-2 font-semibold text-white">ผู้คุมสอบ</div>
                <div className="mt-0.5">สูงสุด 10 ตัว, ทำหน้าที่ยิงคำถามวัด latency ไม่มีสิทธิ์ตัดสิน</div>
              </div>
            </div>

            <SubTitle>วิธีคัดเลือก</SubTitle>
            <P>
              ข้อสอบ 4 ระดับ (cumulative) — ทุกรอบ worker (15 นาที) จะจัดสอบ model ใหม่ตามระดับที่ตั้งไว้ใน{" "}
              <InlineCode>worker_state.exam_level</InlineCode> เก็บคะแนนลง{" "}
              <InlineCode>model_category_scores</InlineCode> แล้วเลือกครูอัตโนมัติ
              model เดียวสามารถเป็น head หลายหมวดได้ (คนเก่งหลายอย่าง)
            </P>
            <div className="grid gap-3 sm:grid-cols-2">
              <LevelCard dot="bg-emerald-400" name="ประถม (primary)" detail="5 ข้อ, ผ่าน ≥ 40%" />
              <LevelCard dot="bg-yellow-400" name="มัธยมต้น (middle)" detail="14 ข้อ, ผ่าน ≥ 50%" isDefault />
              <LevelCard dot="bg-orange-400" name="มัธยมปลาย (high)" detail="22 ข้อ, ผ่าน ≥ 60%" />
              <LevelCard dot="bg-rose-400" name="มหาลัย (university)" detail="30 ข้อ, ผ่าน ≥ 70%" />
            </div>

            <SubTitle>เปลี่ยนระดับ + สั่งสอบใหม่</SubTitle>
            <P>
              ตั้งค่าระดับที่หน้า <A href="/models#exam">โมเดล &amp; อันดับ › ผลสอบ</A> (คลิกการ์ด → save อัตโนมัติ)
              หรือ <InlineCode>POST /api/exam-config {`{ "level": "middle" }`}</InlineCode>.
              สั่งสอบใหม่ทุกคน: ปุ่ม &ldquo;สอบใหม่ทุกคน&rdquo; (กด 2 ครั้งยืนยัน) หรือ{" "}
              <InlineCode>POST /api/exam-reset</InlineCode> — ล้าง <InlineCode>exam_attempts</InlineCode> +{" "}
              <InlineCode>model_category_scores</InlineCode> แล้ว trigger worker ทันที
            </P>
          </Section>

          <Section id="troubleshoot" icon={<IconAlert size={20} />} title="แก้ปัญหา" summary="เช็คทีละข้อ แล้วดูวิธีแก้ error ที่พบบ่อย">
            <SubTitle>เช็คทีละข้อ</SubTitle>
            <Bullets>
              <li>Docker Desktop เปิดอยู่ไหม? (ไอคอนวาฬสีเขียว)</li>
              <li>Container health ไหม? <InlineCode>docker ps --filter name=bcai-router</InlineCode></li>
              <li>เปิด <InlineCode>{apiBase}/</InlineCode> เห็น dashboard ไหม?</li>
              <li>Worker สแกนเสร็จไหม? มี model พร้อมใช้กี่ตัว? (ดูที่หน้า <A href="/models">โมเดล &amp; อันดับ</A>)</li>
              <li>ทดสอบ: <InlineCode>curl {apiBase}/v1/models</InlineCode> ตอบ list กลับไหม?</li>
              <li>ถ้า Docker: base URL เป็น <InlineCode>host.docker.internal:3334</InlineCode> ไหม?</li>
            </Bullets>

            <SubTitle>404 model not found (bcai/tools, groq/vendor/model)</SubTitle>
            <P>
              model ID ที่มี <InlineCode>/</InlineCode> เช่น <InlineCode>bcai/tools</InlineCode> หรือ <InlineCode>groq/vendor/model</InlineCode>{" "}
              ต้องใช้ได้ตามปกติ — ตรวจสอบได้เลย:
            </P>
            <CodeBlock code={`# virtual models (bcai/auto, bcai/fast, bcai/tools, bcai/thai, bcai/consensus)
curl ${apiBase}/v1/models/bcai/tools
# → { "id": "bcai/tools", "object": "model", ... }

# provider/model format
curl ${apiBase}/v1/models/groq/llama-3.3-70b-versatile
# → { "id": "groq/llama-3.3-70b-versatile", ... }

# ถ้าได้ HTML หรือ 404 — ให้ rebuild container
docker compose up -d --build bcai-router`} />

            <SubTitle>Error 413 (payload too large)</SubTitle>
            <P>
              เกิดเมื่อ context ที่ส่งใหญ่เกินกว่า model จะรับได้
              ระบบจะ cooldown model นั้น 15 นาทีแล้ว fallback ไปตัวที่ใหญ่กว่าอัตโนมัติ
              (สูงสุด 3 ครั้ง) — ตรวจ <InlineCode>contextWindow</InlineCode> ใน config ต้อง &ge; 131072
            </P>

            <SubTitle>Error 429 (rate limit)</SubTitle>
            <P>
              Provider นั้นเต็ม quota — ระบบจะ cooldown ตาม streak ที่ fail
              (10s → 20s → 40s → 1m → 2m cap) แล้วสลับไป provider อื่น
              ดู quota ที่เหลือได้ที่หน้า <A href="/monitor#cost">มอนิเตอร์ › ค่าใช้จ่าย &amp; โควตา</A>
            </P>

            <SubTitle>Cooldown cascade (503 เยอะ)</SubTitle>
            <P>
              ถ้าเจอ 503 บ่อย แปลว่า candidate pool แคบเกิน —
              ลองเปิด provider เพิ่มที่หน้า <A href="/setup">/setup</A> หรือเช็ค health_logs ใน DB:
            </P>
            <CodeBlock code={`docker exec bcai-router-postgres-1 psql -U bcai -d bcairouter \\
  -c "SELECT COUNT(*) FROM health_logs WHERE cooldown_until > now();"`} />
          </Section>

          <div className="py-6 text-center text-[12px] text-[var(--muted)]">BCAiRouter &bull; AI Gateway &bull; Local Docker only</div>
        </div>
      </div>
    </>
  );
}
