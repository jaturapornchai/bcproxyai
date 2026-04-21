"use client";

import { useEffect, useState } from "react";

// ─── Shared style helpers ────────────────────────────────────────────────────

function Section({ id, icon, title, children }: { id: string; icon: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-3xl">{icon}</span>
        <h2 className="text-3xl font-black text-white">{title}</h2>
      </div>
      <div className="glass rounded-2xl p-6 border border-indigo-500/15 space-y-4">{children}</div>
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-bold text-indigo-300 mt-6 mb-3 first:mt-0">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-300 leading-relaxed">{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-xs text-gray-200 font-mono overflow-x-auto">
      {children}
    </pre>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="text-indigo-300 font-mono text-xs px-1 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">{children}</code>;
}

function Info({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-start gap-2">
      <span className="text-blue-400 text-lg shrink-0">&#9432;</span>
      <div className="text-sm text-blue-200 leading-relaxed">{children}</div>
    </div>
  );
}

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="h-8 w-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-sm font-bold text-indigo-300">{num}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-sm font-bold text-white">{title}</div>
        <div className="text-sm text-gray-300 space-y-2">{children}</div>
      </div>
    </div>
  );
}

// ─── Code snippets for Quick Connect ─────────────────────────────────────────

type Lang = "nextjs" | "python" | "curl" | "langchain" | "hermes" | "openclaw" | "any";

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
  model: "sml/auto",
  messages: [{ role: "user", content: "สวัสดีครับ" }],
});
console.log(chat.choices[0].message.content);

// tool calling
const tools = await client.chat.completions.create({
  model: "sml/tools",
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
  model: "sml/auto",
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
    model="sml/auto",
    messages=[{"role": "user", "content": "สวัสดีครับ"}],
)
print(chat.choices[0].message.content)

# streaming
stream = client.chat.completions.create(
    model="sml/auto",
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
    "model": "sml/auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}]
  }'

# streaming
curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "sml/auto",
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
    model="sml/auto",
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
  hermes: {
    label: "Hermes Agent",
    code: `# Hermes Agent (Nous Research) — self-improving open-source AI agent
# Windows users: ต้องใช้ WSL2 + Ubuntu (native Windows ยังไม่รองรับ)
#   wsl --install -d Ubuntu-24.04
# macOS / Linux / WSL2: รัน installer ตรงๆ
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc && hermes --version   # → Hermes Agent v0.10.0+

# ── Point Hermes at SMLGateway (provider = custom) ──
hermes config set model.provider custom
hermes config set model.base_url ${base}
hermes config set model.default mistral/mistral-small-latest  # tool_calls เสถียร
# (หลีกเลี่ยง sml/auto เพราะ routing อาจเจอ model ที่ output tool-call เป็น text)

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

# gateway auto-patches [system, tool, ...] message order for Mistral —
# so Hermes' tool flow works out of the box (tested: 13/16 tools pass clean)`,
    note: "ติดตั้งแล้วใช้ได้เลย — pin model เป็น mistral/mistral-small-latest กัน tool-call เพี้ยน",
  },
  openclaw: {
    label: "OpenClaw",
    code: `# Docker — OpenClaw อยู่คนละ container
docker exec <openclaw-container> \\
  openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url ${base.replace("localhost", "host.docker.internal")} \\
  --custom-model-id sml/auto \\
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
  --custom-model-id sml/auto \\
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
Model:       sml/auto  (หรือเลือก model เฉพาะ)

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
  GET  /v1/trace/:reqId              ดู log ของ request เดิม
  GET  /api/my-stats?window=24h      สรุปใช้งานของ IP ตัวเอง (p50/p95/p99)
  GET  /v1/prompts                   รายการ system prompts ที่บันทึกไว้
  POST /v1/prompts                   สร้าง/เขียนทับ { name, content, description? }
  GET|PUT|DELETE /v1/prompts/:name   ดึง/แก้/ลบ

ใช้ prompt ที่บันทึกไว้ในแชท:
  { "model": "sml/auto", "prompt": "my-prompt-name", "messages": [...] }

Dev controls (headers):
  X-SMLGateway-Prefer:   groq,cerebras       ดัน provider ขึ้นบน
  X-SMLGateway-Exclude:  mistral              ตัดออก
  X-SMLGateway-Max-Latency: 3000              กรอง model ที่ช้าเกิน
  X-SMLGateway-Strategy: fastest|strongest    หรือใช้ preset

ตัวอย่าง config ใน framework ต่างๆ:
  Vercel AI SDK:  createOpenAI({ baseURL, apiKey: "dummy" })
  LiteLLM:        model="openai/sml/auto", api_base="..."
  Dify:           Custom Model Provider → OpenAI-compatible
  LobeChat:       Settings → OpenAI → Base URL
  AutoGen:        config_list: [{ base_url, api_key: "dummy" }]
  Continue.dev:   models: [{ provider: "openai", apiBase, apiKey: "${key}" }]`,
  },
  };
}

