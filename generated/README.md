# Generated Code Sandbox

ไฟล์ในโฟลเดอร์นี้ทั้งหมดถูกสร้างขึ้นโดย AI / worker ของระบบอัตโนมัติ
ไม่ได้มาจาก human commits โดยตรง

## โครงสร้าง

```
generated/
├── scripts/    — TypeScript/JavaScript analysis + optimization scripts
├── queries/    — Ad-hoc SQL queries derived from production signals
├── reports/    — JSON/Markdown analysis outputs
└── patches/    — Proposed core changes (human-reviewed, not auto-applied)
```

## กฎ

1. **ห้าม edit ไฟล์ใน `src/`, `docker-compose.yml`, `package.json`, `migrate.ts`** — AI สร้าง code ที่นี่เท่านั้น
2. **ทุกไฟล์ timestamp-named** — เช่น `2026-04-10T14-30-00-analyze-tpm-bottleneck.ts`
3. **ทุกไฟล์ต้อง log ใน `codegen_log` table** — เพื่อดูในหน้า dashboard
4. **Generated code imports จาก src/ ได้** — แต่ห้าม export กลับ หรือ mutate อะไรใน src/
5. **Patches เป็น proposal เท่านั้น** — ไม่ apply อัตโนมัติ ต้องมี human review

## ตัวอย่าง use case

- Worker วิเคราะห์ว่า Groq TPM exhausted บ่อย → สร้าง `generated/scripts/2026-04-10T14-30-00-analyze-groq-tpm.ts`
- ระบบค้นพบว่า Mistral latency สูงมากหลังเที่ยงคืน → สร้าง `generated/reports/2026-04-10T00-15-00-mistral-latency-spike.json`
- Self-healing: บาง category มี loss_streak สูง → สร้าง `generated/queries/2026-04-10T14-30-00-find-healthy-alternatives.sql`

## การรัน generated scripts

```bash
npx tsx generated/scripts/2026-04-10T14-30-00-analyze-tpm.ts
```

Scripts ทำงานแบบ read-only ต่อ DB (INSERT เฉพาะ `codegen_log` และ `generated/reports/*.json`)
