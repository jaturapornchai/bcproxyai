# BCAiRouter

**เกตเวย์ AI ส่วนตัวแบบ OpenAI-compatible ที่ใช้เฉพาะโมเดลฟรี จากหลาย provider**
เลือกโมเดลให้อัตโนมัติตามประเภทงาน, สลับเส้นทางสำรองเมื่อ provider ล่ม และเรียนรู้จากผลการใช้งานจริง

**Production:** https://bcairouter.bcaicloud.com

| ส่วน | ใครใช้ได้ |
|---|---|
| `/` ศูนย์ควบคุม 3D | **ทุกคนดูได้** (ดูอย่างเดียว ข้อมูลแบบไม่ระบุตัวตน) |
| `/v1/*` API | client ที่ถือ key `bcai_live_*` (ออกที่ `/admin/keys`) |
| หน้าอื่นและ `/api/*` ทั้งหมด | **เจ้าของระบบเท่านั้น** — login ด้วย Google (`AUTH_OWNER_EMAIL`) |

ใช้ได้กับทุก client ที่รองรับ OpenAI SDK — Next.js, Python, LangChain, OpenClaw, Hermes Agent, thClaws, Cline, curl ฯลฯ

---

## หน้าแรก `/` — ศูนย์ควบคุม 3D (สาธารณะ)

กาแล็กซีทางช้างเผือกแบบ WebGL เต็มจอ: **ดาว = provider**, **ดาวหาง = คำขอจริง** และกล้องเคลื่อนตามกิจกรรม

- **ศูนย์ควบคุม** (ค่าเริ่มต้น) — แถบตัวชี้วัด (คำขอวันนี้, อัตราสำเร็จ 1 ชม., เวลาตอบ p50/p95, โมเดลออนไลน์, ค่าใช้จ่าย $0.00) วางระหว่างหน้าต่างสองคอลัมน์ หน้าต่างลากได้ ย่อได้ และจำตำแหน่งไว้ในเบราว์เซอร์ มี dock กลางล่างสำหรับเปิด/ปิด
- **ชม** — แถบบนกับ ticker คำขอล่าสุด (กดสลับได้ ระบบจำโหมดที่เลือก)
- **มือถือ / แท็บเล็ตแนวตั้ง / จอเตี้ย** — ใช้ bottom sheet: แถวตัวชี้วัด + แท็บหน้าต่าง
- **ไม่มี WebGL** — แสดงฉาก CSS แทน พร้อมป้าย "โหมดประหยัด" และซ่อนปุ่มกล้อง; ถ้า WebGL context หลุด ระบบลองสร้างใหม่ 1 ครั้งก่อน
- คีย์ลัด: `H` ซ่อน/แสดง UI · `F` เต็มจอ · `Esc` กลับมุมกว้าง

| หน้าต่าง | ผู้ชม | เจ้าของ |
|---|:-:|:-:|
| กิจกรรมสด · สนามสอบ & รอบตรวจ · สุขภาพผู้ให้บริการ · 24 ชั่วโมงล่าสุด · ปริมาณงาน & ความหน่วง | ✓ | ✓ |
| การตัดสินใจของ Router · ป้องกันค่าใช้จ่าย (ปิดไว้ เปิดจาก dock) | ✓ (สรุป) | ✓ (เต็ม) |
| ห้องเครื่อง · โควตา & การพักโมเดล · ถามเลย · เชื่อมต่อ · โมเดลยอดนิยม | — | ✓ |

**สิ่งที่ผู้ชมไม่มีทางเห็น** (ตัดที่ฝั่ง server): ชื่อ provider/model, prompt/คำตอบ, ข้อความ error, request id, IP, key, เหตุผลการ routing, จำนวนต่อ provider ที่ระบุตัวได้ และอีเมลเจ้าของ — ผู้ชมเห็นดาวเป็น `ดาว sXXXXXX` (id แบบ HMAC เปลี่ยนทุกวัน UTC), โทเคนวันนี้ปัดลงทีละ 100K และ JS bundle ของ `/` ไม่มีชื่อ provider

ข้อมูลมาจาก pulse ทุก 4 วินาที และ insights ทุก 30 วินาที (หยุดเมื่อแท็บถูกซ่อน) — อ่านจาก DB/Redis อย่างเดียว ไม่เรียก provider ไม่เรียก `/api/worker` และไม่เพิ่มแถวใน `gateway_logs`

---

## Provider ที่รองรับ — 11 providers / 88 models

ทุก model อยู่ใน [src/lib/free-model-catalog.ts](src/lib/free-model-catalog.ts) (hardcoded) — นอก catalog ระบบไม่เรียก

