"use client";

import { useState } from "react";

const TABS = [
  { id: "usage", label: "การใช้งาน" },
  { id: "openclaw", label: "เชื่อมต่อ OpenClaw" },
  { id: "install", label: "การติดตั้ง" },
  { id: "api", label: "API Reference" },
  { id: "about", label: "ระบบ Benchmark" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">{children}</h3>;
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-bold text-indigo-300 mt-5 mb-2">{children}</h4>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-gray-300 overflow-x-auto font-mono my-2">
      {children}
    </pre>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 leading-relaxed mb-3">{children}</p>;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-amber-400 shrink-0">&#9888;</span>
        <div className="text-sm text-amber-300">{children}</div>
      </div>
    </div>
  );
}

function Info({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-blue-400 shrink-0">&#9432;</span>
        <div className="text-sm text-blue-300">{children}</div>
      </div>
    </div>
  );
}

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-4">
      <div className="h-7 w-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-xs font-bold text-indigo-300">{num}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white mb-1">{title}</div>
        <div className="text-sm text-gray-400">{children}</div>
      </div>
    </div>
  );
}

function TableRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-white/5">
      <td className="py-2 pr-4 text-sm font-mono text-indigo-300 whitespace-nowrap">{label}</td>
      <td className="py-2 text-sm text-gray-400">{value}</td>
    </tr>
  );
}

function Expected({ children }: { children: string }) {
  return (
    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2 my-2">
      <div className="text-xs text-emerald-400 mb-1">&#10003; ผลลัพธ์ที่ควรเห็น:</div>
      <pre className="text-xs text-emerald-300/70 font-mono whitespace-pre-wrap">{children}</pre>
    </div>
  );
}

// ─── Tab: การใช้งาน ──────────────────────────────────────────────────────────