function QuickConnect() {
  const [lang, setLang] = useState<Lang>("nextjs");
  const [copied, setCopied] = useState(false);
  // Detect origin — production shows the real domain + Bearer hint,
  // local dev keeps the familiar localhost:3334
  const [apiBase, setApiBase] = useState("http://localhost:3334/v1");
  const [isProd, setIsProd] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const o = window.location.origin;
    const prod = !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(o);
    setIsProd(prod);
    setApiBase(prod ? `${o}/v1` : "http://localhost:3334/v1");
  }, []);
  const keyPlaceholder = isProd ? "<GATEWAY_API_KEY>" : "dummy";
  const snippets = buildSnippets(apiBase, keyPlaceholder);
  const snippet = snippets[lang];

  const copy = () => {
    navigator.clipboard.writeText(snippet.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tabs: Lang[] = ["nextjs", "python", "curl", "langchain", "hermes", "openclaw", "any"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[
          { label: "Base URL", value: apiBase, color: "text-indigo-300" },
          { label: "API Key", value: isProd ? "Bearer <key จาก owner>" : "dummy (local ไม่เช็ค)", color: "text-amber-300" },
          { label: "Model", value: "sml/auto", color: "text-emerald-300" },
        ].map((info) => (
          <div key={info.label} className="bg-black/30 rounded-lg px-3 py-2 border border-white/5">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-bold">{info.label}</div>
            <code className={`text-sm font-mono ${info.color}`}>{info.value}</code>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => { setLang(t); setCopied(false); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
              lang === t
                ? "bg-indigo-500/20 text-indigo-200 border-indigo-500/50"
                : "text-gray-400 border-white/10 hover:bg-white/5 hover:text-white"
            }`}
          >
            {snippets[t].label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Code>{snippet.code}</Code>
        <button
          onClick={copy}
          className={`absolute top-2 right-2 px-3 py-1 rounded text-xs font-bold border transition-colors ${
            copied
              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
              : "bg-indigo-500/20 text-indigo-300 border-indigo-500/50 hover:bg-indigo-500/30"
          }`}
        >
          {copied ? "คัดลอกแล้ว \u2713" : "คัดลอก"}
        </button>
      </div>

      {snippet.note && (
        <p className="text-xs text-amber-300">* {snippet.note}</p>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

const NAV = [
  { id: "quick-connect", label: "เชื่อมต่อเร็ว" },
  { id: "overview", label: "ภาพรวม" },
  { id: "models", label: "โมเดลพิเศษ" },
  { id: "install", label: "ติดตั้ง" },
  { id: "auth", label: "ยืนยันตัวตน" },
  { id: "openclaw", label: "OpenClaw" },
  { id: "hermes", label: "Hermes Agent" },
  { id: "api", label: "API Reference" },
  { id: "dev-tools", label: "Dev Tools" },
  { id: "benchmark", label: "ระบบสอบ" },
  { id: "troubleshoot", label: "แก้ปัญหา" },
];

// Shared hook: every Code block swaps in the real server origin so docs stay
// accurate when we move the droplet / domain / add more replicas.
function useApiBase() {
  const [base, setBase] = useState<string>("http://localhost:3334");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const o = window.location.origin;
    const prod = !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(o);
    setBase(prod ? o : "http://localhost:3334");
  }, []);
  return base;
}

export default function GuidePage() {
  const apiBase = useApiBase();
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="sticky top-0 z-40 glass-bright border-b border-indigo-500/20 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 text-indigo-300 hover:text-white text-sm">
            <span>&larr;</span>
            <span>กลับหน้าหลัก</span>
          </a>
          <h1 className="text-lg font-black text-white">คู่มือ SMLGateway</h1>
          <div className="flex-1" />
          <a
            href="https://github.com/jaturapornchai/sml-gateway"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-white"
          >
            GitHub &rarr;
          </a>
        </div>
        {/* Anchor nav */}
        <nav className="max-w-5xl mx-auto px-4 pb-2 flex flex-wrap gap-1">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className="px-2.5 py-1 rounded-md text-xs text-gray-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10"
            >
              {n.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        {/* Hero */}
        <div className="text-center py-6">
          <div className="text-5xl mb-3">&#128218;</div>
          <h1 className="text-4xl font-black text-white mb-2">คู่มือ SMLGateway</h1>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto leading-relaxed">
            AI Gateway รวมผู้ให้บริการ AI ฟรี 30+ เจ้าไว้ที่เดียว — OpenAI-compatible API
            เชื่อมต่อ OpenAI SDK, LangChain, Hermes Agent, OpenClaw ได้ทุก framework
            ใช้ <InlineCode>sml/auto</InlineCode> ระบบเลือก model ที่ดีที่สุดให้อัตโนมัติ
          </p>
        </div>

        <Info>
          <strong>Local</strong>: ไม่มี auth ใช้ <InlineCode>apiKey: &quot;dummy&quot;</InlineCode> ได้เลย &middot;{" "}
          <strong>Production</strong>: ต้องใช้ Bearer key (<InlineCode>GATEWAY_API_KEY</InlineCode> จาก owner)
          หรือ login ด้วย Google เข้าใช้ UI อย่างเดียว — endpoint <InlineCode>/v1/*</InlineCode> จำกัดเฉพาะ owner
        </Info>

        <Section id="quick-connect" icon="&#9889;" title="เชื่อมต่อเร็ว">
          <P>
            SMLGateway เป็น OpenAI-compatible API — client library ทุกตัวที่ใช้ OpenAI SDK ได้
            ชี้ <InlineCode>baseURL</InlineCode> มาที่ <InlineCode>${apiBase}/v1</InlineCode> ก็ใช้ได้ทันที
          </P>
          <QuickConnect />
        </Section>

        <Section id="overview" icon="&#128196;" title="ภาพรวมระบบ">
          <P>
            SMLGateway เป็น &ldquo;ตัวกลาง&rdquo; ระหว่าง client กับ AI provider ฟรี 26 เจ้า
            (OpenRouter, Kilo, Google, Groq, Cerebras, SambaNova, Mistral, Ollama, GitHub,
            Fireworks, Cohere, Cloudflare, HuggingFace, NVIDIA, Chutes, LLM7, Scaleway,
            Pollinations, Ollama Cloud, SiliconFlow, glhf, Together, Hyperbolic, Z.AI,
            Alibaba Qwen, Reka)
          </P>
          <P>
            ระบบมี worker หลังบ้านคอย scan model ใหม่ ทดสอบสอบวัดผลตามระดับที่ตั้งไว้
            (ประถม/มัธยมต้น/มัธยมปลาย/มหาลัย) และเลือกครู (teachers) ที่เก่งในแต่ละหมวดไว้เป็น grader
          </P>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-black/30 rounded-lg p-3 border border-white/5">
              <div className="text-xs text-emerald-400 font-bold mb-1">&#128193; Ports</div>
              <div className="text-xs text-gray-300 space-y-0.5 font-mono">
                <div>3333 — external Caddy (300s timeout)</div>
                <div>3334 — in-compose Caddy (LB)</div>
                <div>5434 — Postgres</div>
                <div>6382 — Redis</div>
              </div>
            </div>
            <div className="bg-black/30 rounded-lg p-3 border border-white/5">
              <div className="text-xs text-indigo-400 font-bold mb-1">&#128302; Worker cycle</div>
              <div className="text-xs text-gray-300 space-y-0.5">
                <div>ทุก 15 นาที:</div>
                <div>1. Scan providers</div>
                <div>2. Health check + exam</div>
                <div>3. Appoint teachers</div>
              </div>
            </div>
            <div className="bg-black/30 rounded-lg p-3 border border-white/5">
              <div className="text-xs text-amber-400 font-bold mb-1">&#128293; Warmup</div>
              <div className="text-xs text-gray-300 space-y-0.5">
                <div>ทุก 2 นาที:</div>
                <div>ping model ที่ผ่านสอบ</div>
                <div>รักษา connection warm</div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="models" icon="&#127919;" title="โมเดลพิเศษ (Virtual Models)">
          <P>
            ไม่ใช่ model จริง แต่เป็น &ldquo;ชื่อลัด&rdquo; ที่ gateway จะเลือก model จริงให้อัตโนมัติตามบริบท
          </P>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-xs uppercase">
                  <th className="text-left py-2 pr-4">Model</th>
                  <th className="text-left py-2">คำอธิบาย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["sml/auto", "เลือก model ที่ดีที่สุดอัตโนมัติ — แนะนำใช้ตัวนี้"],
                  ["sml/fast", "เลือกตัวที่ latency ต่ำสุด (สำหรับงานสั้นๆ ต้องการคำตอบเร็ว)"],
                  ["sml/tools", "เลือกเฉพาะ model ที่รองรับ tool/function calling"],
                  ["sml/thai", "เลือก model ที่เก่งภาษาไทย (คะแนน exam หมวด thai สูงสุด)"],
                  ["sml/consensus", "ส่งไปหลาย model พร้อมกัน เปรียบเทียบคำตอบ"],
                ].map(([id, desc]) => (
                  <tr key={id}>
                    <td className="py-2 pr-4"><InlineCode>{id}</InlineCode></td>
                    <td className="py-2 text-gray-300">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Info>
            ถ้า request มี <InlineCode>tools</InlineCode>, <InlineCode>image_url</InlineCode>, หรือ <InlineCode>response_format</InlineCode>
            ระบบจะ auto-detect แล้วเลือก model ที่รองรับให้ — ใช้ <InlineCode>sml/auto</InlineCode> อย่างเดียวก็พอ
          </Info>
          <SubTitle>เจาะจง model ตรงๆ</SubTitle>
          <P>ถ้าอยากใช้ model เฉพาะตัว ระบุ provider + model ID ได้:</P>
          <Code>{`groq/llama-3.3-70b-versatile
openrouter/qwen/qwen3-coder:free
cerebras/qwen-3-235b-a22b-instruct-2507
mistral/mistral-large-2411`}</Code>

          <SubTitle>🇹🇭 Thai-native models (ของคนไทย)</SubTitle>
          <P>2 providers ฟรี — สมัครที่ <a href="/setup" className="text-indigo-300 hover:underline">/setup</a> แล้วเรียกตรงๆ:</P>
          <Code>{`# Typhoon (SCB 10X) — sign up: https://opentyphoon.ai
typhoon/typhoon-v2.5-30b-a3b-instruct

# ThaiLLM (NSTDA national platform) — sign up: https://playground.thaillm.or.th
# 4 โมเดลของคนไทยใต้ endpoint เดียว:
thaillm/OpenThaiGPT-ThaiLLM-8B-Instruct-v7.2     # AIEAT
thaillm/Typhoon-S-ThaiLLM-8B-Instruct            # SCB 10X
thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0    # NECTEC — มี thinking!
thaillm/THaLLE-0.2-ThaiLLM-8B-fa                 # KBTG`}</Code>

          <SubTitle>🧠 Thinking / Reasoning Mode</SubTitle>
          <P>
            Gateway <strong>auto-enable</strong> สำหรับ model ที่ scan แล้วพบว่ารองรับ reasoning
            (เก็บใน <InlineCode>models.supports_reasoning</InlineCode>):
          </P>
          <ul className="text-sm text-gray-300 list-disc pl-6 space-y-1">
            <li><strong>Source 1:</strong> OpenRouter metadata <InlineCode>supported_parameters</InlineCode> includes <InlineCode>reasoning</InlineCode></li>
            <li><strong>Source 2:</strong> regex จับชื่อ model — <InlineCode>qwen3 / o1 / o3 / o4 / deepseek-r1 / thinking / magistral / pathumma-think / lfm-thinking</InlineCode></li>
          </ul>

          <P>เวลายิง gateway จะใส่ให้เอง:</P>
          <Code>{`{
  "reasoning": { "effort": "medium" },     // OpenRouter / Anthropic / OpenAI o-series
  "enable_thinking": true,                  // Qwen3 / DashScope / vLLM
  "max_tokens": 2000                        // เผื่อพื้นที่ trace
}`}</Code>

          <P><strong>Opt-out</strong> (ถ้าไม่อยากให้ thinking):</P>
          <Code>{`{
  "model": "thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0",
  "messages": [...],
  "reasoning": false      // หรือ "enable_thinking": false
}`}</Code>

          <Info>
            <strong>ดูใน &ldquo;สมุดจดงาน&rdquo;</strong> — log exam ที่ใช้ thinking mode จะมี 🧠 tag กำกับ:
            <br />
            <code>📝 เริ่มสอบ [middle] 🧠 thinking: thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0</code>
          </Info>
        </Section>

        <Section id="install" icon="&#128230;" title="ติดตั้ง">
          <SubTitle>วิธีที่แนะนำ — Docker Compose</SubTitle>
          <Step num={1} title="ติดตั้ง Docker Desktop">
            <P>
              ดาวน์โหลดจาก <InlineCode>https://www.docker.com/products/docker-desktop/</InlineCode>
              ติดตั้งแล้วเปิดค้างไว้ (ต้องเห็นวาฬสีเขียว)
            </P>
          </Step>
          <Step num={2} title="Clone + ตั้งค่า">
            <Code>{`git clone <repo-url> sml-gateway
cd sml-gateway
cp .env.example .env.local`}</Code>
            <P>แก้ <InlineCode>.env.local</InlineCode> ใส่ API key ของ provider ที่อยากใช้ (ไม่ต้องใส่ครบทุกตัว)</P>
          </Step>
          <Step num={3} title="Build + Start">
            <Code>{`docker compose up -d --build`}</Code>
            <P>รอ build ครั้งแรก 3-10 นาที จากนั้นเปิด <InlineCode>${apiBase}/</InlineCode></P>
          </Step>
          <Step num={4} title="ใส่ API keys ผ่าน Dashboard">
            <P>
              ในหน้า dashboard กดปุ่ม <strong>Setup</strong> ใส่ API key ของแต่ละ provider
              (หรือกดปุ่ม <strong>Test</strong> ข้างๆ เพื่อเช็คว่า key ใช้ได้ก่อน save)
            </P>
          </Step>
          <Step num={5} title="รอ worker สแกน">
            <P>
              หลังใส่ key worker จะ scan + exam model อัตโนมัติใน 1-2 นาที
              (ดู progress ได้จากหน้า dashboard section &ldquo;สมุดจดงาน&rdquo;)
            </P>
          </Step>

          <SubTitle>Reset ข้อมูล (เริ่มใหม่)</SubTitle>
          <Code>{`docker compose down
docker volume rm sml-gateway_sml-gateway-data
docker compose up -d --build`}</Code>
        </Section>

        <Section id="auth" icon="&#128274;" title="การยืนยันตัวตน — 3 แบบเลือกใช้">
          <P>
            ระบบรองรับ 3 วิธี login admin. <strong>Auto-detect จาก <InlineCode>.env</InlineCode></strong> —
            ตั้ง env ของ method ไหน = method นั้นเปิด. ไม่มี <InlineCode>AUTH_MODE</InlineCode> flag.
          </P>

          <SubTitle>3 แบบ</SubTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-xs uppercase">
                  <th className="text-left py-2 pr-4">แบบ</th>
                  <th className="text-left py-2 pr-4">Trigger env</th>
                  <th className="text-left py-2 pr-4">เหมาะกับ</th>
                  <th className="text-left py-2">Session</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                <tr>
                  <td className="py-2 pr-4"><span className="text-blue-400 font-bold">①</span> Google OAuth</td>
                  <td className="py-2 pr-4 font-mono text-[11px]">GOOGLE_CLIENT_ID<br/>+ GOOGLE_CLIENT_SECRET<br/>+ NEXTAUTH_SECRET<br/>+ NEXTAUTH_URL</td>
                  <td className="py-2 pr-4">ทีมที่มี Gmail, audit per-email</td>
                  <td className="py-2">JWT 30 วัน</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4"><span className="text-amber-400 font-bold">②</span> Admin Password</td>
                  <td className="py-2 pr-4 font-mono text-[11px]">ADMIN_PASSWORD</td>
                  <td className="py-2 pr-4">ไม่มี Gmail / airgap / break-glass</td>
                  <td className="py-2">HMAC cookie 7 วัน</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4"><span className="text-gray-400 font-bold">③</span> Bearer Key</td>
                  <td className="py-2 pr-4 font-mono text-[11px]">GATEWAY_API_KEY</td>
                  <td className="py-2 pr-4">CI / SDK / curl / automation</td>
                  <td className="py-2">stateless (ใส่ทุก request)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <Info>
            <strong>Local mode</strong> (ไม่ตั้ง env ของวิธีใดเลย) → UI + API เปิดหมด ไม่มี auth — เหมาะสำหรับ Docker Desktop
          </Info>

          <SubTitle>3 สถานการณ์ใช้งานจริง</SubTitle>

          <P><strong>A) เล่นบนเครื่องตัวเอง</strong> — <InlineCode>.env.local</InlineCode> ปล่อยว่าง</P>
          <Code>{`# เครื่องส่วนตัว — ไม่มี auth ทุก endpoint เปิด
# ว่างเปล่า = local mode`}</Code>

          <P><strong>B) VPS + Password</strong> — ง่ายสุด ไม่ต้องพึ่ง Google</P>
          <Code>{`# .env.production บน VPS
GATEWAY_API_KEY=sk-gw-<generate>         # SDK / curl
ADMIN_PASSWORD=<random-24-base64>        # admin UI login (7-day cookie)
AUTH_OWNER_EMAIL=admin@example.com       # metadata (แสดง audit)

# Generate:
#   node -e "console.log('sk-gw-' + require('crypto').randomBytes(32).toString('hex'))"
#   node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[+/=]/g,''))"`}</Code>

          <P><strong>C) VPS + Domain + HTTPS + Google OAuth</strong> — production-grade</P>
          <Code>{`# .env.production บน VPS
GATEWAY_API_KEY=sk-gw-<generate>
ADMIN_PASSWORD=<random-24-base64>        # fallback เผื่อ Google ล่ม

AUTH_OWNER_EMAIL=alice@gmail.com,bob@gmail.com,cto@gmail.com
GOOGLE_CLIENT_ID=<google-console>
GOOGLE_CLIENT_SECRET=<google-console>
NEXTAUTH_SECRET=<random-32-base64>
NEXTAUTH_URL=https://your-domain.com

# Google Console redirect URI:
#   {NEXTAUTH_URL}/api/auth/callback/google`}</Code>

          <SubTitle>Auth chain (first match wins)</SubTitle>
          <Code>{`/admin/* + mutating /api/*  →  1. Bearer GATEWAY_API_KEY     →  pass
                             →  2. Signed sml_admin cookie  →  pass  (password)
                             →  3. Google session + owner   →  pass  (OAuth)
                             →  else  →  /login (page) หรือ 401 (API)

/v1/*   →  Bearer sk-gw-* (master) หรือ Bearer sml_live_* เท่านั้น`}</Code>

          <SubTitle>2 ชนิด Bearer key สำหรับ `/v1/*`</SubTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-xs uppercase">
                  <th className="text-left py-2 pr-4">Key</th>
                  <th className="text-left py-2 pr-4">/v1/*</th>
                  <th className="text-left py-2 pr-4">/api/admin/*</th>
                  <th className="text-left py-2">ที่มา</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                <tr><td className="py-2 pr-4"><InlineCode>sk-gw-...</InlineCode> (master)</td><td className="py-2 pr-4 text-emerald-300">✅</td><td className="py-2 pr-4 text-emerald-300">✅</td><td className="py-2">ตั้งใน .env</td></tr>
                <tr><td className="py-2 pr-4"><InlineCode>sml_live_...</InlineCode></td><td className="py-2 pr-4 text-emerald-300">✅</td><td className="py-2 pr-4 text-red-300">❌</td><td className="py-2">admin ออกที่ /admin/keys</td></tr>
              </tbody>
            </table>
          </div>

          <SubTitle>Admin ออก key ให้ client</SubTitle>
          <P>
            Admin login (Google หรือ Password) → เข้า{" "}
            <a href="/admin/keys" className="text-indigo-300 hover:underline">/admin/keys</a>{" "}
            → กรอก label + expiry (optional) → กด <strong>+ สร้าง key</strong>
            → แสดง <InlineCode>sml_live_...</InlineCode> ครั้งเดียว (copy ส่ง client)
          </P>
          <P>
            Key เก็บใน DB เป็น SHA-256 hash — ดูย้อนหลังไม่ได้, revoke/pause ได้รายตัว, มี <InlineCode>last_used_at</InlineCode> audit
          </P>

          <Info>
            <strong>เพิ่ม admin email ใหม่</strong> — แก้ <InlineCode>AUTH_OWNER_EMAIL</InlineCode> ใน <InlineCode>.env</InlineCode> → restart
            <br />
            <span className="text-xs">ssh droplet → <InlineCode>nano /opt/sml-gateway/.env.production</InlineCode> → <InlineCode>bash scripts/deploy-droplet.sh</InlineCode></span>
          </Info>

          <SubTitle>🔌 Admin API (ops / automation)</SubTitle>
          <P>ทุก endpoint ต้อง auth เหมือนหน้า admin (master Bearer / cookie / Google):</P>
          <Code>{`# จัดการ gateway keys
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
}`}</Code>
          <p className="text-xs text-gray-400 leading-relaxed">
            <strong>warnings</strong> = (provider, model) ที่มี fail streak ≥ 3 ใน 30 วินาที แต่ยังไม่ trip — early warning ก่อน circuit open.
            Dashboard section <strong>⚡ ประสิทธิภาพ</strong> แสดง 8 cards real-time (refresh 15s) + การ์ดแดง <strong>🚨 Circuits open: X</strong> เมื่อมี trip &gt; 0
          </p>
        </Section>

        <Section id="openclaw" icon="&#128187;" title="เชื่อม OpenClaw">
          <Info>
            OpenClaw เป็น AI coding assistant ที่รันบน terminal — เชื่อมกับ SMLGateway เพื่อใช้ model ฟรีได้ไม่จำกัด
          </Info>

          <SubTitle>วิธีที่ 1: OpenClaw รันบน Docker</SubTitle>
          <P>ถ้า OpenClaw อยู่คนละ container กับ gateway ต้องใช้ <InlineCode>host.docker.internal</InlineCode>:</P>
          <Code>{`openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://host.docker.internal:3334/v1 \\
  --custom-model-id sml/auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`}</Code>

          <SubTitle>วิธีที่ 2: OpenClaw บนเครื่องโดยตรง (Native)</SubTitle>
          <Code>{`openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url ${apiBase}/v1 \\
  --custom-model-id sml/auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`}</Code>

          <SubTitle>ตรวจสอบ openclaw.json</SubTitle>
          <P>หลัง onboard ไฟล์ <InlineCode>~/.openclaw/openclaw.json</InlineCode> จะหน้าตาแบบนี้:</P>
          <Code>{`{
  "models": {
    "providers": {
      "custom-host-docker-internal-3334": {
        "baseUrl": "http://host.docker.internal:3334/v1",
        "apiKey": "dummy",
        "api": "openai-completions",
        "models": [{ "id": "sml/auto", "contextWindow": 131072 }]
      }
    }
  }
}`}</Code>
          <Info>
            ถ้า <InlineCode>contextWindow</InlineCode> น้อยกว่า 131072 ให้แก้เป็น 131072 เพราะ OpenClaw
            ส่ง system prompt ใหญ่มาก &bull; <InlineCode>api</InlineCode> ต้องเป็น
            <InlineCode>openai-completions</InlineCode>
          </Info>

          <SubTitle>แก้ปัญหา &ldquo;origin not allowed&rdquo;</SubTitle>
          <Code>{`{
  "apiProvider": "openai-completions",
  "openAiBaseUrl": "http://host.docker.internal:3334/v1",
  "openAiModelId": "sml/auto",
  "openAiApiKey": "dummy",
  "contextWindow": 131072,
  "gateway": {
    "bind": "lan",
    "allowedOrigins": [
      "http://host.docker.internal:3334",
      "${apiBase}"
    ]
  }
}`}</Code>
        </Section>

        <Section id="hermes" icon="&#129422;" title="เชื่อม Hermes Agent">
          <Info>
            <a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noopener noreferrer" className="underline">Hermes Agent</a>
            {" "}— self-improving AI agent จาก Nous Research (ปล่อย ก.พ. 2026, ≥95k⭐)
            มี built-in tools (terminal, file, web search, memory) + เรียนรู้ skill ข้ามเซสชัน
            เชื่อมกับ SMLGateway ด้วยการตั้ง <InlineCode>base_url</InlineCode> ใน <InlineCode>~/.hermes/config.toml</InlineCode> ตัวเดียว
          </Info>

          <SubTitle>1. ติดตั้ง Hermes</SubTitle>
          <P>ต้องมี Python 3.11+ (Windows ใช้ WSL2 เท่านั้น — native ไม่รองรับ)</P>
          <Code>{`curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# ตรวจว่าติดตั้งสำเร็จ
hermes --version`}</Code>
          <P>
            ทางเลือก manual: <InlineCode>git clone</InlineCode> repo → <InlineCode>python -m venv venv</InlineCode> → <InlineCode>pip install -r requirements.txt</InlineCode> → <InlineCode>python setup.py</InlineCode>
          </P>

          <SubTitle>2. Config ให้ชี้มา SMLGateway</SubTitle>
          <P>แก้ <InlineCode>~/.hermes/config.toml</InlineCode> ตรงๆ (base_url override provider built-in เสมอ):</P>
          <Code>{`# ~/.hermes/config.toml
[model]
provider = "custom"
base_url = "${apiBase}/v1"
api_key_env = "SML_GATEWAY_KEY"
model = "sml/auto"

# ถ้าอยาก Thai-first ให้ fallback ไป sml/thai เมื่อ primary ตก
[model.fallback]
provider = "custom"
base_url = "${apiBase}/v1"
model = "sml/thai"

[agent]
name = "Hermes"
memory = true
skills_dir = "~/.hermes/skills"`}</Code>

          <SubTitle>3. ใส่ API Key</SubTitle>
          <Code>{`echo 'SML_GATEWAY_KEY=<sml_live_xxxxxxxxxxxx>' >> ~/.hermes/.env

# Local mode (no auth) — ใช้ dummy ได้
# echo 'SML_GATEWAY_KEY=dummy' >> ~/.hermes/.env`}</Code>
          <P>Key สร้างได้ที่ <a href="/admin/keys" className="text-indigo-300 hover:underline">/admin/keys</a> (owner only)</P>

          <SubTitle>4. ใช้งาน / เปลี่ยน model</SubTitle>
          <Code>{`hermes "refactor this repo to use async/await"

# สลับ model ระหว่างใช้งาน (Hermes รองรับ live switch)
hermes model   # เลือกจาก list
hermes tools   # เปิด/ปิด built-in tools
hermes setup   # wizard แก้ทุกอย่างพร้อมกัน`}</Code>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
            <span className="text-amber-400 text-lg shrink-0">&#9888;</span>
            <div className="text-sm text-amber-200 leading-relaxed">
              <strong>ข้อบังคับ Hermes:</strong> model ต้องมี context ≥ 64k tokens — ถ้าต่ำกว่านั้น
              Hermes จะ reject ที่ startup. <InlineCode>sml/auto</InlineCode> ของ SMLGateway กรอง context &lt; 32k
              ทิ้งไปแล้ว ดังนั้นส่วนใหญ่ผ่านเกณฑ์ แต่ถ้า route ไปเจอ model 32k อาจขัด —
              ใช้ header <InlineCode>X-SMLGateway-Max-Latency</InlineCode> + preset <InlineCode>strongest</InlineCode> ช่วยคัด
            </div>
          </div>

          <SubTitle>ตัวเลือก: ใช้ Nous Portal เป็น fallback</SubTitle>
          <P>
            ถ้าอยาก dual-provider (SMLGateway เป็นหลัก + Nous Portal เป็น backup) ตั้งใน config.toml:
          </P>
          <Code>{`[model.fallback]
provider = "nous-portal"
api_key_env = "NOUS_API_KEY"
model = "Hermes-3-Llama-3.1-405B"`}</Code>
        </Section>

        <Section id="api" icon="&#128279;" title="API Reference">
          <SubTitle>Endpoints</SubTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-gray-400 text-xs uppercase">
                  <th className="text-left py-2 pr-4">Method</th>
                  <th className="text-left py-2 pr-4">Path</th>
                  <th className="text-left py-2">คำอธิบาย</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ["POST", "/v1/chat/completions", "Chat — text / vision / tools / streaming"],
                  ["GET", "/v1/models", "รายชื่อ model ทั้งหมด (OpenAI format)"],
                  ["GET", "/v1/models/:id", "ดึงข้อมูล model — รองรับ ID มี / เช่น sml/tools, groq/vendor/model"],
                  ["GET", "/v1/models/search", "ค้นหา/จัดอันดับ model ตาม category, context, ฯลฯ"],
                  ["POST", "/v1/compare", "ยิง prompt ไปหลาย model พร้อมกัน (≤10)"],
                  ["POST", "/v1/structured", "Chat + JSON schema validation + auto-retry"],
                  ["GET", "/v1/trace/:reqId", "ดู log ของ request เดิม"],
                  ["GET", "/v1/prompts", "รายการ system prompts ที่บันทึกไว้"],
                  ["POST", "/v1/prompts", "สร้าง/เขียนทับ prompt"],
                  ["GET", "/v1/prompts/:name", "ดึง prompt"],
                  ["PUT", "/v1/prompts/:name", "แก้ไข"],
                  ["DELETE", "/v1/prompts/:name", "ลบ"],
                  ["GET", "/api/my-stats", "สรุปการใช้งานของ IP ตัวเอง"],
                  ["POST", "/v1/embeddings", "Embeddings (openrouter / mistral / ollama)"],
                  ["POST", "/v1/completions", "Legacy completions"],
                ].map(([m, p, d]) => (
                  <tr key={p}>
                    <td className="py-2 pr-4"><span className={`font-mono text-xs font-bold ${m === "POST" ? "text-emerald-300" : m === "GET" ? "text-blue-300" : m === "PUT" ? "text-amber-300" : "text-rose-300"}`}>{m}</span></td>
                    <td className="py-2 pr-4"><InlineCode>{p}</InlineCode></td>
                    <td className="py-2 text-gray-300">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SubTitle>Response Headers พิเศษ</SubTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-white/5">
                {[
                  ["X-SMLGateway-Model", "model จริงที่ถูกเลือกใช้"],
                  ["X-SMLGateway-Provider", "provider ที่เรียกจริง (groq/nvidia/cerebras/...)"],
                  ["X-SMLGateway-Request-Id", "ใช้กับ /v1/trace/:reqId เพื่อดูรายละเอียด"],
                  ["X-SMLGateway-Hedge", "true ถ้า response มาจาก hedge winner"],
                  ["X-SMLGateway-Cache", "HIT ถ้าดึงจาก semantic cache"],
                  ["X-SMLGateway-Consensus", "รายชื่อ model (เฉพาะ sml/consensus)"],
                  ["X-Resceo-Backoff", "true ถ้ายิงถี่เกิน soft limit (hint, ไม่บล็อก)"],
                ].map(([h, d]) => (
                  <tr key={h}>
                    <td className="py-2 pr-4"><InlineCode>{h}</InlineCode></td>
                    <td className="py-2 text-gray-300">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SubTitle>ตัวอย่าง: Vision (ส่งรูป)</SubTitle>
          <Code>{`curl ${apiBase}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "sml/auto",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "อธิบายรูปนี้"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }]
  }'`}</Code>

          <SubTitle>ตัวอย่าง: Tool Calling</SubTitle>
          <Code>{`curl ${apiBase}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "sml/tools",
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
  }'`}</Code>
        </Section>

        <Section id="dev-tools" icon="&#128736;" title="Dev Tools — สิ่งพิเศษสำหรับนักพัฒนา">
          <P>
            SMLGateway มี endpoint ช่วย dev ทำงานได้เร็วขึ้น — ไม่ต้องเขียน retry,
            ไม่ต้องรู้จัก model ทุกตัว, ไม่ต้องเก็บ prompt ยาวๆ ใน code
          </P>

          <SubTitle>1. ค้นหา Model ตาม Capability</SubTitle>
          <P>
            หา model ที่เก่งด้านที่ต้องการ — category, context, tools support ฯลฯ
          </P>
          <Code>{`# หา model ภาษาไทยที่รับ context 200K+ ท็อป 3
curl "${apiBase}/v1/models/search?category=thai&min_context=200000&top=3"

# หา model tools calling
curl "${apiBase}/v1/models/search?category=code&supports_tools=1&top=5"`}</Code>
          <P>
            Query params: <InlineCode>category</InlineCode> (thai/code/tools/vision/math/
            reasoning/json/instruction/extraction/classification/comprehension/safety),
            <InlineCode>min_context</InlineCode>, <InlineCode>max_context</InlineCode>,
            <InlineCode>supports_tools</InlineCode>, <InlineCode>supports_vision</InlineCode>,
            <InlineCode>provider</InlineCode>, <InlineCode>tier</InlineCode>,
            <InlineCode>exclude_cooldown</InlineCode>, <InlineCode>top</InlineCode>
          </P>

          <SubTitle>2. เปรียบเทียบ Model</SubTitle>
          <P>
            ยิง prompt เดียวไปหลาย model พร้อมกัน → เปรียบเทียบ content + latency
          </P>
          <Code>{`curl -X POST ${apiBase}/v1/compare \\
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
  }'`}</Code>

          <SubTitle>3. Structured Output (JSON Schema + Auto-retry)</SubTitle>
          <P>
            ต้องการ JSON ตาม schema ที่กำหนด — ระบบ validate + retry (default 2 ครั้ง) ให้
            ไม่ต้องเขียน parse/retry logic เอง
          </P>
          <Code>{`curl -X POST ${apiBase}/v1/structured \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "sml/auto",
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

# Response: { ok, attempts, data: { name, color, taste, sweetness }, model, provider, latency_ms, request_ids }`}</Code>

          <SubTitle>4. Prompt Library</SubTitle>
          <P>
            เก็บ system prompt ยาวๆ ไว้เรียกใช้ด้วยชื่อ — ไม่ต้องฝังใน client code
          </P>
          <Code>{`# สร้าง
curl -X POST ${apiBase}/v1/prompts \\
  -H "Content-Type: application/json" \\
  -d '{"name":"pirate","content":"You are a pirate. Short answers only.","description":"Pirate persona"}'

# ใช้ในแชท — แค่ใส่ "prompt": "pirate"
curl -X POST ${apiBase}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"sml/auto","prompt":"pirate","messages":[{"role":"user","content":"how to fish"}]}'

# รายการทั้งหมด
curl ${apiBase}/v1/prompts

# แก้ไข / ลบ
curl -X PUT    ${apiBase}/v1/prompts/pirate -d '{...}'
curl -X DELETE ${apiBase}/v1/prompts/pirate`}</Code>

          <SubTitle>5. Trace — Debug Request ย้อนหลัง</SubTitle>
          <P>
            ทุก response มี <InlineCode>X-SMLGateway-Request-Id</InlineCode> → เอาไปเรียก
            trace endpoint ดูได้ว่าเกิดอะไรกับ request นั้นๆ
          </P>
          <Code>{`# ยิง chat ธรรมดา
curl -D - ${apiBase}/v1/chat/completions \\
  -d '{"model":"sml/auto","messages":[{"role":"user","content":"hi"}]}'
# → response headers มี: X-SMLGateway-Request-Id: 5m3obi

# ดู trace
curl ${apiBase}/v1/trace/5m3obi
# → { requestId, found, entry: { resolved_model, provider, latency_ms, input_tokens, ... } }`}</Code>

          <SubTitle>6. Usage Stats ของ IP ตัวเอง</SubTitle>
          <Code>{`curl "${apiBase}/api/my-stats?window=24h"
# → { total, success, p50_latency_ms, p95_latency_ms, p99_latency_ms,
#     top_models: [...], by_hour: [...] }
# window: 1h | 6h | 24h | 7d | 30d`}</Code>

          <SubTitle>7. Control Headers — บังคับ/หลีกเลี่ยง Provider</SubTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-white/5">
                {[
                  ["X-SMLGateway-Prefer", "groq,cerebras", "ดัน provider เหล่านี้ขึ้นบนสุด"],
                  ["X-SMLGateway-Exclude", "mistral", "ตัด provider เหล่านี้ออก"],
                  ["X-SMLGateway-Max-Latency", "3000", "กรอง model ที่ avg_latency เกินนี้ (ms)"],
                  ["X-SMLGateway-Strategy", "fastest", "เรียงตาม latency asc"],
                  ["X-SMLGateway-Strategy", "strongest", "เรียงตาม tier + context desc"],
                ].map(([h, v, d], i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4"><InlineCode>{h}</InlineCode></td>
                    <td className="py-2 pr-4"><InlineCode>{v}</InlineCode></td>
                    <td className="py-2 text-gray-300">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Code>{`curl -X POST ${apiBase}/v1/chat/completions \\
  -H "X-SMLGateway-Prefer: groq,cerebras" \\
  -H "X-SMLGateway-Exclude: mistral" \\
  -H "X-SMLGateway-Strategy: fastest" \\
  -H "X-SMLGateway-Max-Latency: 3000" \\
  -d '{"model":"sml/auto","messages":[...]}'`}</Code>
        </Section>

        <Section id="benchmark" icon="&#127891;" title="ระบบสอบ (Benchmark)">
          <P>
            SMLGateway มีระบบสอบวัดผล model อัตโนมัติ — ใช้ &ldquo;AI ตรวจ AI&rdquo;
            (model หนึ่งเป็นนักเรียน อีกตัวเป็นครู) เพื่อคัดเฉพาะ model ที่ตอบคำถามได้ถูกต้องจริง
          </P>
          <SubTitle>โครงสร้างโรงเรียน</SubTitle>
          <ul className="list-none space-y-2 text-sm text-gray-300">
            <li>&#128081; <strong>Principal (ครูใหญ่)</strong> — 1 ตัว, model ที่คะแนนรวมสูงสุด มี tools รองรับ (ใช้ตัดสินข้อพิพาท)</li>
            <li>&#128203; <strong>Head (ครูประจำวิชา)</strong> — 1 ตัวต่อหมวด, model ที่ทำคะแนน &ge; 80% ในหมวดนั้น (classification, code, comprehension, extraction, instruction, json, math, reasoning, safety, thai, tools, vision)</li>
            <li>&#128101; <strong>Proctor (ผู้คุมสอบ)</strong> — สูงสุด 10 ตัว, ทำหน้าที่ยิงคำถามวัด latency ไม่มีสิทธิ์ตัดสิน</li>
          </ul>
          <SubTitle>วิธีคัดเลือก</SubTitle>
          <P>
            ข้อสอบ 4 ระดับ (cumulative) — ทุกรอบ worker (15 นาที) จะจัดสอบ model ใหม่ตามระดับที่ตั้งไว้ใน{" "}
            <InlineCode>worker_state.exam_level</InlineCode> เก็บคะแนนลง{" "}
            <InlineCode>model_category_scores</InlineCode> แล้วเลือกครูอัตโนมัติ
            model เดียวสามารถเป็น head หลายหมวดได้ (คนเก่งหลายอย่าง)
          </P>
          <ul className="list-none space-y-1 text-sm text-gray-300">
            <li>&#128994; <strong>ประถม (primary)</strong> — 5 ข้อ, ผ่าน &ge; 40%</li>
            <li>&#128993; <strong>มัธยมต้น (middle)</strong> — 14 ข้อ, ผ่าน &ge; 50% <em className="text-gray-500">(default)</em></li>
            <li>&#128992; <strong>มัธยมปลาย (high)</strong> — 22 ข้อ, ผ่าน &ge; 60%</li>
            <li>&#128308; <strong>มหาลัย (university)</strong> — 30 ข้อ, ผ่าน &ge; 70%</li>
          </ul>
          <SubTitle>เปลี่ยนระดับ + สั่งสอบใหม่</SubTitle>
          <P>
            ตั้งค่าระดับใน dashboard section <strong>&#127962; ระดับสอบ</strong> (คลิกการ์ด → save อัตโนมัติ)
            หรือ <InlineCode>POST /api/exam-config {`{ "level": "middle" }`}</InlineCode>.
            สั่งสอบใหม่ทุกคน: ปุ่ม &ldquo;&#128260; สอบใหม่ทุกคน&rdquo; (กด 2 ครั้งยืนยัน) หรือ{" "}
            <InlineCode>POST /api/exam-reset</InlineCode> — ล้าง <InlineCode>exam_attempts</InlineCode> +
            <InlineCode>model_category_scores</InlineCode> แล้ว trigger worker ทันที
          </P>
        </Section>

        <Section id="troubleshoot" icon="&#128736;" title="แก้ปัญหา">
          <SubTitle>เช็คทีละข้อ</SubTitle>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
            <li>Docker Desktop เปิดอยู่ไหม? (ไอคอนวาฬสีเขียว)</li>
            <li>Container health ไหม? <InlineCode>docker ps --filter name=sml-gateway</InlineCode></li>
            <li>เปิด <InlineCode>${apiBase}/</InlineCode> เห็น dashboard ไหม?</li>
            <li>Worker สแกนเสร็จไหม? มี model พร้อมใช้กี่ตัว? (ดูจาก dashboard &ldquo;คณะครู&rdquo;)</li>
            <li>ทดสอบ: <InlineCode>curl ${apiBase}/v1/models</InlineCode> ตอบ list กลับไหม?</li>
            <li>ถ้า Docker: base URL เป็น <InlineCode>host.docker.internal:3334</InlineCode> ไหม?</li>
          </ul>

          <SubTitle>404 model not found (sml/tools, groq/vendor/model)</SubTitle>
          <P>
            model ID ที่มี <InlineCode>/</InlineCode> เช่น <InlineCode>sml/tools</InlineCode> หรือ <InlineCode>groq/vendor/model</InlineCode>
            ต้องใช้ได้ตามปกติ — ตรวจสอบได้เลย:
          </P>
          <Code>{`# virtual models (sml/auto, sml/fast, sml/tools, sml/thai, sml/consensus)
curl ${apiBase}/v1/models/sml/tools
# → { "id": "sml/tools", "object": "model", ... }

# provider/model format
curl ${apiBase}/v1/models/groq/llama-3.3-70b-versatile
# → { "id": "groq/llama-3.3-70b-versatile", ... }

# ถ้าได้ HTML หรือ 404 — ให้ rebuild container
docker compose up -d --build sml-gateway`}</Code>

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
            ดู quota ที่เหลือได้ที่ dashboard section &ldquo;โควต้า&rdquo;
          </P>

          <SubTitle>Cooldown cascade (503 เยอะ)</SubTitle>
          <P>
            ถ้าเจอ 503 บ่อย แปลว่า candidate pool แคบเกิน —
            ลองเปิด provider เพิ่มใน setup modal หรือเช็ค health_logs ใน DB:
          </P>
          <Code>{`docker exec sml-gateway-postgres-1 psql -U sml -d smlgateway \\
  -c "SELECT COUNT(*) FROM health_logs WHERE cooldown_until > now();"`}</Code>
        </Section>

        <div className="text-center text-xs text-gray-600 py-8">
          SMLGateway &bull; AI Gateway &bull; Local Docker only
        </div>
      </main>
    </div>
  );
}
