# SMLGateway

**OpenAI-compatible LLM gateway ที่รวมโมเดลฟรีจากหลาย provider ไว้จุดเดียว**
ระบบเรียนรู้จากการใช้งานเอง — ไม่ต้อง tune ด้วยมือ ยิ่งใช้ยิ่งเลือก route ได้ดี

> ใช้ได้กับทุก client ที่รองรับ OpenAI SDK — Next.js, Python, LangChain, curl, OpenClaw, Aider, Cline ฯลฯ

**Local-only** — ออกแบบให้รันบน Docker Desktop เครื่องเดียว ไม่มี auth / multi-tenant / public deploy (หลีกเลี่ยงปัญหา provider IP lock)

---

## สารบัญ

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Virtual Models](#virtual-models)
- [โรงเรียน — Exam + Teachers](#โรงเรียน--exam--teachers)
- [Smart Routing](#smart-routing)
- [API](#api)
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
| `exam_attempts` / `exam_answers` | ผลสอบ 25 ข้อ, threshold 50% |
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

**Exam:** 25 คำถาม (mixed category) + threshold 50% → โมเดลที่ผ่านเข้า pool
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
| `GET  /guide` | คู่มือเชื่อมต่อ (long-form page) |
| `GET  /` | dashboard |

**Response headers ของ `/v1/chat/completions`:**
```
X-SMLGateway-Model       ชื่อ model ที่ตอบจริง
X-SMLGateway-Provider    provider ที่ตอบ
X-SMLGateway-Latency-Ms  latency ms
X-SMLGateway-Cache       HIT / MISS
X-SMLGateway-Hedge       winner index (0-2)
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