function UsageGuide() {
  return (
    <div className="space-y-6">
      <Warning>
        <strong>ระบบนี้ไม่มี API Key Authentication</strong> -- ห้ามเปิดให้ภายนอกเข้าถึง
        <br />แนะนำให้ติดตั้งบน Local (เครื่องตัวเอง) หรือ Network ภายในองค์กรเท่านั้น
        <br />ไม่มี API Key -- ใครก็ตามที่เข้าถึงพอร์ตได้ จะใช้ได้ทันที
      </Warning>

      <div>
        <SectionTitle>ภาพรวมระบบ</SectionTitle>
        <Paragraph>
          BCProxyAI เป็น <span className="text-white">&quot;ตัวกลาง&quot;</span> ระหว่าง OpenClaw กับผู้ให้บริการ AI ฟรีหลายเจ้า
          คิดง่ายๆ ว่า: OpenClaw ส่งคำถามมา &rarr; BCProxyAI เลือกโมเดล AI ฟรีตัวที่ดีที่สุดให้ &rarr; ส่งคำตอบกลับ
        </Paragraph>
        <Paragraph>
          สแกนหาโมเดล AI ฟรีจาก 4 ผู้ให้บริการ (OpenRouter, Kilo AI, Google AI Studio, Groq)
          แล้วเลือกตัวที่ดีที่สุดให้อัตโนมัติ ใช้งานผ่าน API ที่เข้ากันได้กับ OpenAI 100%
        </Paragraph>
      </div>

      <div>
        <SectionTitle>Virtual Models (โมเดลพิเศษ)</SectionTitle>
        <Paragraph>
          ไม่ใช่โมเดลจริง แต่เป็น &quot;ชื่อลัด&quot; ที่ BCProxyAI จะเลือกโมเดลจริงให้:
        </Paragraph>
        <table className="w-full">
          <tbody>
            <TableRow label="auto" value="เลือกโมเดลที่คะแนน benchmark สูงสุด (แนะนำ)" />
            <TableRow label="bcproxy/fast" value="เลือกโมเดลที่ตอบเร็วที่สุด (latency ต่ำสุด)" />
            <TableRow label="bcproxy/tools" value="เลือกโมเดลที่รองรับ tool calling (เรียกฟังก์ชัน)" />
            <TableRow label="bcproxy/thai" value="เลือกโมเดลที่เก่งภาษาไทย (คะแนนสูงสุด)" />
          </tbody>
        </table>
      </div>

      <div>
        <SectionTitle>การตรวจจับอัตโนมัติ</SectionTitle>
        <Paragraph>
          แม้จะใช้ <span className="text-indigo-300">auto</span> แต่ถ้า request มีลักษณะพิเศษ ระบบจะตรวจจับและเลือกให้เหมาะ:
        </Paragraph>
        <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 ml-2">
          <li>มี <code className="text-indigo-300">tools</code> ใน request &rarr; เลือกเฉพาะโมเดลที่รองรับ tool calling</li>
          <li>มี <code className="text-indigo-300">image_url</code> ใน messages &rarr; เลือกเฉพาะโมเดลที่รองรับ vision (ดูรูป)</li>
          <li>มี <code className="text-indigo-300">response_format: json_schema</code> &rarr; เลือกโมเดลขนาดใหญ่</li>
        </ul>
      </div>

      <div>
        <SectionTitle>Smart Context-Aware Selection</SectionTitle>
        <Paragraph>
          ระบบจะประมาณจำนวน token ของ request แล้วเลือกเฉพาะโมเดลที่มี context window (ความจำ) เพียงพอ
        </Paragraph>
        <Paragraph>
          ถ้าเกิด error 413 (ข้อมูลใหญ่เกิน): โมเดลนั้นจะถูก cooldown 15 นาที แล้ว fallback ไปโมเดลอื่นทันที (สูงสุด 3 ครั้ง)
        </Paragraph>
      </div>

      <div>
        <SectionTitle>การใช้โมเดลตรง</SectionTitle>
        <Paragraph>ถ้าอยากเจาะจงโมเดล ระบุ provider + model ID ตรงๆ ได้:</Paragraph>
        <Code>{`groq/llama-3.3-70b-versatile
openrouter/qwen/qwen3-coder:free
kilo/nvidia/nemotron-3-super-120b-a12b:free`}</Code>
      </div>

      <div>
        <SectionTitle>Auto-Fallback</SectionTitle>
        <Paragraph>
          ถ้าโมเดลที่เลือกตอบ error (429 rate limit หรือ 5xx) ระบบจะสลับไปใช้โมเดลอื่นอัตโนมัติ
          สูงสุด 3 ครั้ง โดยโมเดลที่ error จะถูกพัก cooldown 2 ชม.
        </Paragraph>
      </div>

      <div>
        <SectionTitle>Worker อัตโนมัติ</SectionTitle>
        <Paragraph>Worker (โปรแกรมทำงานเบื้องหลัง) ทำงาน 3 ขั้นตอน ทุก 1 ชั่วโมง:</Paragraph>
        <ul className="list-decimal list-inside text-sm text-gray-400 space-y-2 ml-2">
          <li><span className="text-blue-300 font-medium">Scan</span> -- สแกนโมเดลฟรีจาก 4 ผู้ให้บริการ ตรวจจับโมเดลใหม่/หายไป</li>
          <li><span className="text-emerald-300 font-medium">Health Check</span> -- ส่ง ping ทดสอบ พักโมเดลที่ติด limit 2 ชม. ทดสอบ tool/vision support</li>
          <li><span className="text-indigo-300 font-medium">Benchmark</span> -- สอบ 3 คำถามภาษาไทย ให้คะแนน 0-10 ข้ามโมเดลที่สอบตก 7 วัน</li>
        </ul>
      </div>

      <div>
        <SectionTitle>Dashboard</SectionTitle>
        <Paragraph>หน้านี้แหละ! รีเฟรชอัตโนมัติทุก 15 วินาที แสดง:</Paragraph>
        <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 ml-2">
          <li>สถานะ Worker + นับถอยหลังรอบถัดไป</li>
          <li>สถิติโมเดลทั้งหมด / พร้อมใช้ / พักผ่อน / มีคะแนน</li>
          <li>แจ้งเตือนโมเดลใหม่ / หายชั่วคราว / หายถาวร</li>
          <li>อันดับโมเดลตามคะแนน Benchmark</li>
          <li>ทดลองแชทกับโมเดลได้ทันที</li>
          <li>บันทึกการทำงานของ Worker</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Tab: เชื่อมต่อ OpenClaw ─────────────────────────────────────────────────

function OpenClawGuide() {
  return (
    <div className="space-y-6">
      <Info>
        <strong>OpenClaw คืออะไร?</strong> OpenClaw เป็น AI coding assistant ที่ทำงานใน Terminal (หน้าต่างพิมพ์คำสั่ง)
        ช่วยเขียนโค้ดให้ BCProxyAI ทำให้ OpenClaw ใช้โมเดล AI ฟรีได้โดยไม่ต้องจ่ายเงิน
      </Info>

      <div>
        <SectionTitle>วิธีที่ 1: OpenClaw บน Docker</SectionTitle>
        <Info>
          <strong>ทำไมต้อง host.docker.internal?</strong><br />
          เมื่อ OpenClaw กับ BCProxyAI รันบน Docker คนละ Container (กล่อง) จะเรียก localhost หากันไม่ได้
          ต้องใช้ <code className="text-blue-200">host.docker.internal</code> เพื่อให้ Container เข้าถึงเครื่องจริงของคุณ
        </Info>

        <Step num={1} title="onboard OpenClaw ให้ชี้มา BCProxyAI">
          <Paragraph>เปิด Terminal (หน้าต่างพิมพ์คำสั่ง) แล้ว copy คำสั่งนี้ทั้งหมดวาง:</Paragraph>
          <Code>{`openclaw onboard \\
  --non-interactive \\
  --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://host.docker.internal:3333/v1 \\
  --custom-model-id auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels \\
  --skip-daemon \\
  --skip-health \\
  --skip-search \\
  --skip-skills \\
  --skip-ui`}</Code>
          <Expected>{`Onboarding complete!\nProvider: custom-host-docker-internal-3333/auto`}</Expected>
          <Paragraph>
            <span className="text-gray-500">--custom-api-key dummy</span> = ใส่อะไรก็ได้ เพราะ BCProxyAI ไม่มี authentication<br />
            <span className="text-gray-500">--custom-model-id auto</span> = ให้ BCProxyAI เลือกโมเดลให้อัตโนมัติ<br />
            <span className="text-gray-500">--skip-*</span> = ข้ามขั้นตอนที่ไม่จำเป็นตอน onboard
          </Paragraph>
        </Step>

        <Step num={2} title="ตรวจสอบ openclaw.json">
          <Paragraph>
            หลัง onboard เสร็จ OpenClaw จะสร้าง config ให้อัตโนมัติ ปกติ<strong>ไม่ต้องแก้อะไรเพิ่ม</strong><br />
            ถ้าอยากตรวจสอบ หาไฟล์ <code className="text-indigo-300">~/.openclaw/openclaw.json</code> จะเห็น:
          </Paragraph>
          <Code>{`"models": {
  "providers": {
    "custom-host-docker-internal-3333": {
      "baseUrl": "http://host.docker.internal:3333/v1",
      "apiKey": "dummy",
      "api": "openai-completions",
      "models": [{
        "id": "auto",
        "contextWindow": 131072
      }]
    }
  }
}`}</Code>
          <Info>
            <strong>ถ้า contextWindow น้อยกว่า 131072</strong> ให้แก้เป็น 131072 เพราะ OpenClaw ส่ง system prompt ใหญ่มาก<br />
            <strong>api</strong> ต้องเป็น <code className="text-amber-200">&quot;openai-completions&quot;</code> (onboard ตั้งให้อัตโนมัติ)
          </Info>
        </Step>

        <Step num={3} title='แก้ปัญหา "pairing required"'>
          <Paragraph>
            เมื่อ OpenClaw รันใน Docker แล้วพยายามเชื่อมต่อ อาจเจอ error &quot;pairing required&quot;
            หมายถึง Device ยังไม่ได้รับอนุญาต วิธีแก้:
          </Paragraph>
          <Code>{`# ดูรายการ devices ที่รอ approve
openclaw devices list`}</Code>
          <Expected>{`Pending devices:\n  requestId: abc123-def456-...\n  name: docker-container-xxx`}</Expected>
          <Code>{`# approve device (เอา requestId จากข้างบนมาใส่)
openclaw devices approve abc123-def456-...`}</Code>
          <Expected>{`Device approved successfully`}</Expected>
        </Step>

        <Step num={4} title='แก้ปัญหา "origin not allowed"'>
          <Paragraph>
            ถ้า Gateway ถูก bind แบบ &quot;loopback&quot; (รับเฉพาะ 127.0.0.1) แต่ Docker Container เรียกมาจาก IP อื่น
            ต้องเพิ่ม gateway config ใน openclaw.json:
          </Paragraph>
          <Code>{`{
  "apiProvider": "openai-completions",
  "openAiBaseUrl": "http://host.docker.internal:3333/v1",
  "openAiModelId": "auto",
  "openAiApiKey": "dummy",
  "contextWindow": 131072,
  "gateway": {
    "bind": "lan",
    "allowedOrigins": [
      "http://host.docker.internal:3333",
      "http://localhost:3333"
    ]
  }
}`}</Code>
          <Paragraph>
            <span className="text-gray-500">&quot;bind&quot;: &quot;lan&quot;</span> = เปิดให้เครื่องอื่นใน network เข้าถึงได้<br />
            <span className="text-gray-500">allowedOrigins</span> = รายชื่อ URL ที่อนุญาตให้เชื่อมต่อ
          </Paragraph>
        </Step>
      </div>

      <div>
        <SectionTitle>วิธีที่ 2: OpenClaw แบบ CLI Native (ไม่ใช้ Docker)</SectionTitle>
        <Info>
          ถ้า OpenClaw รันบนเครื่องโดยตรง (ไม่ใช่ Docker) ง่ายกว่ามาก -- ใช้ <code className="text-blue-200">localhost</code> ได้เลย
          ไม่ต้องตั้ง gateway หรือ approve device
        </Info>

        <Step num={1} title="onboard">
          <Code>{`openclaw onboard \\
  --non-interactive \\
  --accept-risk \\
  --auth-choice custom-api-key \\
  --custom-base-url http://localhost:3333/v1 \\
  --custom-model-id auto \\
  --custom-api-key dummy \\
  --custom-compatibility openai \\
  --skip-channels \\
  --skip-daemon \\
  --skip-health \\
  --skip-search \\
  --skip-skills \\
  --skip-ui`}</Code>
        </Step>

        <Paragraph>
          เท่านี้เลย! onboard ตั้งค่าให้อัตโนมัติ (api: openai-completions, contextWindow: 131072)
          <br />ไม่ต้องแก้ openclaw.json เพิ่ม ไม่ต้อง approve device
        </Paragraph>
      </div>

      <div>
        <SectionTitle>Troubleshooting Checklist</SectionTitle>
        <Paragraph>เช็คทีละข้อถ้าเชื่อมต่อไม่ได้:</Paragraph>
        <ul className="list-disc list-inside text-sm text-gray-400 space-y-2 ml-2">
          <li>Docker Desktop เปิดอยู่ไหม? (ไอคอนวาฬสีเขียว)</li>
          <li>BCProxyAI Docker รันอยู่ไหม? (<code className="text-indigo-300">docker compose up -d</code>)</li>
          <li>เปิด <code className="text-indigo-300">http://localhost:3333</code> ได้ไหม? (ต้องเห็น Dashboard)</li>
          <li>Worker สแกนเสร็จไหม? มีโมเดลพร้อมใช้ไหม? (ดูจาก Dashboard)</li>
          <li><code className="text-indigo-300">openclaw onboard</code> เสร็จเรียบร้อยไหม?</li>
          <li><code className="text-indigo-300">api</code> เป็น <code className="text-amber-300">&quot;openai-completions&quot;</code> ไหม? (ดูใน openclaw.json ส่วน models.providers)</li>
          <li><code className="text-indigo-300">contextWindow</code> เป็น <code className="text-amber-300">131072</code> ไหม? (ดูใน models.providers.*.models[0].contextWindow)</li>
          <li>ถ้า Docker: base URL เป็น <code className="text-indigo-300">host.docker.internal:3333</code> ไหม?</li>
          <li>ถ้า Docker: approve pairing แล้วไหม? (<code className="text-indigo-300">openclaw devices approve</code>)</li>
          <li>ถ้า Docker: gateway bind เป็น <code className="text-indigo-300">&quot;lan&quot;</code> + allowedOrigins ถูกต้องไหม?</li>
          <li>ทดสอบ: <code className="text-indigo-300">curl http://localhost:3333/v1/models</code> ตอบรายชื่อโมเดลกลับมาไหม?</li>
        </ul>
      </div>

      <div>
        <SectionTitle>Token Mismatch / Error 413</SectionTitle>
        <Paragraph>
          ถ้า OpenClaw ส่ง context ที่ใหญ่เกินกว่าโมเดลจะรับได้ (error 413 = payload too large):
        </Paragraph>
        <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 ml-2">
          <li>ตรวจสอบว่า <code className="text-indigo-300">contextWindow</code> ใน openclaw.json เป็น <code className="text-indigo-300">131072</code></li>
          <li>BCProxyAI จัดการอัตโนมัติ: cooldown โมเดลนั้น 15 นาที แล้ว fallback ไปตัวอื่น</li>
          <li>ระบบ smart selection จะพยายามเลือกโมเดลที่ context window พออยู่แล้ว</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Tab: การติดตั้ง ─────────────────────────────────────────────────────────

function InstallGuide() {
  return (
    <div className="space-y-6">
      <Warning>
        <strong>ติดตั้งบน Local (เครื่องตัวเอง) หรือ Network ภายในองค์กรเท่านั้น</strong>
        <br />ระบบนี้ไม่มี API Key Authentication -- ห้ามเปิดให้ภายนอก (Internet) เข้าถึง
      </Warning>

      <div>
        <SectionTitle>ติดตั้ง Docker Desktop (สำหรับมือใหม่)</SectionTitle>
        <Info>
          <strong>Docker คืออะไร?</strong> โปรแกรมที่ช่วยรันแอปพลิเคชันใน &quot;กล่อง&quot; (Container) แยกส่วนจากเครื่องของคุณ
          คิดง่ายๆ ว่าเป็น &quot;คอมจำลอง&quot; ที่รันโปรแกรมให้เราโดยไม่ต้องติดตั้งอะไรเพิ่มบนเครื่องจริง
        </Info>

        <Step num={1} title="ดาวน์โหลด Docker Desktop">
          <Paragraph>
            เปิดเบราว์เซอร์ไปที่ <code className="text-indigo-300">https://www.docker.com/products/docker-desktop/</code><br />
            กดปุ่ม &quot;Download for Windows&quot; (หรือ Mac) รอดาวน์โหลดเสร็จ (ประมาณ 500MB)
          </Paragraph>
        </Step>

        <Step num={2} title="ติดตั้ง">
          <Paragraph>
            ดับเบิลคลิกไฟล์ที่ดาวน์โหลดมา ถ้าถูกถาม &quot;Use WSL 2&quot; ให้ติ๊กเลือก (เร็วกว่า)
            กด Ok แล้วรอติดตั้ง (2-5 นาที) จากนั้นกด &quot;Close and restart&quot;
          </Paragraph>
        </Step>

        <Step num={3} title="เปิด Docker Desktop ครั้งแรก">
          <Paragraph>
            หลัง restart เปิด Docker Desktop จาก Start Menu<br />
            รอจนเห็น <span className="text-emerald-300">&quot;Docker Desktop is running&quot;</span> (ไอคอนวาฬสีเขียว)<br />
            ถ้าเจอหน้า Sign in ให้กด Skip ได้ (ไม่ต้อง sign in)
          </Paragraph>
        </Step>

        <Paragraph>
          <strong className="text-white">หน้าตา Docker Desktop:</strong><br />
          <span className="text-gray-500">Containers</span> = กล่องที่กำลังรัน | <span className="text-gray-500">Images</span> = แม่พิมพ์ของกล่อง | <span className="text-gray-500">Volumes</span> = ที่เก็บข้อมูล
        </Paragraph>

        <Warning>
          Docker Desktop ต้องเปิดค้างไว้ตลอดเวลาที่จะใช้ BCProxyAI ถ้าปิด Docker = BCProxyAI จะหยุดทำงาน
        </Warning>
      </div>

      <div>
        <SectionTitle>ติดตั้ง BCProxyAI บน Docker</SectionTitle>
        <Info>
          <strong>Terminal คืออะไร?</strong> หน้าต่างสำหรับพิมพ์คำสั่ง เปิดได้โดยกด <code className="text-blue-200">Win + R</code> พิมพ์ <code className="text-blue-200">cmd</code> แล้วกด Enter
          หรือค้นหา &quot;Terminal&quot; จาก Start Menu
        </Info>

        <Step num={1} title="Clone โปรเจค">
          <Paragraph>เปิด Terminal แล้วพิมพ์:</Paragraph>
          <Code>{`git clone <repository-url> bcproxyai
cd bcproxyai`}</Code>
          <Expected>{`Cloning into 'bcproxyai'...\nremote: Enumerating objects: ...\nReceiving objects: 100% ...`}</Expected>
        </Step>

        <Step num={2} title="สร้างไฟล์ .env.local">
          <Code>{`cp .env.example .env.local`}</Code>
          <Paragraph>
            จากนั้นเปิดไฟล์ <code className="text-indigo-300">.env.local</code> ด้วย text editor (เช่น Notepad) แล้วใส่ API Key:
          </Paragraph>
          <Code>{`# จำเป็น -- สมัครฟรีที่ https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-xxxx

# จำเป็น -- สมัครฟรีที่ https://console.groq.com/keys
GROQ_API_KEY=gsk_xxxx

# ไม่บังคับ
KILO_API_KEY=
GOOGLE_AI_API_KEY=`}</Code>
        </Step>

        <Step num={3} title="Build (สร้างกล่อง)">
          <Code>{`docker compose build`}</Code>
          <Paragraph>รอจนเสร็จ (ครั้งแรก 3-10 นาที) ถ้าเจอ error ตรวจว่า Docker Desktop เปิดอยู่</Paragraph>
          <Expected>{`[+] Building ...\n=> exporting to image`}</Expected>
        </Step>

        <Step num={4} title="Start (เริ่มรัน)">
          <Code>{`docker compose up -d`}</Code>
          <Paragraph>
            <code className="text-gray-500">-d</code> = รันเบื้องหลัง (detached) -- Terminal จะกลับมาให้พิมพ์คำสั่งอื่นได้
          </Paragraph>
          <Expected>{`[+] Running 1/1\n  Container bcproxyai-bcproxyai-1  Started`}</Expected>
        </Step>

        <Step num={5} title="เปิด Dashboard ดู">
          <Paragraph>
            เปิดเบราว์เซอร์ พิมพ์ <code className="text-indigo-300">http://localhost:3333</code> แล้วกด Enter<br />
            จะเห็น Dashboard ของ BCProxyAI -- Worker จะเริ่มสแกนโมเดลอัตโนมัติทันที
          </Paragraph>
        </Step>
      </div>

      <div>
        <SectionTitle>ติดตั้งแบบ Manual (ไม่ใช้ Docker)</SectionTitle>
        <Paragraph>ต้องมี Node.js 20+ ติดตั้งบนเครื่อง:</Paragraph>
        <Code>{`npm ci              # ติดตั้ง dependencies
npm run build       # Build โปรเจค
npm start           # เริ่มรัน`}</Code>
        <Paragraph>
          เข้าใช้งานที่ <code className="text-indigo-300">http://localhost:3000</code> (พอร์ต 3000 ไม่ใช่ 3333)
        </Paragraph>
      </div>

      <div>
        <SectionTitle>วิธีสมัคร API Key (ฟรี)</SectionTitle>
        <table className="w-full">
          <tbody>
            <TableRow label="OpenRouter" value="https://openrouter.ai/keys -- จำเป็น สมัครฟรี มีโมเดลฟรีมากที่สุด" />
            <TableRow label="Groq" value="https://console.groq.com/keys -- จำเป็น สมัครฟรี เร็วมาก" />
            <TableRow label="Kilo AI" value="https://kilo.ai -- ไม่บังคับ ไม่ต้องใช้ key ก็สแกนได้" />
            <TableRow label="Google AI" value="https://aistudio.google.com/apikey -- ไม่บังคับ สมัครฟรี" />
          </tbody>
        </table>
        <SubTitle>ตัวอย่างวิธีสมัคร OpenRouter</SubTitle>
        <ul className="list-decimal list-inside text-sm text-gray-400 space-y-1 ml-2">
          <li>เปิด https://openrouter.ai/keys</li>
          <li>กด &quot;Create Account&quot; หรือ Sign in ด้วย Google</li>
          <li>กด &quot;Create Key&quot;</li>
          <li>Copy key (ขึ้นต้นด้วย <code className="text-indigo-300">sk-or-v1-</code>)</li>
          <li>วางใน <code className="text-indigo-300">.env.local</code> ที่บรรทัด <code className="text-indigo-300">OPENROUTER_API_KEY=</code></li>
        </ul>
      </div>

      <div>
        <SectionTitle>Reset ข้อมูลทั้งหมด (เริ่มใหม่)</SectionTitle>
        <Code>{`docker compose down                              # หยุด container
docker volume rm bcproxyai_bcproxyai-data         # ลบ database
docker compose up -d                              # เริ่มใหม่`}</Code>
      </div>
    </div>
  );
}

// ─── Tab: API Reference ──────────────────────────────────────────────────────

function ApiGuide() {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Gateway (OpenAI Compatible)</SectionTitle>
        <Paragraph>BCProxyAI ใช้ API format เดียวกับ OpenAI 100% -- โปรแกรมที่ใช้ OpenAI API ได้อยู่แล้ว สามารถชี้มาที่ BCProxyAI ได้เลย</Paragraph>
        <table className="w-full mb-4">
          <thead>
            <tr className="border-b border-white/10 text-xs text-gray-500">
              <th className="py-2 text-left">Method</th>
              <th className="py-2 text-left">Path</th>
              <th className="py-2 text-left">คำอธิบาย</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/5">
              <td className="py-2 text-sm text-emerald-300 font-mono">POST</td>
              <td className="py-2 text-sm text-indigo-300 font-mono">/v1/chat/completions</td>
              <td className="py-2 text-sm text-gray-400">ส่งข้อความแชท (รองรับ stream)</td>
            </tr>
            <tr className="border-b border-white/5">
              <td className="py-2 text-sm text-blue-300 font-mono">GET</td>
              <td className="py-2 text-sm text-indigo-300 font-mono">/v1/models</td>
              <td className="py-2 text-sm text-gray-400">รายชื่อโมเดลทั้งหมด + สถานะ</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <SubTitle>ตัวอย่าง: ส่งข้อความ (ไม่ stream)</SubTitle>
        <Code>{`curl -X POST http://localhost:3333/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}],
    "stream": false
  }'`}</Code>
      </div>

      <div>
        <SubTitle>ตัวอย่าง: Stream (ตอบทีละคำ)</SubTitle>
        <Code>{`curl -X POST http://localhost:3333/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "สวัสดีครับ"}],
    "stream": true
  }'`}</Code>
      </div>

      <div>
        <SubTitle>ตัวอย่าง: ใช้ Tool Calling</SubTitle>
        <Code>{`curl -X POST http://localhost:3333/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "bcproxy/tools",
    "messages": [{"role": "user", "content": "วันนี้อากาศเป็นยังไง"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather",
        "parameters": {"type": "object", "properties": {}}
      }
    }]
  }'`}</Code>
      </div>

      <div>
        <SubTitle>ตัวอย่าง: ส่งรูปภาพ (Vision)</SubTitle>
        <Code>{`curl -X POST http://localhost:3333/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "อธิบายรูปนี้"},
        {"type": "image_url", "image_url": {"url": "https://..."}}
      ]
    }]
  }'`}</Code>
      </div>

      <div>
        <SectionTitle>Response Headers พิเศษ</SectionTitle>
        <table className="w-full">
          <tbody>
            <TableRow label="X-BCProxy-Model" value="โมเดลที่ถูกเลือกใช้จริง" />
            <TableRow label="X-BCProxy-Provider" value="ผู้ให้บริการ (openrouter/kilo/groq)" />
          </tbody>
        </table>
      </div>

      <div>
        <SectionTitle>Dashboard API</SectionTitle>
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 text-xs text-gray-500">
              <th className="py-2 text-left">Method</th>
              <th className="py-2 text-left">Path</th>
              <th className="py-2 text-left">คำอธิบาย</th>
            </tr>
          </thead>
          <tbody>
            {[
              { method: "GET", path: "/api/status", desc: "สถานะ worker + สถิติ + โมเดลใหม่/หายไป" },
              { method: "GET", path: "/api/models", desc: "โมเดลทั้งหมด + health + benchmark" },
              { method: "GET", path: "/api/leaderboard", desc: "อันดับโมเดลตามคะแนน" },
              { method: "GET", path: "/api/worker", desc: "สถานะ worker" },
              { method: "POST", path: "/api/worker", desc: "สั่ง worker รันทันที" },
              { method: "POST", path: "/api/chat", desc: "Chat API สำหรับ Dashboard" },
            ].map((r) => (
              <tr key={r.path + r.method} className="border-b border-white/5">
                <td className="py-2 text-sm font-mono" style={{ color: r.method === "POST" ? "#6ee7b7" : "#93c5fd" }}>{r.method}</td>
                <td className="py-2 text-sm text-indigo-300 font-mono">{r.path}</td>
                <td className="py-2 text-sm text-gray-400">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: ระบบ Benchmark ─────────────────────────────────────────────────────

function AboutGuide() {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>ระบบ Benchmark ทำงานอย่างไร?</SectionTitle>
        <Paragraph>
          BCProxyAI มีระบบสอบวัดผลโมเดล AI อัตโนมัติ เพื่อคัดเฉพาะโมเดลที่ตอบภาษาไทยได้ดี
          ใช้ระบบ <span className="text-indigo-300 font-medium">&quot;ให้ AI ตรวจข้อสอบ AI&quot;</span> -- โมเดลหนึ่งตอบคำถาม
          อีกโมเดลหนึ่งเป็นคุณครูตรวจให้คะแนน
        </Paragraph>
      </div>

      <div className="glass rounded-xl p-5 border border-indigo-500/20">
        <div className="text-center mb-4">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">ขั้นตอนการสอบ</div>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <div className="glass rounded-lg px-4 py-2 border border-blue-500/30">
              <div className="text-xs text-blue-300">นักเรียน</div>
              <div className="text-sm font-bold text-white">โมเดลที่ถูกสอบ</div>
            </div>
            <span className="text-gray-600">&rarr;</span>
            <div className="glass rounded-lg px-4 py-2 border border-amber-500/30">
              <div className="text-xs text-amber-300">ข้อสอบ</div>
              <div className="text-sm font-bold text-white">3 คำถามภาษาไทย</div>
            </div>
            <span className="text-gray-600">&rarr;</span>
            <div className="glass rounded-lg px-4 py-2 border border-emerald-500/30">
              <div className="text-xs text-emerald-300">คุณครู</div>
              <div className="text-sm font-bold text-white">AI Judge ให้คะแนน</div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <SectionTitle>ข้อสอบ (3 ข้อ)</SectionTitle>
        <div className="space-y-2">
          {[
            { q: "สวัสดีครับ วันนี้อากาศเป็นยังไงบ้าง?", purpose: "ทดสอบการทักทาย + ตอบคำถามทั่วไป" },
            { q: "แนะนำอาหารไทยมา 3 เมนู", purpose: "ทดสอบความรู้วัฒนธรรมไทย + การจัดรูปแบบคำตอบ" },
            { q: "กรุงเทพมหานครอยู่ประเทศอะไร?", purpose: "ทดสอบความรู้ทั่วไป + ตอบถูกต้อง" },
          ].map((item, i) => (
            <div key={i} className="glass rounded-lg p-3 border border-white/5">
              <div className="flex items-start gap-2">
                <span className="text-indigo-300 font-bold shrink-0">ข้อ {i + 1}.</span>
                <div>
                  <div className="text-sm text-white">&quot;{item.q}&quot;</div>
                  <div className="text-xs text-gray-500 mt-1">{item.purpose}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>คุณครูผู้ตรวจ (AI Judge)</SectionTitle>
        <Paragraph>
          ระบบใช้โมเดล AI ฟรีจาก OpenRouter เป็น &quot;คุณครู&quot; ตรวจคำตอบและให้คะแนน 0-10
          โดยเรียงลำดับความน่าเชื่อถือดังนี้ (ถ้าตัวแรกไม่ว่าง จะใช้ตัวถัดไป):
        </Paragraph>
        <div className="space-y-2">
          {[
            { name: "Qwen3 235B A22B", id: "qwen/qwen3-235b-a22b:free", desc: "โมเดลใหญ่ที่สุด น่าเชื่อถือที่สุด", rank: 1 },
            { name: "Llama 4 Scout", id: "meta-llama/llama-4-scout:free", desc: "โมเดลสำรองลำดับที่ 2", rank: 2 },
            { name: "Gemma 3 27B", id: "google/gemma-3-27b-it:free", desc: "โมเดลสำรองลำดับที่ 3", rank: 3 },
          ].map((judge) => (
            <div key={judge.id} className="flex items-center gap-3 glass rounded-lg p-3 border border-white/5">
              <div className="h-8 w-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-emerald-300">#{judge.rank}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white">{judge.name}</div>
                <div className="text-xs text-gray-500 truncate">{judge.id}</div>
                <div className="text-xs text-gray-600">{judge.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <Paragraph>
          ถ้าไม่มีคุณครูว่างเลย (ทั้ง 3 ตัวติด limit) ระบบจะใช้
          <span className="text-amber-300"> Heuristic Score</span> แทน -- ถ้าคำตอบยาวกว่า 10 ตัวอักษร ให้ 5/10
        </Paragraph>
      </div>

      <div>
        <SectionTitle>เกณฑ์การให้คะแนน</SectionTitle>
        <Paragraph>คุณครูจะให้คะแนน 0-10 พร้อมเหตุผลสั้นๆ:</Paragraph>
        <table className="w-full">
          <tbody>
            <TableRow label="8-10 คะแนน" value="ตอบถูกต้อง เป็นธรรมชาติ ภาษาไทยดี" />
            <TableRow label="5-7 คะแนน" value="ตอบได้ แต่อาจมีบางจุดไม่สมบูรณ์" />
            <TableRow label="3-4 คะแนน" value="ตอบได้บ้าง แต่คุณภาพต่ำ" />
            <TableRow label="0-2 คะแนน" value="ตอบผิด ตอบไม่เป็นภาษาไทย หรือไม่ตอบ" />
          </tbody>
        </table>
      </div>

      <div>
        <SectionTitle>กฎการสอบ</SectionTitle>
        <ul className="list-disc list-inside text-sm text-gray-400 space-y-2 ml-2">
          <li><span className="text-emerald-300">สอบผ่าน</span> = คะแนนเฉลี่ย &ge; 5/10 -- โมเดลพร้อมใช้งาน</li>
          <li><span className="text-red-300">สอบตก</span> = คะแนนเฉลี่ย &lt; 3/10 -- ไม่สอบซ้ำภายใน 7 วัน</li>
          <li>สอบครบ 3 ข้อแล้ว จะไม่สอบซ้ำอีก (ประหยัด token)</li>
          <li>สอบสูงสุด 3 โมเดลต่อรอบ (ทุก 1 ชม.)</li>
          <li>เฉพาะโมเดลที่ผ่าน Health Check แล้วเท่านั้นจึงจะถูกสอบ</li>
        </ul>
      </div>

      <div>
        <SectionTitle>ปรับแต่งได้</SectionTitle>
        <Paragraph>
          แก้ไขไฟล์ <code className="text-indigo-300">src/lib/worker/benchmark.ts</code>:
        </Paragraph>
        <ul className="list-disc list-inside text-sm text-gray-400 space-y-1 ml-2">
          <li><code className="text-indigo-300">QUESTIONS</code> -- เปลี่ยนคำถามข้อสอบ</li>
          <li><code className="text-indigo-300">JUDGE_MODELS</code> -- เปลี่ยนคุณครูผู้ตรวจ</li>
          <li><code className="text-indigo-300">MAX_MODELS_PER_RUN</code> -- จำนวนโมเดลที่สอบต่อรอบ</li>
          <li><code className="text-indigo-300">FAIL_SCORE_THRESHOLD</code> -- เกณฑ์สอบตก (ปัจจุบัน 3/10)</li>
          <li><code className="text-indigo-300">RETEST_DAYS</code> -- สอบซ้ำได้หลังกี่วัน (ปัจจุบัน 7 วัน)</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Main Modal ──────────────────────────────────────────────────────────────

export function GuideModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<TabId>("usage");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] glass-bright rounded-2xl border border-indigo-500/20 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-gray-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">คู่มือ BCProxyAI</h2>
              <p className="text-xs text-gray-500">Smart AI Gateway -- คู่มือแบบจับมือทำ</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 py-2 border-b border-white/5 bg-gray-900/30 shrink-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "usage" && <UsageGuide />}
          {activeTab === "openclaw" && <OpenClawGuide />}
          {activeTab === "install" && <InstallGuide />}
          {activeTab === "api" && <ApiGuide />}
          {activeTab === "about" && <AboutGuide />}
        </div>
      </div>
    </div>
  );
}
