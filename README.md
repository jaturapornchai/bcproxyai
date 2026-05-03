# SMLGateway

**OpenAI-compatible LLM gateway ที่ใช้เฉพาะ free-tier model จาก provider ที่คัดเลือกไว้แล้ว**
ระบบเรียนรู้จากการใช้งานเอง — ยิ่งใช้ยิ่งเลือก route ได้ดี

> ใช้ได้กับทุก client ที่รองรับ OpenAI SDK — Next.js, Python, LangChain, thClaws, Hermes Agent, OpenClaw, Aider, Cline, curl ฯลฯ

---

## ⛔ ก่อนสมัคร provider — อ่านก่อน

provider AI หลายเจ้า **ข้ามจาก free tier ไปตัดบัตรเครดิตเงียบๆ** เมื่อ quota หมด — SMLGateway ห้ามไม่ได้

**กฎเหล็ก 4 ข้อก่อนกรอก API key:**
1. **ใช้ email สำรอง** ที่ไม่เคยใส่บัตรเครดิต ไม่มี Google Pay/Apple Pay ผูก
2. ถ้าตอนสมัคร **SKIP ใส่บัตรได้ → ใช้ได้** ปลอดภัย
3. ถ้า provider **บังคับใส่บัตร** → ข้ามไปเลย ใช้เจ้าอื่นแทน
4. ถ้าเผลอผูกบัตรไปแล้ว → **ลบบัตรออก** หรือตั้ง `spending limit = $0` ก่อนกรอก key

หน้า `/setup` มี hazard-stripe banner เตือนทุกครั้ง — ห้ามปิด ห้ามข้าม

---

## Catalog ปัจจุบัน — 14 providers / ~122 models

ทุก model ใน [src/lib/free-model-catalog.ts](src/lib/free-model-catalog.ts) ผ่านการ verify ด้วย direct API probe ว่าเป็น free tier จริง — ไม่ใช่ trial credit ที่จะหมดแล้วเก็บเงิน

