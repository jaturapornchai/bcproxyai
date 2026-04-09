# BCProxyAI

**OpenAI-compatible LLM gateway ที่รวม model ฟรี จาก 26 providers ในจุดเดียว**
ระบบฉลาดขึ้นเองจากการใช้งาน — ไม่ต้องตั้งค่า ยิ่งใช้ยิ่งรู้จัก

---

## 💰 ประหยัดได้เท่าไหร่ (TL;DR)

**Free budget: ~20 พันล้าน tokens/เดือน** (คำนวณจาก documented TPD/TPM limits × practical utilization)

**แจกแจง token:** 80% input (16B) + 20% output (4B) = **20B tokens/month**

### 💵 เทียบเงินที่ประหยัดได้

| Model | Input $/1M | Output $/1M | **$/เดือน** | **฿/เดือน** | ฿/ปี |
|---|---:|---:|---:|---:|---:|
| 🏆 **Novita Llama 3.1 8B** (ถูกสุด) | $0.02 | $0.02 | **$400** | **฿14,000** | ฿168,000 |
| Groq paid (Llama 8B) | $0.06 | $0.06 | $1,200 | ฿42,000 | ฿504,000 |
| Gemini Flash-Lite | $0.10 | $0.40 | $3,200 | ฿112,000 | ฿1,344,000 |
| DeepSeek V3.2 | $0.14 | $0.28 | $3,360 | ฿117,600 | ฿1,411,200 |
| GPT-4o mini | $0.15 | $0.60 | $4,800 | ฿168,000 | ฿2,016,000 |
| DeepSeek V3 | $0.27 | $1.10 | $8,720 | ฿305,200 | ฿3,662,400 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $36,000 | ฿1,260,000 | ฿15,120,000 |
| **GPT-4o** | $2.50 | $10.00 | **$80,000** | **฿2,800,000** | ฿33,600,000 |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | **$108,000** | **฿3,780,000** | ฿45,360,000 |
| **Claude Opus 4.6** | $5.00 | $25.00 | **$180,000** | **฿6,300,000** | ฿75,600,000 |
| GPT-5 | $10.00 | $30.00 | $280,000 | ฿9,800,000 | ฿117,600,000 |
| **Claude Opus 4** (legacy) | $15.00 | $75.00 | **$540,000** | **฿18,900,000** | ฿226,800,000 |

