# SMLGateway

**OpenAI-compatible LLM gateway ที่รวมโมเดลฟรีจากหลาย provider ไว้จุดเดียว**
ระบบเรียนรู้จากการใช้งานเอง — ไม่ต้อง tune ด้วยมือ ยิ่งใช้ยิ่งเลือก route ได้ดี

> ใช้ได้กับทุก client ที่รองรับ OpenAI SDK — Next.js, Python, LangChain, thClaws, Hermes Agent, curl, OpenClaw, Aider, Cline ฯลฯ

## 3 แบบการใช้งาน (เลือก 1)

ระบบ **auto-detect จาก `.env`** — ตั้ง env ของ method ไหน = method นั้นเปิดอัตโนมัติ

| | ① Local | ② VPS + Password | ③ VPS + Google OAuth |
|---|---|---|---|
| **ใคร** | Dev เล่นคนเดียว | ทีมเล็ก, ไม่มี Gmail / airgap | ทีม production, audit รายคน |
| **Setup** | 5 นาที | 10 นาที | 30-45 นาที |
| **Prereq** | Docker | VPS + Docker | VPS + Domain + HTTPS + Google Console |
| **Auth** | 🚫 ไม่มี | Bearer + Password | Bearer + Password + Google |
| **Client ใช้ยังไง** | `api_key: "dummy"` | `Bearer sk-gw-...` / `sml_live_*` | `Bearer sk-gw-...` / `sml_live_*` |
| **Admin UI** | เปิดหมด | Password login 7-day cookie | Google login / Password fallback |
| **Identity audit** | — | shared secret | ✅ per-email |
| **Public-facing ปลอดภัย** | 🚫 ไม่ควร | ⚠️ พอได้ (ถ้ามี HTTPS) | ✅ production-grade |

### ① Local — "เล่นได้เลย"
```bash
git clone https://github.com/jaturapornchai/bcproxyai.git sml-gateway
cd sml-gateway
cp .env.example .env.local        # ไม่ต้องแก้อะไร (auth vars ว่างทั้งหมด)
docker compose up -d --build
# เปิด http://localhost:3334/
```

### ② VPS + Password — ง่าย ไม่ต้องพึ่ง Google
ตั้ง 3 ตัวใน `.env.production`:
```bash
GATEWAY_API_KEY=sk-gw-<generate>      # SDK / curl
ADMIN_PASSWORD=<random-24-base64>     # admin UI login
AUTH_OWNER_EMAIL=admin@example.com    # metadata (audit label)
```

### ③ VPS + Google OAuth — ของจริง production
ตั้งครบ 8 ตัวใน `.env.production`:
```bash
GATEWAY_API_KEY=sk-gw-<generate>
ADMIN_PASSWORD=<random-24-base64>     # fallback เผื่อ Google ล่ม
AUTH_OWNER_EMAIL=alice@gmail.com,bob@gmail.com,cto@gmail.com
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
NEXTAUTH_SECRET=<random-32-base64>
NEXTAUTH_URL=https://your-domain.com
# redirect URI ที่ Google Console: {NEXTAUTH_URL}/api/auth/callback/google
```

**Rule:** เปิด method ไหน = ตั้ง env ของ method นั้น · ไม่ตั้ง = ปิด · ไม่มี `AUTH_MODE` flag

ดูรายละเอียดทุกตัวแปรใน [.env.example](.env.example).

**Stateless** — gateway ไม่เก็บ conversation history / session memory. Client (OpenClaw, Aider, IDE plugin, ฯลฯ) เป็นคนจัดการ history เอง แล้วส่ง `messages[]` array มาทุก request ตามมาตรฐาน OpenAI API. ระบบมีแค่ response cache (hash ตาม body+model — cache HIT กลับใน <200ms) + routing memory (`live_score`, `fail_streak`, category winners) ซึ่งเป็น aggregate stat ไม่ผูกกับ user.

**DB-driven config** — Provider list และ API keys อยู่ใน database ทั้งหมด (`provider_catalog` + `api_keys` table). `.env.local` ใช้แค่ runtime config (Ollama URL, Cloudflare account ID) — **ไม่อ่าน API key จาก env**. ตั้งค่าทุกอย่างผ่าน Setup modal ในหน้า dashboard.

**Cost policy** — ค่าเริ่มต้นบล็อก provider/model ที่อาจคิดเงินทั้งหมด แม้มี API key อยู่ใน DB. `SML_FREE_PROVIDER_ALLOWLIST` ใช้กับ provider ที่เชื่อว่าไม่ผูกเงินทั้ง provider เช่น `ollama,pollinations`; cloud provider ต้องผ่าน `SML_FREE_MODEL_ALLOWLIST` ราย model เท่านั้น เช่น `openrouter/*:free,openrouter/openrouter/free`. Paid deployment ต้องตั้ง `SML_ALLOW_PAID_PROVIDERS=1`.

**Auto-Discovery (catalog only)** — ทุก worker cycle (15 นาที) ระบบสแกน internet หา provider ใหม่จาก 3 แหล่ง: (1) OpenRouter `/api/v1/providers`, (2) HuggingFace inference list, (3) URL pattern probe. Provider ที่พบใหม่ → INSERT `provider_catalog`. การใช้งานจริงยังต้องผ่าน cost policy ก่อนเสมอ.

## สิ่งที่ Dev ได้ทันที

