# SMLGateway — OpenAI-Compatible API Guide

> Drop-in replacement สำหรับ OpenAI API — ใช้กับ app ใดก็ได้ที่รองรับ OpenAI format
> รวมโมเดลฟรีจาก 21 providers, smart routing, per-category teacher, hedge top-3, auto-retry, fallback

## Base URL

```
http://localhost:3334/v1      # in-compose Caddy (recommended)
http://localhost:3333/v1      # external Caddy (if configured, 300s timeout)
```

ตั้ง `OPENAI_API_BASE` หรือ `base_url` ใน client เป็น URL นี้

## Authentication

```
Authorization: Bearer <any-string>
```

SMLGateway ไม่ตรวจ API key ของ client — ใส่อะไรก็ได้ (หรือไม่ใส่ก็ได้)
Key ของ provider แต่ละตัวตั้งใน environment (`.env.local`) หรือ dashboard (`/` → ผู้ให้บริการ)

**Local-only** — ออกแบบรันบน Docker Desktop เครื่องเดียว ไม่มี multi-tenant / public deploy

---

## Endpoints

### 1. Chat Completions

```
POST /v1/chat/completions
```

**นี่คือ endpoint หลัก** — รองรับ text, vision, tools, streaming ทุกอย่าง

#### Request Body

```jsonc
{
  "model": "sml/auto",                // virtual model หรือ "provider/model_id"
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "สวัสดี" }
  ],
  "stream": true,                     // แนะนำ true เสมอ
  "max_tokens": 4096,                 // หรือ max_completion_tokens (แปลงอัตโนมัติ)
  "temperature": 0.7,                 // optional
  "tools": [...],                     // optional — function calling
  "tool_choice": "auto",              // optional
  "response_format": { "type": "json_schema", "json_schema": {...} },  // optional
  "prompt": "my-saved-prompt-name",   // optional — lookup จาก /v1/prompts
  "extra": {                          // optional dev controls (หรือใช้ headers)
    "prefer": ["groq", "cerebras"],
    "exclude": ["mistral"],
    "max_latency_ms": 3000,
    "strategy": "fastest"             // "fastest" | "strongest"
  }
}
```

#### Model Names

| Model | พฤติกรรม |
|-------|---------|
| `sml/auto` (แนะนำ) | Smart routing — เลือก model ตาม category (thai/code/tools/vision/...) |
| `sml/fast` | เลือก model latency ต่ำสุด |
| `sml/tools` | เลือก model ที่รองรับ function calling |
| `sml/thai` | เลือก model ครูหัวหน้าหมวด thai |
| `sml/consensus` | ยิง 3 model ขนานกัน → เลือกคำตอบที่ตรงกันมากสุด |
| `provider/model_id` | ระบุตรง เช่น `groq/moonshotai/kimi-k2-instruct-0905` |
| `auto` | alias ของ `sml/auto` (backward-compat) |

#### Vision (ส่งรูป)

ส่ง image เป็น `image_url` ใน content array:

```jsonc
{
  "model": "auto",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "รูปนี้คืออะไร?" },
        { "type": "image_url", "image_url": { "url": "https://example.com/photo.jpg" } }
        // หรือ base64: "data:image/jpeg;base64,/9j/4AAQ..."
      ]
    }
  ],
  "stream": true
}
```

- Proxy จะเลือกเฉพาะ model ที่รองรับ vision อัตโนมัติ
- Ollama: image URL จะถูกแปลงเป็น base64 ให้อัตโนมัติ
- **ถ้าส่งรูป + tools พร้อมกัน** → tools จะถูก strip ออก (provider ส่วนใหญ่ไม่รองรับ)

#### Function Calling (Tools)

```jsonc
{
  "model": "auto",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" }
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "stream": true
}
```

**Response ที่มี tool_calls:**
```jsonc
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        {
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"location\": \"Bangkok\"}"
          }
        }
      ]
    }
  }]
}
```

**ส่ง tool result กลับ:**
```jsonc
{
  "messages": [
    // ... ข้อความก่อนหน้า ...
    { "role": "assistant", "content": null, "tool_calls": [{"id": "call_abc123", ...}] },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"temp\": 35, \"condition\": \"sunny\"}"
    }
  ]
}
```

> **หมายเหตุ:** `tool_call_id` format ไม่จำกัด — proxy จะแปลง ID ให้เข้ากับ provider อัตโนมัติ (เช่น Mistral ต้องการ 9 chars)