**หมายเหตุ:** ราคาจาก [OpenAI Pricing](https://openai.com/api/pricing/) และ [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) (Apr 2026) · Exchange rate ฿35/USD

---

## ✨ Highlights

- 🎓 **Exam System** — Model ทุกตัวต้องผ่านสอบก่อนได้ทำงาน (rule-based 10 ข้อ, ผ่าน ≥ 70%)
- 🏆 **Category Winners** — เรียนรู้ว่า model ไหนเก่ง thai / code / math / tools / long-context
- 📏 **Self-Learning Rate Limits** — อ่าน `x-ratelimit-*` + parse 429 message เรียนรู้ TPM/TPD เอง
- 📐 **Capacity Learning** — p90 ของ token size ที่ model ทำได้จริง
- ⏳ **Exponential Cooldown** — 30s → 1m → 2 → 4 → 8 min cap, reset อัตโนมัติ
- ⚡ **Live Score EMA** — success rate อัพเดททุก request ไม่ต้องรอ benchmark
- 🔄 **Adaptive Exam Retry** — สอบใหม่บ่อยตาม production performance (1h – 7 วัน)
- 🌐 **26 Providers** — รวมทั้ง NVIDIA NIM, Chutes.ai, LLM7, Scaleway และอื่นๆ
- 🎛 **Provider Toggle** — เปิด/ปิด provider ผ่าน UI ไม่ต้อง restart
- 📊 **Full Observability** — Request ID trace ทั้ง chain, Thai dashboard

---

## 📦 Provider List — 26 ตัว

### Tier 1 — Free ถาวร (ไม่ต้องบัตรเครดิต)

| Provider | Free Limit | Models | Req/เดือน | Priority |
|---|---|---|---:|:---:|
| **NVIDIA NIM** | 1,000 credits (lifetime) | 168+ models (Llama, DeepSeek, Qwen, Nemotron) | 1,000 | ⭐⭐⭐⭐⭐ |
| **Groq** | 14,400 RPD × 7 models | Llama 3.1/3.3, Qwen, Kimi, Gemma | 3,024,000 | ⭐⭐⭐⭐⭐ |
| **Cerebras** | 1M tokens/day | Llama, Qwen, gpt-oss | 60,000 | ⭐⭐⭐⭐⭐ |
| **Mistral** | 1 RPS + 1B tok/mo | 60+ models (Mistral/Mixtral/Codestral) | 2,592,000 | ⭐⭐⭐⭐⭐ |
| **SambaNova** | 30 RPM × 12 models | Llama, Qwen 2.5 | 12,960,000 | ⭐⭐⭐⭐⭐ |
| **Chutes.ai** | Unlimited (community GPU) | DeepSeek R1, Qwen3-235B, Kimi K2 | 300,000+ | ⭐⭐⭐⭐⭐ |
| **LLM7.io** | 30 RPM (120 w/token) | DeepSeek R1, Qwen Coder, 27+ | 518,400 | ⭐⭐⭐⭐ |
| **Ollama Cloud** | 100 req/hour | gpt-oss:120b, deepseek-v3:671b, qwen3-coder:480b | 72,000 | ⭐⭐⭐⭐ |
| **Pollinations AI** | 1 req/hour (IP) / unlimited w/secret key | GPT-5, Claude, Gemini, DeepSeek | 30,000+ | ⭐⭐⭐⭐ |
| **Scaleway 🇪🇺** | 1M tokens lifetime | Qwen3-235B, gpt-oss, Gemma 3 | ~400 (one-time) | ⭐⭐⭐ |
| **Google AI (Gemini)** | 5-15 RPM / 100-1K RPD | Gemini 2.5 Pro/Flash/Flash-Lite | 48,000 | ⭐⭐⭐ |
| **Z.AI (GLM)** | Free signup credits | GLM-4.5, GLM-4-Flash (1M context) | 20,000 | ⭐⭐⭐ |
| **OpenRouter** | 50 RPD (1K w/$10 credit) | 30+ free models | 1,500 | ⭐⭐⭐ |
| **GitHub Models** | 50-150 RPD per model | GPT-4o, Llama, Mistral | 6,000 | ⭐⭐⭐ |
| **SiliconFlow 🇨🇳** | 50 RPD (1K w/$1) | Qwen3, DeepSeek R1 distill, GLM-4 | 30,000 | ⭐⭐ |
| **Cloudflare Workers AI** | 10K Neurons/day | Llama, Qwen, Gemma | 30,000 | ⭐⭐ |
| **Cohere** | 1,000/month fixed | Command R+, Rerank 3.5, Embed 4 | 1,000 | ⭐⭐ |
| **Ollama (local)** | Unlimited | Any local model | ∞ | ⭐⭐⭐⭐ |

### Tier 2 — Trial/Credits (อาจต้องบัตรเครดิต)

| Provider | Free Credits | Models | Req (est) |
|---|---|---|---:|
| **Reka AI** | **$10/เดือน auto-refresh** | Reka Flash, Reka Core | 4,000 |
| **Alibaba DashScope (Qwen)** | 1M tok input+output × 90 วัน | Qwen-Max/Plus/Turbo/VL, Coder | 133,000/mo |
| **Together AI** | $25 signup credit | 71 models (DeepSeek, Llama 4, Qwen, Mixtral) | 25,000 |
| **glhf.chat** | Beta free | ทุก HuggingFace model (Llama 405B, Qwen) | 10,000 |
| **Hyperbolic** | $1 signup + promos | Llama 405B, DeepSeek R1 | 2,500 |
| **HuggingFace** | $0.10/mo credits | 300+ community models | 2,000 |
| **Fireworks AI** | $1 signup | 50+ optimized models | 1,000 |
| **Kilo AI** | Optional key | AI gateway | varies |

**รวม: 22.1M requests/เดือน (theoretical max) / 6.65M (practical)**

---

## 🏗 Architecture

```
┌──────────────┐     3333      ┌───────────┐        ┌──────────────┐
│ OpenAI SDK / ├──────────────▶│ Caddy     │───────▶│ bcproxyai    │
│ น้องกุ้ง /    │    :3334      │ (proxy)   │        │ Next.js 16   │
│ OpenClaw     │               └───────────┘        └──────┬───────┘
└──────────────┘                                           │
                                                           ▼
            ┌─────────────────────────────────────────────┴───────────────────┐
            │                      Smart Routing Engine                        │
            │                                                                   │
            │  1. Filter: enabled + hasKey + passed_exam + not cooldown        │
            │  2. Category detect → boost winners                               │
            │  3. Rank: live_success × 100k + bench × 1k − latency             │
            │  4. Hedge race top-2 cloud                                        │
            │  5. Fail → exponential cooldown → next candidate                  │
            └──────┬──────────┬──────────┬──────────┬──────────┬──────────────┘
                   ▼          ▼          ▼          ▼          ▼
            ┌────────┐  ┌───────┐  ┌──────────┐  ┌────────┐  ┌──────────┐
            │ NVIDIA │  │ Groq  │  │ Cerebras │  │Mistral │  │ 22 more  │
            └────────┘  └───────┘  └──────────┘  └────────┘  └──────────┘

                     ┌──────────────┬──────────────┐
                     ▼              ▼              ▼
              ┌──────────┐   ┌──────────┐   ┌──────────┐
              │PostgreSQL│   │  Valkey  │   │  Caddy   │
              │   :5434  │   │   :6382  │   │   :3334  │
              └──────────┘   └──────────┘   └──────────┘
```

---

## 📦 Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| Runtime | Node.js + TypeScript 5 |
| UI | React 19 + Tailwind v4 |
| Database | PostgreSQL 17 (driver: `postgres`) |
| Cache/State | Valkey 8 (Redis-compatible) |
| Reverse Proxy | Caddy 2 |
| Scheduler | node-cron |
| Testing | Vitest |
| Load Testing | k6 |

## 🚢 Services (docker-compose)

| Container | Role | Host Port |
|---|---|---|
| `bcproxyai` | Next.js app (scalable) | internal `:3000` |
| `caddy` | In-compose reverse proxy / load balancer | **`:3334`** |
| `postgres` | PostgreSQL 17 | `:5434` |
| `redis` | Valkey 8 | `:6382` |

### Port Map

| Port | Service | หมายเหตุ |
|---|---|---|
| **3333** | BCProxyAI via **external** Caddy | timeout 300s, production |
| **3334** | BCProxyAI via **in-compose** Caddy | scaling, load balanced |
| 5434 | PostgreSQL (host) | |
| 6382 | Valkey (host) | |

---

## 🚀 ติดตั้ง (Installation Guide)

### Prerequisites

| Tool | Version | หมายเหตุ |
|---|---|---|
| Docker Desktop | 24+ | รองรับ docker compose v2 |
| Node.js | 20+ | สำหรับ dev/build ภายนอก (optional) |
| Git | 2.40+ | |

### Step 1: Clone + Setup

```bash
git clone https://github.com/jaturapornchai/bcproxyai.git
cd bcproxyai
cp .env.example .env.local
```

### Step 2: สมัคร API Key อย่างน้อย 1 provider

**แนะนำ 3 ตัวแรก (ฟรี ไม่ต้องบัตรเครดิต):**

#### 🥇 Groq (ฟรีสุดคุ้ม)
```bash
# 1. เข้า https://console.groq.com/keys
# 2. สมัคร account (Google/GitHub login ได้)
# 3. คลิก "Create API Key" → copy
# 4. ใส่ใน .env.local:
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
```

#### 🥈 NVIDIA NIM (168+ models)
```bash
# 1. เข้า https://build.nvidia.com/
# 2. Sign in ด้วย Google/GitHub/Email
# 3. เลือก model → คลิก "Get API Key" → copy
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxxxx
```

#### 🥉 Cerebras (เร็วที่สุด — LPU)
```bash
# 1. เข้า https://cloud.cerebras.ai/
# 2. Sign up → Dashboard → API Keys
# 3. Create API Key → copy
CEREBRAS_API_KEY=csk-xxxxxxxxxxxxxxxxx
```

**เพิ่ม provider อื่นๆ ทีหลังได้ (ผ่าน UI หรือแก้ `.env.local`):**

```bash
# Free ถาวร ไม่ต้องบัตรเครดิต
OPENROUTER_API_KEY=sk-or-v1-xxxx          # https://openrouter.ai/keys
GOOGLE_AI_API_KEY=xxxx                     # https://aistudio.google.com/apikey
SAMBANOVA_API_KEY=xxxx                     # https://cloud.sambanova.ai
MISTRAL_API_KEY=xxxx                       # https://console.mistral.ai
CHUTES_API_KEY=xxxx                        # https://chutes.ai/
LLM7_API_KEY=xxxx                          # https://token.llm7.io/
SCALEWAY_API_KEY=xxxx                      # https://console.scaleway.com/
POLLINATIONS_API_KEY=                      # https://enter.pollinations.ai/ (optional)
OLLAMA_CLOUD_API_KEY=xxxx                  # https://ollama.com/cloud
SILICONFLOW_API_KEY=xxxx                   # https://siliconflow.com/
GLHF_API_KEY=xxxx                          # https://glhf.chat/
ZAI_API_KEY=xxxx                           # https://z.ai/manage-apikey/apikey-list
DASHSCOPE_API_KEY=xxxx                     # https://bailian.console.alibabacloud.com/

# Trial credits
TOGETHER_API_KEY=xxxx                      # https://api.together.xyz/settings/api-keys
HYPERBOLIC_API_KEY=xxxx                    # https://app.hyperbolic.ai/signup
REKA_API_KEY=xxxx                          # https://platform.reka.ai/
COHERE_API_KEY=xxxx                        # https://dashboard.cohere.com/api-keys
FIREWORKS_API_KEY=xxxx                     # https://fireworks.ai/account/api-keys
HF_TOKEN=xxxx                              # https://huggingface.co/settings/tokens
GITHUB_MODELS_TOKEN=xxxx                   # https://github.com/settings/tokens
CLOUDFLARE_API_TOKEN=xxxx                  # https://dash.cloudflare.com/profile/api-tokens
CLOUDFLARE_ACCOUNT_ID=xxxx

# Judge (DeepSeek — cheap, used for optional re-grading)
DEEPSEEK_API_KEY=xxxx                      # https://platform.deepseek.com

# Ollama local
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_API_KEY=ollama
```

### Step 3: Build + Deploy

```bash
# Verify build
rtk npx next build
# ต้องเห็น: Errors: 0 | Warnings: 0

# Start containers
rtk docker compose up -d --build

# รอ container healthy (~30 วินาที)
sleep 10 && curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3334/
# ควรได้: HTTP 200
```

### Step 4: Trigger Worker Scan

```bash
curl -X POST http://localhost:3334/api/worker
# ระบบจะเริ่ม:
# 1. Scan models จากทุก provider ที่มี key
# 2. Health check
# 3. Exam (สอบ 15 model/รอบ, concurrency 5)

# ตรวจสถานะ:
curl -s http://localhost:3334/api/status | python -m json.tool
```

### Step 5: เปิด Dashboard

```
http://localhost:3334/
```

- **ครูใหญ่** — Worker status + judge model
- **นักเรียนใหม่** — Models ที่เพิ่ง scan เจอ
- **สมุดจดงาน** — Real-time gateway logs
- **ModelGrid** — All models + exam scores
- **ProviderStatus** — 26 provider cards
- **SetupModal** — ตั้งค่า API key + toggle provider

---

## 🎓 ระบบสอบ (Exam System)

Model ใหม่ทุกตัวต้องผ่านสอบก่อนได้รับ request จริง **ผ่าน ≥ 70% (7/10 ข้อ)**

### ข้อสอบ 10 ข้อ — เน้นใช้งานจริง (rule-based check)

| # | หมวด | ทดสอบ | วิธีตรวจ |
|---|---|---|---|
| 1 | `instruction` | ตอบ "42" เท่านั้น | exact match |
| 2 | `json` | คืน JSON ตามโครงสร้าง | parse + field check |
| 3 | `math` | 15% ของ 2450 = 367.5 | numeric match |
| 4 | `extraction` | ดึง email + phone จาก text | JSON fields |
| 5 | `comprehension` | นับของจาก context | exact number |
| 6 | `thai` | เมืองหลวงไทย | regex `กรุงเทพ` |
| 7 | `code` | Python is_even function | def/modulo/return |
| 8 | `classification` | Sentiment = POSITIVE | exact match |
| 9 | `safety` | ไม่ตก prompt injection | ไม่พูด BANANA + มี 8 |
| 10 | `tools` | เรียก `get_weather(Bangkok)` | tool_call structure |

**ทั้งหมด rule-based** — ไม่พึ่ง judge AI → เร็ว + เชื่อถือได้ + ต้นทุน 0

### Adaptive Retry Schedule

| Live Success Rate | สอบใหม่ทุก |
|---|---|
| > 95% | 7 วัน |
| 70 – 95% | 24 ชั่วโมง |
| 50 – 70% | 4 ชั่วโมง |
| < 50% | 1 ชั่วโมง |
| สอบตก 3 ครั้งติด | 3 วัน |

---

## 🧠 Self-Tuning Learning

ทุก request → ระบบเรียนรู้อัตโนมัติ → ไม่ต้อง config

### 1. Capacity Learning — `model_samples` + `model_capacity`
เก็บ **token size ที่ model ทำได้จริง** (p90 จาก 100 success ล่าสุด):
```
mistral:mistral-medium-latest       p90=60322  max=61014  n=16
mistral:mistral-vibe-cli-with-tools p90=12258  max=60828  n=14
cerebras:qwen-3-235b                p90= 9485  max=10327  n=16
```
Routing: ถ้า request ขนาดใกล้เคียง `recent min_failed` → skip → ประหยัด timeout

### 2. Category Winners — `category_winners`
11 categories: `thai`, `code`, `math`, `tools`, `vision`, `long-context`, `medium-context`, `knowledge`, `translate`, `classification`, `general`

```
code         → cerebras:qwen-3-235b    wins=2  (100%)
tools        → mistral:mistral-vibe    wins=12 (86%)
long-context → mistral:mistral-medium  wins=4  (100%)
thai         → mistral:mistral-medium  wins=3  (83%)
```

Request ใหม่ → detect category → boost winners ขึ้นบน

### 3. Provider Rate Limits — `provider_limits`
เรียนรู้จาก **3 แหล่ง**:
1. **Response headers** (`x-ratelimit-limit-tokens`, `remaining-tokens`, `reset-tokens`)
2. **Error 429 message** — parse `"Limit 100000, Used 91788"`
3. **Persist ลง DB** + Redis cache 5 นาที

ก่อนยิง → `canFitRequest()` เช็ค remaining → skip ถ้าไม่พอ

### 4. Exponential Cooldown — `model_fail_streak`
```
streak 1 → 30 วินาที
streak 2 → 1 นาที
streak 3 → 2 นาที
streak 4 → 4 นาที
streak 5+ → 8 นาที (cap)
```
- **Auto-reset** ถ้า fail ก่อนหน้าเกิน 10 นาที
- **Success → reset streak = 0** ทันที
- ไม่มี permanent ban

### 5. Live Score EMA — in-memory
```
[PROVIDER-RANK] cerebras(100%/2651ms/n=2) > mistral(70%/n=0) > groq(0%/n=2)
```
- α = 0.25 (ใหม่มีน้ำหนัก 25%)
- อัพเดททุก request — ไม่ต้องรอ batch
- Fail → ดันลง ranking ทันที

---

## 🎯 Smart Routing Pipeline

```
Request → Detect category (thai/code/tools/...)
       → Get candidates (passed_exam + enabled + hasKey + not cooldown)
       → Category boost (winners ขึ้นบน)
       → Filter: hasProviderKey + isProviderEnabled
       → Provider cooldown check (Redis)
       → Size filter (context_length >= required × 1.4)
       → Capacity check (recent failures)
       → Provider limits check (TPM/TPD remaining)
       → TPM hard check (request > limit → skip)
       → Rank by provider score × 100k + bench × 1k − latency
       → Hedge race top-2 cloud (parallel fetch, non-tools only)
       → Fail → Exponential cooldown → next candidate
       → All fail → Relaxed retry (ignore soft filters)
       → All fail → 503 with skip reasons breakdown
```

### Per-attempt Timeout (dynamic)

| Body Size | Timeout |
|---|---|
| < 10K chars | 8s |
| 10K – 20K | 12s |
| 20K – 40K | 20s |
| > 40K | 30s |
| Ollama | 30s |

### Total Retry Budget

| Est Tokens | Budget |
|---|---|
| > 20K | 60s |
| > 10K | 45s |
| > 5K | 30s |
| else | 20s |

---

## 🔌 API Endpoints

### Gateway (OpenAI-compatible)

```
POST /v1/chat/completions       # ยิง request — auto routing
POST /v1/chat/completions       # stream=true → SSE
GET  /v1/models                 # รายการ model ที่ผ่านสอบ
```

### Model Selection

```
model: "bcproxy/auto"           # Smart routing (default)
model: "bcproxy/fast"           # เน้น latency ต่ำ
model: "bcproxy/tools"          # เน้น tool calling
model: "bcproxy/thai"           # เน้นภาษาไทย
model: "bcproxy/consensus"      # ยิง 3 model parallel เลือก consensus
model: "groq/llama-3.1-8b"      # Direct provider routing
model: "nvidia/meta/llama-3.3-70b-instruct"
model: "chutes/deepseek-ai/DeepSeek-R1"
```

### Admin / Dashboard

| Endpoint | คำอธิบาย |
|---|---|
| `GET /api/status` | Worker status + stats + recent logs |
| `GET /api/models` | รายการ model ทั้งหมด + exam result + cooldown |
| `GET /api/providers` | Provider status + enabled + model count |
| `GET /api/learning` | Category winners + capacities + fail streaks |
| `GET /api/provider-limits` | TPM/TPD ที่เรียนรู้จากแต่ละ model |
| `GET /api/live-score` | Live EMA score snapshot |
| `GET /api/gateway-logs` | Request history |
| `GET /api/analytics` | Token usage + cost analytics |
| `GET /api/leaderboard` | Top performing models |
| `GET /api/infra` | Infrastructure health (DB, Valkey) |
| `GET /api/uptime` | Uptime per provider |
| `GET /api/trend` | Time-series metrics |
| `POST /api/worker` | Trigger worker cycle manually |
| `POST /api/setup` | Add/remove API key or toggle provider |

---

## 🗃 Database Schema

### Core
- `models` — Model metadata (provider, context_length, capabilities)
- `api_keys` — Runtime-configurable API keys
- `provider_settings` — Enable/disable provider toggle

### Exam System
- `exam_attempts` — Every exam run (attempt_number, score_pct, passed, next_exam_at, consecutive_fails)
- `exam_answers` — Per-question results (answer, passed, check_method, fail_reason)

### Learning
- `model_fail_streak` — Exponential cooldown counter
- `model_capacity` — p90 token capacity per model
- `model_samples` — Ring buffer (500 samples/model)
- `category_winners` — Wins/losses per (category, model)
- `provider_limits` — Learned TPM/TPD per provider/model
- `discovered_questions` — Patterns ที่ทำให้ model fail

### Runtime
- `health_logs` — Health check + cooldown_until
- `gateway_logs` — ทุก request (ก่อน/หลัง routing)
- `worker_logs` · `worker_state`
- `routing_stats` · `events` · `token_usage`
- `complaints` / `complaint_exams`

### Views
- `benchmark_results` (VIEW) — Read-only compat mapping

---

## 🔍 Observability

Every request gets a **Request ID** — trace ทั้ง chain ได้:

```
[REQ:abc123]            bcproxy/auto | tools=true | msgs=7 | est=9315tok | "..."
[CATEGORY-BOOST:abc123] "tools" → 3 winners: cerebras, mistral-medium, mistral-vibe
[PROVIDER-RANK:abc123]  cerebras(100%/2651ms/n=2) > mistral(70%/n=0) > groq(0%/n=2)
[CANDIDATES:abc123]     12 candidates | top5: cerebras/qwen-3-235b(ctx=131072), ...
[LIMIT-SKIP:abc123]     groq/llama-3.3-70b — TPD: remaining 103 < needed 10021
[RETRY:abc123]          1/10 | cerebras/qwen-3-235b → HTTP 429 | tokens per minute
[LIMIT-LEARN]           cerebras/qwen-3-235b error-generic
[EXPO-COOLDOWN:abc123]  cerebras/qwen-3-235b → 1min
[TIMEOUT-ATTEMPT:abc123] mistral/mistral-medium timeout → 1min
[SKIPS:abc123]          tried=2, skipped=3 — {"tpm-exhausted":2,"limit-exhausted":1}
[RES:abc123]            200 | mistral/mistral-vibe-cli-with-tools | 12918ms
```

---

## ⚙️ Worker Cycle

รันทุก **1 ชั่วโมง** (+ trigger manual ได้):

```
Step 1: Scan     → ดึง model จากทุก provider ที่มี key + enabled
                   ลบ model ที่ provider หายไป
Step 2: Health   → ping ทุก model ด้วย timeout 5s
                   auto-detect non-chat model จาก response
Step 3: Exam     → สอบสูงสุด 15 model/รอบ (concurrency 5)
                   adaptive schedule ตาม next_exam_at
```

### Leader Election
Multi-replica safe — ใช้ Redis leader lock:
```bash
docker compose up -d --scale bcproxyai=3
```

---

## 🔗 Integration Examples

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3334/v1",
    api_key="dummy"  # bcproxyai ไม่บังคับ
)

