# SMLGateway

**OpenAI-compatible LLM gateway ที่รวมโมเดลฟรีจากหลาย provider ไว้จุดเดียว**
ระบบเรียนรู้จากการใช้งานเอง — ไม่ต้อง tune ด้วยมือ ยิ่งใช้ยิ่งเลือก route ได้ดี

> ใช้ได้กับทุก client ที่รองรับ OpenAI SDK — Next.js, Python, LangChain, curl, OpenClaw, Aider, Cline ฯลฯ

**Local-only** — ออกแบบให้รันบน Docker Desktop เครื่องเดียว ไม่มี auth / multi-tenant / public deploy (หลีกเลี่ยงปัญหา provider IP lock)

## สิ่งที่ Dev ได้ทันที

| | |
|---|---|
| 🆓 Free | 21 providers ฟรี, 300+ models, ไม่มี token cost |
| ⚡ Fast | hedge top-3, warmup, semantic cache → p50 ~500ms |
| 🎯 Smart routing | per-category teacher (thai/code/tools/vision/...) |
| 🔄 Auto-fallback | provider ล่ม → สลับทันที, circuit breaker + cooldown |
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
git clone https://github.com/jaturapornchai/sml-gateway.git
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

ยิงทดสอบ:
```bash
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"sml/auto","messages":[{"role":"user","content":"สวัสดี"}]}'
```

Worker cycle (scan → health → exam → appoint teachers) รันเองทุก 15 นาที
Warmup worker ping โมเดลที่ผ่านสอบทุก 2 นาที
Trigger manual: `curl -X POST http://localhost:3334/api/worker`

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

### DB Schema (26 tables, highlights)

| Table | หน้าที่ |
|---|---|
| `models` | รายการโมเดล + flags (vision, tools, thai, ...) + live_score |
| `teachers` | ครูใหญ่ + ครูหัวหน้าต่อ category + ครูคุมสอบ (rebuild ทุก cycle) |
| `model_category_scores` | คะแนนรายโมเดลต่อ 12 หมวด (code, thai, tools, vision, ...) |
| `exam_attempts` / `exam_answers` | ผลสอบ + คอลัมน์ `exam_level` (primary/middle/high/university) |
| `worker_state` | key-value config (เช่น `exam_level` ที่ใช้สอบรอบถัดไป) |
| `gateway_logs` | log ทุก request (model, provider, latency, status) |
| `health_logs` | ping ทุก cycle + cooldown_until |
| `model_fail_streak` | fail streak + cooldown exponential |
| `provider_limits` | TPM/TPD/RPM ที่ parse จาก response header |
| `semantic_cache` | pgvector cosine similarity cache |
| `routing_stats` | p50/p99 latency ต่อ provider |

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

---

## โรงเรียน — Exam + Teachers

ระบบจำลอง "โรงเรียน":

- **ครูใหญ่ (principal)** — 1 ตัว, คะแนนรวมสูงสุด, ใช้ตอบ request ที่ไม่ระบุ category
- **ครูหัวหน้าหมวด (head)** — 1 ตัวต่อ category (12 หมวด: code, thai, tools, vision, math, reasoning, extraction, classification, comprehension, instruction, json, safety)
- **ครูคุมสอบ (proctor)** — ≤ 10 ตัว, ใช้ออกและเกรดข้อสอบ

### Exam — 4 ระดับความยาก (cumulative)

| ระดับ | ชื่อ | จำนวนข้อ | ผ่าน |
|------|------|---------|------|
| 🟢 `primary`    | ประถม      | 10 | ≥ 70% |
| 🟡 `middle`     | มัธยมต้น   | 19 | ≥ 75% |
| 🟠 `high`       | มัธยมปลาย  | 27 | ≥ 80% |
| 🔴 `university` | มหาลัย     | 35 | ≥ 85% |

ระดับสูงครอบคลุมข้อของระดับต่ำกว่า (เด็กมหาลัยต้องตอบข้อประถมได้) — score normalize เป็น % เพื่อเทียบข้ามระดับได้

ตั้งค่าระดับ: dashboard section **🎚 ระดับสอบ** หรือ `POST /api/exam-config { "level": "primary" }`
สอบใหม่ทุกคน: ปุ่มในหน้าเดียวกัน หรือ `POST /api/exam-reset` (ลบ `exam_attempts` + `model_category_scores` ทั้งหมด แล้ว trigger worker)

**Appoint:** หลัง exam ทุก cycle → `DELETE FROM teachers` + bulk insert (atomic swap)
**Routing:** `sml/auto` + category prompt → route ไปครูหัวหน้าของหมวดนั้นก่อน

---

## Smart Routing

1. **Category detect** — infer จาก prompt (code / thai / tools / vision / ...)
2. **Pool filter** — ตัด model ที่ `cooldown_until > now()` ออก
3. **Context filter** — ถ้า `estTokens > 20K` เลือกเฉพาะ model ที่ `context_length > estTokens × 1.5`
4. **Hedge top-3** — ยิง 3 ตัวบนสุดพร้อมกัน, ใครตอบก่อนชนะ
5. **Fail → cooldown** — exponential (10s → 2m cap) ตาม `streak_count`
6. **Circuit breaker** — half-open probe หลัง 30s
7. **Semantic cache** — ถ้า cosine ≥ 0.92 → คืน cache ทันที

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
| `GET  /api/metrics` | Prometheus text format |
| `POST /api/worker` | trigger scan+exam cycle ด้วยมือ |
| `GET  /api/exam-config` | active exam level + 4 ระดับ + ตัวอย่างข้อสอบ (`?includeQuestions=1&level=primary`) |
| `POST /api/exam-config` | ตั้งระดับสอบ `{ "level": "primary"\|"middle"\|"high"\|"university" }` |
| `POST /api/exam-reset` | ลบประวัติสอบทั้งหมด + trigger worker ให้สอบใหม่ทันที |
| `GET  /guide` | คู่มือเชื่อมต่อ (long-form page) |
| `GET  /` | dashboard |

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