#### Streaming Response (SSE)

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"สวัสดี"},"index":0}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop","index":0}]}

data: [DONE]
```

#### Non-Streaming Response

```jsonc
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1712345678,
  "model": "mistral/mistral-large-latest",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "สวัสดีครับ!"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15
  }
}
```

---

### 2. Models

```
GET /v1/models
```

รายชื่อ model ทั้งหมด — format เดียวกับ OpenAI

```
GET /v1/models/{model_id}
```

ดูข้อมูล model เฉพาะตัว

---

### 3. Embeddings

```
POST /v1/embeddings
```

```jsonc
{
  "input": "Hello world",          // string หรือ array of strings
  "model": "auto",                 // optional — auto เลือก provider ที่มี
  "encoding_format": "float"       // optional
}
```

Response:
```jsonc
{
  "object": "list",
  "data": [
    { "object": "embedding", "index": 0, "embedding": [0.123, -0.456, ...] }
  ],
  "model": "mistral/mistral-embed",
  "usage": { "prompt_tokens": 2, "total_tokens": 2 }
}
```

---

### 4. Image Generation

```
POST /v1/images/generations
```

```jsonc
{
  "prompt": "A cat wearing a hat",
  "model": "flux",                 // optional, default "flux"
  "n": 1,                          // optional, max 4
  "size": "1024x1024",            // optional
  "response_format": "url"        // "url" หรือ "b64_json"
}
```

Provider: Pollinations.ai (ฟรี ไม่ต้อง key)

---

### 5. Audio — Speech (TTS)

```
POST /v1/audio/speech
```

```jsonc
{
  "input": "สวัสดีครับ ยินดีต้อนรับ",
  "model": "playai/PlayDialog",    // optional
  "voice": "austin",              // austin, daniel, troy, diana, hannah, autumn
  "response_format": "wav"        // wav, mp3, opus, flac
}
```

Returns: binary audio file

---

### 6. Audio — Transcription

```
POST /v1/audio/transcriptions
```

Multipart form data:
- `file` — audio file
- `model` — optional, default `whisper-large-v3-turbo`

Returns: `{ "text": "ข้อความที่ถอดเสียงได้" }`

---

### 7. Audio — Translation

```
POST /v1/audio/translations
```

เหมือน transcriptions แต่แปลเป็นภาษาอังกฤษ

---

### 8. Models Search

```
GET /v1/models/search?category=thai&min_context=200000&supports_tools=1&top=5
```

Filter + rank models ตาม capability. Query params:
- `category` — thai, code, tools, vision, math, reasoning, json, instruction, extraction, classification, comprehension, safety
- `min_context` / `max_context` — integer
- `supports_tools` / `supports_vision` / `supports_reasoning` / `supports_json` — 0 | 1
- `provider` — groq, nvidia, cerebras, ...
- `tier` — small, medium, large, xlarge
- `exclude_cooldown` — 1 (default) | 0
- `top` — 1-200 (default 20)

Response เรียงตาม category score → context → avg latency

### 9. Compare

```
POST /v1/compare
```

ยิง prompt เดียวกันไปหลาย model พร้อมกัน (สูงสุด 10 ตัว) แล้วคืน side-by-side

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "models": ["groq/kimi-k2", "cerebras/qwen-3-235b", "nvidia/llama-4-maverick"],
  "max_tokens": 200,
  "timeout_ms": 30000
}
```

### 10. Structured Output

```
POST /v1/structured
```

Chat + JSON schema validation + auto-retry (default 2 ครั้ง) ถ้า output ไม่ตรง schema

```json
{
  "model": "sml/auto",
  "messages": [{"role": "user", "content": "Describe a fruit"}],
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
}
```

Response: `{ ok, attempts, data, model, provider, latency_ms, request_ids }`

### 11. Trace

```
GET /v1/trace/:reqId
```

ดู log ละเอียดของ request เดิม (ใช้ `X-SMLGateway-Request-Id` header ที่ได้จาก response).
Response รวม `routing_explain` JSONB ที่บันทึก decision trail (mode, candidates, selected, fallbackUsed) — no prompt content.

### 12. My Stats

```
GET /api/my-stats?window=24h
```

สรุปการใช้งานของ IP ตัวเอง — total, p50/p95/p99, top models, by hour
Windows: `1h`, `6h`, `24h`, `7d`, `30d`

### 13. Prompt Library