response = client.chat.completions.create(
    model="bcproxy/auto",
    messages=[{"role": "user", "content": "สวัสดีครับ"}]
)
print(response.choices[0].message.content)
```

### OpenClaw (Docker)

```bash
docker exec openclaw-bcproxy-test openclaw onboard \
  --non-interactive --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://host.docker.internal:3333/v1 \
  --custom-model-id auto \
  --custom-api-key dummy \
  --custom-compatibility openai

docker exec openclaw-bcproxy-test openclaw agent --agent main -m "สวัสดี"
```

### cURL

```bash
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bcproxy/auto",
    "messages": [{"role": "user", "content": "Write Python fibonacci"}]
  }'
```

### Direct Provider Routing

```bash
# ระบุ provider ตรงๆ
curl -X POST http://localhost:3334/v1/chat/completions \
  -d '{"model":"nvidia/meta/llama-3.3-70b-instruct","messages":[...]}'
curl -X POST http://localhost:3334/v1/chat/completions \
  -d '{"model":"chutes/deepseek-ai/DeepSeek-R1","messages":[...]}'
curl -X POST http://localhost:3334/v1/chat/completions \
  -d '{"model":"groq/llama-3.1-8b-instant","messages":[...]}'
```

---

## 📊 Dashboard Features

- **ครูใหญ่** — Worker status + judge model + next run
- **นักเรียนใหม่** — Recently discovered models (checked vs pending)
- **สมุดจดงาน** — Real-time gateway logs with filters
- **ModelGrid** — All models with exam scores, cooldown, capabilities
- **ProviderStatus** — 26 provider cards (active / no_key / error / disabled)
- **InfraPanel** — Postgres · Valkey · Replicas · Rate Limit
- **SchoolBell** — System events feed
- **StatsCards** — Total / Available / Cooldown / Passed / Avg Score
- **SetupModal** — Add/remove API keys, toggle provider on/off

UI เป็นภาษาไทยทั้งหมด

---

## 🎛 Provider Management (UI)

เปิด/ปิด provider ได้ผ่าน Setup Modal — ไม่ต้อง restart:

```
Setup Modal → Toggle switch per provider
           → POST /api/setup { provider, enabled: bool }
           → Cache 5s in memory + persist DB
           → Scanner skip disabled provider in next cycle
           → Gateway filter candidates ทันที (hot reload)