| Provider | Models | Free tier |
|---|--:|---|
| OpenRouter | 29 | ตัวที่ลงท้าย `:free` ทั้งหมด |
| GitHub Models | 20 | Microsoft preview (Personal Access Token + `read:models`) |
| SambaNova | 12 | 10-30 RPM, daily quota per model |
| Google AI Studio | 7 | Gemini 2.0/2.5 Flash + Gemma 3 |
| NVIDIA NIM | 7 | ~40 RPM + starter credits |
| Groq | 6 | 30 RPM / 1K-14K RPD |
| Mistral La Plateforme | 6 | Free Experiment 1G tok/เดือน |
| HuggingFace Inference | 6 | monthly free credits |
| Ollama Cloud | 5 | daily quota + key required |
| Cerebras | 4 | 1M tok/วัน, context cap 8K |
| Cohere | 4 | trial 1K calls/**month** (RPM throttled to 1) |
| 🇹🇭 ThaiLLM (NECTEC) | 4 | 5 RPS / 200 RPM, no card |
| 🇸🇬 SEA-LION (AI Singapore) | 3 | 10 RPM, no card |
| Together AI | 2 | เฉพาะ `*-Free` endpoints |
| 🇹🇭 Typhoon (SCB 10X) | 2 | 5 RPS / 200 RPM, no card |

ลบ/เพิ่ม model ต้องแก้ `free-model-catalog.ts` แล้ว redeploy. Model ที่ deprecate เพิ่ม field `deprecatedAfter: 'YYYY-MM-DD'` แทนการลบ — จะถูก filter ออกอัตโนมัติเมื่อถึงวัน + warn 7 วันก่อน

---

## 3 แบบการใช้งาน (เลือก 1)

ระบบ **auto-detect จาก `.env`** — ตั้ง env ของ method ไหน = method นั้นเปิดอัตโนมัติ

| | ① Local | ② VPS + Password | ③ VPS + Google OAuth |
|---|---|---|---|
| **ใคร** | Dev เล่นคนเดียว | ทีมเล็ก, ไม่มี Gmail | ทีม production, audit รายคน |
| **Setup** | 5 นาที | 10 นาที | 30-45 นาที |
| **Auth** | 🚫 ไม่มี | Bearer + Password | Bearer + Password + Google |
| **Client** | `api_key: "dummy"` | `Bearer sk-gw-...` / `sml_live_*` | `Bearer sk-gw-...` / `sml_live_*` |
| **Admin UI** | เปิดหมด | Password 7-day cookie | Google login / Password fallback |

### ① Local
```bash
git clone https://github.com/jaturapornchai/bcproxyai.git sml-gateway
cd sml-gateway
cp .env.example .env.local
docker compose up -d --build
# http://localhost:3334/
```

### ② VPS + Password
ตั้ง 3 ตัวใน `.env.production`:
```bash
GATEWAY_API_KEY=sk-gw-<32-byte-hex>
ADMIN_PASSWORD=<random-24-base64>
AUTH_OWNER_EMAIL=admin@example.com
```

### ③ VPS + Google OAuth
เพิ่มอีก 4 ตัว:
```bash
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=<random-32-base64>
GOOGLE_CLIENT_ID=<from-google-console>
GOOGLE_CLIENT_SECRET=<from-google-console>
```
เปิด method ไหน = ตั้ง env ของ method นั้น · ไม่ตั้ง = ปิด · ไม่มี `AUTH_MODE` flag

---

## Quick Start

```bash
docker compose up -d --build
sleep 10 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/
start http://localhost:3334/         # Windows — เปิด dashboard
start http://localhost:3334/guide    # คู่มือเชื่อมต่อ + ตัวอย่างโค้ด
```

ยิงทดสอบ (local — no auth):
```bash
curl -X POST http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"sml/auto","messages":[{"role":"user","content":"สวัสดี"}]}'
```

ผ่าน production (Cloudflare):
```bash
curl -X POST https://your-domain.com/v1/chat/completions \
  -H "Authorization: Bearer sk-gw-..." \
  -H "Content-Type: application/json" \
  -d '{"model":"sml/auto","messages":[{"role":"user","content":"สวัสดี"}]}'
```

---

## Virtual Models

| Model | เลือกยังไง |
|---|---|
| `sml/auto` | category-aware — กระจาย provider ใน top-6 candidates ก่อน fallback (single-provider outage ไม่ stall) |
| `sml/fast` | latency ต่ำสุด — boost Groq/Cerebras/SambaNova/Together และใช้ EWMA ของ production latency |
| `sml/tools` | รองรับ tool calling — function call schema validation gate |
| `sml/thai` | category=thai winner — Pathumma/Typhoon/OpenThaiGPT เก่งภาษาไทยจะถูกเลือกหลัง 24h |
| `sml/consensus` | ส่งไปหลาย model พร้อมกัน vote คำตอบที่ตรงกันมากสุด |

เรียก model ตรงได้ทุกตัวใน catalog เช่น `openrouter/openai/gpt-oss-20b:free`, `groq/llama-3.3-70b-versatile`, `typhoon/typhoon-v2.5-30b-a3b-instruct`

---

## Reliability Features

### Hardcoded mode (no runtime discovery)
- Catalog ฝังในโค้ด (`free-model-catalog.ts`) — scanner sync เข้า DB ทุก 15 นาที, ไม่ scrape internet
- ENV vars `SML_FREE_PROVIDER_ALLOWLIST`, `SML_FREE_MODEL_ALLOWLIST`, `SML_ALLOW_PAID_PROVIDERS` ถูก ignore ทั้งหมด — leak `.env` ไม่ขยาย access ได้

### Circuit breaker (3-state)
- In-memory + Redis-mirrored — multi-pod safe ผ่าน `SET NX EX 65`
- เมื่อ model fail ≥2 ครั้งใน 30s → half-open: admit 1 probe ทั่ว cluster
- Success ปิด breaker ทันที, fail double cooldown

### Client-side RPM throttle
- Redis sliding-window per `(provider, model)` ตาม `rpmLimit` ใน catalog
- Skip locally ก่อนยิง upstream → ไม่เผา quota แล้วเจอ 429 cooldown ยาว
- Fail-open บน Redis outage

### Provider-diversity fallback chain
- Top-6 candidates round-robin across providers ใน `reorderForLatency()`
- OR ล่ม → ลำดับถัดไปคือ Groq/Cerebras/Google ทันที (ไม่ใช่ OR ตัวที่ 2-6)

### Tool-call JSON validation
- ทุก response ที่มี `tool_calls` ตรวจ `JSON.parse(arguments)` ก่อน return
- Malformed JSON / non-object args → treated as fail, fallback ไป provider ถัดไป
- ป้องกัน OpenClaw/Hermes agents stall จาก broken function call

### Deprecation watcher
- Field `deprecatedAfter: 'YYYY-MM-DD'` ใน catalog entry
- หลังวันที่ระบุ — auto-filter จาก `/v1/models` + scanner + cost policy check
- 7 วันก่อน EOL — log warn จาก worker cycle

### Regression alert
- `checkRegressionWarning()` เทียบ success rate 1h ล่าสุด vs baseline 23h
- Drop ≥20pp + min sample 10 ฝั่งละ → log warn + POST ไปยัง `GATEWAY_REGRESSION_WEBHOOK` (ถ้าตั้ง)
- Slack/Discord-compatible payload (`text` + `content` field)
- Cooldown 10 นาทีต่อ modelId กัน log spam

### Cost policy
- `isModelCostAllowed(provider, modelId)` ตรวจกับ catalog set ตรงๆ
- ทุก request ผ่าน `forwardToProvider` → check ก่อนยิง
- Hardcoded — ไม่อ่าน env, ไม่อ่าน DB allowlist

---

## Smart Routing

1. **Response cache HIT** — hash body+model, TTL 30min → ~200ms ไม่เรียก upstream
2. **Semantic cache** — pgvector ANN (HNSW), per-tenant key, 1h TTL
3. **Category detect** — code / thai / tools / vision / math / reasoning / json / ...
4. **Sticky pin** — `(client_ip, category)` 30s — pin warm socket
5. **Pool filter** — ตัด `cooldown_until > now()` + `deprecated` ออก
6. **Context filter** — `estTokens > 20K` → เลือก `context_length > estTokens × 1.5`
7. **Latency-aware sort** — EWMA จาก `routing_stats` (24h) + `PROVIDER_LATENCY_HINT_MS` fallback สำหรับ provider ใหม่
8. **Provider diversity** — top-6 round-robin across providers
9. **Hedge top-N** — ยิงพร้อมกัน, race first byte
10. **Speculative hedge** — primary > 1.5s → backup race
11. **Circuit breaker** — half-open probe limit ป้องกัน thundering herd
12. **Local RPM throttle** — Redis sliding window
13. **JSON tool-call repair** — Hermes/Qwen JSON-in-content → OpenAI `tool_calls` shape
14. **Mistral message-order patch** — inject `assistant` turn ก่อน `tool` after `system`/`user`
15. **Connection pre-warm** — ทุก 4 นาที (keep-alive socket)

---

## โรงเรียน — Exam + Teachers

### Exam levels (cumulative)
| ระดับ | ชื่อ | จำนวนข้อ | ผ่าน |
|---|---|--:|---|
| 🟢 primary | ประถม | 5 | ≥40% |
| 🟡 middle | มัธยมต้น | 14 | ≥50% |
| 🟠 high | มัธยมปลาย | ~30 | ≥60% (default) |
| 🔴 university | มหาลัย | ~41 | ≥70% |

**Thai battery: 32 questions** — translation TH↔EN, idiom (น้ำขึ้นให้รีบตัก), proverb, word problem ภาษาไทย, currency words, polite particle (ห้าม `ครับ/ค่ะ` slash), numerals (๒๐๒๖), classifier (ลักษณนาม), royal vocab (เสวย), tone marker, code-switch detection, Isan dialect, address order, BE↔CE conversion, phone format, summary

ตั้งระดับ: dashboard **🎚 ระดับสอบ** หรือ `POST /api/exam-config { "level": "middle" }`
สอบใหม่ทุกคน: `POST /api/exam-reset` (ลบ `exam_attempts` + `model_category_scores`)
ใส่ key ใหม่ → re-exam อัตโนมัติ: `triggerExamForProvider()` (5-min cooldown guard)

### Teachers
- **ครูใหญ่** — 1 ตัว, คะแนนรวมสูงสุด, ใช้ตอบ `sml/auto` ที่ไม่ระบุ category
- **ครูหัวหน้าหมวด** — 1 ตัวต่อ category (12 หมวด)
- **ครูคุมสอบ** — ≤10 ตัว, ใช้ออก/เกรดข้อสอบ
- หลังสอบ → `DELETE FROM teachers` + bulk insert (atomic swap)

---

## API

| Endpoint | หน้าที่ |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible (text / vision / tools / stream) |
| `GET  /v1/models` | รายการ + 5 virtual aliases (deprecation-filtered) |
| `GET  /v1/models/:id` | model ตัวเดียว — รองรับ ID ที่มี `/` |
| `GET  /v1/models/search` | filter/rank ตาม category, context, tools |
| `POST /v1/compare` | ยิงไปหลาย model พร้อมกัน (≤10) |
| `POST /v1/structured` | Chat + JSON schema validation + auto-retry |
| `POST /v1/completions` | legacy completion |
| `POST /v1/embeddings` | embeddings (proxy ไป provider ที่รองรับ) |
| `GET  /v1/trace/:reqId` | log ของ request เดิม |
| `GET/POST/PUT/DELETE /v1/prompts[/:name]` | prompt library |
| `GET  /api/health` | public health check |
| `GET  /api/status` | health + counts |
| `GET  /api/my-stats?window=24h` | stats ของ IP ตัวเอง (p50/p95/p99) |
| `POST /api/worker` | trigger scan + exam cycle |
| `POST /api/exam-reset` | ลบประวัติสอบ + trigger worker |
| `GET/POST /api/exam-config` | active exam level |
| `GET  /api/admin/keys` `POST /api/admin/keys` | **[owner]** issue/revoke `sml_live_*` |
| `GET/PUT /api/admin/providers` | **[owner]** provider catalog |
| `GET/DELETE /api/admin/circuits` | **[owner]** per-model breaker state |

**`[owner]`** = master `Bearer GATEWAY_API_KEY` / admin password cookie / Google owner session

### Sensitive GET endpoints (auth-gated)
- `/api/gateway-logs`, `/v1/trace/:reqId` — full prompts
- `/api/infra`, `/api/dev-suggestions`, `/api/k6-report`, `/api/complaint`
- `/api/setup`, `/api/status`, `/api/warmup-stats`
- `/api/semantic-cache`, `/api/providers`, `/api/provider-limits`
- `/api/live-score`, `/api/learning`, `/api/control-room`
- `/api/routing-explain`, `/api/autopilot`, `/api/replay`

`/api/health` + `/api/auth/*` ยังเปิด public

### Response headers (`/v1/chat/completions`)
```
X-SMLGateway-Model        ชื่อ model ที่ตอบจริง
X-SMLGateway-Provider     provider ที่ตอบ
X-SMLGateway-Request-Id   ใช้กับ /v1/trace/:reqId
X-SMLGateway-Cache        HIT (จาก semantic cache)
X-SMLGateway-Hedge        true (ชนะจาก hedge)
X-SMLGateway-Consensus    รายชื่อ model (ถ้าใช้ sml/consensus)
```

### Dev controls (body extra หรือ header)
```
prefer:          ["openrouter"]    ดัน provider ขึ้น
exclude:         ["cohere"]        ตัดทิ้ง
max_latency_ms:  3000              กรอง model
strategy:        "fastest"|"strongest"
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
    model="sml/thai",
    messages=[{"role": "user", "content": "แปลเป็นไทย: I love coding"}],
)
```

### LangChain
```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(base_url="http://localhost:3334/v1", api_key="dummy", model="sml/auto")
```

### thClaws
```bash
docker run --rm \
  -e DASHSCOPE_BASE_URL=https://your-domain.com/v1 \
  -e DASHSCOPE_API_KEY=sml_live_... \
  -e THCLAWS_DISABLE_KEYCHAIN=1 \
  -v "$PWD:/workspace" -w /workspace \
  thclaws-smlgateway:local \
  -p -m sml/auto --permission-mode auto \
  "สรุปโปรเจกต์นี้"
```

### Hermes Agent
```bash
hermes config set model.provider custom
hermes config set model.base_url https://your-domain.com/v1
hermes config set model.default sml/auto
echo 'OPENAI_API_KEY=sml_live_...' >> ~/.hermes/.env
```

ตัวอย่างเพิ่มเติม (vision, tools, streaming, 6 ภาษา) → `/guide`

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
                        ┌──────────┐          ┌───────────┐          ┌──────────────┐
                        │Postgres  │          │  Valkey   │          │ 14 providers │
                        │pgvector  │          │ (Redis)   │          │  upstream    │
                        │  :5434   │          │   :6382   │          │              │
                        └──────────┘          └───────────┘          └──────────────┘
```

### Containers
| Container | Image | Port |
|---|---|---|
| `sml-gateway-sml-gateway-1` | next.js app | 3000 (internal) |
| `sml-gateway-caddy-1` | caddy:2-alpine | 3334 → 80 |
| `sml-gateway-postgres-1` | pgvector/pgvector:pg17 | 5434 → 5432 |
| `sml-gateway-redis-1` | valkey/valkey:8-alpine | 6382 → 6379 |

Scale: `docker compose up -d --scale sml-gateway=N`

### DB highlights (29+ tables)
| Table | หน้าที่ |
|---|---|
| `models` | catalog sync จาก `free-model-catalog.ts` + capability flags |
| `teachers` | principal + heads + proctors (rebuild ทุก cycle) |
| `model_category_scores` | คะแนนต่อ 12 หมวด |
| `exam_attempts` / `exam_answers` | ผลสอบ + `exam_level` |
| `model_fail_streak` | exponential cooldown |
| `model_capacity` | EWMA token + latency tracking |
| `health_logs` | ping + cooldown_until |
| `provider_limits` | TPM/TPD/RPM parsed จาก response header |
| `gateway_api_keys` | `sml_live_*` per-client (SHA-256 hash) |
| `gateway_logs` | request log + routing_explain |
| `routing_stats` | p50/p99 latency per provider |
| `category_winners` | win/loss per (category, model) |
| `semantic_cache` | pgvector embeddings (HNSW) |

---

## Worker cycles (auto)

| Loop | Interval | งาน |
|---|---|---|
| main | 15 นาที | sync hardcoded catalog → DB + health + exam + teacher |
| exam | 5 นาที | สอบ model ที่รอในคิว |
| warmup | 2 นาที | ping model — keep socket warm |

Trigger manual: `POST /api/worker`

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
rtk npx next build                                                              # 0 errors
rtk docker compose up -d --build
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/      # 200
docker ps --format "{{.Names}} {{.Status}}" | grep sml-gateway                  # Up / healthy
```

Tests:
```bash
rtk node node_modules/vitest/vitest.mjs run    # 127 tests across 10 files
```

Load tests:
```bash
npm run loadtest:smoke
npm run loadtest:chat
npm run loadtest:stress
npm run loadtest:ratelimit
```

Reset DB:
```bash
docker compose down -v && docker compose up -d --build
```

---

## Deploy to Droplet

Droplet เป็น Docker host ล้วน — ไม่ใช่ git repo. Flow: copy ไฟล์ที่แก้ → run deploy script → verify

```bash
# 1. Stream changed files via tar (preserves permissions, atomic)
git archive HEAD -- <files...> | ssh root@<droplet> 'cd /opt/sml-gateway && tar -xf -'

# 2. Run deploy
ssh root@<droplet> 'cd /opt/sml-gateway && bash scripts/deploy-droplet.sh'

# Script: docker compose up -d --build → wait /api/health 30s → print state

# 3. Verify ผ่าน Cloudflare
curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/api/health
```

**Requirement:** `/opt/sml-gateway/.env.production` ต้องมีอยู่ (copy จาก `.env.production.example` ครั้งแรก)

**Memory caveat:** `next build` กิน RAM 1-2 GB. droplet 8 GB ที่รัน 10+ container อาจ OOM ต้องมี swap ≥4 GB:
```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Caddy config:** `caddy-prod.Caddyfile` bind mount เข้า in-compose caddy ที่ `/etc/caddy/Caddyfile`. แก้ → `docker compose restart caddy`

---

## Operations / Tuning

Runtime knobs (env) — ใส่ผิดก็ไม่ crash (clamped ที่ code)

| Env | Default | ผล |
|---|---|---|
| `PG_POOL_MAX` | 20 | Postgres connection per replica |
| `PG_IDLE_TIMEOUT_SEC` | 30 | ปิด idle connection |
| `CACHE_MAX_ENTRIES` | 2000 | LRU cap ของ in-memory cache |
| `WORKER_LEADER_FAIL_OPEN` | `0` prod / `1` dev | Redis ล่ม: `1` = single-replica run, `0` = wait |
| `WORKER_AUTOSTART` | `1` | `1` = boot triggers `ensureWorkerStarted()` |
| `WARMUP_MAX_MODELS` | 30 | จำนวน model ต่อ warmup cycle |
| `LOG_SAMPLE_RATE` | 1 | sampled log 1-in-N (`debug` ปิด sampling) |
| `RESPONSE_CACHE_ENABLED` | `1` | Redis response cache (skip ถ้ามี tools) |
| `SEMANTIC_CACHE_SHOW_PREVIEW` | `0` | `1` = แสดง 40-char preview ใน admin |
| `APP_ENCRYPTION_KEY` | _(unset)_ | AES-256-GCM encrypt-at-rest สำหรับ provider keys |
| `ADMIN_COOKIE_SECRET` | _(fallback to ADMIN_PASSWORD)_ | HMAC signing key ของ admin cookie |
| `TRUSTED_PROXY_HOPS` | 1 | reverse proxy hops ที่เชื่อ X-Forwarded-For |
| `BENCHMARK_CONCURRENCY` | 8 | parallel workers ใน benchmark cycle |
| `GATEWAY_REGRESSION_WEBHOOK` | _(unset)_ | Slack/Discord URL — POST เมื่อ regression detected |
| `SSRF_ALLOW_PRIVATE` | _(unset)_ | dev only — disable SSRF guard |

### Worker leader behavior ([leader.ts](src/lib/worker/leader.ts))
- Redis OK → `SET NX EX 14m` ป้องกัน multi-replica run cycle ซ้อน
- `renewLeader` / `releaseLeader` ใช้ Lua script fenced (atomic CAS)
- Background renewer ทุก 2 นาที — cycle > 14 นาทีไม่หลุด lock
- Redis ล่ม + prod + `WORKER_LEADER_FAIL_OPEN ≠ 1` → return `false`
- SIGTERM → `stopWorker()` → release lock + `sql.end()` ก่อน exit

### Migration safety ([migrate.ts](src/lib/db/migrate.ts))
ทุก table ใช้ `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`. ไม่มี `DROP TABLE` — restart container ไม่ทำลาย data

### Tenant isolation
- Response cache key `respcache:<tenant_ns>:<hash>` per Bearer
- Semantic cache composite unique `(tenant_ns, query_hash)`
- API keys encrypt-at-rest ผ่าน `APP_ENCRYPTION_KEY` (lazy migrate `enc:v1:*`)

### SSRF protection
`/api/admin/providers/*/test` ผ่าน [ssrf-guard.ts](src/lib/ssrf-guard.ts) — DNS resolve + block RFC1918 / loopback / link-local / cloud-metadata + port allowlist

### Constant-time compare
master Bearer ทุกจุดใช้ [secret-compare.ts](src/lib/secret-compare.ts) `timingSafeStringEqual()`

### Live ops dashboard
- 🛰️ **Control Room** (`/api/control-room`) — single-call snapshot
- 🤖 **Autopilot** (`/api/autopilot`) — rule-based recommendations
- 🧭 **Routing Explain** (`/api/routing-explain`) — decision trail per request
- 🔁 **Replay & Compare** (`/api/replay`) — owner-only re-run prompt
- 🧠 **Semantic Cache Analytics** (`/api/semantic-cache`) — hit rate, top entries

---

## Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `/v1/chat/completions` → 404 model | ใช้ `sml/auto` หรือเช็ค `GET /v1/models` |
| 503 ยาว | pool หมด — ดู dashboard "โควต้า Provider", รอ cooldown |
| p99 สูง | long context — filter ไป `context_length` สูง, ดู `/api/routing-stats` |
| `sml/auto` เลือกผิดหมวด | เช็ค `model_category_scores` + `teachers` |
| Worker ไม่รัน | `POST /api/worker`, ดู `worker_logs` + `worker_state` |
| Cerebras "Wrong API Key" | API key ผิด — เปลี่ยนใน `/setup` |
| Cohere ทุกตัวคืน 429 | trial 1K calls/month หมด — รอเดือนถัดไป |
| Provider ล่ม → ทุก fallback fail | เช็ค `/api/admin/circuits` — อาจ open ทั้ง pool |

Debug DB:
```bash
docker exec -it sml-gateway-postgres-1 psql -U sml -d smlgateway
# \dt
# SELECT * FROM teachers;
# SELECT * FROM model_fail_streak;
# SELECT * FROM gateway_logs ORDER BY created_at DESC LIMIT 10;
# SELECT model_id, status, cooldown_until FROM latest_model_health;
```

Logs:
```bash
docker compose logs -f sml-gateway
docker exec sml-gateway-postgres-1 psql -U sml -d smlgateway \
  -c "SELECT created_at, level, message FROM worker_logs WHERE level='warn' ORDER BY created_at DESC LIMIT 30"
```
