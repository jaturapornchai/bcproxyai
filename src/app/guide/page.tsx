"use client";

import { useState } from "react";

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

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
      <span className="text-amber-400 text-lg shrink-0">&#9888;</span>
      <div className="text-sm text-amber-200 leading-relaxed">{children}</div>
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

type Lang = "nextjs" | "python" | "curl" | "langchain" | "openclaw" | "any";

const SNIPPETS: Record<Lang, { label: string; code: string; note?: string }> = {
  nextjs: {
    label: "Next.js / Node",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:3334/v1",
  apiKey: "dummy",              // ไม่ต้องใช้ key จริง
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
    base_url="http://localhost:3334/v1",
    api_key="dummy",            # ไม่ต้องใช้ key จริง
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
    code: `curl http://localhost:3334/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "sml/auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}]
  }'

# streaming
curl http://localhost:3334/v1/chat/completions \\
  -H "Content-Type: application/json" \\
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
    base_url="http://localhost:3334/v1",
    api_key="dummy",
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
  openclaw: {
    label: "OpenClaw",
    code: `# Docker — OpenClaw อยู่คนละ container
docker exec <openclaw-container> \\
  openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://host.docker.internal:3334/v1 \\
  --custom-model-id sml/auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui

# Local — OpenClaw รันบนเครื่องเดียวกัน
openclaw onboard \\
  --non-interactive --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://localhost:3334/v1 \\
  --custom-model-id sml/auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels --skip-daemon \\
  --skip-health --skip-search \\
  --skip-skills --skip-ui`,
    note: "Docker ใช้ host.docker.internal แทน localhost",
  },
  any: {
    label: "ทุก Framework",
    code: `Endpoint:    http://localhost:3334/v1/chat/completions
API Key:     dummy   (ใส่อะไรก็ได้ ไม่มี auth)
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

ตัวอย่าง config ใน framework ต่างๆ:
  Vercel AI SDK:  createOpenAI({ baseURL, apiKey: "dummy" })
  LiteLLM:        model="openai/sml/auto", api_base="..."
  Dify:           Custom Model Provider → OpenAI-compatible
  LobeChat:       Settings → OpenAI → Base URL
  AutoGen:        config_list: [{ base_url, api_key: "dummy" }]
  Continue.dev:   models: [{ provider: "openai", apiBase, apiKey: "dummy" }]`,
  },
};

function QuickConnect() {
  const [lang, setLang] = useState<Lang>("nextjs");
  const [copied, setCopied] = useState(false);
  const snippet = SNIPPETS[lang];

  const copy = () => {
    navigator.clipboard.writeText(snippet.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tabs: Lang[] = ["nextjs", "python", "curl", "langchain", "openclaw", "any"];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[
          { label: "Base URL", value: "http://localhost:3334/v1", color: "text-indigo-300" },
          { label: "API Key", value: "dummy (ใส่อะไรก็ได้)", color: "text-amber-300" },
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
            {SNIPPETS[t].label}
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
  { id: "openclaw", label: "OpenClaw" },
  { id: "api", label: "API Reference" },
  { id: "benchmark", label: "ระบบสอบ" },
  { id: "troubleshoot", label: "แก้ปัญหา" },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="sticky top-0 z-40 glass-bright border-b border-indigo-500/20 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 text-indigo-300 hover:text-white text-sm">
            <span>&larr;</span>
            <span>Dashboard</span>
          </a>
          <h1 className="text-lg font-bold text-white">คู่มือ SMLGateway</h1>
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
            AI Gateway ที่รวม 26 ผู้ให้บริการ AI ฟรีไว้ที่เดียว — OpenAI-compatible API
            เชื่อมต่อได้ทุก framework ใช้งานผ่าน <InlineCode>sml/auto</InlineCode> ระบบเลือก model ที่ดีที่สุดให้อัตโนมัติ
          </p>
        </div>

        <Warn>
          <strong>ใช้งาน local เท่านั้น</strong> — ระบบไม่มี authentication ห้าม expose ออก internet
          (ถ้า traffic ทั้งหมดออกจาก IP เดียว provider จะ lock IP ทั้งหมด)
        </Warn>

        <Section id="quick-connect" icon="&#9889;" title="เชื่อมต่อเร็ว">
          <P>
            SMLGateway เป็น OpenAI-compatible API — client library ทุกตัวที่ใช้ OpenAI SDK ได้
            ชี้ <InlineCode>baseURL</InlineCode> มาที่ <InlineCode>http://localhost:3334/v1</InlineCode> ก็ใช้ได้ทันที
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
            ระบบมี worker หลังบ้านคอย scan model ใหม่ ทดสอบ benchmark 25 ข้อ และเลือกครู
            (teachers) ที่เก่งในแต่ละหมวดไว้เป็น grader ให้คะแนน model ตัวอื่น
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
            <P>รอ build ครั้งแรก 3-10 นาที จากนั้นเปิด <InlineCode>http://localhost:3334/</InlineCode></P>
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
  --custom-base-url http://localhost:3334/v1 \\
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
      "http://localhost:3334"
    ]
  }
}`}</Code>
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
                  ["POST", "/v1/chat/completions", "Chat — รองรับ text, vision, tools, streaming"],
                  ["GET", "/v1/models", "รายชื่อ model ทั้งหมด (OpenAI format)"],
                  ["POST", "/v1/embeddings", "Embeddings (provider ที่รองรับ: openrouter, mistral, ollama)"],
                  ["POST", "/v1/completions", "Legacy completions (บาง provider)"],
                ].map(([m, p, d]) => (
                  <tr key={p}>
                    <td className="py-2 pr-4"><span className={`font-mono text-xs font-bold ${m === "POST" ? "text-emerald-300" : "text-blue-300"}`}>{m}</span></td>
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
                  ["X-SMLGateway-Provider", "provider ที่เรียกจริง (openrouter/groq/cerebras/...)"],
                  ["X-SMLGateway-Latency-Ms", "เวลาตอบกลับจริงของ provider"],
                  ["X-SMLGateway-Category", "หมวดที่ระบบ classify request ไว้ (thai/code/math/tools/...)"],
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
          <Code>{`curl http://localhost:3334/v1/chat/completions \\
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
          <Code>{`curl http://localhost:3334/v1/chat/completions \\
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
            ข้อสอบมี 25 ข้อ แบ่งเป็น 12 หมวด — ทุกรอบ worker (15 นาที) จะจัดสอบ model ใหม่
            เก็บคะแนนลง <InlineCode>model_category_scores</InlineCode> แล้วเลือกครูอัตโนมัติ
            model เดียวสามารถเป็น head หลายหมวดได้ (คนเก่งหลายอย่าง)
          </P>
          <SubTitle>เกณฑ์ผ่าน</SubTitle>
          <P>
            Model ต้องทำคะแนนรวม &ge; 85% ถึงจะเป็น <InlineCode>passed_exam = true</InlineCode>
            และเกณฑ์ 50% ขึ้นไปถึงจะเข้า routing pool ได้
          </P>
        </Section>

        <Section id="troubleshoot" icon="&#128736;" title="แก้ปัญหา">
          <SubTitle>เช็คทีละข้อ</SubTitle>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
            <li>Docker Desktop เปิดอยู่ไหม? (ไอคอนวาฬสีเขียว)</li>
            <li>Container health ไหม? <InlineCode>docker ps --filter name=sml-gateway</InlineCode></li>
            <li>เปิด <InlineCode>http://localhost:3334/</InlineCode> เห็น dashboard ไหม?</li>
            <li>Worker สแกนเสร็จไหม? มี model พร้อมใช้กี่ตัว? (ดูจาก dashboard &ldquo;คณะครู&rdquo;)</li>
            <li>ทดสอบ: <InlineCode>curl http://localhost:3334/v1/models</InlineCode> ตอบ list กลับไหม?</li>
            <li>ถ้า Docker: base URL เป็น <InlineCode>host.docker.internal:3334</InlineCode> ไหม?</li>
          </ul>

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