```

---

## 💵 Cost Comparison (Deep Dive)

### Free Token Budget — คำนวณจาก documented TPD/TPM/RPM

**Conservative practical estimate** (20% utilization of theoretical max):

| Provider | Limit Source | Tokens/เดือน |
|---|---|---:|
| **Groq** | llama-8b 500K TPD + 6 other models | **~10B** |
| **SambaNova** | 12 models × 20-30 RPM × 2.5K/req | **~5B** |
| **Mistral** | 1 RPS cap + 1B tok/month per model | **~2B** |
| **Chutes.ai** | Unlimited community GPU | **~1B** |
| **LLM7.io** | 30 RPM × 2.5K × 24h | **~500M** |
| **Pollinations** | Secret key unlimited | **~500M** |
| **Together AI** | $25 signup + free models | **~500M** |
| **glhf.chat** | Beta free (rate-limited) | **~200M** |
| **Google Gemini** | 3 tiers × RPD caps | **~120M** |
| **SiliconFlow** | 1000 RPD (w/$1 topup) | **~75M** |
| **OpenRouter** | 1000 RPD (w/$10 credit) | **~75M** |
| **Cerebras** | 1M tokens/day × 30 | **~30M** |
| **GitHub Models** | 200 RPD × 2.5K | **~15M** |
| **Reka AI** | $10/mo auto ÷ $0.75/1M | **~13M** |
| **Ollama Cloud** | 16K tok/hr × 24h × 30 | **~11.5M** |
| **Cloudflare AI** | 10K Neurons/day | **~3M** |
| **Cohere** | 1000 req/month | **~2.5M** |
| **HuggingFace** | $0.10/mo credits | **~2M** |
| **NVIDIA NIM** | 1000 credits (÷ 30 amortize) | **~2.5M** |
| **Hyperbolic** | $1 signup (÷ 30) | **~2.5M** |
| **DashScope (Qwen)** | 1M tok × 90 days (÷ 3) | **~667K** |
| **Z.AI (GLM)** | Signup credits (amortize) | **~1.7M** |
| **Scaleway** | 1M tok lifetime (÷ 30) | **~33K** |
| **Ollama local** | Unlimited (hardware only) | ∞ |
| | | |
| **รวม Practical** | | **~20 พันล้าน tokens/month** |

### Token-based Cost (20B tokens = 16B input + 4B output)

**ถ้าต้องจ่ายเงินแทน BCProxyAI:**

| Tier | Model | Input | Output | Cost/month | ฿/month | ฿/year |
|---|---|---:|---:|---:|---:|---:|
| 🏆 Cheapest | **Novita Llama 3.1 8B** | $0.02 | $0.02 | **$400** | **฿14,000** | ฿168,000 |
| Cheap | Groq paid (Llama 8B) | $0.06 | $0.06 | $1,200 | ฿42,000 | ฿504,000 |
| Cheap | SiliconFlow (8B) | $0.06 | $0.06 | $1,200 | ฿42,000 | ฿504,000 |
| Cheap | Qwen3 4B (Novita) | $0.03 | $0.03 | $600 | ฿21,000 | ฿252,000 |
| Budget | Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $3,200 | ฿112,000 | ฿1,344,000 |
| Budget | DeepSeek V3.2 | $0.14 | $0.28 | $3,360 | ฿117,600 | ฿1,411,200 |
| Budget | GPT-4o mini | $0.15 | $0.60 | $4,800 | ฿168,000 | ฿2,016,000 |
| Budget | Gemini 2.5 Flash | $0.15 | $0.60 | $4,800 | ฿168,000 | ฿2,016,000 |
| Mid | DeepSeek V3 | $0.27 | $1.10 | $8,720 | ฿305,200 | ฿3,662,400 |
| Mid | o4 mini | $0.55 | $2.20 | $17,600 | ฿616,000 | ฿7,392,000 |
| Mid | Claude Haiku 4.5 | $1.00 | $5.00 | $36,000 | ฿1,260,000 | ฿15,120,000 |
| Mid | Gemini 1.5 Pro | $1.25 | $5.00 | $40,000 | ฿1,400,000 | ฿16,800,000 |
| 💎 Premium | **GPT-4o** | $2.50 | $10.00 | **$80,000** | **฿2,800,000** | ฿33,600,000 |
| Premium | **Claude Sonnet 4.6** | $3.00 | $15.00 | **$108,000** | **฿3,780,000** | ฿45,360,000 |
| Premium | **Claude Opus 4.6** | $5.00 | $25.00 | **$180,000** | **฿6,300,000** | ฿75,600,000 |
| Premium | GPT-5 | $10.00 | $30.00 | $280,000 | ฿9,800,000 | ฿117,600,000 |
| 👑 Flagship | **Claude Opus 4** (legacy) | $15.00 | $75.00 | **$540,000** | **฿18,900,000** | ฿226,800,000 |

### การคำนวณ (16B input + 4B output)

```
Novita Llama 8B:
  Input:  16,000M × $0.02/1M = $320
  Output:  4,000M × $0.02/1M = $80
  Total:                       $400/month

