# BCProxyAI -- Smart AI Gateway

ระบบ Gateway อัจฉริยะ สำหรับเลือกโมเดล AI ฟรีที่ดีที่สุดให้อัตโนมัติ  
รองรับ **8 ผู้ให้บริการ** กว่า **130+ โมเดล** ทั้งคลาวด์และ Local LLM  
ออกแบบมาสำหรับใช้งานร่วมกับ **[OpenClaw](https://github.com/openclaw/openclaw)** และ **HiClaw**

---

## คำเตือนด้านความปลอดภัย

> **ระบบนี้ไม่มีการยืนยันตัวตน (API Key) ในการเรียกใช้ Gateway**  
> ห้ามเปิดให้เข้าถึงจากภายนอก (Internet) โดยเด็ดขาด  
>  
> **แนะนำให้ติดตั้งบน Local (เครื่องตัวเอง) หรือ Network ภายในองค์กรเท่านั้น**  
> หากต้องการเปิดให้ภายนอกใช้งาน ให้นำ Code ไปแก้ไขเพิ่มระบบ Authentication ก่อน  
>  
> ไม่มี API Key -- ใครก็ตามที่เข้าถึงพอร์ตได้ จะใช้ได้ทันที

---

## สารบัญ

- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [ผู้ให้บริการ AI ทั้ง 8 เจ้า](#ผู้ให้บริการ-ai-ทั้ง-8-เจ้า)
- [ติดตั้ง Docker Desktop (สำหรับมือใหม่)](#ติดตั้ง-docker-desktop-สำหรับมือใหม่)
- [ติดตั้ง BCProxyAI บน Docker](#ติดตั้ง-bcproxyai-บน-docker)
- [ตั้งค่า API Keys](#ตั้งค่า-api-keys)
- [เชื่อมต่อกับ OpenClaw (ละเอียดมาก)](#เชื่อมต่อกับ-openclaw-ละเอียดมาก)
- [Virtual Models (โมเดลพิเศษ)](#virtual-models-โมเดลพิเศษ)
- [ฟีเจอร์เด่น](#ฟีเจอร์เด่น)
- [API Endpoints](#api-endpoints)
- [Monitoring & Health Check](#monitoring--health-check)
- [ระบบ Benchmark (คุณครูออกข้อสอบ)](#ระบบ-benchmark-คุณครูออกข้อสอบ)
- [Worker อัตโนมัติ](#worker-อัตโนมัติ)
- [Dashboard](#dashboard)
- [ขีดจำกัดของระบบ (Stress Test)](#ขีดจำกัดของระบบ-stress-test)
- [การแก้ไขปัญหาทั่วไป](#การแก้ไขปัญหาทั่วไป)
- [ค่าใช้จ่ายในการรัน](#ค่าใช้จ่ายในการรัน)
- [สร้างด้วยอะไร](#สร้างด้วยอะไร)

---

## ภาพรวมระบบ

BCProxyAI ทำหน้าที่เป็น "ตัวกลาง" ระหว่าง OpenClaw กับผู้ให้บริการ AI ฟรีหลายเจ้า  
คิดง่ายๆ ว่า: **OpenClaw ส่งคำถามมา -> BCProxyAI เลือกโมเดล AI ฟรีตัวที่ดีที่สุดให้ -> ส่งคำตอบกลับ**

```
OpenClaw / HiClaw
        |
        v
+-------------------------------+
|     BCProxyAI Gateway         |  <- http://localhost:3333/v1
|  (ตัวกลางเลือก AI ให้)        |
|                               |
|  Smart Router                 |  <- เลือก model อัตโนมัติ
|  - auto/fast/tools/thai       |     หรือเจาะจง provider ตรงๆ
|  - Weighted load balancing    |     (เรียงตาม score + latency)
|  - Fallback 10 ครั้ง          |     round-robin ข้าม provider
|  - ทุกตัว cooldown → สุ่มเลือก |     (ไม่มีวัน 503 ถาวร)
|  - Configurable fallback      |     FALLBACK_STRATEGY=latency|random|score...
|                               |
|  Background Worker            |  <- ทำงานทุก 1 ชม.
|  1. สแกน 8 providers พร้อมกัน  |
|  2. Health check 5 concurrent |
|  3. Benchmark 20 concurrent   |
|  4. ตั้งชื่อเล่นไทย (DeepSeek) |
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

## ผู้ให้บริการ AI ทั้ง 8 เจ้า

| # | ผู้ให้บริการ | ประเภท | จุดเด่น | ต้องใช้ API Key? |
|---|-------------|--------|---------|-----------------|
| 1 | **OpenRouter** | Cloud ฟรี | โมเดลฟรีมากที่สุด | ต้องสมัคร (ฟรี) |
| 2 | **Kilo AI** | Cloud ฟรี | ไม่ต้องใช้ key เลย | ไม่ต้อง |
| 3 | **Google AI Studio** | Cloud ฟรี | Gemini models | ต้องสมัคร (ฟรี) |
| 4 | **Groq** | Cloud ฟรี | เร็วที่สุด | ต้องสมัคร (ฟรี) |
| 5 | **Cerebras** | Cloud ฟรี | เร็ว | ต้องสมัคร (ฟรี) |
| 6 | **SambaNova** | Cloud ฟรี | Llama 405B | ต้องสมัคร (ฟรี) |
| 7 | **Mistral** | Cloud ฟรี | 1B tokens/เดือน | ต้องสมัคร (ฟรี) |
| 8 | **Ollama** | LOCAL LLM | รันบนเครื่องตัวเอง (gemma3:4b, gemma4:31b ฯลฯ) | ไม่ต้อง |

> **Ollama** เป็น Local LLM ที่รันบนเครื่องของคุณเอง ไม่ต้องส่งข้อมูลออกนอก  
> BCProxyAI จะลงทะเบียน Ollama model ด้วย 128K context, ส่ง `num_ctx=65536` สำหรับ context ขนาดใหญ่  
> Ollama จะ **ไม่ถูก cooldown** เด็ดขาด (เพราะเป็นเครื่องตัวเอง ไม่มี rate limit)

---

## ติดตั้ง Docker Desktop (สำหรับมือใหม่)

> **Docker คืออะไร?** Docker เป็นโปรแกรมที่ช่วยรันแอปพลิเคชันใน "กล่อง" (Container) แยกส่วนจากเครื่องของคุณ คิดง่ายๆ ว่าเป็น "คอมจำลอง" ที่รันโปรแกรมให้เราโดยไม่ต้องติดตั้งอะไรเพิ่มบนเครื่องจริง

### ขั้นตอนที่ 1: ดาวน์โหลด Docker Desktop

1. เปิดเบราว์เซอร์ ไปที่ **https://www.docker.com/products/docker-desktop/**
2. กดปุ่ม **"Download for Windows"** (หรือ Mac ถ้าใช้ Mac)
3. รอดาวน์โหลดเสร็จ (ไฟล์ประมาณ 500MB)

### ขั้นตอนที่ 2: ติดตั้ง Docker Desktop

1. **ดับเบิลคลิก**ไฟล์ที่ดาวน์โหลดมา (Docker Desktop Installer.exe)
2. ถ้าถูกถาม "Use WSL 2 instead of Hyper-V" ให้ **ติ๊กเลือก** (WSL2 เร็วกว่า)
3. กด **Ok** แล้วรอติดตั้ง (ประมาณ 2-5 นาที)
4. กด **Close and restart** เพื่อ restart เครื่อง

### ขั้นตอนที่ 3: เปิด Docker Desktop ครั้งแรก

1. หลัง restart กดเปิดโปรแกรม **Docker Desktop** จาก Start Menu
2. รอจนเห็นข้อความ **"Docker Desktop is running"** ที่มุมล่างซ้าย (ไอคอนวาฬสีเขียว)
3. ถ้าเจอหน้า "Accept license" ให้กด **Accept**
4. ถ้าเจอหน้า "Sign in" สามารถกด **Skip** ได้ (ไม่ต้อง sign in)

### รู้จักหน้าตา Docker Desktop

| แท็บ | คืออะไร |
|------|--------|
| **Containers** | กล่องที่กำลังรัน (หลังติดตั้ง BCProxyAI จะเห็นที่นี่) |
| **Images** | ไฟล์ต้นแบบของกล่อง (คิดเหมือน "แม่พิมพ์") |
| **Volumes** | ที่เก็บข้อมูลของกล่อง (database อยู่ที่นี่) |

> **สำคัญ:** Docker Desktop ต้องเปิดค้างไว้ตลอดเวลาที่จะใช้ BCProxyAI ถ้าปิด Docker = BCProxyAI จะหยุดทำงาน

---

## ติดตั้ง BCProxyAI บน Docker

> **Terminal คืออะไร?** หน้าต่างสำหรับพิมพ์คำสั่ง บน Windows เปิดได้โดยกด `Win + R` พิมพ์ `cmd` แล้วกด Enter หรือค้นหา "Terminal" หรือ "PowerShell" จาก Start Menu

### ขั้นตอนที่ 1: Clone โปรเจค

เปิด Terminal (หน้าต่างพิมพ์คำสั่ง) แล้วพิมพ์:

```bash
git clone https://github.com/jaturapornchai/bcproxyai.git
cd bcproxyai
```

> **ผลลัพธ์ที่ควรเห็น:**
> ```
> Cloning into 'bcproxyai'...
> remote: Enumerating objects: ...
> Receiving objects: 100% ...
> ```

### ขั้นตอนที่ 2: สร้างไฟล์ .env.local

```bash
cp .env.example .env.local
```

จากนั้นเปิดไฟล์ `.env.local` ด้วย text editor (เช่น Notepad) แล้วใส่ API Key:

```env
# จำเป็น -- สมัครฟรีที่ https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-xxxx

# จำเป็น -- สมัครฟรีที่ https://console.groq.com/keys
GROQ_API_KEY=gsk_xxxx

# ไม่บังคับ -- ถ้าไม่ใส่ จะข้ามการสแกน
KILO_API_KEY=
GOOGLE_AI_API_KEY=
CEREBRAS_API_KEY=
SAMBANOVA_API_KEY=
MISTRAL_API_KEY=

# ไม่บังคับ -- สำหรับ DeepSeek Judge (ตรวจข้อสอบ benchmark)
DEEPSEEK_API_KEY=

# ไม่บังคับ -- Ollama (ถ้ารันบนเครื่อง)
OLLAMA_BASE_URL=http://localhost:11434

# === Fallback Strategy (เลือก model ยังไงเมื่อ model แรก fail) ===
# Options: latency (default), random, score, least-used, round-robin, provider-balanced
# - latency: เร็วสุดก่อน
# - random: สุ่มทั้งหมด
# - score: คะแนน benchmark สูงสุด
# - least-used: ใช้น้อยสุดใน 24 ชม.
# - round-robin: กระจายเท่าๆ กัน
# - provider-balanced: กระจายข้าม provider
FALLBACK_STRATEGY=latency
```

(ดูวิธีสมัครที่หัวข้อ [ตั้งค่า API Keys](#ตั้งค่า-api-keys))

### ขั้นตอนที่ 3: Build (สร้างกล่อง)

พิมพ์คำสั่งนี้ใน Terminal:

```bash
docker compose build
```

> **รอจนเสร็จ** (ครั้งแรกใช้เวลาประมาณ 3-10 นาที ขึ้นอยู่กับความเร็วเน็ต)  
> **ผลลัพธ์ที่ควรเห็น:**
> ```
> [+] Building ...
> => [internal] load build definition ...
> ...
> => exporting to image
> ```

> **ถ้าเจอ error:** ตรวจสอบว่า Docker Desktop เปิดอยู่ (ไอคอนวาฬสีเขียว)

### ขั้นตอนที่ 4: Start (เริ่มรัน)

```bash
docker compose up -d
```

> `-d` หมายถึง "รันเบื้องหลัง" (detached) -- Terminal จะกลับมาให้พิมพ์คำสั่งอื่นได้  
> **ผลลัพธ์ที่ควรเห็น:**
> ```
> [+] Running 1/1
>  ✓ Container bcproxyai-bcproxyai-1  Started
> ```

### ขั้นตอนที่ 5: เปิด Dashboard ดู

1. เปิดเบราว์เซอร์
2. พิมพ์ **http://localhost:3333** แล้วกด Enter
3. จะเห็น Dashboard ของ BCProxyAI

> Worker จะเริ่มสแกนโมเดลอัตโนมัติทันที รอสักครู่จะเห็นโมเดลเริ่มปรากฏ  
> หรือกดปุ่ม **"รันตอนนี้"** บน Dashboard เพื่อเร่ง

### ติดตั้งแบบ Manual (ไม่ใช้ Docker)

ถ้าไม่อยากใช้ Docker ต้องมี **Node.js 20+** ติดตั้งบนเครื่อง:

```bash
npm ci              # ติดตั้ง dependencies
npm run build       # Build โปรเจค
npm start           # เริ่มรัน
```

เข้าใช้งานที่ **http://localhost:3000** (พอร์ต 3000 ไม่ใช่ 3333)

---

## ตั้งค่า API Keys

API Key คือ "กุญแจ" สำหรับเข้าถึงบริการ AI ของแต่ละเจ้า สมัครฟรีทั้งหมด:

| ผู้ให้บริการ | ลิงก์สมัคร | หมายเหตุ |
|-------------|-----------|----------|
| **OpenRouter** | https://openrouter.ai/keys | **จำเป็น** -- สมัครฟรี มีโมเดลฟรีมากที่สุด |
| **Groq** | https://console.groq.com/keys | **จำเป็น** -- สมัครฟรี เร็วมาก |
| **Kilo AI** | https://kilo.ai | ไม่บังคับ -- ไม่ต้องใช้ key ก็สแกนได้ |
| **Google AI Studio** | https://aistudio.google.com/apikey | ไม่บังคับ -- สมัครฟรี |
| **Cerebras** | https://cloud.cerebras.ai | ไม่บังคับ -- สมัครฟรี |
| **SambaNova** | https://cloud.sambanova.ai | ไม่บังคับ -- สมัครฟรี Llama 405B |
| **Mistral** | https://console.mistral.ai | ไม่บังคับ -- สมัครฟรี 1B tokens/เดือน |
| **Ollama** | https://ollama.com | ไม่บังคับ -- ติดตั้งบนเครื่อง ไม่ต้อง key |

### วิธีสมัคร (ตัวอย่าง OpenRouter)

1. เปิด https://openrouter.ai/keys
2. กด "Create Account" หรือ Sign in ด้วย Google
3. กด "Create Key"
4. **Copy key** (ขึ้นต้นด้วย `sk-or-v1-`)
5. วางใน `.env.local` ที่บรรทัด `OPENROUTER_API_KEY=`

### Auto API Key Rotation (หลาย key ต่อ provider)

รองรับ API Key หลายตัวต่อ provider -- ใส่คั่นด้วยจุลภาค (comma):

```env
OPENROUTER_API_KEY=key1,key2,key3
GROQ_API_KEY=keyA,keyB
```

- ระบบสลับ key แบบ round-robin อัตโนมัติ
- ถ้า key ไหนติด rate limit จะพัก 5 นาที แล้วใช้ key ถัดไป
- เพิ่ม throughput ได้หลายเท่า!

---

## เชื่อมต่อกับ OpenClaw (ละเอียดมาก)

> **OpenClaw คืออะไร?** OpenClaw เป็น AI coding assistant ที่ทำงานใน Terminal ช่วยเขียนโค้ดให้ BCProxyAI ทำให้ OpenClaw ใช้โมเดล AI ฟรีได้โดยไม่ต้องจ่ายเงิน

### วิธีที่ 1: OpenClaw บน Docker (BCProxyAI รันบน Docker ด้วย)

> **ทำไมต้อง host.docker.internal?**  
> เมื่อ OpenClaw กับ BCProxyAI รันบน Docker คนละ Container จะเรียก `localhost` หากันไม่ได้ ต้องใช้ `host.docker.internal` เพื่อให้ Container เข้าถึง host machine (เครื่องจริงของคุณ)

#### ขั้นตอนที่ 1: onboard OpenClaw ให้ชี้มา BCProxyAI

เปิด Terminal (หน้าต่างพิมพ์คำสั่ง) แล้วพิมพ์คำสั่งนี้ทั้งหมด (copy ทั้งบล็อก):

```bash
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://host.docker.internal:3333/v1 \
  --custom-model-id auto \
  --custom-api-key dummy \
  --custom-compatibility openai \
  --skip-channels \
  --skip-daemon \
  --skip-health \
  --skip-search \
  --skip-skills \
  --skip-ui
```

> **ผลลัพธ์ที่ควรเห็น:**
> ```
> Onboarding complete!
> Provider: custom-host-docker-internal-3333/auto
> ```

> **อธิบายคำสั่ง:**
> - `--custom-base-url` = บอกว่า BCProxyAI อยู่ที่ไหน
> - `--custom-api-key dummy` = ใส่อะไรก็ได้ เพราะ BCProxyAI ไม่มี authentication
> - `--custom-model-id auto` = ให้ BCProxyAI เลือกโมเดลให้อัตโนมัติ
> - `--skip-*` = ข้ามขั้นตอนที่ไม่จำเป็นตอน onboard

#### ขั้นตอนที่ 2: แก้ไข openclaw.json

หลัง onboard เสร็จ OpenClaw จะสร้าง config ให้อัตโนมัติ ตรวจสอบว่าถูกต้อง:

1. หาไฟล์ `openclaw.json` (ปกติอยู่ใน `~/.openclaw/openclaw.json`)
2. ดูส่วน `models.providers` จะเห็น provider ที่เพิ่งสร้าง:

```json
{
  "models": {
    "providers": {
      "custom-host-docker-internal-3333": {
        "baseUrl": "http://host.docker.internal:3333/v1",
        "apiKey": "dummy",
        "api": "openai-completions",
        "models": [{
          "id": "auto",
          "name": "BCProxyAI Auto",
          "contextWindow": 131072,
          "maxTokens": 8192
        }]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "custom-host-docker-internal-3333/auto" }
    }
  }
}
```

> **ตรวจสอบให้แน่ใจว่า:**
> - `api` เป็น `"openai-completions"` (onboard ตั้งให้อัตโนมัติ)
> - `contextWindow` เป็น `131072` (128K) -- ถ้าค่าน้อยกว่านี้ให้แก้ เพราะ OpenClaw ส่ง system prompt ใหญ่มาก
> - BCProxyAI จะเลือกโมเดลที่มี context window พอกับ request ให้อัตโนมัติ

#### ขั้นตอนที่ 3: แก้ปัญหา "pairing required"

> **ปัญหานี้เกิดเมื่อไหร่?** เมื่อ OpenClaw รันใน Docker แล้วพยายามเชื่อมต่อกับ Gateway อาจเจอ error "pairing required" -- หมายถึง Device ยังไม่ได้รับอนุญาต

วิธีแก้ -- พิมพ์ทีละบรรทัด:

```bash
# ขั้นที่ 1: ดูรายการ devices ที่รอ approve
openclaw devices list
```

> **ผลลัพธ์ที่ควรเห็น:**
> ```
> Pending devices:
>   requestId: abc123-def456-...
>   name: docker-container-xxx
> ```

```bash
# ขั้นที่ 2: approve device (เอา requestId จากข้างบนมาใส่)
openclaw devices approve abc123-def456-...
```

> **ผลลัพธ์ที่ควรเห็น:**
> ```
> Device approved successfully
> ```

#### ขั้นตอนที่ 4: แก้ปัญหา "origin not allowed"

> **ปัญหานี้เกิดเมื่อไหร่?** เมื่อ Gateway ถูก bind แบบ "loopback" (รับเฉพาะ 127.0.0.1) แต่ Docker Container เรียกมาจาก IP อื่น

วิธีแก้ -- แก้ส่วน `gateway` ใน openclaw.json:

```json
{
  "gateway": {
    "bind": "lan",
    "controlUi": {
      "allowedOrigins": [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:18790",
        "http://127.0.0.1:18790"
      ]
    }
  }
}
```

> **อธิบาย:**
> - `"bind": "lan"` = เปิดให้เครื่องอื่นใน network เข้าถึงได้ (ไม่ใช่แค่ตัวเอง)
> - `allowedOrigins` = รายชื่อ URL ที่อนุญาตให้เปิด Dashboard (ใส่ port ที่ map จาก Docker ด้วย)

### วิธีที่ 2: OpenClaw แบบ CLI Native (ไม่ใช้ Docker)

> ถ้า OpenClaw รันบนเครื่องโดยตรง (ไม่ใช่ Docker) ง่ายกว่ามาก -- ใช้ `localhost` ได้เลย

#### ขั้นตอนที่ 1: onboard

```bash
openclaw onboard \
  --non-interactive \
  --accept-risk \
  --auth-choice custom-api-key \
  --custom-base-url http://localhost:3333/v1 \
  --custom-model-id auto \
  --custom-api-key dummy \
  --custom-compatibility openai \
  --skip-channels \
  --skip-daemon \
  --skip-health \
  --skip-search \
  --skip-skills \
  --skip-ui
```

> เท่านี้เลย! onboard จะตั้งค่า provider ให้อัตโนมัติ (api: openai-completions, contextWindow ฯลฯ)  
> ไม่ต้องแก้ openclaw.json เพิ่ม ไม่ต้อง approve device

### Tool Call Parameter Fix

BCProxyAI แก้ปัญหา tool call parameters อัตโนมัติ -- OpenClaw web_search บางทีส่ง number เป็น string (เช่น `"5"` แทน `5`) ระบบจะแปลง string ที่เป็นตัวเลขให้เป็น number อัตโนมัติ ไม่ต้องทำอะไรเพิ่ม

### Checklist เชื่อมต่อ OpenClaw (เช็คทีละข้อ)

- [ ] Docker Desktop เปิดอยู่ (ไอคอนวาฬสีเขียว)
- [ ] BCProxyAI Docker รันอยู่ (`docker compose up -d`)
- [ ] เปิด http://localhost:3333 ได้ (เห็น Dashboard)
- [ ] Worker สแกนเสร็จ มีโมเดลพร้อมใช้ (ดูจาก Dashboard)
- [ ] `openclaw onboard` เสร็จเรียบร้อย (ไม่ต้องแก้ openclaw.json เพิ่ม ถ้าใช้คำสั่งข้างบน)
- [ ] ถ้าใช้ Docker: base URL เป็น `host.docker.internal:3333`
- [ ] ถ้าใช้ Docker: approve pairing แล้ว (`openclaw devices approve`)
- [ ] ถ้าใช้ Docker: gateway bind เป็น `"lan"` + allowedOrigins ถูกต้อง
- [ ] ทดสอบ: `curl http://localhost:3333/v1/models` ตอบรายชื่อโมเดลกลับมา

---

## Virtual Models (โมเดลพิเศษ)

BCProxyAI มีโมเดลพิเศษ 4 ตัว -- ไม่ใช่โมเดลจริง แต่เป็น "ชื่อลัด" ที่ BCProxyAI จะเลือกโมเดลจริงให้:

| Model ID | พฤติกรรม |
|----------|---------|
| `auto` หรือ `bcproxy/auto` | เลือกโมเดลที่คะแนน benchmark สูงสุด |
| `bcproxy/fast` | เลือกโมเดลที่ตอบเร็วที่สุด (latency ต่ำสุด) |
| `bcproxy/tools` | เลือกโมเดลที่รองรับ tool calling (เช่น เรียกฟังก์ชัน) |
| `bcproxy/thai` | เลือกโมเดลที่เก่งภาษาไทย (คะแนน benchmark สูงสุด) |

### การใช้โมเดลตรง (Direct Provider Routing)

ถ้าอยากเจาะจงโมเดล ระบุ provider + model ID ตรงๆ ได้:

```
groq/llama-3.3-70b-versatile
openrouter/qwen/qwen3-coder:free
cerebras/qwen-3-235b-a22b-instruct-2507
sambanova/DeepSeek-R1
mistral/mistral-large-latest
ollama/gemma3:4b
ollama/gemma4:31b
```

### การตรวจจับอัตโนมัติ

แม้จะใช้ `auto` แต่ถ้า request มีลักษณะพิเศษ ระบบจะตรวจจับและเลือกให้เหมาะ:

- มี `tools` ใน request -> เลือกเฉพาะโมเดลที่รองรับ tool calling
- มี `image_url` ใน messages -> เลือกเฉพาะโมเดลที่รองรับ vision (ดูรูป)
- มี `response_format: json_schema` -> เลือกโมเดลขนาดใหญ่ที่จัดการ JSON ได้ดี

### Smart Context-Aware Selection

ระบบจะประมาณจำนวน token ของ request แล้วเลือกเฉพาะโมเดลที่มี context window เพียงพอ

ถ้าเกิด error 413 (payload too large):
- โมเดลนั้นจะถูก cooldown 15 นาที
- ระบบ fallback ไปโมเดลอื่นทันที (สูงสุด 10 ครั้ง กระจายข้าม provider แบบ round-robin)

---

## ฟีเจอร์เด่น

### Weighted Load Balancing

ระบบกระจายโหลดอัจฉริยะ:
- เรียง provider ตาม weight: **คะแนนสูง + latency ต่ำ = ได้ request ก่อน**
- Round-robin ข้าม provider (ไม่กระจุกที่ตัวเดียว)
- Fallback สูงสุด **10 ครั้ง** ข้ามทุก provider
- ถ้าทุกตัว cooldown -> **สุ่มจากทั้งหมด** (ไม่มีวัน 503 ถาวร)
- Model ที่ทำงานสำเร็จ -> **clear cooldown ทันที**

### Smart Cooldown

Cooldown ตาม error type -- ไม่ใช่ one-size-fits-all:

| Error | Cooldown | เหตุผล |
|-------|----------|--------|
| 413 (request ใหญ่) | 15 นาที | ลองใหม่ได้เร็ว |
| 429 (rate limit) | 30 นาที | รอ limit reset |
| 422 (unprocessable) | 30 นาที | ข้อมูลผิดรูปแบบ |
| 5xx (server error) | 1 ชม. | provider มีปัญหา |
| 401/403 (auth error) | 24 ชม. | key หมดอายุ/ผิด |
| Ollama | ไม่ cooldown เด็ดขาด | เครื่องตัวเอง ไม่มี rate limit |
| 400 / อื่นๆ | ไม่ cooldown | แค่ skip ไป model ถัดไป |

### Tool Call Parameter Fix

แก้ปัญหา tool call อัตโนมัติ:
- OpenClaw web_search บางทีส่ง parameter เป็น string แทนที่จะเป็น number (เช่น `"5"` แทน `5`)
- BCProxyAI จะ **auto-convert string ที่เป็นตัวเลขให้เป็น number** ก่อนส่งต่อ
- ไม่ต้องแก้อะไรฝั่ง OpenClaw

### Reasoning-to-Content Fix

สำหรับ Ollama gemma4:
- บาง model ใส่คำตอบใน `reasoning` field แทน `content`
- BCProxyAI จะ **ย้าย reasoning field ไปเป็น content** อัตโนมัติ
- ทำให้ OpenClaw อ่านคำตอบได้ถูกต้อง

### Token Budget (ควบคุมการใช้งาน)

ตั้ง budget จำกัดการใช้ token ต่อวัน:

```bash
# ตั้ง budget 1 ล้าน tokens/วัน
curl -X POST http://localhost:3333/api/budget \
  -H "Content-Type: application/json" \
  -d '{"dailyLimit": 1000000}'

# ดู budget ปัจจุบัน
curl http://localhost:3333/api/budget
```

- ใช้ไป **80%** -> สลับไป model ที่ประหยัดกว่า
- ใช้ไป **95%** -> หยุดรับ request ชั่วคราว (ป้องกันค่าใช้จ่ายบาน)

### Cost Calculator (คำนวณเงินที่ประหยัดได้)

ดูว่าถ้าใช้ paid API จะเสียเงินเท่าไหร่:

```bash
curl http://localhost:3333/api/cost-savings
```

เปรียบเทียบกับ 5 บริการชั้นนำ (ราคาจริงจากเว็บทางการ):

| บริการ | ค่า Input | ค่า Output |
|--------|----------|-----------|
| GPT-4o | $2.50/M tokens | $10.00/M tokens |
| Claude Sonnet 4.6 | $3.00/M tokens | $15.00/M tokens |
| Gemini 2.5 Pro | $1.25/M tokens | $10.00/M tokens |
| Qwen Plus | $0.40/M tokens | $1.20/M tokens |
| DeepSeek V3 | $0.28/M tokens | $0.42/M tokens |
| **BCProxyAI** | **ฟรี!** | **ฟรี!** |

แสดงยอดสะสมทั้ง USD และ THB (บาท)

### In-Memory Caching

ระบบมี cache ในตัว ลด load ไป database:

| ข้อมูล | Cache TTL | หมายเหตุ |
|--------|----------|---------|
| รายชื่อ model (gateway) | 10 วินาที | Clear อัตโนมัติเมื่อ cooldown เปลี่ยน |
| API status/models/leaderboard | 5 วินาที | ลด DB hit จาก dashboard refresh |
| Health check | 5 วินาที | ไม่ query DB ซ้ำถี่เกินไป |

### Input Validation

Gateway ตรวจสอบ request ก่อนประมวลผล:
- `messages` ต้องเป็น array ที่ไม่ว่าง
- `model` ต้องเป็น string (ถ้าระบุ)
- ตอบ 400 พร้อมข้อความอธิบายถ้าผิด format

---

## API Endpoints

### Gateway (OpenAI Compatible)

| Method | Path | คำอธิบาย |
|--------|------|---------|
| POST | `/v1/chat/completions` | ส่งข้อความแชท (รองรับ stream) |
| GET | `/v1/models` | รายชื่อโมเดลทั้งหมด + สถานะ |

**ตัวอย่าง: ส่งข้อความ**

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}],
    "stream": false
  }'
```

**ตัวอย่าง: Stream (ตอบทีละคำ)**

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}],
    "stream": true
  }'
```

**ตัวอย่าง: ใช้ Ollama ตรง**

```bash
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ollama/gemma3:4b",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}],
    "stream": false
  }'
```

**Response Headers พิเศษ:**

| Header | คำอธิบาย |
|--------|---------|
| `X-BCProxy-Model` | โมเดลที่ถูกเลือกใช้จริง |
| `X-BCProxy-Provider` | ผู้ให้บริการ (openrouter/kilo/groq/cerebras/sambanova/mistral/ollama) |

### Dashboard API

| Method | Path | คำอธิบาย |
|--------|------|---------|
| GET | `/api/status` | สถานะ worker + สถิติ + โมเดลใหม่/หายไป |
| GET | `/api/models` | โมเดลทั้งหมด + health + benchmark |
| GET | `/api/leaderboard` | อันดับโมเดลตามคะแนน |
| GET | `/api/worker` | สถานะ worker |
| POST | `/api/worker` | สั่ง worker รันทันที |
| POST | `/api/chat` | Chat API สำหรับ Dashboard |
| GET | `/api/gateway-logs` | Gateway request/response logs (รองรับ pagination) |
| GET | `/api/budget` | Budget สถานะ token usage วันนี้ |
| POST | `/api/budget` | ตั้ง daily token limit |
| GET | `/api/cost-savings` | คำนวณเงินที่ประหยัดได้ vs paid API |
| GET | `/api/health` | Health check -- status healthy/degraded/down + Thai alerts |

---

## Monitoring & Health Check

ตรวจสอบสถานะระบบทั้งหมดผ่าน endpoint เดียว:

```bash
curl http://localhost:3333/api/health
```

**ผลลัพธ์:**

```json
{
  "status": "healthy",
  "checks": {
    "database": { "ok": true, "latencyMs": 0 },
    "providers": { "total": 132, "available": 66, "cooldown": 30, "percentAvailable": 50 },
    "worker": { "status": "idle", "lastRun": "2026-04-03T01:00:19Z", "minutesSinceLastRun": 15 },
    "gateway": { "recentSuccessRate": 95, "avgLatencyMs": 2800 }
  },
  "alerts": []
}
```

### สถานะ 3 ระดับ

| สถานะ | เงื่อนไข |
|-------|---------|
| **healthy** | providers > 20% available, worker รันภายใน 2 ชม., success rate > 50% |
| **degraded** | บางเงื่อนไขไม่ผ่าน (แต่ยังใช้งานได้) |
| **down** | providers = 0% available หรือ database ไม่ตอบ |

### แจ้งเตือนอัตโนมัติ (alerts ภาษาไทย)

| เหตุการณ์ | ข้อความ |
|----------|---------|
| ทุกโมเดล cooldown | "ทุกโมเดลติด cooldown -- อาจถูก rate limit ทั้งหมด" |
| Worker หยุดนาน | "Worker ไม่ทำงานมา X ชม." |
| Success rate ต่ำ | "Success rate ต่ำกว่า 50%" |
| DB ช้า | "Database latency สูง (> 100ms)" |

### ใช้งานจริง

เหมาะสำหรับต่อกับ Uptime monitoring เช่น [UptimeRobot](https://uptimerobot.com/), [Healthchecks.io](https://healthchecks.io/) หรือเขียน cron ตรวจเอง:

```bash
# ตรวจทุก 5 นาที -- ถ้า status ไม่ใช่ healthy ให้แจ้งเตือน
curl -s http://localhost:3333/api/health | grep -q '"healthy"' || echo "ALERT: BCProxyAI degraded!"
```

---

## ระบบ Benchmark (คุณครูออกข้อสอบ)

BCProxyAI ใช้ระบบ **"ให้ AI ตรวจข้อสอบ AI"** -- โมเดลหนึ่งตอบคำถาม อีกโมเดลหนึ่งเป็นคุณครูตรวจให้คะแนน

### ข้อสอบ (3 ข้อ ภาษาไทย)

| ข้อ | คำถาม | ทดสอบอะไร |
|-----|-------|----------|
| 1 | "สวัสดีครับ วันนี้อากาศเป็นยังไงบ้าง?" | ทักทาย + ตอบคำถามทั่วไป |
| 2 | "แนะนำอาหารไทยมา 3 เมนู" | ความรู้วัฒนธรรมไทย + จัดรูปแบบ |
| 3 | "กรุงเทพมหานครอยู่ประเทศอะไร?" | ความรู้ทั่วไป + ตอบถูก |

### Benchmark Concurrency

- **20 concurrent** requests พร้อมกัน
- **10 models** ต่อรอบ
- **3 คำถามภาษาไทย** ต่อ model

### คุณครูผู้ตรวจ (AI Judge)

| ลำดับ | โมเดล | หมายเหตุ |
|-------|-------|---------|
| 1 (หลัก) | **DeepSeek Chat** (`deepseek-chat`) | ถูก เสถียร ให้คะแนนแม่น |
| 2 (สำรอง) | **Qwen3 235B** (OpenRouter free) | ถ้า DeepSeek ไม่ว่าง |
| 3 (สำรอง) | **Llama 4 Scout** (OpenRouter free) | ถ้าสองตัวแรกไม่ว่าง |
| 4 (สำรอง) | **Gemma 3 27B** (OpenRouter free) | ถ้าสามตัวแรกไม่ว่าง |

ถ้าคุณครูไม่ว่างทั้ง 4 ตัว จะใช้ Heuristic Score แทน (คำตอบยาว > 10 ตัวอักษร = 5/10)

### ชื่อเล่น (Nickname)

คุณครู DeepSeek จะตั้งชื่อเล่นภาษาไทยตลกๆ ให้โมเดล **ตามคะแนนและความประพฤติ**:

**ก่อนสอบ** -- ตั้งชื่อทั่วไปน่ารักๆ (10 ตัว/รอบ):
- ตัวอย่าง: `ลีลี่ลีล่าลีลา`, `เนโมน้อย`, `ฉิวฉิวฉลาดเฉียบ`

**หลังสอบ** -- ตั้งชื่อใหม่ตามผลสอบ + ความประพฤติ:

| คะแนน | ความประพฤติที่บอก DeepSeek | ตัวอย่างชื่อ |
|-------|-------------------------|------------|
| 90%+ | "ขยัน เก่ง เด่นมาก" | `ลามะน้อยขยัน`, `ฉลาดน้อยขยัน` |
| 70%+ | "ตั้งใจเรียน" | `น้องเก่งตั้งใจ` |
| 50%+ | "ขี้เกียจนิดหน่อย" | `ลูกอ่อนขี้เกียจ` |
| 30%+ | "ชอบหลับในห้อง" | `หนูน้อยง่วงนอน` |
| <30% | "ไม่ตั้งใจเรียนเลย" | `เด็กดื้อไม่เรียน` |

- ชื่อไม่ซ้ำกัน -- DeepSeek รู้ชื่อที่ตั้งไปแล้ว
- ชื่อจะเปลี่ยนหลังสอบทุกครั้ง ตามคะแนนล่าสุด

### เกณฑ์การให้คะแนน

| คะแนน | หมายถึง |
|-------|--------|
| 8-10 | ตอบถูกต้อง เป็นธรรมชาติ ภาษาไทยดี |
| 5-7 | ตอบได้ แต่อาจมีบางจุดไม่สมบูรณ์ |
| 3-4 | ตอบได้บ้าง แต่คุณภาพต่ำ |
| 0-2 | ตอบผิด ตอบไม่เป็นภาษาไทย หรือไม่ตอบ |

### กฎการสอบ

- **สอบผ่าน** = คะแนนเฉลี่ย >= 5/10 -- โมเดลพร้อมใช้งาน
- **สอบตก** = คะแนนเฉลี่ย < 3/10 -- ไม่สอบซ้ำภายใน 7 วัน (ประหยัด token)
- สอบครบ 3 ข้อแล้ว จะไม่สอบซ้ำอีก
- สอบสูงสุด 10 โมเดลต่อรอบ (ทุก 1 ชม.)
- เฉพาะโมเดลที่ผ่าน Health Check แล้วเท่านั้นจึงจะถูกสอบ

---

## Worker อัตโนมัติ

Worker (โปรแกรมทำงานเบื้องหลัง) ทำงานทุก **1 ชั่วโมง**:

### ขั้นตอนที่ 1: สแกนโมเดล (Scan)

- ดึงรายชื่อโมเดลฟรีจาก **8 ผู้ให้บริการพร้อมกัน** (OpenRouter, Kilo, Google, Groq, Cerebras, SambaNova, Mistral, Ollama)
- บันทึกโมเดลใหม่ อัพเดตโมเดลเดิม
- ตรวจจับโมเดลที่หายไป (หายชั่วคราว 2-48 ชม. / หายถาวร > 48 ชม.)
- **ตั้งชื่อเล่นภาษาไทย** ให้โมเดลที่ยังไม่มี (DeepSeek ตั้งให้ 10 ตัว/รอบ)

### ขั้นตอนที่ 2: Health Check (ตรวจสุขภาพ)

- ส่ง ping ทดสอบ **5 concurrent** พร้อมกัน
- Timeout: Ollama = **120 วินาที** (เพราะ Local LLM โหลดช้า), Cloud = **15 วินาที**
- โมเดลที่ติด rate limit หรือ error -> พัก cooldown 2 ชม.
- ทดสอบ tool calling support (สูงสุด 3 ตัว/รอบ)
- ทดสอบ vision support (สูงสุด 3 ตัว/รอบ)

### ขั้นตอนที่ 3: Benchmark (สอบ)

- สอบ 3 คำถามภาษาไทย ให้คะแนน 0-10
- **20 concurrent**, **10 models/รอบ**
- สอบผ่าน = คะแนนเฉลี่ย >= 5/10
- สอบตก (< 3/10) จะไม่สอบซ้ำภายใน 7 วัน

### ขั้นตอนที่ 4: ตั้งชื่อเล่น (Naming)

- DeepSeek ตั้งชื่อเล่นภาษาไทยให้โมเดลที่ยังไม่มีชื่อ
- สูงสุด **10 ตัว/รอบ**
- ชื่อตามคะแนน benchmark + ความประพฤติ

### Log Rotation

- ลบ log เก่าเกิน **30 วัน** อัตโนมัติทุกรอบ

---

## Dashboard

เปิด **http://localhost:3333** เพื่อดู Dashboard

### ส่วนต่างๆ ของ Dashboard

| ส่วน | คำอธิบาย |
|------|---------|
| **Worker Status** | สถานะ worker + นับถอยหลังครั้งถัดไป |
| **Judge Info** | แสดงว่าใช้ DeepSeek Chat เป็นคุณครูตรวจ |
| **Cost Comparison** | การ์ดเปรียบเทียบค่าใช้จ่าย 5 paid providers vs BCProxyAI ฟรี (USD + THB) |
| **สถิติ (Stats Cards)** | 4 animated counters: โมเดลทั้งหมด / พร้อมใช้ / พักผ่อน / มีคะแนน |
| **การเปลี่ยนแปลง** | แจ้งเตือนโมเดลใหม่ (new) / หายไป (missing) / คำเตือน (warning) |
| **อันดับโมเดล** | ตาราง ranking ตามคะแนน benchmark |
| **Speed Race** | Animation แข่งความเร็วระหว่าง providers + podium 1st/2nd/3rd |
| **ห้องเรียน AI** | Grid แสดงทุกโมเดล ธีมห้องเรียน: เกรด A+ ถึง F, ชื่อเล่นไทย, ความเร็ว |
| **ทดลองแชท** | Chat panel ทดสอบแชทกับโมเดลที่เลือกได้ |
| **Gateway Log LIVE** | LIVE log ทุก request เข้า-ออก (refresh ทุก 2 วินาที) |
| **บันทึกการทำงาน** | Log การทำงานของ worker |
| **คู่มือ (Guide)** | Modal 5 แท็บ + ปุ่ม GitHub |

Dashboard รีเฟรชอัตโนมัติทุก 15 วินาที (Gateway Log ทุก 2 วินาที)

### Speed Race Animation

- Provider แข่งกัน: Groq vs SambaNova vs Cerebras vs Mistral vs OpenRouter vs Kilo vs Google vs Ollama
- เรียงตาม latency จริง
- Podium 1st / 2nd / 3rd
- อัพเดตอัตโนมัติทุก 15 วินาที

### ห้องเรียน AI (School Theme)

โมเดลแต่ละตัวแสดงผลแบบ "นักเรียน" พร้อม:
- **ชื่อเล่นภาษาไทย** สีทอง (DeepSeek ตั้งให้)
- **เกรด**: A+ (97%+) นักเรียนดีเด่น, A (80%+) เก่งมาก, B (60%+) ดี, C (40%+) พอใช้, D (20%+) ต้องปรับปรุง, F ไม่ผ่าน
- **สถานะตลก**: หัวหน้าห้อง!, ไปพักผ่อนก่อน, รอเข้าห้องสอบ, ซ้ำชั้นเลย
- **ความเร็ว**: สายฟ้า, เร็วมาก, ปกติ, ช้า, ช้ามาก

---

## ขีดจำกัดของระบบ (Stress Test)

ทดสอบจริงด้วย `stress-test.js`:

| สถานการณ์ | Concurrent | Requests | Success Rate | Throughput |
|-----------|-----------|----------|-------------|------------|
| **ใช้งานปกติ** | 5 | 200 | **97%** | 2.9 req/s |
| **ทีมขนาดกลาง** | 10 | 1,000 | **97%** | 3.4 req/s |
| **โหลดหนัก** | 1,000 | 10,000 | 18-30% | 73-125 req/s |

> **Bottleneck คือ rate limit ของ provider ฟรี** ไม่ใช่ตัว BCProxyAI  
> สำหรับ **ทีม 5-20 คนใช้พร้อมกัน** ใช้งานได้สบาย success rate 97%+  
> ถ้าต้องการรองรับมากกว่านี้ ต้องใช้ paid API หรือเพิ่ม API Key (Auto Rotation)

### รัน Stress Test เอง

```bash
node stress-test.js
```

แก้ค่า `TOTAL_REQUESTS` และ `CONCURRENCY` ใน `stress-test.js` ได้

---

## การแก้ไขปัญหาทั่วไป

### Docker Desktop ไม่ยอมเริ่ม

- ตรวจสอบว่า Virtualization เปิดอยู่ใน BIOS
- ลอง restart เครื่อง
- ตรวจสอบว่า Windows Update ล่าสุดแล้ว
- ลอง Uninstall แล้ว Install ใหม่

### Worker ไม่ทำงาน

```bash
# ดู log ของ container (ดูว่ามี error อะไร)
docker logs bcproxyai-bcproxyai-1

# สั่ง worker รันทันที
curl -X POST http://localhost:3333/api/worker
```

### ไม่มีโมเดลพร้อมใช้

- ตรวจสอบว่าใส่ API Key ใน `.env.local` แล้ว
- รอ worker ทำ health check เสร็จ (ดูจาก Dashboard)
- โมเดลที่ติด rate limit จะพักอัตโนมัติ 2 ชม.

### Gateway ตอบ error

```bash
# ทดสอบ gateway (ถ้าตอบกลับมา = ทำงานปกติ)
curl -X POST http://localhost:3333/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"test"}]}'
```

- ตรวจสอบ `X-BCProxy-Model` header เพื่อดูว่าเลือกโมเดลอะไร
- ถ้าไม่มีโมเดลพร้อมใช้ จะตอบ 503
- แต่ถ้าทุกตัว cooldown ระบบจะ **สุ่มเลือก** แทน (ไม่ 503 ถาวร)

### OpenClaw เชื่อมต่อไม่ได้

- ดูหัวข้อ [เชื่อมต่อกับ OpenClaw](#เชื่อมต่อกับ-openclaw-ละเอียดมาก) ด้านบน
- ตรวจสอบใน openclaw.json ว่า `models.providers.*.api` เป็น `"openai-completions"`
- ตรวจสอบ `models.providers.*.models[0].contextWindow` เป็น `131072`
- ถ้า Docker: ตรวจ pairing (`openclaw devices list` แล้ว `approve`)
- ถ้า Docker: ตรวจ gateway bind เป็น `"lan"` + allowedOrigins
- ทดสอบ: `curl http://localhost:3333/v1/models` ต้องตอบรายชื่อโมเดลกลับมา

### Error 413 (Payload Too Large)

- BCProxyAI จัดการอัตโนมัติ: cooldown โมเดลนั้น 15 นาที แล้ว fallback ไปตัวอื่น
- ตรวจสอบว่า `contextWindow` ใน openclaw.json = `131072`

### Ollama เชื่อมต่อไม่ได้

- ตรวจสอบว่า Ollama รันอยู่: `ollama list`
- ตรวจสอบว่า pull model แล้ว: `ollama pull gemma3:4b`
- ตรวจสอบว่า `OLLAMA_BASE_URL` ถูกต้องใน `.env.local`
- ถ้ารัน BCProxyAI บน Docker: ใช้ `http://host.docker.internal:11434` แทน `localhost`

### ต้องการ reset ข้อมูลทั้งหมด (เริ่มใหม่)

```bash
docker compose down                              # หยุด container
docker volume rm bcproxyai_bcproxyai-data         # ลบ database
docker compose up -d                              # เริ่มใหม่
```

---

## ค่าใช้จ่ายในการรัน

### ฟรี 100%

| รายการ | ใช้ตรงไหน | ค่าใช้จ่าย |
|--------|----------|-----------|
| OpenRouter, Kilo, Google, Groq | scan + proxy | ฟรี (free tier) |
| Cerebras, SambaNova, Mistral | scan + proxy | ฟรี (free tier) |
| Ollama (Local LLM) | scan + proxy | ฟรี (รันบนเครื่องตัวเอง) |
| Docker Desktop + SQLite | รันระบบ + เก็บข้อมูล | ฟรี |

### DeepSeek (ถ้าใส่ key)

| รายการ | ความถี่ | ค่าใช้จ่ายโดยประมาณ |
|--------|---------|-------------------|
| ตรวจข้อสอบ (judge) | 9 calls/ชม. x 24 = 216 calls/วัน | ~$0.22/วัน (~8 บาท) |
| ตั้งชื่อเล่น (model ใหม่) | 10 ชื่อ/รอบ (เฉพาะวันแรก) | ~$0.12 ครั้งเดียว |
| ตั้งชื่อหลังสอบ | 3 ชื่อ/รอบ | ~$0.04/วัน (~1 บาท) |
| **รวม** | | **~$0.05-0.26/วัน (~2-9 บาท)** |

> **หลังสแกนครบทุกตัวแล้ว:** ค่าใช้จ่ายลดเหลือ ~$0.05/วัน (~2 บาท) เพราะตั้งชื่อเฉพาะ model ใหม่เท่านั้น

### ถ้าไม่อยากเสียเงินเลย

ลบ `DEEPSEEK_API_KEY` ออกจาก `.env.local` -> ระบบจะ:
- ใช้ **OpenRouter ฟรี** ตรวจข้อสอบแทน (Qwen3/Llama4/Gemma3)
- **ไม่ตั้งชื่อเล่น** (แสดงชื่อจริงแทน)
- **ค่าใช้จ่าย = $0 ทั้งหมด**

---

## สร้างด้วยอะไร?

โปรเจคนี้สร้างด้วย **Claude Code (Claude CLI)** -- AI Coding Assistant จาก Anthropic  
สั่งงานเป็นภาษาไทย สร้างเสร็จภายในวันเดียว ตั้งแต่ออกแบบจนถึง deploy

| เครื่องมือ | ทำหน้าที่ |
|-----------|----------|
| **Claude Code (Opus 4.6)** | เขียนโค้ดทั้งหมด ออกแบบระบบ เขียน tests |
| **Next.js 16 + TypeScript** | Web framework + ภาษาหลัก |
| **SQLite (better-sqlite3)** | ฐานข้อมูลแบบ embedded (ฝังในตัว) |
| **Tailwind CSS** | CSS framework สำหรับ UI |
| **Docker** | Multi-stage build (289MB) |
| **Vitest** | Unit testing (67 tests) |

---

**BCProxyAI** -- Smart AI Gateway สำหรับ OpenClaw และ HiClaw  
สร้างด้วย Claude Code (Opus 4.6) + Next.js 16 + TypeScript + SQLite + Tailwind CSS  
**8 Providers** | **130+ โมเดลฟรี** | **Local LLM (Ollama)** | **Auto-Fallback 10 ครั้ง** | **Speed Race** | **Thai Benchmark** | **Fun Nicknames** | **Health Monitoring** | **Cost Calculator**
