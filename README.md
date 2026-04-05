# BCProxyAI — Smart AI Gateway

Gateway อัจฉริยะที่รวม AI ฟรีจาก **8 ผู้ให้บริการ** กว่า **130+ โมเดล** ไว้ในที่เดียว
ใช้งานผ่าน **OpenAI-compatible API** — เปลี่ยน base URL แล้วใช้ได้เลย ไม่ต้องแก้โค้ด

---

## คำเตือนด้านความปลอดภัย

> **ระบบนี้ไม่มี Authentication**
> ห้ามเปิดให้เข้าถึงจาก Internet — ใช้บน Local หรือ Network ภายในเท่านั้น
> ใครก็ตามที่เข้าถึงพอร์ตได้ จะใช้ได้ทันที

---

## สารบัญ

- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [OpenAI API Compliance](#openai-api-compliance)
- [ผู้ให้บริการ AI ทั้ง 8 เจ้า](#ผู้ให้บริการ-ai-ทั้ง-8-เจ้า)
- [ติดตั้ง Docker Desktop](#ติดตั้ง-docker-desktop)
- [ติดตั้��� BCProxyAI](#ติดตั้ง-bcproxyai)
- [ตั้งค่า API Keys](#ตั้งค่า-api-keys)
- [เชื่อมต่อกับ OpenClaw](#เชื่อมต่อกับ-openclaw)
- [Virtual Models](#virtual-models)
- [ฟีเจอร์ทั้งหมด](#ฟีเจอร์ทั้งหมด)
- [API Endpoints](#api-endpoints)
- [Health Monitoring](#health-monitoring)
- [ระบบ Benchmark](#ระบบ-benchmark)
- [Worker อัตโนมัติ](#worker-อัตโนมัติ)
- [Dashboard](#dashboard)
- [Stress Test](#stress-test)
- [แก้ไขปัญหา](#แก้ไขปัญหา)
- [ค่าใช้จ่าย](#ค่าใช้จ่าย)

---

## ภาพรวมระบบ

```
Application (OpenClaw / HiClaw / Python / curl / ...)
        |
        v
+-------------------------------+
|     BCProxyAI Gateway         |  http://localhost:3333/v1
|                               |
|  OpenAI-compatible API        |  POST /v1/chat/completions
|  - auto/fast/tools/thai       |  GET  /v1/models
|  - consensus (3 models vote)  |  GET  /v1/models/{id}
|  - weighted load balancing    |
|  - fallback 10 retries        |
|  - prompt compression         |
|                               |
|  Background Worker (ทุก 1 ชม.) |
|  - สแกน 8 providers           |
|  - health check               |
|  - benchmark + ตั้งชื่อเล่น    |
|                               |
|  SQLite DB + Dashboard        |
+-------------------------------+
        |
        v
+----------+---------+---------+---------+-----------+-----------+---------+---------+
|OpenRouter| Kilo AI | Google  |  Groq   | Cerebras  | SambaNova | Mistral | Ollama  |
|  (ฟรี)   |  (ฟรี)  |AI Studio|  (ฟรี)  |   (ฟรี)   |   (ฟรี)   |  (ฟรี)  | (LOCAL) |
+----------+---------+---------+---------+-----------+-----------+---------+---------+
```

---

## OpenAI API Compliance

BCProxyAI เป็น **100% OpenAI-compatible API** — ใช้แทน OpenAI ได้เลย

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat Completions (stream + non-stream) |
| GET | `/v1/models` | List all models |
| GET | `/v1/models/{model_id}` | Retrieve a model |

### Response Format

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "groq/llama-4-scout",
  "system_fingerprint": "fp_bcproxy_a1b2c3d4",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "สวัสดีครับ!",
      "refusal": null
    },
    "finish_reason": "stop",
    "logprobs": null
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### Error Format

```json
{
  "error": {
    "message": "The model 'xxx' does not exist",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

| HTTP | type | code |
|------|------|------|
| 400 | `invalid_request_error` | `invalid_request` |
| 401 | `invalid_request_error` | `invalid_api_key` |
| 404 | `invalid_request_error` | `model_not_found` |
| 429 | `rate_limit_exceeded` | `rate_limit_exceeded` |
| 500 | `api_error` | `server_error` |
| 503 | `api_error` | `server_overloaded` |

### Model Object

```json
{
  "id": "groq/llama-4-scout",
  "object": "model",
  "created": 1700000000,
  "owned_by": "groq"
}
```

### ใช้งานกับ Library อะไรก็ได้

```python
# Python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3333/v1", api_key="dummy")
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "สวัสดีครับ"}]
)
```

```typescript
// TypeScript
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: 'http://localhost:3333/v1', apiKey: 'dummy' });
const response = await client.chat.completions.create({
    model: 'auto',
    messages: [{ role: 'user', content: 'สวัสดีครับ' }]
});
```

```bash
# curl
curl http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'
```

> `api_key` ใส่อะไรก็ได้ (ระบบไม่ตรวจ auth) แต่ต้องใส่เพราะ library บังคับ

---

## ผู้ให้บริการ AI ทั้ง 8 เจ้���

| # | Provider | ประเภท | จุดเด่น | API Key |
|---|----------|--------|---------|---------|
| 1 | **OpenRouter** | Cloud ฟรี | โมเดลฟรีมากที่สุด | สมัครฟรี |
| 2 | **Kilo AI** | Cloud ฟรี | ไม่ต้องใช้ key | ไม่���้อง |
| 3 | **Google AI Studio** | Cloud ฟรี | Gemini models | สมัครฟรี |
| 4 | **Groq** | Cloud ฟรี | เร็วที่สุด | สมัครฟรี |
| 5 | **Cerebras** | Cloud ฟรี | เร็ว | สมัครฟรี |
| 6 | **SambaNova** | Cloud ฟรี | Llama 405B | สมัครฟรี |
| 7 | **Mistral** | Cloud ฟรี | 1B tokens/เดือน | สมัครฟรี |
| 8 | **Ollama** | LOCAL | รันบนเครื่องตัวเอง | ไม่ต้อง |

> **Ollama** รันบนเครื่องคุณเอง ไม่ส่งข้อมูลออกนอก
> BCProxyAI ลงทะเบียน Ollama model ด้วย 128K context, ส่ง `num_ctx=65536`
> Ollama จะ **ไม่ถูก cooldown** เด็ดขาด (เครื่องตัวเอง ไม่มี rate limit)

---

## ติดตั้ง Docker Desktop

> **Docker คืออะไร?** โปรแกรมที่รันแอปใน "กล่อง" (Container) แยกจากเครื่องจริง

### ขั้นตอนที่ 1: ดาวน์โหลด

1. ไปที่ **https://www.docker.com/products/docker-desktop/**
2. กด **"Download for Windows"** (หรือ Mac)
3. รอดาวน์โหลดเสร็จ (~500MB)

### ขั้นตอนที่ 2: ติดตั้ง

1. ดับเบิลคลิกไฟล์ Docker Desktop Installer.exe
2. ติ๊กเลือก "Use WSL 2 instead of Hyper-V"
3. กด Ok แล้วรอ (2-5 นาที)
4. กด Close and restart

### ขั้นตอนที่ 3: เปิดครั้งแรก

1. เปิด **Docker Desktop** จาก Start Menu
2. รอจนเห็น **"Docker Desktop is running"** (ไอคอนวาฬสีเขียว)
3. Accept license, Skip sign in

> Docker Desktop ต้องเปิดค้างไว้ตลอดเวลาที่ใช้ BCProxyAI

---

## ติดตั้ง BCProxyAI

### ขั้นตอนที่ 1: Clone

```bash
git clone https://github.com/jaturapornchai/bcproxyai.git
cd bcproxyai
```

### ขั้นตอนที่ 2: สร้าง .env.local

```bash
cp .env.example .env.local
```

เปิด `.env.local` แล้วใส่ API Key:

```env
# จำเป็น
OPENROUTER_API_KEY=sk-or-v1-xxxx
GROQ_API_KEY=gsk_xxxx

# ไม่บังคับ
KILO_API_KEY=
GOOGLE_AI_API_KEY=
CEREBRAS_API_KEY=
SAMBANOVA_API_KEY=
MISTRAL_API_KEY=
DEEPSEEK_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
```

### ขั้นตอนที่ 3: Build + Start

```bash
docker compose build    # ��ร้าง image (ครั้งแรก 3-10 นาที)
docker compose up -d    # เริ่มรัน
```

### ขั้นตอนท���่ 4: เปิด Dashboard

เปิด **http://localhost:3333** — Worker จะเริ่มสแกนโมเดลอัตโนมัติ

### ติดตั้งแบบไม่ใช้ Docker

```bash
npm ci && npm run build && npm start    # เปิดที่ http://localhost:3000
```

---

## ตั้งค่า API Keys

| Provider | ลิงก์สมัคร | หมายเหตุ |
|----------|-----------|----------|
| **OpenRouter** | https://openrouter.ai/keys | **จำเป็น** |
| **Groq** | https://console.groq.com/keys | **จำเป็น** |
| **Kilo AI** | https://kilo.ai | ไม่บังคับ |
| **Google AI Studio** | https://aistudio.google.com/apikey | ไม่บังคับ |
| **Cerebras** | https://cloud.cerebras.ai | ไม่บังคับ |
| **SambaNova** | https://cloud.sambanova.ai | ไม่บังคับ |
| **Mistral** | https://console.mistral.ai | ไม่บังคับ |
| **Ollama** | https://ollama.com | ไม่บังคับ |

### Auto API Key Rotation

ใส่ key หลายตัวคั่นด้วย comma:

```env
OPENROUTER_API_KEY=key1,key2,key3
GROQ_API_KEY=keyA,keyB
```

ระบบสลับ round-robin อัตโนมัติ — key ติด rate limit จะพัก 5 นาทีแล้วใช้ตัวถัดไป

---

## เชื่อมต่อกับ OpenClaw

### Docker (OpenClaw + BCProxyAI อยู่บน Docker)

```bash
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://host.docker.internal:3333/v1 \
  --custom-model-id auto \
  --custom-api-key dummy \
  --custom-compatibility openai \
  --skip-channels --skip-daemon --skip-health --skip-search --skip-skills --skip-ui
```

> ใช้ `host.docker.internal` เพราะ Container เรียก `localhost` หากันไม่ได้

ถ้าเจอ "pairing required":

```bash
openclaw devices list                    # ดู requestId
openclaw devices approve <requestId>     # อนุมัติ
```

ถ้าเจอ "origin not allowed" — แก้ `openclaw.json`:

```json
{ "gateway": { "bind": "lan" } }
```

### CLI Native (ไม่ใช้ Docker)

```bash
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://localhost:3333/v1 \
  --custom-model-id auto \
  --custom-api-key dummy \
  --custom-compatibility openai \
  --skip-channels --skip-daemon --skip-health --skip-search --skip-skills --skip-ui
```

### Checklist

- [ ] Docker Desktop เปิดอยู่
- [ ] BCProxyAI รันอยู่ (`docker compose up -d`)
- [ ] http://localhost:3333 เปิดได้
- [ ] Worker สแกนเสร็จ มีโมเดลพร้อมใช้
- [ ] `openclaw onboard` สำเร็จ
- [ ] ทดสอบ: `curl http://localhost:3333/v1/models`

---

## Virtual Models

| Model ID | พฤติกรรม |
|----------|---------|
| `auto` / `bcproxy/auto` | คะแนน benchmark สูงสุด |
| `bcproxy/fast` | latency ต่ำสุด |
| `bcproxy/tools` | รองรับ tool calling |
| `bcproxy/thai` | เก่งภาษาไทย |
| `bcproxy/consensus` | ส่ง 3 models ให้ vote เลือกคำตอบดีสุด |

### Direct Provider Routing

```
groq/llama-3.3-70b-versatile
openrouter/qwen/qwen3-coder:free
cerebras/qwen-3-235b-a22b-instruct-2507
sambanova/DeepSeek-R1
mistral/mistral-large-latest
ollama/gemma3:4b
ollama/gemma4:31b
```

### Auto-Detection

- มี `tools` → เลือกเฉพาะโมเดลที่รองรับ tool calling
- มี `image_url` → เลือกเฉพาะโมเดลที่รองรับ vision
- มี `response_format: json_schema` → เลือกโมเดลขนาดใหญ่

---

## ฟีเจอร์ทั้งหมด

### Weighted Load Balancing

- เรียง provider ตาม weight: **คะแนนสูง + latency ต่ำ = ได้ก่อน**
- Round-robin ข้าม provider (ไม่กระจุก)
- Fallback สูงสุด **10 ครั้ง**
- ทุกตัว cooldown → **สุ่มจากทั้งหมด** (ไม่มีวัน 503 ถาวร)
- Model สำเร็จ → **clear cooldown ทันที**

### Smart Cooldown

| Error | Cooldown | เหตุผล |
|-------|----------|--------|
| 413 | 15 นาที | request ใหญ่เกินไป |
| 429 | 30 นาที | rate limit |
| 422 | 30 นาที | ข้อมูลผิดรูปแบบ |
| 5xx | 1 ชม. | provider มีปัญหา |
| 401/403 | 24 ชม. | key หมดอายุ/ผิด |
| Ollama | ไม่ cooldown | เครื่องตัวเอง |

### Multi-Model Consensus

```bash
curl http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"bcproxy/consensus","messages":[{"role":"user","content":"อะไรดี?"}]}'
```

- ส่งไป 3 models จาก 3 providers พร้อมกัน
- เลือกคำตอบยาวที่สุด + เร็วที่สุด
- Header `X-BCProxy-Consensus` แสดงผู้เข้าแข่ง

### Prompt Compression

- ข้อความยาวเกิน 30K tokens ถูกบีบอัดอัตโนมัติ
- ประหยัด token 20-40% โดยไม่เสียเนื้อหา

### Token Budget

```bash
curl -X POST http://localhost:3333/api/budget \
  -H "Content-Type: application/json" \
  -d '{"dailyLimit": 1000000}'
```

- ใช้ 80% → สลับ model ประหยัด
- ใช้ 95% → หยุดรับ request ชั่วคราว

### Cost Calculator

```bash
curl http://localhost:3333/api/cost-savings
```

| บริการ | Input | Output |
|--------|-------|--------|
| GPT-4o | $2.50/M | $10.00/M |
| Claude Sonnet 4.6 | $3.00/M | $15.00/M |
| Gemini 2.5 Pro | $1.25/M | $10.00/M |
| Qwen Plus | $0.40/M | $1.20/M |
| DeepSeek V3 | $0.28/M | $0.42/M |
| **BCProxyAI** | **ฟรี** | **ฟรี** |

### Auto-Fixes

- **Tool Call Parameter**: string numbers → actual numbers (`"5"` → `5`)
- **Reasoning-to-Content**: Ollama gemma4 ใส่คำตอบใน reasoning field → ย้ายเป็น content อัตโนมัติ
- **OpenAI Response Fields**: เติม `id`, `system_fingerprint`, `usage.total_tokens`, `logprobs`, `refusal` ให้ครบ

### Charts & Analytics

Dashboard แสดงกราฟ 4 ประเภท:
- สถิติรายผู้ให้บริการ
- ปริมาณ request รายชั่วโมง
- Top 10 models
- Token usage รายวัน

---

## API Endpoints

### Gateway (OpenAI-compatible)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat (stream + non-stream) |
| GET | `/v1/models` | List all models |
| GET | `/v1/models/{model_id}` | Get single model |

**Response Headers:**

| Header | Description |
|--------|-------------|
| `X-BCProxy-Model` | โมเดลที่ถูกเลือกใช้จริง |
| `X-BCProxy-Provider` | ผู้ให้บริการ |
| `X-BCProxy-Consensus` | ผู้เข้าแข่ง consensus (เฉพาะ consensus mode) |

### Dashboard API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Worker status + สถิติ |
| GET | `/api/models` | โมเดลทั้งหมด + health + benchmark |
| GET | `/api/leaderboard` | อันดับโมเดล |
| GET/POST | `/api/worker` | สถานะ / สั่ง worker รัน |
| POST | `/api/chat` | Chat สำหรับ Dashboard |
| GET | `/api/gateway-logs` | Gateway logs (pagination) |
| GET/POST | `/api/budget` | Token budget |
| GET | `/api/cost-savings` | คำนวณเงินประหยัด |
| GET | `/api/health` | Health check |
| GET | `/api/analytics` | Charts data |

---

## Health Monitoring

```bash
curl http://localhost:3333/api/health
```

```json
{
  "status": "healthy",
  "checks": {
    "database": { "ok": true, "latencyMs": 0 },
    "providers": { "total": 132, "available": 66, "percentAvailable": 50 },
    "worker": { "status": "idle", "minutesSinceLastRun": 15 },
    "gateway": { "recentSuccessRate": 95, "avgLatencyMs": 2800 }
  },
  "alerts": []
}
```

| สถานะ | เงื่อนไข |
|-------|---------|
| **healthy** | providers > 20%, worker ภายใน 2 ชม., success rate > 50% |
| **degraded** | บางเงื่อนไขไม่ผ่าน |
| **down** | providers 0% หรือ DB ไม่ตอบ |

---

## ระบบ Benchmark

ระบบ "AI ตรวจข้อสอบ AI" — 3 คำถามภาษาไทย, คะแนน 0-10

### ข้อสอบ

| ข้อ | คำถาม |
|-----|-------|
| 1 | "สวัสดีครับ วันนี้อากาศเป็นยังไงบ้าง?" |
| 2 | "แนะนำอาหารไทยมา 3 เมนู" |
| 3 | "กรุงเทพมหานครอยู่ประเทศอะไร?" |

### AI Judge

| ลำดับ | โมเดล | หมายเหตุ |
|-------|-------|---------|
| 1 | **DeepSeek Chat** | หลัก (ถูก เสถียร) |
| 2 | Qwen3 235B | สำรอง (OpenRouter free) |
| 3 | Llama 4 Scout | สำรอง |
| 4 | Gemma 3 27B | สำรอง |

### ชื่อเล่น (Nickname)

DeepSeek ตั้งชื่อเล่นภาษาไทยตามคะแนน + ความประพฤติ:

| คะแนน | พฤติกรรม | ตัวอย่างชื่อ |
|-------|---------|------------|
| 90%+ | ขยัน เก่ง เด่นมาก | `ลามะน้อยขยัน` |
| 70%+ | ตั้งใจเรียน | `น้องเก่งตั้งใจ` |
| 50%+ | ขี้เกียจนิดหน่อย | `ลูกอ่อนขี้เกียจ` |
| <30% | ไม่ตั้งใจเรียนเลย | `เด็กดื้อไม่เรียน` |

### กฎ

- สอบผ่าน = คะแนนเฉล���่ย >= 5/10
- สอบตก (< 3/10) จะไม่สอบซ้ำภายใน 7 วัน
- 20 concurrent, 10 models/รอบ

---

## Worker อัตโนมัติ

ทำงานทุก **1 ชั่วโมง** — 4 ขั้นตอน:

| ขั้นตอน | ทำอะไร |
|---------|--------|
| 1. Scan | สแกน 8 providers พร้อมกัน, บันทึกโมเดลใหม่, ตั้งชื่อเล่น 10 ตัว/รอบ |
| 2. Health Check | Ping 5 concurrent, Ollama timeout 120s, Cloud 15s, ทดสอบ tool+vision |
| 3. Benchmark | สอบ 3 คำถาม, 20 concurrent, 10 models/รอบ, ตั้งชื่อตามคะแนน |
| 4. Cleanup | ลบ log เก่าเกิน 30 วัน |

---

## Dashboard

เปิด **http://localhost:3333**

| ส่วน | คำอธิบาย |
|------|---------|
| Worker Status | สถานะ + นับถอยหลัง |
| Judge Info | DeepSeek Chat เป็นคุณครูตรวจ |
| Cost Comparison | เปรียบเทียบ 5 paid providers (USD + THB) |
| Stats Cards | 4 animated counters |
| Speed Race | Animation แข่งความเร็วระหว่าง providers + podium |
| ห้องเรียน AI | Grid ทุกโมเดล: เกรด A+-F, ชื่อเล่น, ความเร็ว |
| Charts & Analytics | กราฟ 4 ประเภท |
| ทดลองแชท | Chat panel เลือกโมเดลได้ |
| Gateway Log LIVE | LIVE log ทุก request (refresh 2 วินาที) |
| คู่มือ | Modal 5 แท็บ |

---

## Stress Test

| สถานการณ์ | Concurrent | Requests | Success Rate | Throughput |
|-----------|-----------|----------|-------------|------------|
| ใช้งานปกติ | 5 | 200 | **97%** | 2.9 req/s |
| ทีมขนาดกลาง | 10 | 1,000 | **97%** | 3.4 req/s |
| โหลดหนัก | 1,000 | 10,000 | 18-30% | 73-125 req/s |

> Bottleneck คือ rate limit ของ provider ฟรี ไม่ใช่ BCProxyAI
> ทีม 5-20 คน ใช้สบาย 97%+

```bash
node stress-test.js    # แก้ TOTAL_REQUESTS / CONCURRENCY ในไฟล์ได้
```

---

## แก้ไขปัญหา

### Docker Desktop ไม่เริ่ม
- ตรวจ Virtualization ใน BIOS
- Restart เครื่อง

### Worker ไม่ทำงาน
```bash
docker logs bcproxyai-bcproxyai-1    # ดู error
curl -X POST http://localhost:3333/api/worker    # สั่งรันทันที
```

### ไม่มีโมเดลพร้อมใช้
- ใส่ API Key ใน `.env.local` แล้วหรือยัง?
- รอ worker scan + health check เสร็จ

### Gateway ตอบ error
```bash
curl http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"test"}]}'
```
- ดู header `X-BCProxy-Model` ว่าเลือกโมเดลอะไร
- ทุกตัว cooldown → ระบบจะสุ่มเลือกแทน (ไม่ 503 ถาวร)

### OpenClaw เชื่อมไม่ได้
- ดูหัวข้อ [เชื่อมต่อกับ OpenClaw](#เชื่อมต่อกับ-openclaw)
- Docker: ใช้ `host.docker.internal:3333` + approve pairing + bind `"lan"`
- ทดสอบ: `curl http://localhost:3333/v1/models`

### Ollama เชื่อมไม่ได้
- Ollama รันอยู่? `ollama list`
- Pull model แล้ว? `ollama pull gemma3:4b`
- Docker: ใช้ `OLLAMA_BASE_URL=http://host.docker.internal:11434`

### Reset ข้อมูลทั้งหมด

```bash
docker compose down
docker volume rm bcproxyai_bcproxyai-data
docker compose up -d
```

---

## ค่าใช้จ่าย

### ฟรี 100%

| รายการ | ค่าใช้จ่าย |
|--------|-----------|
| 8 AI Providers (cloud + local) | ฟรี (free tier) |
| Docker Desktop + SQLite | ฟรี |

### DeepSeek (ถ้าใส่ key)

| รายการ | ค่าใช้จ่าย |
|--------|-----------|
| ตรวจข���อสอบ + ตั้งชื่อ | ~$0.05-0.26/วัน (~2-9 บาท) |

> ไม่อยากเสียเงิน? ลบ `DEEPSEEK_API_KEY` → ใช้ OpenRouter ฟรีตรวจแทน, ไม่ตั้งชื่อเล่น

---

## สร้างด้วย

| เครื่องมือ | หน้าที่ |
|-----------|--------|
| **Claude Code (Opus 4.6)** | เขียนโค้ด + ออกแบบระบบ |
| **Next.js 16 + TypeScript** | Web framework |
| **SQLite (better-sqlite3)** | Database |
| **Tailwind CSS** | UI styling |
| **Docker** | Multi-stage build (289MB) |
| **Vitest** | Unit testing |

---

**BCProxyAI** — Smart AI Gateway
**8 Providers** | **130+ Free Models** | **OpenAI-compatible API** | **Local LLM** | **Auto-Fallback** | **Consensus** | **Thai Benchmark** | **Fun Nicknames**