| | |
|---|---|
| 🆓 No-spend default | ใช้งานจริงเฉพาะ trusted free provider (`ollama,pollinations`) และ free model rule (`openrouter/*:free`, `openrouter/openrouter/free`); cloud provider/model อื่นถูกบล็อกแม้มี key |
| 🇹🇭 Thai-native | Typhoon (SCB 10X) + ThaiLLM (NSTDA national platform — 4 models: OpenThaiGPT, Typhoon-S, Pathumma-think, THaLLE) + virtual `sml/thai` — รองรับ auth scheme `apikey-header` อัตโนมัติ (DB-driven) |
| 🧠 Thinking mode | auto-detect จาก OpenRouter metadata + name regex → scan flag → exam ตรวจ trace จริง (`<think>` tag / `reasoning` field) → gateway forward path auto-enable (opt-out via body) |
| 🔐 3 auth methods | Local (open) / Password cookie / Google OAuth — เลือกได้ตาม env, ใช้คู่ได้. Per-client key ออกที่ `/admin/keys` |
| 🔎 Auto-verify | probe homepage + `/v1/models` ของทุก provider ทุก 3 นาที + sync URL ใหม่จาก cheahjs/LiteLLM registry ทุก 6 ชม. |
| 🌐 Auto-Discovery | สแกน OpenRouter/HuggingFace/URL pattern หา provider ใหม่ทุก 15 นาที (กรอง paid ทิ้ง) |
| ⚡ Fast | hedge top-3 + speculative mid-flight + warmup + connection pre-warm + response cache + model-list cache + sticky pin → **p50 22ms cached / 606ms forward**, streaming TTFB ~450ms |
| 🎯 Smart routing | per-category teacher (thai/code/tools/vision/...) + sticky routing (IP+category 30s) |
| 🔄 Auto-fallback | **per-(provider,model) circuit breaker** + exponential cooldown + auto-demote on 429 storm + adaptive slow-cooldown |
| 🤖 Agent-ready | thClaws + Hermes agent + OpenClaw + Aider + Cline — ใช้ virtual model `sml/*`, Mistral message-order auto-patch, tool_calls passthrough, และ JSON tool-call repair |
| 📊 Perf dashboard | `⚡ ประสิทธิภาพ` section — cache HIT/hedge WIN/spec WIN/sticky/demoted/p50/p95/throughput live (refresh 15s) |
| 🇹🇭 Thai UI | Dashboard + `/guide` + `/setup` ทุกหน้าเป็นภาษาไทย (tooltip อธิบาย technical term เมื่อ hover) — อ่านเข้าใจได้ทันที ไม่ต้องแปล |
| 🔌 Drop-in | เปลี่ยนแค่ `baseURL` ของ OpenAI SDK → ใช้ได้เลย |
| 📐 Structured JSON | `/v1/structured` — schema validation + auto-retry |
| ⚖️ A/B test | `/v1/compare` ยิง prompt ไป N model พร้อมกัน |
| 🔍 Model search | `/v1/models/search` หา model ที่เก่งด้านที่ต้องการ |
| 📚 Prompt library | เก็บ system prompt ใช้ซ้ำด้วยชื่อ |
| 🔬 Trace | `/v1/trace/:reqId` debug request ย้อนหลัง |
| 📊 Stats | `/api/my-stats` ของ IP ตัวเอง (p50/p95/p99) |
| 🎛 Control headers | `X-SMLGateway-Prefer/Exclude/Strategy/Max-Latency` |

---

## สารบัญ