```
GET    /v1/prompts              รายการทั้งหมด
POST   /v1/prompts              สร้าง { name, content, description? }
GET    /v1/prompts/:name        ดึงเฉพาะตัว
PUT    /v1/prompts/:name        แก้ไข
DELETE /v1/prompts/:name        ลบ
```

ใช้ใน chat:
```json
{ "model": "sml/auto", "prompt": "pirate", "messages": [{"role":"user","content":"how?"}] }
```
→ ระบบจะ prepend system prompt `pirate` ที่บันทึกไว้ให้อัตโนมัติ

### 14. Dev Controls (X-SMLGateway-* headers)

```
X-SMLGateway-Prefer:      groq,cerebras       ดัน provider ขึ้นบน
X-SMLGateway-Exclude:     mistral              ตัดออก
X-SMLGateway-Max-Latency: 3000                 กรอง model ที่ช้าเกิน
X-SMLGateway-Strategy:    fastest | strongest  preset sort
```

Response headers:
```
X-SMLGateway-Request-Id   ใช้กับ /v1/trace/:reqId
X-SMLGateway-Provider     provider ที่ตอบจริง
X-SMLGateway-Model        model ที่ตอบจริง
X-SMLGateway-Hedge        true ถ้าชนะจาก hedge
X-SMLGateway-Cache        HIT ถ้าดึงจาก semantic cache
X-Resceo-Backoff          true ถ้ายิงถี่เกิน soft limit (ไม่บล็อก, hint เท่านั้น)
```

### 15. Ops endpoints (owner/master only — auth chain เดียวกับ /api/admin/*)

```
GET  /api/control-room?windowMin=60      single-call dashboard snapshot
GET  /api/routing-explain?limit=30       recent routing decisions trail
                          ?fallback=1    เฉพาะ request ที่เข้า fallback path
                          ?error=1       เฉพาะ status >= 400
GET  /api/autopilot                       rule-based ops recommendation cards
POST /api/replay                          owner-only request replay
                                          body: { reqId, candidates: [{provider, model}], confirm? }
```

**Replay guard:** prompt ที่มีคำอย่าง `password`, `api_key`, `secret`, `token`, `bearer`, `credit-card`, `ssn` จะถูก block — ส่ง `confirm: true` ใน body เพื่อ override (เฉพาะตอน debug จำเป็น).

**Routing explain shape** (`gateway_logs.routing_explain` JSONB):
```json
{
  "mode": "auto",
  "category": "thai",
  "fallbackUsed": false,
  "candidates": [
    { "provider": "groq", "model": "llama-3.1-8b", "accepted": true,  "reason": "selected:fastest" },
    { "provider": "cerebras", "model": "llama-3.1-8b", "accepted": false, "reason": "rejected:other" }
  ],
  "selected": { "provider": "groq", "model": "llama-3.1-8b", "reason": "selected:fastest" }
}
```

---

## Smart Routing — วิธีที่ Proxy เลือก Model

```
Request เข้ามา
  ↓
ตรวจ capabilities (tools? images? json_schema?)
  ↓
Query models จาก DB → filter ตาม capability
  ↓
เรียงลำดับ:
  1. supports_tools (ถ้า request มี tools)
  2. context_length (ใหญ่กว่าดีกว่า)
  3. benchmark score (ถ้ามี)
  4. latency (เร็วกว่าดีกว่า)
  ↓
Spread across providers (กระจายโหลด)
  ↓
ส่งไป provider → ถ้า fail → retry ตัวถัดไป (max 10 ครั้ง)
```

### Auto-Retry & Fallback

| HTTP Status | พฤติกรรม |
|-------------|---------|
| 200 | สำเร็จ — return response |
| 400, 422 | Request format ผิด — cooldown model นั้น 1 นาที, retry ตัวถัดไป |
| 413 | Request ใหญ่เกินไป — retry model ที่ context ใหญ่กว่า |
| 429 | Rate limited — cooldown API key 5 นาที, retry provider อื่น |
| 500+ | Server error — cooldown model 5 นาที, retry ตัวถัดไป |
| Timeout | 15 วินาที cloud, 60 วินาที Ollama — retry ตัวถัดไป |

Total timeout: **30 วินาที** สำหรับ retry loop ทั้งหมด

### Content Quality Check

Proxy ตรวจ response ก่อน return:
- ตรวจจับ `<tool_call>` XML leak → retry model อื่น
- Strip `<think>` tags จาก reasoning models
- Response สั้นเกินไป (< 3 chars) → retry