GPT-4o:
  Input:  16,000M × $2.50/1M = $40,000
  Output:  4,000M × $10.0/1M = $40,000
  Total:                       $80,000/month

Claude Sonnet 4.6:
  Input:  16,000M × $3.00/1M = $48,000
  Output:  4,000M × $15.0/1M = $60,000
  Total:                       $108,000/month

Claude Opus 4 (legacy):
  Input:  16,000M × $15.0/1M = $240,000
  Output:  4,000M × $75.0/1M = $300,000
  Total:                       $540,000/month
```

### BCProxyAI Weighted Blend Quality

**BCProxyAI ไม่ใช่ "เหมือน GPT-4o" แต่ผสมคุณภาพหลายตัว:**

| % traffic | Quality tier | ตัวอย่าง model |
|---:|---|---|
| 35% | Small fast | Groq llama-8b, Qwen2.5-7B, mistral-small |
| 40% | Mid (70B-120B) | Llama 3.3 70B, Mistral Medium, gpt-oss:120b, Qwen2.5-72B |
| 20% | Large (235B-480B) | Qwen3-235B, Kimi K2, DeepSeek R1, Llama 3.1 405B, qwen3-coder:480b |
| 5% | Flagship (671B+) | DeepSeek V3.1 671B (Ollama Cloud), Llama 405B |

**Weighted equivalent quality ≈ Llama 3.3 70B / DeepSeek V3 class**

### เปรียบเทียบ apples-to-apples (Llama 70B class)

**Closest paid equivalent** = DeepSeek V3.2 ($0.14/$0.28) หรือ Llama 70B cheap providers

```
BCProxyAI (ฟรี)     vs  DeepSeek V3.2 paid    = ประหยัด $3,360/mo   (฿117,600)
BCProxyAI (ฟรี)     vs  Gemini 2.5 Flash      = ประหยัด $4,800/mo   (฿168,000)
BCProxyAI (ฟรี)     vs  GPT-4o mini           = ประหยัด $4,800/mo   (฿168,000)
```

### เปรียบเทียบ worst-case (ถ้าใช้แต่ flagship)

```
BCProxyAI (ฟรี)     vs  GPT-4o               = ประหยัด $80,000/mo  (฿2.8M)
BCProxyAI (ฟรี)     vs  Claude Sonnet 4.6    = ประหยัด $108,000/mo (฿3.78M)
BCProxyAI (ฟรี)     vs  Claude Opus 4.6      = ประหยัด $180,000/mo (฿6.3M)
BCProxyAI (ฟรี)     vs  Claude Opus 4 legacy = ประหยัด $540,000/mo (฿18.9M)
```

### ตัวอย่าง use case จริง

**Dev/prototype** (2B tokens/month):
- BCProxyAI: ฿0
- Novita 8B: ฿1,400
- DeepSeek V3.2: ฿11,760
- GPT-4o: ฿280,000
- Claude Opus 4.6: ฿630,000

**Production small** (5B tokens/month):
- BCProxyAI: ฿0
- Novita 8B: ฿3,500
- GPT-4o: ฿700,000
- Claude Sonnet 4.6: ฿945,000

**Heavy usage** (20B tokens/month = budget เต็ม):
- BCProxyAI: ฿0
- Novita 8B: ฿14,000
- GPT-4o: ฿2,800,000
- Claude Sonnet 4.6: ฿3,780,000
- Claude Opus 4: ฿18,900,000 (legacy pricing)

### ROI Summary

**ROI เทียบ tier ต่างๆ (20B tokens/month practical):**

```
🟢 Lower bound (Novita 8B):     ประหยัด ฿168,000/ปี
🟡 Mid (DeepSeek V3.2):        ประหยัด ฿1,411,200/ปี
🟠 GPT-4o mini:                ประหยัด ฿2,016,000/ปี
🔴 GPT-4o:                     ประหยัด ฿33,600,000/ปี
🔴 Claude Sonnet 4.6:          ประหยัด ฿45,360,000/ปี
🔴 Claude Opus 4.6:            ประหยัด ฿75,600,000/ปี
⚫ Claude Opus 4 legacy:        ประหยัด ฿226,800,000/ปี
```

**Sources ราคา (Apr 2026):**
- [OpenAI Pricing](https://openai.com/api/pricing/) — GPT-4o, GPT-4o mini, GPT-5
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — Claude Haiku/Sonnet/Opus 4.6
- [Novita AI](https://novita.ai/) — Llama 8B $0.02/1M (ถูกสุดในตลาด)
- [DeepSeek Pricing](https://platform.deepseek.com/) — V3, V3.2
- [Google AI Pricing](https://ai.google.dev/pricing) — Gemini Flash/Pro

---

## 🔧 Development

### Commands

```bash
npm run dev            # Next.js dev server
npm run build          # Production build
npm run start          # Production server
npm run lint           # ESLint
npm run test           # Vitest
npm run test:watch     # Vitest watch mode
npm run build:mcp      # Build MCP server
npm run mcp            # Run MCP server
```

### Load Testing (k6)

```bash
npm run loadtest:smoke        # Quick smoke test
npm run loadtest:dashboard    # Dashboard load
npm run loadtest:chat         # Chat endpoint load
npm run loadtest:ratelimit    # Rate limit test
npm run loadtest:stress       # Full stress test
```

### Deploy Checklist

```bash
rtk npx next build                                                           # 0 errors
rtk docker compose up -d --build
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/   # 200
docker ps --format "{{.Names}}\t{{.Status}}" | grep bcproxyai                # Up (healthy)
```

### Caddy Reload

```bash
powershell -File "C:/Users/jatur/restart-caddy.ps1"
```

---

## 📐 Key Design Decisions

1. **Rule-based exam > Judge AI** — ตรวจแบบ deterministic = 0 cost + 100ms + ไม่สุ่ม
2. **Exponential cooldown cap ที่ 8 นาที** — ป้องกัน candidate pool หาย → 503 cascade
3. **Separate quota fail vs capacity fail** — Quota fail (429/TPM) ไม่นับเป็น capacity
4. **Provider-first candidate selection** — Group by provider → sort providers → within provider sort models
5. **Size filter ใช้ × 1.4** — เผื่อ response + safety margin
6. **Per-attempt timeout dynamic** — Request ใหญ่ timeout ยาวขึ้น
7. **Ollama skip ถ้ามี cloud alternative + not loaded** — ประหยัดเวลา cold-load
8. **Hedge race เฉพาะ non-tools** — Tools request ไม่ parallel เพื่อประหยัด quota
9. **Category boost ก่อน sort** — ผู้ชนะ category ขึ้นบนเสมอ
10. **Live score in-memory (EMA)** — ไม่ต้องรอ DB round-trip ข้าม request

---

## 📄 License

Private project — BC Account.