- [3 แบบการใช้งาน](#3-แบบการใช้งาน-เลือก-1) — Local / VPS+Password / VPS+OAuth
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Virtual Models](#virtual-models)
- [โรงเรียน — Exam + Teachers](#โรงเรียน--exam--teachers)
- [Smart Routing](#smart-routing)
- [API](#api)
- [Dev Tools](#dev-tools)
- [Integration](#integration)
- [Port Map](#port-map)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
git clone https://github.com/jaturapornchai/bcproxyai.git sml-gateway
cd sml-gateway
cp .env.example .env.local
# แก้ .env.local — ใส่เฉพาะ API key ของ provider ที่มี (เว้นว่างได้)

docker compose up -d --build
sleep 10 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/
# เปิด dashboard
start http://localhost:3334/   # Windows
# คู่มือเชื่อมต่อ + ตัวอย่างโค้ด
start http://localhost:3334/guide
```

**ยิงทดสอบ (local mode — no auth):**
```bash
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"sml/auto","messages":[{"role":"user","content":"สวัสดี"}]}'
```

### เปิดโหมด VPS + Password (ง่ายสุด — ไม่พึ่ง Google)
ใน `.env.production` ของ droplet ตั้ง **3 ตัว**:
```bash
# Generate:
#   node -e "console.log('sk-gw-' + require('crypto').randomBytes(32).toString('hex'))"
GATEWAY_API_KEY=sk-gw-<32-byte-hex>

# Generate:
#   node -e "console.log(require('crypto').randomBytes(24).toString('base64').replace(/[+/=]/g,''))"
ADMIN_PASSWORD=<32-char-random>

# Metadata (แสดงใน audit + UI)
AUTH_OWNER_EMAIL=you@gmail.com,teammate@gmail.com
```

### เปิดโหมด VPS + Google OAuth (audit per-email)
เพิ่มอีก **4 ตัว**:
```bash
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=<random-32-base64>
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
# redirect URI ที่ Google: {NEXTAUTH_URL}/api/auth/callback/google
```
Google OAuth + Password **ใช้คู่กันได้** — login ด้วยวิธีไหนก็ได้

**เพิ่ม/ลบ admin ภายหลัง:** แก้ `AUTH_OWNER_EMAIL` → restart
```bash
ssh root@your-droplet
nano /opt/sml-gateway/.env.production
bash /opt/sml-gateway/scripts/deploy-droplet.sh
```

### Auth chain สำหรับ `/admin/*` + mutating `/api/*` + sensitive GET
```
1. Bearer GATEWAY_API_KEY  → pass  (CI / SDK path)
2. Signed admin cookie     → pass  (password login)
3. Google session + owner  → pass  (OAuth path)
4. else → /login (page) หรือ 401 (API)
```

**Sensitive GET endpoints** (ป้องกันด้วย auth chain เดียวกัน — owner/master only,
**check ก่อน /v1/* gate** เพื่อกัน `sml_live_*` token เห็น state ของ tenant อื่น):
- `/api/gateway-logs` — `user_message` + `assistant_message`
- `/v1/trace/:reqId` — per-request trace + messages
- `/api/infra` — Redis info + replica details
- `/api/dev-suggestions` — internal diagnostics
- `/api/k6-report` — internal load-test data
- `/api/complaint` — user-reported wrong answers (full text)
- `/api/setup` — masked API keys + provider toggle
- `/api/status` — worker state + run timing
- `/api/warmup-stats` — warmup-step worker logs
- `/api/semantic-cache` — query_hash + length + analytics (hit rate, top providers, stale entries) — preview hidden unless explicitly enabled
- `/api/providers` — operational provider state
- `/api/provider-limits` — upstream rate-limit headroom
- `/api/live-score` — per-model live success rate
- `/api/learning` — routing-learning state
- `/api/control-room` — single-call ops snapshot (worker + req stats + provider/model breakdown + circuits + cache)
- `/api/routing-explain` — per-request routing decision trail (no prompt content)
- `/api/autopilot` — rule-based ops recommendation cards
- `/api/replay` — POST owner-only request replay against multiple models (sensitive-prompt blocked unless `confirm: true`)

`/api/health` + `/api/auth/*` ยังเปิด public.

### คู่มือการสมัครใช้ API key (สำหรับ user ทั่วไป)

ระบบไม่มี self-service signup — ต้องขอผ่าน admin

**ขั้นตอน:**
1. ส่งอีเมลจาก **Gmail ของตัวเอง** (เพื่อ verify identity ได้ง่าย) ไปที่ email ใน `AUTH_OWNER_EMAIL` พร้อมข้อมูล:
   - Label / ชื่อที่อยากให้ใช้เรียก key (เช่น "ทีม marketing", "laptop-jane")
   - Use case สั้นๆ — ใช้ทำอะไร (chatbot / coding assistant / batch script ฯลฯ)
   - ปริมาณคาดการ์ณ (ถ้ามี) — กี่ request/วัน
2. **Admin เข้า** `/admin/keys` (prompt master key) → กรอก label + notes (อ้างอีเมลผู้ขอ) → กด **+ สร้าง key**
3. Admin **copy** `sml_live_...` **ตอบกลับทางอีเมล** (แสดงครั้งเดียว — หายไม่มีทางดูย้อนหลัง)
4. User เอา key ไปใช้:
   ```python
   from openai import OpenAI
   client = OpenAI(
       base_url="https://<your-gateway-domain>/v1",
       api_key="sml_live_xxxxxxxxxxxx",
   )
   ```

**ถ้า key หาย / โดน leak:** user ส่งอีเมลแจ้ง → admin revoke ใน `/admin/keys` (ลบทันที) → ออก key ใหม่
**ตั้งวันหมดอายุได้:** admin ใส่ expiry ตอนสร้าง (optional) — หมดอายุแล้ว middleware reject อัตโนมัติ

> รายละเอียดเพิ่มเติม + tutorial ทุก framework (Python/Node/LangChain/Hermes/OpenClaw) ดูที่ `/guide`

**Worker cycles ที่รันอัตโนมัติ:**

| Loop | Interval | ทำอะไร |
|---|---|---|
| main | 15 นาที | discovery + verify + scan + health + exam + teacher |
| verify | 3 นาที | probe homepage + `/v1/models` ของทุก provider |
| exam | 5 นาที | สอบ model ที่รอในคิว (ไม่ต้องรอ main cycle) |
| registry-sync | 6 ชม. | pull cheahjs + LiteLLM registry → auto-patch URL เสีย |
| warmup | 2 นาที | ping model ที่ผ่านสอบ — connection warm |

Trigger manual: `curl -X POST http://localhost:3334/api/worker`

---

## Provider Management — Local AI (Ollama) ผ่าน UI

หน้า `/admin/providers` (เข้าผ่านปุ่ม **🔌 Providers** บน navbar dashboard) ออกแบบให้เน้น **Local AI** เป็นหลัก:
- แสดงเฉพาะ provider ที่ host เป็น `localhost` / `127.0.0.1` / `host.docker.internal` / `0.0.0.0`
- Cloud provider (Groq, OpenRouter, Mistral, ฯลฯ) ระบบจัดการอัตโนมัติ — ซ่อนอยู่ใต้ปุ่ม "▼ แสดง Cloud providers" (read-only summary)

**ใช้สำหรับ:**
- เปลี่ยน Ollama port (เช่น `11434` → `8888`)
- ชี้ไป LLM local ตัวอื่นที่ OpenAI-compatible (vLLM, LM Studio, llama.cpp, LocalAI)
- ย้าย host (Docker → host machine, หรือ remote IP)
- ปิด provider ชั่วคราว (`active` ↔ `paused`)

**Flow:**
1. เข้า `/admin/providers` (auth ผ่าน Google OAuth / password / Bearer)
2. แก้ฟิลด์ **Host** หรือ **Port** แยกกัน — URL เต็มอัปเดตอัตโนมัติ (preview ด้านล่าง เปลี่ยนเป็นสีส้มเมื่อ dirty)
3. กด **🧪 ทดสอบเชื่อมต่อ** — probe `/v1/models` → แสดง HTTP status + จำนวน model + latency
4. กด **💾 บันทึก** — `provider_catalog.base_url` update ใน DB + cache 30s flush ทันที

**ฟีเจอร์อื่น:**
- **Theme toggle** ☀️/🌙 — เก็บใน `localStorage`
- Embeddings + completions URL จะ **derive อัตโนมัติ** จาก chat URL (แทน `/chat/completions` ด้วย `/embeddings` หรือ `/completions`) — ไม่ต้องตั้งแยก

**Resolver priority** ([src/lib/provider-resolver.ts](src/lib/provider-resolver.ts)):
1. `provider_catalog.base_url` (DB) — แก้จาก UI ได้
2. `PROVIDER_URLS` ใน [src/lib/providers.ts](src/lib/providers.ts) — fallback hardcoded
3. `""` — caller treats as unknown provider

---

## Architecture

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────┐
│  OpenAI SDK  │────▶│  Caddy (in-compose) │────▶│ Next.js  │
│   client     │     │  :3334 → :3000      │     │ gateway  │
└──────────────┘     └─────────────────────┘     └────┬─────┘
                                                     │
                              ┌──────────────────────┼──────────────────────┐
                              ▼                      ▼                      ▼
                        ┌──────────┐          ┌───────────┐          ┌───────────┐
                        │Postgres  │          │  Valkey   │          │ Provider  │
                        │pgvector  │          │ (Redis)   │          │  upstream │
                        │  :5434   │          │   :6382   │          │  (21 key) │
                        └──────────┘          └───────────┘          └───────────┘
```

### Container

| Container | Image | Port |
|---|---|---|
| `sml-gateway-sml-gateway-1` | next.js app | 3000 (internal) |
| `sml-gateway-caddy-1` | caddy:2-alpine | 3334 → 80 |
| `sml-gateway-postgres-1` | pgvector/pgvector:pg17 | 5434 → 5432 |
| `sml-gateway-redis-1` | valkey/valkey:8-alpine | 6382 → 6379 |

สเกล gateway หลายตัว: `docker compose up -d --scale sml-gateway=N` (Caddy load balance ให้)

### DB Schema (29 tables, highlights)

| Table | หน้าที่ |
|---|---|
| `models` | รายการโมเดล + flags (vision, tools, thai, reasoning, ...) + live_score |
| `teachers` | ครูใหญ่ + ครูหัวหน้าต่อ category + ครูคุมสอบ (rebuild ทุก cycle) |
| `model_category_scores` | คะแนนรายโมเดลต่อ 12 หมวด (code, thai, tools, vision, ...) |
| `exam_attempts` / `exam_answers` | ผลสอบ + คอลัมน์ `exam_level` (primary/middle/high/university) |
| `worker_state` | key-value config (เช่น `exam_level` ที่ใช้สอบรอบถัดไป) |
| `provider_catalog` | registry ของ provider + `auth_scheme` (bearer/apikey-header/none) + verify metadata |
| `provider_settings` / `api_keys` | API key ต่อ provider (encrypted) + meta |
| `gateway_api_keys` | per-client `sml_live_*` keys ที่ admin ออก (SHA-256 hash) |
| `gateway_logs` | log ทุก request (model, provider, latency, status, answer) |
| `health_logs` | ping ทุก cycle + cooldown_until |
| `model_fail_streak` | fail streak + exponential cooldown |
| `provider_limits` | TPM/TPD/RPM ที่ parse จาก response header |
| `token_usage` | tracking token usage ต่อ (provider, model) ใน rolling window |
| `worker_logs` | log ของ worker ทุก step (discovery/verify/scan/exam/warmup/cleanup) |
| `events` | school-bell notifications + provider errors |
| `complaints` / `complaint_exams` | User complaint loop (model ตอบแย่ → auto re-exam) |
| `routing_stats` | p50/p99 latency ต่อ provider |
| `prompts` | prompt library สำหรับ `POST /v1/prompts` |

---

## Virtual Models

| Model | เลือกยังไง |
|---|---|
| `sml/auto` | อัตโนมัติ — ประเมินจาก category ของ prompt แล้วเลือกครูหัวหน้าของหมวดนั้น |
| `sml/fast` | latency ต่ำสุด (p50) |
| `sml/tools` | รองรับ tool calling |
| `sml/thai` | ครูหัวหน้าหมวด thai |
| `sml/consensus` | ยิงไปหลายโมเดลแล้วเลือกคำตอบที่ตรงกันมากสุด |

เรียก model ตรงได้เหมือนเดิม — ใส่ `modelId` ของ provider เช่น `groq/llama-3.3-70b-versatile`

**Thai LLM shortcuts** (ต้องใส่ key ของแต่ละ provider ที่ `/setup`):
```
typhoon/typhoon-v2.5-30b-a3b-instruct
thaillm/OpenThaiGPT-ThaiLLM-8B-Instruct-v7.2
thaillm/Typhoon-S-ThaiLLM-8B-Instruct
thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0     ← มี reasoning mode
thaillm/THaLLE-0.2-ThaiLLM-8B-fa
```

## 🧠 Thinking / Reasoning Mode

Auto-detect + auto-enable — user ไม่ต้องส่ง param เอง

**การตรวจจับ** (stored ที่ `models.supports_reasoning`):
1. **Primary:** OpenRouter metadata `supported_parameters` มี `reasoning` / `include_reasoning` / `reasoning_effort`
2. **Fallback:** regex จับ keyword ที่ model id (`qwen3`, `o1`/`o3`/`o4`, `deepseek-r1`, `thinking`, `magistral`, `pathumma-think`, `lfm-thinking`, ฯลฯ)

**การใช้งาน** — gateway ใส่ให้อัตโนมัติ:
```json
{
  "reasoning": { "effort": "medium" },   // OpenRouter / Anthropic style
  "enable_thinking": true,                 // Qwen3 / DashScope style
  "max_tokens": 2000
}
```

**Opt-out** (ถ้าอยาก disable สำหรับ request นี้):
```json
{ "model": "thaillm/Pathumma-ThaiLLM-qwen3-8b-think-3.0.0",
  "messages": [...],
  "reasoning": false }
```

**สังเกตใน dashboard** — สมุดจดงานมี 🧠 tag บน exam ที่รันกับ reasoning model

---

## โรงเรียน — Exam + Teachers

ระบบจำลอง "โรงเรียน":

- **ครูใหญ่ (principal)** — 1 ตัว, คะแนนรวมสูงสุด, ใช้ตอบ request ที่ไม่ระบุ category
- **ครูหัวหน้าหมวด (head)** — 1 ตัวต่อ category (12 หมวด: code, thai, tools, vision, math, reasoning, extraction, classification, comprehension, instruction, json, safety)
- **ครูคุมสอบ (proctor)** — ≤ 10 ตัว, ใช้ออกและเกรดข้อสอบ

### Exam — 4 ระดับความยาก (cumulative)

| ระดับ | ชื่อ | จำนวนข้อ | ผ่าน |
|------|------|---------|------|
| 🟢 `primary`    | ประถม     | 5  | ≥ 40% |
| 🟡 `middle`     | มัธยมต้น   | 14 | ≥ 50% — _default_ |
| 🟠 `high`       | มัธยมปลาย  | 22 | ≥ 60% |
| 🔴 `university` | มหาลัย     | 30 | ≥ 70% |

ระดับสูงครอบคลุมข้อของระดับต่ำกว่า — score normalize เป็น % เพื่อเทียบข้ามระดับได้
**Default = middle** เพราะครอบคลุม primary + middle (กรอง Thai ได้ + ทดสอบ instruction/JSON/safety). `primary` ใช้เมื่อ pool ขาด model และอยากรับ "พื้นฐานพอ" เร็วๆ

ตั้งค่าระดับ: dashboard section **🎚 ระดับสอบ** — คลิกการ์ดระดับ → save อัตโนมัติทันที หรือ `POST /api/exam-config { "level": "middle" }`
สอบใหม่ทุกคน: ปุ่ม **🔄 สอบใหม่ทุกคน** (กด 2 ครั้งเพื่อยืนยัน) หรือ `POST /api/exam-reset` — ลบ `exam_attempts` + `model_category_scores` ทั้งหมด แล้ว trigger worker

**ใส่ key ใหม่ → re-exam อัตโนมัติ**: `/api/setup` POST → trigger `triggerExamForProvider(provider)` ทันที (model ที่เคยตกของ provider นั้น สอบใหม่ในรอบถัดไป) — กัน infinite loop ด้วย 5-min cooldown guard.

**Appoint:** หลัง exam ทุก cycle → `DELETE FROM teachers` + bulk insert (atomic swap)
**Routing:** `sml/auto` + category prompt → route ไปครูหัวหน้าของหมวดนั้นก่อน

---

## Smart Routing

1. **Response cache HIT** — hash body+model, TTL 30min → กลับใน ~200ms ไม่เรียก upstream (HIT rate ~60-70%)
2. **Category detect** — infer จาก prompt (code / thai / tools / vision / ...)
3. **Sticky pin** — (client_ip, category) ที่สำเร็จใน 30s ล่าสุด → pin candidate นั้นไว้บนสุด (warm socket + upstream KV cache)
4. **Pool filter** — ตัด model ที่ `cooldown_until > now()` ออก
5. **Context filter** — ถ้า `estTokens > 20K` เลือกเฉพาะ model ที่ `context_length > estTokens × 1.5`
6. **Hedge top-3** — ยิง 3 ตัวบนสุดพร้อมกัน (stream → first-byte race, non-stream → race บน response แรก). Hedge WIN ~46% ใน production
7. **Speculative hedge mid-flight** — ถ้า primary ไม่ตอบภายใน 1.5s → ยิง backup candidate (different provider) race ต่อ, abort loser
8. **Fail → cooldown** — exponential (10s → 2m cap) ตาม `streak_count`
9. **Adaptive slow-cooldown** — latency > 5-15s (ตาม prompt size) → 5min cooldown + school-bell event
10. **Circuit breaker — per (provider, model)** — 30s window rolling success/fail; < 30% success → open 30s → half-open probe. model ตัวเดียวพัง ไม่ลากทั้ง provider
11. **Auto-demote on 429 storm** — provider ที่คืน 429 ≥ 5 ครั้งใน 30s → cooldown ทั้ง provider 5min (quota หมดชัดเจน)
12. **Mistral message-order auto-patch** — inject `assistant()` turn ก่อน `tool` ที่มา after `system`/`user` เพื่อให้ผ่าน Mistral chat-template validator (Hermes agent + OpenClaw ใช้ได้)
13. **JSON tool-call repair** — ถ้า upstream ส่ง function call เป็น JSON ใน `message.content` ระบบจะแปลงเป็น OpenAI `tool_calls` เมื่อชื่อ function ตรงกับ schema ที่ client ส่งมา
14. **Client-400 short-circuit** — upstream คืน 400 invalid-shape → หยุด retry ทันที surface error กลับ client (ไม่ burn 10+ retries บน bug ฝั่งลูก)
15. **Parallel skip-checks** — Promise.all รวม cooldown/TPM/fit/capacity/circuit check
16. **Connection pre-warm** — ping top providers ตอน boot + ทุก 4 นาที (keep-alive socket ไม่ตาย)

**Backend speedups** (invisible to clients):
- Redis pipelining ใน hot paths (2→1 RTTs)
- DB query cache 5s stampede-safe wrap routing_stats aggregate
- Batched `gateway_logs` writes (100ms / 200 rows per INSERT)

**Measured in production** (stress test 30 VUs × 2min):
- Throughput: **12.5 req/s unique prompts**, **100+ req/s cached**
- p50: **22ms cached** / **606ms forward**
- p95: **530ms cached** / **3.9s forward**
- Cache HIT rate: **67-70%** (repeated queries)
- Success rate: **93%** under stress, **100%** normal

**เป้าหมาย:** p99 latency ~3s, success rate ~98%, 503 rate <1%
**Cost:** ไม่สนใจ — เน้น quality + latency (user rule)

---

## API

| Endpoint | หน้าที่ |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible chat (text / vision / tools / stream) |
| `GET  /v1/models` | รายการโมเดลทั้งหมด (รวม virtual models) |
| `GET  /v1/models/:id` | ดึงข้อมูล model ตัวเดียว รองรับ ID ที่มี `/` เช่น `sml/tools`, `groq/vendor/model` |
| `GET  /v1/models/search` | ค้นหา/จัดอันดับ model ตาม category, context, tools ฯลฯ |
| `POST /v1/compare` | ยิง prompt เดียวไปหลาย model พร้อมกัน (สูงสุด 10) |
| `POST /v1/structured` | Chat + JSON schema validation + auto-retry ถ้า output ไม่ตรง |
| `GET  /v1/trace/:reqId` | ดู log ของ request เดิม (จาก `X-SMLGateway-Request-Id` header) |
| `GET  /api/my-stats?window=24h` | สรุปการใช้งานของ IP ตัวเอง (p50/p95/p99 + top models) |
| `GET  /v1/prompts` | รายการ system prompts ที่บันทึกไว้ |
| `POST /v1/prompts` | สร้าง/เขียนทับ prompt `{ name, content, description? }` |
| `GET  /v1/prompts/:name` | ดึง prompt |
| `PUT  /v1/prompts/:name` | แก้ไข |
| `DELETE /v1/prompts/:name` | ลบ |
| `POST /v1/completions` | legacy completion endpoint |
| `POST /v1/embeddings` | embeddings (proxy ไป provider ที่รองรับ) |
| `GET  /api/status` | health summary + counts |
| `GET  /api/models` | model list + category scores |
| `GET  /api/teachers` | รายการครู (principal + heads + proctors) |
| `GET  /api/provider-limits` | TPM/TPD/RPM ต่อ provider |
| `GET  /api/semantic-cache` | cache stats + top entries |
| `GET  /api/warmup-stats` | warmup cycle stats |
| `GET  /api/perf-insights` | 1h rolling: cache/hedge/spec/sticky/demote counters + p50/p95 + throughput |
| `GET  /api/metrics` | Prometheus text format |
| `POST /api/worker` | trigger scan+exam cycle ด้วยมือ |
| `GET  /api/exam-config` | active exam level + 4 ระดับ + ตัวอย่างข้อสอบ (`?includeQuestions=1&level=middle`) |
| `POST /api/exam-config` | ตั้งระดับสอบ `{ "level": "primary"\|"middle"\|"high"\|"university" }` |
| `POST /api/exam-reset` | ลบประวัติสอบทั้งหมด + trigger worker ให้สอบใหม่ทันที |
| `GET  /api/provider-catalog` | รายการ provider ทั้งหมด (seed + discovered) + summary ตาม source |
| `POST /api/provider-catalog` | trigger auto-discovery ทันที (สแกน OpenRouter, HF, URL pattern) |
| `GET  /api/admin/keys` | **[owner]** รายการ gateway API keys (`sml_live_*`) |
| `POST /api/admin/keys` | **[owner]** สร้าง key ใหม่ — ตอบกลับ token ครั้งเดียว `{ label, expiresAt?, notes? }` |
| `PATCH/DELETE /api/admin/keys/:id` | **[owner]** enable/disable หรือ revoke |
| `GET  /api/admin/providers` | **[owner]** รายการ provider พร้อม `base_url` + status |
| `PUT  /api/admin/providers/:name` | **[owner]** แก้ `base_url` / status (active\|paused) / notes — flush cache 30s ทันที |
| `POST /api/admin/providers/:name/test` | **[owner]** probe `/v1/models` ของ URL (override ผ่าน body `base_url`) |
| `GET  /api/admin/circuits` | **[owner]** per-model circuit-breaker state — `{ open[], halfOpen[], warnings[], summary }` |
| `DELETE /api/admin/circuits?provider=X&modelId=Y` | **[owner]** reset 1 คู่ (ไม่ใส่ param = reset ทั้งหมด) |
| `GET  /guide` | คู่มือเชื่อมต่อ (long-form page) |
| `GET  /` | dashboard |

**`[owner]`** = ต้อง auth: master `Bearer GATEWAY_API_KEY` / admin password cookie / Google owner session

**Response headers ของ `/v1/chat/completions`:**
```
X-SMLGateway-Model        ชื่อ model ที่ตอบจริง
X-SMLGateway-Provider     provider ที่ตอบ
X-SMLGateway-Request-Id   ใช้กับ /v1/trace/:reqId เพื่อดูรายละเอียด
X-SMLGateway-Cache        HIT (ถ้าดึงจาก semantic cache)
X-SMLGateway-Hedge        true (ถ้าชนะจาก hedge)
X-SMLGateway-Consensus    รายชื่อ model ถ้าใช้ sml/consensus
X-Resceo-Backoff          true ถ้าเรียกถี่เกิน soft limit (ไม่บล็อก — hint)
```

**Dev controls ของ `/v1/chat/completions`** (ผ่าน `extra` body field หรือ `X-SMLGateway-*` headers):
```
prefer:          ["groq","cerebras"]   ดัน provider เหล่านี้ขึ้นบน (CSV ก็ได้)
exclude:         ["mistral"]           ตัดทิ้ง
max_latency_ms:  3000                  กรอง model ที่ avg_latency เกินนี้
strategy:        "fastest"             เรียง latency asc
strategy:        "strongest"           เรียง tier + context desc
```
ตัวอย่าง curl:
```bash
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "X-SMLGateway-Prefer: groq,cerebras" \
  -H "X-SMLGateway-Strategy: fastest" \
  -H "X-SMLGateway-Max-Latency: 3000" \
  -d '{"model":"sml/auto","messages":[...]}'
```

---

## Dev Tools

### หา model ตาม capability
```bash
curl "http://localhost:3334/v1/models/search?category=thai&min_context=200000&top=3"
curl "http://localhost:3334/v1/models/search?category=code&supports_tools=1&top=5"
```

### เปรียบเทียบ model
```bash
curl -X POST http://localhost:3334/v1/compare \
  -d '{"messages":[...],"models":["groq/...","cerebras/..."],"max_tokens":200}'
```

### Structured output (JSON schema + auto-retry)
```bash
curl -X POST http://localhost:3334/v1/structured \
  -d '{
    "messages":[{"role":"user","content":"Describe a fruit"}],
    "schema":{"type":"object","required":["name","color"],"properties":{...}},
    "max_retries":2
  }'
# → { ok, attempts, data, model, provider, latency_ms, request_ids }
```

### Prompt library
```bash
# สร้าง
curl -X POST http://localhost:3334/v1/prompts \
  -d '{"name":"pirate","content":"You are a pirate","description":"..."}'

# ใช้ในแชท — แค่เพิ่ม "prompt": "pirate"
curl -X POST http://localhost:3334/v1/chat/completions \
  -d '{"model":"sml/auto","prompt":"pirate","messages":[...]}'

# รายการ + แก้ + ลบ
curl http://localhost:3334/v1/prompts
curl -X PUT    http://localhost:3334/v1/prompts/pirate -d '{...}'
curl -X DELETE http://localhost:3334/v1/prompts/pirate
```

### Trace request
```bash
# ทุก response มี header: X-SMLGateway-Request-Id: <id>
curl http://localhost:3334/v1/trace/<id>
# → { requestId, found, entry: { resolved_model, provider, latency_ms, ... } }
```

### Usage stats
```bash
curl "http://localhost:3334/api/my-stats?window=24h"
# → { total, success, p50/p95/p99_latency_ms, top_models, by_hour }
# window: 1h | 6h | 24h | 7d | 30d
```

---

## Integration

### Next.js / Node
```ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "http://localhost:3334/v1", apiKey: "dummy" });
const chat = await client.chat.completions.create({
  model: "sml/auto",
  messages: [{ role: "user", content: "สวัสดี" }],
});
```

### Python
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3334/v1", api_key="dummy")
chat = client.chat.completions.create(
    model="sml/auto",
    messages=[{"role": "user", "content": "สวัสดี"}],
)
```

### LangChain
```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(base_url="http://localhost:3334/v1", api_key="dummy", model="sml/auto")
```

### thClaws
```bash
# ให้ SMLGateway เป็นคนเลือก provider/model จริงผ่าน virtual model
docker run --rm \
  -e DASHSCOPE_BASE_URL=https://smlgateway.smlsoftdemo.com/v1 \
  -e DASHSCOPE_API_KEY=sml_live_... \
  -e THCLAWS_DISABLE_KEYCHAIN=1 \
  -v "$PWD:/workspace" -w /workspace \
  thclaws-smlgateway:local \
  -p -m sml/auto --permission-mode auto \
  "สรุปโปรเจกต์นี้"
```

ใช้ `sml/auto` เป็นค่าเริ่มต้น, `sml/fast` เมื่อต้องการ latency ต่ำ, และ `sml/tools` เมื่อ workflow ต้องใช้ function/tool calling. ไม่ต้อง lock เป็นชื่อ provider/model เฉพาะ ยกเว้นตอน debug upstream โดยตรง.

### OpenClaw
```bash
# ในคอนเทนเนอร์ OpenClaw
openclaw onboard \
  --non-interactive --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://host.docker.internal:3333/v1 \
  --custom-model-id sml/auto \
  --custom-api-key dummy \
  --custom-compatibility openai \
  --skip-channels --skip-daemon --skip-health \
  --skip-search --skip-skills --skip-ui
```

### Hermes Agent (Nous Research)

Windows: ต้องใช้ WSL2 — `wsl --install -d Ubuntu-24.04`. macOS/Linux/WSL2:
```bash
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# Point Hermes at SMLGateway (custom provider)
hermes config set model.provider custom
hermes config set model.base_url https://smlgateway.smlsoftdemo.com/v1
hermes config set model.default sml/auto
# ใช้ sml/tools ถ้า workflow ต้องเรียก tools หนัก ๆ

# API key in ~/.hermes/.env
echo 'OPENAI_BASE_URL=https://smlgateway.smlsoftdemo.com/v1' >> ~/.hermes/.env
echo 'OPENAI_API_KEY=sml_live_...' >> ~/.hermes/.env

hermes chat -q "run: df -h | head -5"     # one-shot
hermes chat --continue                      # resume last session
```

Gateway auto-patches `[system, tool, ...]` message order for Mistral และ repair JSON-style tool calls เป็น OpenAI `tool_calls` shape เมื่อ client ส่ง tool schema มาด้วย ทำให้ Hermes/OpenClaw/thClaws ใช้ `sml/*` แล้วให้ SMLGateway route model ได้เอง.

ตัวอย่างเพิ่มเติม (vision, tools, streaming, 6 ภาษา) → เปิด `http://localhost:3334/guide`

---

## Port Map

| Port | Service |
|------|---------|
| 3333 | SMLGateway via external Caddy (300s timeout) |
| 3334 | SMLGateway via in-compose Caddy (load balanced) |
| 5434 | Postgres (pgvector) |
| 6382 | Valkey (Redis-compatible) |

---

## Development

Stack: Next.js 16 (App Router) · TypeScript 5 · Postgres (pgvector) · Valkey · Docker Compose

```bash
# Build + deploy + verify (ต้องผ่านทั้ง 3)
rtk npx next build                                                    # (1) 0 errors
rtk docker compose up -d --build
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/   # (2) 200
docker ps --format "{{.Names}} {{.Status}}" | grep sml-gateway         # (3) Up / healthy
```

Load test (k6):
```bash
npm run loadtest:smoke     # สั้นๆ — verify endpoint ยังตอบ
npm run loadtest:chat      # mixed category
npm run loadtest:stress    # stress hedge + pool recovery
npm run loadtest:ratelimit # rate limit enforcement
```

Reset database:
```bash
docker compose down -v   # ⚠ ลบ volume ทั้งหมด
docker compose up -d --build
```

Reindex QMD:
```bash
bash scripts/reindex.sh
```

---

## Deploy to Droplet

Droplet เป็น **Docker host ล้วน** (ไม่ใช่ git repo) — flow คือ copy ไฟล์ที่แก้ขึ้นไป แล้วรัน deploy script ให้ build + restart

```bash
# 1. copy ไฟล์ที่แก้ขึ้น droplet (เฉพาะที่เปลี่ยน)
scp <changed-files> root@<droplet>:/opt/sml-gateway/<path>

# 2. ssh เข้า droplet แล้วรัน deploy
ssh root@<droplet>
cd /opt/sml-gateway
bash scripts/deploy-droplet.sh
```

Script จะทำ:
1. `docker compose up -d --build` (ใช้ `docker-compose.yml` + `docker-compose.prod.yml`)
2. รอ `/api/health` ตอบ 200 ภายใน 30s
3. print container state

**Requirement:** `/opt/sml-gateway/.env.production` ต้องมีอยู่แล้ว (คัดลอกจาก `.env.production.example` ครั้งแรก)

**Caveat — memory:** `next build` กิน RAM 1–2 GB ระหว่าง build droplet 8 GB ที่รัน 10+ container พร้อมกันอาจ OOM ต้องมี swap อย่างน้อย 4 GB:
```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Caddy config:** `caddy-prod.Caddyfile` bind mount เข้า in-compose caddy container ที่ `/etc/caddy/Caddyfile` (read-only) หลังแก้ไฟล์นี้ ต้อง `docker compose restart caddy`

**Verify ผ่าน Cloudflare:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/api/health
```

---

## Operations / Tuning

Runtime knobs (env) — clamp ที่ฝั่ง code ไว้แล้ว ใส่ผิดก็ไม่ crash:

| Env | Default | Range | ผล |
|---|---|---|---|
| `PG_POOL_MAX` | 20 | 1–200 | จำนวน Postgres connection สูงสุดต่อ replica |
| `PG_IDLE_TIMEOUT_SEC` | 30 | 1–3600 | ปิด idle connection หลัง N วินาที |
| `PG_CONNECT_TIMEOUT_SEC` | 10 | 1–120 | timeout ตอน acquire connection |
| `CACHE_MAX_ENTRIES` | 2000 | 100–100000 | LRU cap ของ in-memory cache (`getCached` / `cachedQuery`) |
| `WORKER_LEADER_FAIL_OPEN` | `0` ใน prod, `1` ใน dev | `0`/`1` | ถ้า Redis ล่ม: `1` = run worker (single-replica), `0` = ไม่ run (กัน multi-replica thrashing) |
| `WORKER_AUTOSTART` | `1` | `0`/`1` | `1` = `instrumentation.ts` เรียก `ensureWorkerStarted()` ตอน boot. `0` = รอ `/api/worker` ตัว trigger (เช่น migration job แยก) |
| `WARMUP_MAX_MODELS` | 30 | 1–500 | จำนวนสูงสุด model ต่อรอบ warmup (ทุก 2 นาที). เลือก model ที่ latency ต่ำสุดก่อน |
| `LOG_SAMPLE_RATE` | 1 | 1–1000 | ใน chat hot path ใช้ `log.info()` ที่ sampled 1-in-N (ตั้ง 10–20 ใน prod ได้). `LOG_LEVEL=debug` ปิด sampling. Error/slow log emit เสมอ |
| `RESPONSE_CACHE_ENABLED` | `1` | `0`/`1` | response cache key = `respcache:<tenant_ns>:<hash>` — namespace per Bearer ป้องกัน cross-tenant. skip ทุก request ที่มี `tools`/`tool_choice` หรือ header `X-No-Cache: 1` |
| `SEMANTIC_CACHE_SHOW_PREVIEW` | `0` | `0`/`1` | `0` = `/api/semantic-cache` ส่งเฉพาะ hash + length. `1` = แสดง preview 40 ตัวอักษรสำหรับ debug เฉพาะ admin |
| `APP_ENCRYPTION_KEY` | _(unset)_ | ≥16 chars | เปิด encrypt-at-rest สำหรับ provider API keys ใน `api_keys.api_key` (AES-256-GCM, lazy migrate). unset = เก็บ plaintext (legacy) |
| `ADMIN_COOKIE_SECRET` | _(fallback to ADMIN_PASSWORD)_ | ≥32 random bytes | HMAC signing key ของ `sml_admin` cookie. ตั้งแยกเพื่อให้ password rotation ไม่ทำให้ทุก cookie หายและกัน offline brute-force ของ password ผ่าน leaked cookie |
| `TRUSTED_PROXY_HOPS` | 1 | 0–5 | จำนวน reverse proxy ที่เชื่อ X-Forwarded-For. Caddy 1 hop = 1, Cloudflare→Caddy = 2 |
| `BENCHMARK_CONCURRENCY` | 8 | 1–32 | parallel workers ใน benchmark cycle. ลด/เพิ่มตาม `PG_POOL_MAX` headroom |
| `SSRF_ALLOW_PRIVATE` | _(unset)_ | `1` | dev only — disable SSRF guard ใน `/api/admin/providers/*/test` เพื่อทดสอบกับ localhost provider |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | URL | base ของ Ollama (override ได้ผ่าน `/admin/providers` ที่จะเก็บ DB ทับ env) |
| `SML_FREE_PROVIDER_ALLOWLIST` | `ollama,pollinations` | CSV provider names | รายชื่อ provider ที่อนุญาตทั้ง provider ใน no-spend mode; ใช้กับ local/no-key เท่านั้น |
| `SML_FREE_MODEL_ALLOWLIST` | `openrouter/*:free,openrouter/openrouter/free` | CSV `provider/model` globs | รายชื่อ cloud model ที่ยืนยันว่าเป็น free-only; ไม่อนุญาตทั้ง provider |
| `SML_ALLOW_PAID_PROVIDERS` | `0` | `0`/`1` | `1` = ปิด cost guard และอนุญาต provider ทุกตัวที่มี key; ใช้เฉพาะ paid deployment |

**Worker leader behavior** ([src/lib/worker/leader.ts](src/lib/worker/leader.ts)):
- ตอน Redis ใช้ได้ → `SET NX EX 14m` ป้องกัน multi-replica run cycle ซ้อน
- `renewLeader()` + `releaseLeader()` ใช้ Lua script fenced — เช็ค `GET == me` ก่อนทำการ EXPIRE/DEL atomically กัน race window ที่ replica ใหม่อาจคว้า lock ระหว่างนั้น
- ระหว่าง `runWorkerCycle()` มี background renewer ทุก 2 นาที → cycle ที่ลากกว่า 14 นาทีไม่หลุด lock ให้ replica อื่น
- ตอน Redis ล่ม + `NODE_ENV=production` + `WORKER_LEADER_FAIL_OPEN` ไม่ใช่ `1` → return `false` (ไม่มี replica run)
- ตอน Redis ล่ม + `NODE_ENV !== production` (หรือ `WORKER_LEADER_FAIL_OPEN=1`) → return `true` (single-replica fallback สำหรับ dev)
- SIGTERM ใน [instrumentation.ts](src/instrumentation.ts) เรียก `stopWorker()` → clear timers + `releaseLeader()` + `sql.end()` ก่อน exit (lock ไม่ค้าง 14 นาทีหลัง restart)

**Migration safety** ([src/lib/db/migrate.ts](src/lib/db/migrate.ts)):
ทุก table ใช้ `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` ไม่มี `DROP TABLE` — restart container ไม่ทำลาย data เดิม.

**Latest health helper:** view `latest_model_health` ([src/lib/db/migrate.ts](src/lib/db/migrate.ts)) คืน 1 row ต่อ model — entry ล่าสุดของ `health_logs`. `/api/health`, `/api/status`, `/api/models`, worker warmup join view นี้แทน pattern `GROUP BY model_id, MAX(id)` (ใช้ index `idx_health_model_id_desc`).

**Tenant isolation in caches** (กัน cross-tenant leak):
- Response cache (Redis) — key `respcache:<tenant_ns>:<hash>` per Bearer
- Semantic cache (pgvector) — composite unique `(tenant_ns, query_hash)` กัน tenant A INSERT บล็อค tenant B ผ่าน ON CONFLICT
- Provider API keys — encrypt-at-rest ผ่าน `APP_ENCRYPTION_KEY` (AES-256-GCM, lazy migrate `enc:v1:*` format)

**SSRF protection:** `/api/admin/providers/*/test` ผ่าน [src/lib/ssrf-guard.ts](src/lib/ssrf-guard.ts) — DNS resolve + block RFC1918 / loopback / link-local / cloud-metadata IPs + port allowlist (80/443/8080/8443/3000/8000). dev override: `SSRF_ALLOW_PRIVATE=1`.

**Constant-time secret compare:** master Bearer ทุกจุดใช้ [src/lib/secret-compare.ts](src/lib/secret-compare.ts) `timingSafeStringEqual()` แทน `===` — กัน byte-by-byte timing attack.

**Live Ops Dashboard** (panels ใหม่ใน [src/app/page.tsx](src/app/page.tsx)):
- 🛰️ **Control Room** ([api](src/app/api/control-room/route.ts)) — single-call snapshot ของ worker / req stats / provider breakdown / circuits / cache (ปรับ window 15m / 1h / 6h / 24h)
- 🤖 **Autopilot** ([api](src/app/api/autopilot/route.ts)) — rule-based recommendation cards (provider error rate / slow p95 / cooldown count / fallback heavy / cache hit low / circuits open)
- 🧭 **Routing Explain** ([api](src/app/api/routing-explain/route.ts)) — decision trail per request (mode, candidates, selected reason, fallbackUsed). เก็บใน `gateway_logs.routing_explain JSONB` — no prompt content
- 🔁 **Replay & Compare** ([api](src/app/api/replay/route.ts)) — owner-only POST `{ reqId, candidates }` ดึง prompt เดิม ยิงเทียบ ≤5 model. sensitive keyword block (override `confirm: true`)
- 🧠 **Semantic Cache Analytics** ([api](src/app/api/semantic-cache/route.ts)) — hit rate (1h), top providers/models, stale entries (>30 วัน), estimated saved requests

**Maintainability notes:** ไฟล์ใหญ่/refactor candidates → [docs/maintainability-notes.md](docs/maintainability-notes.md)

---

## Troubleshooting

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| `/v1/chat/completions` → 404 model | ใช้ `sml/auto` หรือเช็ค `GET /v1/models` |
| 503 ยาว | pool หมด — ดู dashboard "โควต้า Provider" + "ขาด/ลา", รอ cooldown หรือเติม API key |
| p99 สูง | มักเป็น long context — filter ไปโมเดล `context_length` สูง, ดู `/api/routing-stats` |
| `sml/auto` เลือกผิดหมวด | เช็ค `model_category_scores` + `teachers` ใน DB |
| Worker ไม่รัน | trigger ด้วย `POST /api/worker`, ดู `worker_logs` + `worker_state` |
| postgres healthcheck fail | `docker compose logs postgres` — มักเป็น volume permission |

Debug DB:
```bash
docker exec -it sml-gateway-postgres-1 psql -U sml -d smlgateway
# \dt                                      ดู tables
# SELECT * FROM teachers;                  ดูครู
# SELECT * FROM model_fail_streak;         ดู cooldown
# SELECT * FROM gateway_logs ORDER BY created_at DESC LIMIT 10;
```

Logs:
```bash
docker compose logs -f sml-gateway
docker compose logs -f postgres
```