| Provider | Models | Provider | Models |
|---|--:|---|--:|
| OpenRouter (`:free`) | 33 | Cohere (trial) | 6 |
| SambaNova | 12 | ThaiLLM (NECTEC) | 4 |
| Mistral | 8 | Cerebras | 4 |
| NVIDIA NIM | 7 | SEA-LION (AI Singapore) | 3 |
| Groq | 6 | Ollama Cloud | 3 |
| | | Typhoon (SCB 10X) | 2 |

**ไม่รองรับ:** Google AI Studio (Gemini API key ตรง), Together AI, Hugging Face, GitHub Models (โมเดลของ Google ที่เสิร์ฟผ่าน OpenRouter เช่น `google/gemma-*:free` ใช้ได้)

Model ที่จะเลิกให้บริการใส่ `deprecatedAfter: 'YYYY-MM-DD'` — ถูกกรองออกอัตโนมัติเมื่อถึงวัน และเตือนล่วงหน้า 7 วัน

---

## กันเสียเงิน (no-spend)

- **Catalog-only** — `isModelCostAllowed()` ตรวจทุก upstream call กับ catalog; env allowlist ใดๆ ถูกละเว้น
- **OpenRouter `max_price = 0`** — `applyNoSpendGuards()` ล็อก `provider.max_price` เป็น 0 ทุกคำขอ (OpenRouter ปฏิเสธเองถ้ามีราคา)
- **ตัดของที่คิดเงิน** — ลบ body key ที่พาไป model/feature เสียเงิน (`models`, `route`, `preset`, `provider`, `plugins`, `web_search*`, `search`), เหลือเฉพาะ tool แบบ `function` และ content แบบ `text`/`image_url` (ตัด server tools และไฟล์/PDF)
- **สวิตช์ provider บังคับจริง** — provider ที่ปิดใน `/setup` ไม่ได้รับ key จึงไม่มีทางถูกเรียก
- **เฝ้า key OpenRouter + tripwire** — worker เรียก `GET https://openrouter.ai/api/v1/key` ทุก 10 นาที (cache 5 นาที): เตือนเมื่อ key ไม่มี credit limit, บัญชีไม่ใช่ free tier หรือโควตาฟรีรายวันใช้ ≥ 80%; จำ `usage` ครั้งแรกเป็น baseline ถ้า `usage` เพิ่มเมื่อไร ระบบปิด OpenRouter ทันที เปิดคืนเองที่ `/setup` (= ตั้ง baseline ใหม่) · สถานะดูได้ที่ `/setup`, `/overview` และ `GET /api/openrouter-status`

ตั้งค่าฝั่งบัญชี provider ให้เก็บเงินไม่ได้ด้วย (สมัครด้วยอีเมลที่ไม่ผูกบัตร):

| Provider | กันเสียเงิน |
|---|---|
| OpenRouter | เครดิต $0 + ปิด auto top-up หรือตั้ง credit limit ของ key = $0 |
| Groq / SambaNova | ไม่ใส่ payment method |
| Mistral | แผน Experiment (ฟรี) ปิด pay-as-you-go |
| Cohere | ใช้ Trial key เท่านั้น |
| Cerebras / Ollama Cloud | ไม่ซื้อเครดิต |
| NVIDIA / Typhoon / ThaiLLM / SEA-LION | ไม่มีระบบเก็บเงิน |

---

## ใช้งาน `/v1` (OpenAI-compatible)

เจ้าของออก key `bcai_live_*` ที่ `/admin/keys` (เก็บเป็น hash) แล้วส่งเป็น Bearer:

```bash
curl https://bcairouter.bcaicloud.com/v1/chat/completions \
  -H "Authorization: Bearer bcai_live_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"bcai/auto","messages":[{"role":"user","content":"สวัสดี"}]}'
```

```python
from openai import OpenAI
client = OpenAI(base_url="https://bcairouter.bcaicloud.com/v1", api_key="bcai_live_...")
client.chat.completions.create(model="bcai/thai", messages=[{"role": "user", "content": "สวัสดี"}])
```

| Model | เลือกยังไง |
|---|---|
| `bcai/auto` | ตามประเภทงาน (thai / code / tools / vision / math / json …) กระจายหลาย provider ก่อน fallback |
| `bcai/fast` | latency ต่ำสุด |
| `bcai/tools` | รองรับ tool calling + ตรวจ JSON ของ `tool_calls` |
| `bcai/thai` | โมเดลไทยก่อน (ThaiLLM / Typhoon / SEA-LION) |
| `bcai/consensus` | ยิงหลายโมเดลพร้อมกันแล้วเลือกคำตอบที่ตรงกันมากสุด |
| `<provider>/<model_id>` | ระบุตรง เช่น `groq/llama-3.3-70b-versatile` |

