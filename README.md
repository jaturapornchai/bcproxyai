# SMLGateway

**OpenAI-compatible LLM gateway ที่รวม model ฟรี จาก 26 providers ในจุดเดียว**
ระบบฉลาดขึ้นเองจากการใช้งาน — ไม่ต้องตั้งค่า ยิ่งใช้ยิ่งรู้จัก

> เหมาะกับ: Developer ที่ต้องการทดลอง AI, Startup ที่อยากลดค่า API, Production app ที่ต้องการ fallback/redundancy, Coding agent (OpenClaw, Aider, Cline)

---

## 📋 สารบัญ

- [✨ Highlights](#-highlights)
- [🚀 Quick Start (5 นาที)](#-quick-start-5-นาที)
- [📦 Provider List 26 ตัว](#-provider-list--26-ตัว)
- [🏗 Architecture](#-architecture)
- [🚀 Installation Guide (ละเอียด)](#-ติดตั้ง-installation-guide)
- [🎓 Exam System](#-ระบบสอบ-exam-system)
- [🧠 Self-Tuning Learning](#-self-tuning-learning)
- [🎯 Smart Routing Pipeline](#-smart-routing-pipeline)
- [🔌 API Endpoints](#-api-endpoints)
- [🗃 Database Schema](#-database-schema)
- [🔗 Integration Examples](#-integration-examples)
- [🛠 Troubleshooting](#-troubleshooting)
- [❓ FAQ](#-faq)
- [🔧 Development](#-development)

---

## 🚀 Quick Start (5 นาที)

ต้องการทดลองเร็วสุด ใช้แค่ 2 provider ก็พอ:

```bash
# 1. Clone + install
git clone https://github.com/jaturapornchai/sml-gateway.git
cd sml-gateway
cp .env.example .env.local

# 2. แก้ .env.local ใส่ 2 keys
# GROQ_API_KEY=gsk_xxx          ← https://console.groq.com/keys (ฟรี)
# NVIDIA_API_KEY=nvapi-xxx      ← https://build.nvidia.com/ (ฟรี)

# 3. Build + run
docker compose up -d --build

# 4. รอ 10 วินาที แล้วเปิด dashboard
sleep 10 && open http://localhost:3334/

# 5. Trigger worker scan (1 ครั้ง)
curl -X POST http://localhost:3334/api/worker
```

เท่านี้ก็พร้อมใช้งาน — model ที่ผ่านสอบจะพร้อมรับ request อัตโนมัติ

**ทดสอบเรียกใช้:**
```bash
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"sml/auto","messages":[{"role":"user","content":"สวัสดี"}]}'
```

---

## ✨ Highlights

- 🎓 **Exam System** — Model ทุกตัวต้องผ่านสอบก่อนได้ทำงาน (rule-based 10 ข้อ, ผ่าน ≥ 70%)
- 🏆 **Category Winners** — เรียนรู้ว่า model ไหนเก่ง thai / code / math / tools / long-context
- 📏 **Self-Learning Rate Limits** — อ่าน `x-ratelimit-*` + parse 429 message เรียนรู้ TPM/TPD เอง
- 📐 **Capacity Learning** — p90 ของ token size ที่ model ทำได้จริง
- ⏳ **Exponential Cooldown** — 10s → 20s → 40s → 80s → 2 min cap, reset อัตโนมัติ
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
│ OpenAI SDK / ├──────────────▶│ Caddy     │───────▶│ sml-gateway    │
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
            │  4. Hedge race top-3 (1 per provider)                              │
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
| Database | PostgreSQL 17 + pgvector (driver: `postgres`) |
| Cache/State | Valkey 8 (Redis-compatible) |
| Reverse Proxy | Caddy 2 |
| Scheduler | node-cron |
| Testing | Vitest |
| Load Testing | k6 |

## 🚢 Services (docker-compose)

| Container | Role | Host Port |
|---|---|---|
| `sml-gateway` | Next.js app (scalable) | internal `:3000` |
| `caddy` | In-compose reverse proxy / load balancer | **`:3334`** |
| `postgres` | PostgreSQL 17 + pgvector | `:5434` |
| `redis` | Valkey 8 | `:6382` |

### Port Map

| Port | Service | หมายเหตุ |
|---|---|---|
| **3333** | SMLGateway via **external** Caddy | timeout 300s, production |
| **3334** | SMLGateway via **in-compose** Caddy | scaling, load balanced |
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
git clone https://github.com/jaturapornchai/sml-gateway.git
cd sml-gateway
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

### Step 6: Verify Installation

ตรวจสอบว่าทุกอย่างพร้อม:

```bash
# 1. Container ทั้งหมด healthy
docker ps --format "{{.Names}}\t{{.Status}}" | grep sml-gateway

# ต้องเห็น:
#  sml-gateway-sml-gateway-1   Up (healthy)
#  sml-gateway-caddy-1       Up
#  sml-gateway-postgres-1    Up (healthy)
#  sml-gateway-redis-1       Up (healthy)

# 2. API health check
curl -s http://localhost:3334/api/health | python -m json.tool

# 3. ดู providers ที่ active
curl -s http://localhost:3334/api/providers | python -c "
import sys, json
for p in json.load(sys.stdin):
  icon = '✅' if p['status']=='active' else '⏸'
  print(f\"{icon} {p['provider']:15} status={p['status']:10} models={p.get('modelCount',0)}\")
"

# 4. ดู models ที่ผ่านสอบแล้ว
curl -s http://localhost:3334/api/status | python -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Total: {d['stats']['totalModels']}\")
print(f\"Available: {d['stats']['availableModels']}\")
print(f\"Passed exam: {d['stats']['benchmarkedModels']}\")
"
```

### Step 7: First API Call

```bash
# ทดสอบ chat
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sml/auto",
    "messages": [
      {"role": "user", "content": "สวัสดี ตอบสั้นๆ ภาษาไทย"}
    ]
  }' | python -m json.tool
```

**ถ้าได้ response 200 + content ภาษาไทย → ติดตั้งสำเร็จ ✅**

### Step 8: Production Tips

#### เปิด External Caddy (port 3333, timeout 300s)

สำหรับ production ที่ต้องการรับ request ยาว (coding agents, long context):

```bash
# แก้ Caddyfile (external)
# dev.sml-gateway.com {
#     reverse_proxy localhost:3334 {
#         timeout 300s
#     }
# }

# Reload
powershell -File "C:/Users/jatur/restart-caddy.ps1"
```

#### Scale Horizontal

```bash
docker compose up -d --scale sml-gateway=3
# → Caddy in-compose จะ load balance + Redis leader election ป้องกัน duplicate worker
```

#### Monitor

```bash
# Real-time gateway logs
docker logs sml-gateway-sml-gateway-1 -f | grep -E "\[REQ:|\[RES:"

# Worker status
watch -n 5 "curl -s http://localhost:3334/api/status | python -m json.tool | grep -A5 worker"

# Learning progress
curl -s http://localhost:3334/api/learning | python -m json.tool
```

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
streak 1 → 10 วินาที
streak 2 → 20 วินาที
streak 3 → 40 วินาที
streak 4 → 80 วินาที
streak 5+ → 2 นาที (cap)
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
       → Hedge race top-3 different providers (parallel, non-tools only)
       → Fail → Exponential cooldown → next candidate
       → All fail → Relaxed retry (ignore soft filters)
       → All fail → 503 with skip reasons breakdown
```

### Per-attempt Timeout (dynamic, non-stream)

| Body Size | Timeout |
|---|---|
| < 10K chars | 12s |
| 10K – 20K | 20s |
| 20K – 40K | 35s |
| > 40K | 60s |
| Ollama | 30s |

### Total Retry Budget

| Est Tokens | Budget |
|---|---|
| > 40K | 120s |
| > 20K | 90s |
| > 10K | 60s |
| else | 30s |

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
model: "sml/auto"           # Smart routing (default)
model: "sml/fast"           # เน้น latency ต่ำ
model: "sml/tools"          # เน้น tool calling
model: "sml/thai"           # เน้นภาษาไทย
model: "sml/consensus"      # ยิง 3 model parallel เลือก consensus
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
[REQ:abc123]            sml/auto | tools=true | msgs=7 | est=9315tok | "..."
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

รันทุก **15 นาที** (+ trigger manual ได้):

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
docker compose up -d --scale sml-gateway=3
```

---

## 🔗 Integration Examples

### OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3334/v1",
    api_key="dummy"  # sml-gateway ไม่บังคับ
)

response = client.chat.completions.create(
    model="sml/auto",
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
    "model": "sml/auto",
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

## 🛠 Troubleshooting

### 🔴 Container ไม่ start / Healthcheck fail

```bash
# ดู log
docker logs sml-gateway-sml-gateway-1 --tail=50

# ตรวจ postgres + valkey พร้อมไหม
docker ps --format "{{.Names}}\t{{.Status}}"

# Restart ทั้งหมด
docker compose down && docker compose up -d --build
```

**สาเหตุที่พบบ่อย:**
- `.env.local` ไม่มี หรือ format ผิด → `cp .env.example .env.local` แล้วเพิ่ม key ใหม่
- Port 3334/5434/6382 ถูกใช้อยู่ → แก้ `docker-compose.yml` port mapping
- Docker Desktop ไม่รัน → เปิดก่อน `docker compose up`

### 🔴 HTTP 503 — ไม่มี candidates

```
All 0 models from 0 providers failed
```

**สาเหตุ:** ยังไม่มี model ผ่านสอบในระบบ

**แก้:**
```bash
# 1. ตรวจ provider ที่ตั้ง key แล้ว
curl -s http://localhost:3334/api/providers | python -m json.tool

# 2. Trigger worker scan → exam
curl -X POST http://localhost:3334/api/worker

# 3. รอ 2-5 นาที ให้สอบเสร็จ แล้วตรวจ
curl -s http://localhost:3334/api/status | python -m json.tool

# 4. ดู model ที่ผ่านสอบ
docker exec sml-gateway-postgres-1 psql -U sml -d smlgateway -c "
SELECT m.provider, m.model_id, ea.score_pct::int as score
FROM models m
INNER JOIN (SELECT DISTINCT ON (model_id) model_id, score_pct
            FROM exam_attempts WHERE passed = true
            ORDER BY model_id, started_at DESC) ea
ON m.id = ea.model_id
ORDER BY ea.score_pct DESC LIMIT 20;
"
```

### 🔴 HTTP 503 — TPM exhausted

```
tpm-exhausted: groq/llama-3.1-8b-instant
```

**สาเหตุ:** Request ขนาดใหญ่เกิน rate limit ของ free tier

**แก้:** เพิ่ม provider ที่ context/TPM สูงกว่า:
- Chutes.ai (no monthly cap)
- Mistral (1B tok/month per model)
- SambaNova (30 RPM × 2.5K tok)
- Ollama local (unlimited)

### 🔴 Model ตอบช้า / Timeout

**Check:**
```bash
# ดู live score + ranking
curl -s http://localhost:3334/api/live-score

# ดู fail streak
curl -s http://localhost:3334/api/learning | python -m json.tool
```

**แก้:**
- Slow model จะถูก cooldown อัตโนมัติหลัง exponential fails
- ถ้ายังช้า → toggle provider ปิดผ่าน UI (SetupModal)
- หรือเพิ่ม per-attempt timeout ใน `route.ts` สำหรับ request ใหญ่

### 🔴 Build fail / TypeScript errors

```bash
# Clean rebuild
rm -rf .next node_modules
npm install
npx next build
```

### 🔴 Worker cycle ไม่ run อัตโนมัติ

```bash
# Manual trigger
curl -X POST http://localhost:3334/api/worker

# ตรวจ worker state
curl -s http://localhost:3334/api/status | python -m json.tool | grep -A5 worker
```

### 🔴 Cooldown หายช้า

Cooldown จะ auto-reset ตามเวลา แต่ถ้าต้องการเคลียร์ทันที:

```bash
docker exec sml-gateway-postgres-1 psql -U sml -d smlgateway -c "
DELETE FROM health_logs WHERE cooldown_until > now();
DELETE FROM model_fail_streak;
"
```

### 🔴 Provider key ใหม่ไม่ถูก scan

```bash
# 1. ตรวจว่า provider ไม่ถูก toggle ปิด
curl -s http://localhost:3334/api/providers | python -c "
import sys, json
for p in json.load(sys.stdin):
  print(f\"{p['provider']:15} enabled={p.get('enabled',True)} status={p['status']}\")
"

# 2. Trigger scan manually
curl -X POST http://localhost:3334/api/worker

# 3. รอ 30 วินาที แล้วดู log
docker logs sml-gateway-sml-gateway-1 --tail=50 | grep -i scan
```

---

## ❓ FAQ

### Q: ต้องใส่ API key กี่ provider ถึงจะพอ?
**A:** อย่างน้อย **1 ตัว** ก็ใช้ได้ แต่แนะนำ **3+ ตัว** เพื่อมี fallback เวลา 1 ตัวติด cooldown:
- **Minimum:** Groq (14.4K req/day, ฟรี)
- **Recommended:** Groq + NVIDIA NIM + Cerebras (คุณภาพผสมหลากหลาย)
- **Heavy use:** เพิ่ม Mistral + SambaNova + Chutes.ai

### Q: Model อะไรเร็วที่สุด?
**A:** ตาม live score ระบบจะเลือกเองอัตโนมัติ แต่โดยทั่วไป:
- **Cerebras** → wafer-scale, ~2000+ tok/s (Llama, Qwen, gpt-oss)
- **Groq** → LPU, ~500+ tok/s (Llama, Mixtral, Kimi)
- **SambaNova** → RDU, ~300 tok/s (Llama, Qwen)

### Q: Model อะไรฉลาดที่สุด?
**A:** ระดับ flagship ที่ฟรี:
- **DeepSeek V3/R1** (671B) via Ollama Cloud, Chutes.ai, OpenRouter
- **Qwen3-235B** via Cerebras, NVIDIA NIM, Chutes.ai
- **Llama 3.1 405B** via Hyperbolic, glhf.chat, SambaNova
- **Kimi K2** via Groq, Chutes.ai

### Q: รองรับ streaming ไหม?
**A:** ได้ ส่ง `"stream": true` ใน request → SSE format เหมือน OpenAI

### Q: รองรับ tool calling / function calling ไหม?
**A:** ได้ ระบบจะเลือก model ที่รองรับ tools อัตโนมัติ (กรองด้วย `supports_tools=1`)

### Q: รองรับ vision (รูปภาพ) ไหม?
**A:** ได้ ส่ง image_url ใน message → ระบบเลือก vision model (Gemini, Qwen-VL, Llama-Vision)

### Q: Dashboard เข้าจากไหน?
**A:** `http://localhost:3334/` (ถ้า scale multiple replicas ผ่าน in-compose Caddy)
หรือ `http://localhost:3333/` (ถ้า deploy ผ่าน external Caddy)

### Q: Scale horizontal ได้ไหม?
**A:** ได้ ใช้ Redis leader election:
```bash
docker compose up -d --scale sml-gateway=3
```

### Q: Ollama local ต้องติดตั้งยังไง?
**A:**
```bash
# Mac/Windows
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull llama3.1
ollama pull qwen2.5-coder

# Set in .env.local
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

### Q: ต้องการเปลี่ยน rate limit เอง?
**A:** ระบบเรียนรู้ auto จาก response headers + 429 messages ไม่ต้องตั้งเอง
แต่ถ้าต้องการ override ตั้งใน `src/lib/tpm-tracker.ts` → `MODEL_TPM` map

### Q: Log อยู่ไหน?
**A:**
- Worker logs → `worker_logs` table + `/api/status` endpoint
- Gateway logs → `gateway_logs` table + `/api/gateway-logs` endpoint
- Container logs → `docker logs sml-gateway-sml-gateway-1`
- Dashboard → "สมุดจดงาน" panel (realtime)

### Q: จะใช้กับ OpenClaw/Aider/Cline ยังไง?
**A:** ตั้ง base URL เป็น `http://localhost:3334/v1` + api_key = dummy (ใช้ใดๆ ก็ได้)

### Q: ถ้า provider ล่มจะเป็นไง?
**A:** ระบบมี 26 providers + exponential cooldown + circuit breaker + relaxed retry
→ 1 provider ล่ม = fallback ไป provider อื่นอัตโนมัติ

### Q: SMLGateway เก็บ prompt/response ไหม?
**A:** เก็บ 500 ตัวอักษรแรก + 500 ตัวอักษรของ assistant response ใน `gateway_logs` (สำหรับ debug/analytics)
ลบ log เก่า 7 วัน อัตโนมัติ (`cleanOldLogs()`)
ปิด/แก้ได้ใน `src/app/v1/chat/completions/route.ts`

### Q: ต้อง restart หลังแก้ .env.local ไหม?
**A:** ต้อง → `docker compose up -d --force-recreate` เพื่อโหลด env ใหม่
**แต่** ถ้าตั้ง key ผ่าน UI (SetupModal) → ไม่ต้อง restart (เก็บใน DB)

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
docker ps --format "{{.Names}}\t{{.Status}}" | grep sml-gateway                # Up (healthy)
```

### Caddy Reload

```bash
powershell -File "C:/Users/jatur/restart-caddy.ps1"
```

---

## ⚡ Performance Optimizations

- **Response cache (Valkey-backed)** — 1h TTL, aggressive mode, skips only streaming. Cache key includes tools + tool_choice to prevent cross-request bleeding.
- **Hedge top-3 parallel (per-provider dedup)** — fires top 3 candidates from **different** providers in parallel; first healthy response wins, stragglers aborted. Prevents same-provider concurrent rate-limiting.
- **Exponential cooldown with fast recovery** — fail streak ladder 10s / 20s / 40s / 80s / 2m cap. Auto-reset after 10 minutes idle.
- **Warmup worker** — every 2 minutes pings passing models to keep connections warm and refresh live scores.
- **Semantic cache (pgvector)** — embeddings via local Ollama `nomic-embed-text`; near-duplicate queries hit at cosine similarity ≥ 0.92. Gracefully degrades when the `vector` extension is absent.
- **Valkey tuned (1GB LRU, cache-only)** — no persistence, LRU eviction, TCP keepalive 60s.
- **Postgres performance indexes** — partial indexes for active cooldowns, recent gateway logs, and passed exams.
- **Prometheus metrics** at `/api/metrics` — models, latency p50/p99, cache hit ratio, provider limit remaining.
- **Node built-in HTTP client** — uses Node 20's native `fetch` (undici internally with keep-alive). Custom undici dispatchers disabled due to compatibility issues with some providers.
- **Context-aware provider filter** — requests over 20K tokens skip providers with insufficient context window.
- **Smart circuit breaker** — half-open probe 30s after trip; one success closes the breaker immediately.
- **RELAXED-RETRY budget signal** — second-pass retry passes remaining timeout budget via AbortSignal, preventing requests from outliving the total timeout.

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