---

## การ Normalize ที่ Proxy ทำให้อัตโนมัติ

App ไม่ต้องกังวลเรื่องพวกนี้ — proxy จัดการให้:

| สิ่งที่ Client ส่ง | Proxy ทำอะไร |
|-------------------|-------------|
| `max_completion_tokens` | แปลงเป็น `max_tokens` |
| `store: true` | Strip ออก (OpenAI-only) |
| `stream_options` | Strip ออก |
| `reasoning` ใน messages | Strip ออก (Mistral/Groq ไม่รองรับ) |
| `reasoning_content` ใน messages | Strip ออก |
| `tool_call_id` format ยาว | แปลงเป็น 9 chars สำหรับ Mistral |
| Image URL + Ollama | แปลง URL → base64 ให้ |
| Tools + Images พร้อมกัน | Strip tools ออก (incompatible) |
| Tools + model ไม่รองรับ | Strip tools + orphaned messages ออก |
| Messages ยาวมาก (>30K tokens) | Compress อัตโนมัติ |

---

## ตัวอย่าง Client Code

### Python (openai SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3334/v1",
    api_key="any-string"
)

# Text
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "สวัสดี"}],
    stream=True
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")

# Vision
response = client.chat.completions.create(
    model="auto",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "อธิบายรูปนี้"},
            {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}
        ]
    }]
)

# Tools
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "อากาศวันนี้เป็นยังไง"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"]
            }
        }
    }]
)

# Embeddings
response = client.embeddings.create(
    model="auto",
    input="Hello world"
)

# TTS
response = client.audio.speech.create(
    model="playai/PlayDialog",
    input="สวัสดีครับ",
    voice="austin"
)

# Image Generation
response = client.images.generate(
    prompt="A cat in Bangkok",
    model="flux",
    n=1
)
```

### curl

```bash
# Chat
curl http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "สวัสดี"}],
    "stream": false
  }'

# Streaming
curl http://localhost:3334/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "สวัสดี"}],
    "stream": true
  }'

# Models list
curl http://localhost:3334/v1/models
```

### TypeScript/JavaScript

```typescript
const response = await fetch("http://localhost:3334/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "auto",
    messages: [{ role: "user", content: "สวัสดี" }],
    stream: true
  })
});

// Read SSE stream
const reader = response.body!.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  // parse "data: {...}\n\n" lines
}
```

---

## Providers (13 ตัว)

| Provider | ประเภท | ต้องการ Key |
|----------|--------|------------|
| openrouter | Cloud (aggregator) | `OPENROUTER_API_KEY` |
| mistral | Cloud | `MISTRAL_API_KEY` |
| groq | Cloud (fast inference) | `GROQ_API_KEY` |
| cerebras | Cloud (fast inference) | `CEREBRAS_API_KEY` |
| sambanova | Cloud (fast inference) | `SAMBANOVA_API_KEY` |
| google | Cloud (Gemini) | `GOOGLE_AI_API_KEY` |
| github | Cloud (GitHub Models) | `GITHUB_MODELS_TOKEN` |
| fireworks | Cloud | `FIREWORKS_API_KEY` |
| cohere | Cloud | `COHERE_API_KEY` |
| cloudflare | Cloud (Workers AI) | `CLOUDFLARE_API_TOKEN` |
| huggingface | Cloud | `HF_TOKEN` |
| kilo | Cloud | `KILO_API_KEY` |
| ollama | Local | ไม่ต้อง (default: `http://host.docker.internal:11434`) |

---

## Error Responses

ทุก error เป็น OpenAI format:

```jsonc
{
  "error": {
    "message": "All models failed after 10 retries",
    "type": "server_error",
    "code": "service_unavailable"
  }
}
```

| Status | ความหมาย |
|--------|---------|
| 400 | Request format ผิด |
| 402 | Budget limit (ถ้าตั้ง daily limit) |
| 404 | Model ไม่เจอ |
| 503 | ทุก model fail — retry หมดแล้ว |

---

## Quick Start

1. ตั้ง `base_url` เป็น `http://localhost:3334/v1`
2. ตั้ง `api_key` เป็นอะไรก็ได้
3. ใช้ `model: "auto"` (หรือไม่ส่งก็ได้)
4. ส่ง request ตาม OpenAI format ปกติ — proxy จัดการ routing, retry, normalization ให้ทั้งหมด