Endpoint: `chat/completions`, `completions`, `models` (+ `models/search`, `models/:id`), `embeddings`, `structured`, `compare`, `audio/speech`, `audio/transcriptions` · เฉพาะเจ้าของ: `trace/:reqId`, จัดการ `prompts` — รายละเอียด request/response, headers และตัวอย่างโค้ดอยู่ที่ [docs/API-GUIDE.md](docs/API-GUIDE.md) และหน้า `/guide`

เส้นทางการเลือกโมเดล: response cache → semantic cache → ตรวจประเภทงาน → ตัดโมเดลที่พัก/หมดอายุ → เรียงตาม latency จริง (EWMA) → กระจาย provider → hedge/speculative race → circuit breaker + RPM throttle ต่อโมเดล → ตรวจ/ซ่อม tool-call JSON

Worker (รอบหลักทุก 15 นาที) sync catalog → ตรวจสุขภาพ → สอบโมเดลตามระดับที่ตั้ง (ประถม 40% · มัธยมต้น 50% · มัธยมปลาย 60% · มหาลัย 70%) → เลือกครูประจำหมวด; ตั้งระดับที่ `/api/exam-config`

---

## API สาธารณะ vs เจ้าของ

| Endpoint | ผู้ชม | เจ้าของ |
|---|---|---|
| `GET /api/health` | `{status}` อย่างเดียว (503 เฉพาะตอน DB ต่อไม่ได้) | รายงานเต็ม (DB, Redis, โมเดลพร้อมเสิร์ฟ, alerts) |
| `GET /api/public/pulse` | กิจกรรมสดแบบไม่ระบุตัวตน | — |
| `GET /api/public/insights` | สรุป 24 ชม., p95, ผลสอบแบบตำแหน่ง, รอบตรวจ, จำนวนโมเดลพัก/ใหม่ | — |
| `GET /api/activity` | 401 | กิจกรรมสดฉบับเต็ม (ชื่อ provider/model, routing) |
| `GET /api/insights` | 401 | insights ฉบับเต็ม + เหตุขัดข้อง, error ล่าสุด, โควตา, การพักโมเดล, perf, ระบบ |
| `GET /api/openrouter-status` | 401 | สถานะ key OpenRouter + tripwire |

`/api/*` อื่นทั้งหมดเฉพาะเจ้าของ (ไม่ใช่ → 401 JSON) · หน้าอื่น → redirect ไป `/login` · หลัง login เจ้าของกลับมาที่ `/`

---

## การยืนยันตัวตน ([src/proxy.ts](src/proxy.ts) — default-deny)

- **Server mode** — เปิดเมื่อตั้ง auth env อย่างน้อย 1 ตัว: public เฉพาะ `/`, `/login`, `/api/auth/*`, `/api/public/*`, `/api/health`; `/v1/*` ต้องมี key `bcai_live_*`; `/v1/trace/*`, `/v1/prompts*` และที่เหลือเฉพาะเจ้าของ
- **Production** — เจ้าของ login ด้วย Google เท่านั้น: ไม่มี password login และไม่มี master key
- **Local open mode** — ไม่ตั้ง auth env เลย = ไม่มี login ทุกหน้าและ API เปิด (ถือเป็นเจ้าของ) ใช้บนเครื่องตัวเองเท่านั้น

---

## Environment variables

ไฟล์ตัวอย่าง: [.env.example](.env.example) (local → `.env.local` + `.env` สำหรับ compose) และ [.env.production.example](.env.production.example) (server → `.env.production`) — ห้าม commit ไฟล์จริง

| Env | ความหมาย |
|---|---|
| `AUTH_OWNER_EMAIL` | อีเมล Google ของเจ้าของ (หลายคนคั่นด้วย `,`) — ตั้งแล้วเปิด server mode |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client ของ Google (redirect URI: `{NEXTAUTH_URL}/api/auth/callback/google`) |
| `NEXTAUTH_URL` | URL ของ deployment (prod ตั้งใน `docker-compose.prod.yml`) |
| `NEXTAUTH_SECRET` (หรือ `AUTH_SECRET`) | ใช้ sign session และเป็น key ของ id ดาวสาธารณะ |
| `APP_ENCRYPTION_KEY` | (ไม่บังคับ) เข้ารหัส provider key ใน DB (AES-256-GCM) — ตั้งแล้วห้ามเปลี่ยน |
| `GATEWAY_API_KEY` | master Bearer key (สิทธิ์เจ้าของ) — ไม่ใช้บน production |
| `ADMIN_PASSWORD` / `ADMIN_COOKIE_SECRET` | password login (แสดงเฉพาะเมื่อไม่ได้ตั้ง Google) + key sign cookie — ไม่ใช้บน production |
| `POSTGRES_PASSWORD` + `DATABASE_URL` | รหัส Postgres ของ compose และ connection string — docker compose อ่านจาก `.env` (local) หรือ `--env-file .env.production` (prod) ไม่มีค่าฝังในไฟล์ compose; รัน `next dev`/`next start` นอก compose ตั้ง `DATABASE_URL` ใน `.env.local` |
| `REDIS_URL` | Valkey — compose ตั้งให้แล้ว |
| `WORKER_AUTOSTART` | `0` = ไม่เริ่ม worker ตอนบูต (ค่าเริ่มต้นเริ่ม) |

Provider API key **ไม่อยู่ใน env** — กรอกที่ `/setup` แล้วเก็บใน DB · ตัวปรับจูนอื่น (`PG_POOL_MAX`, `CACHE_MAX_ENTRIES`, `RESPONSE_CACHE_ENABLED`, `SEMANTIC_CACHE_ENABLED`, `TRUSTED_PROXY_HOPS`, `GATEWAY_REGRESSION_WEBHOOK`, `LOG_LEVEL` ฯลฯ) มีค่าเริ่มต้นในโค้ดแล้ว

---

## Local dev

```bash
cp .env.example .env.local        # เว้น auth env ว่าง = open mode
docker compose up -d --build
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3334/   # 200
```

เปิด `http://localhost:3334/` (ศูนย์ควบคุม), `/setup` (ใส่ provider key), `/overview` (dashboard), `/guide` (คู่มือเชื่อมต่อ)

ตรวจก่อนส่งงาน (ต้องผ่านทั้งหมด):
```bash
npx tsc --noEmit
npx eslint src --quiet
npx vitest run
npx next build
docker compose up -d --build && docker ps --format "{{.Names}} {{.Status}}" | grep bcai-router   # Up
```

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · three.js · Postgres (pgvector) · Valkey · Docker Compose + Caddy

---

## Deploy (droplet)

Production อยู่ที่ `/opt/bcai-router` บน droplet (ไม่ใช่ git checkout): host Caddy → `127.0.0.1:8335` → Caddy ใน compose → app

```bash
# 1. ส่งไฟล์ (tar ไม่ลบไฟล์ที่ถูกลบในเครื่อง — ลบบน server เอง)
tar czf - --exclude=./node_modules --exclude=./.next --exclude=./.git --exclude='./.env*' . \
  | ssh root@<droplet> 'cd /opt/bcai-router && tar xzf -'

# 2. build + start + รอ /api/health
ssh root@<droplet> 'cd /opt/bcai-router && bash scripts/deploy-droplet.sh'

# 3. ตรวจ
curl -s -o /dev/null -w "%{http_code}\n" https://bcairouter.bcaicloud.com/api/health   # 200
```

`scripts/deploy-droplet.sh` ไม่ยอม deploy ถ้าไม่มี `.env.production`, ยังมี placeholder `<...>` จากไฟล์ตัวอย่าง หรือไม่ได้ตั้ง auth env สักตัว (gateway เปิดโล่ง) จากนั้นรัน `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` และรอ `/api/health` = 200 ภายใน 30 วินาที

Scale: `docker compose up -d --scale bcai-router=N` (Caddy ใน compose กระจายโหลด)

---

## Ports

| Port | Service |
|---|---|
| 3333 | BCAiRouter ผ่าน Caddy ภายนอก (timeout 300s) |
| 3334 | BCAiRouter ผ่าน Caddy ใน compose (load balanced) — container app เปิดแค่ 3000 ภายใน |
| 5434 | Postgres (service ใน compose) |
| 6382 | Redis/Valkey (service ใน compose) |
| 18790 | OpenClaw ผ่าน Caddy (timeout 600s) |
| 18791 | OpenClaw ตรง (Docker) |
| 8335 | (prod) Caddy ใน compose บน `127.0.0.1` ให้ host Caddy ต่อเข้า |

แก้ Caddyfile ภายนอกแล้วรัน `powershell -File "C:/Users/jatur/restart-caddy.ps1"`

---

## Troubleshooting

| อาการ | วิธีแก้ |
|---|---|
| `/v1/*` → 401 | ใช้ key `bcai_live_*` ที่ยังไม่ถูก revoke |
| 404 model | ใช้ `bcai/auto` หรือดู `GET /v1/models` |
| 503 จาก `/v1` | ทุกโมเดลพัก/ติด rate limit — ดูหน้าต่าง "โควตา & การพักโมเดล" ที่ `/` |
| OpenRouter ถูกปิดเอง | tripwire ทำงาน — ตรวจบัญชี OpenRouter แล้วเปิดคืนที่ `/setup` |
| หน้า `/` ไม่มีกาแล็กซี | เบราว์เซอร์ไม่รองรับ WebGL2 — ระบบใช้โหมดประหยัด (หน้าต่างยังทำงานครบ) |
| Worker ไม่รัน | ดู `worker_logs` / `worker_state` ใน Postgres |

```bash
docker compose logs -f bcai-router
docker exec -it bcai-router-postgres-1 psql -U bcai -d bcairouter
```
