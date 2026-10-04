"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChatPanel } from "../../../components/ChatPanel";
import { ReplayPanel } from "../../../components/ReplayPanel";
import type { ModelData } from "../../../components/shared";
import { IconChat, IconCube } from "../../../components/ui/icons";
import { Callout, Card, EmptyState, LinkButton, PageHeader, Reveal, SectionTitle } from "../../../components/ui/ui";

const STEPS = [
  { title: "เลือกโมเดล", text: "เลือกจากรายการที่พร้อมใช้ตอนนี้ (อยากให้ระบบเลือกให้เอง ใช้ bcai/auto ผ่าน API)" },
  { title: "พิมพ์ข้อความ", text: "ถามอะไรก็ได้ หรือกดตัวอย่างคำถามเพื่อเริ่มเร็วขึ้น" },
  { title: "ดูผลและโมเดลที่ตอบ", text: "ใต้คำตอบจะบอกว่าโมเดลไหนตอบ และใช้เวลาเท่าไร" },
];

const STARTER_PROMPTS = [
  "อธิบาย API key ให้คนที่ไม่เคยเขียนโค้ดเข้าใจ",
  "สรุปเรื่อง AI ให้สั้นเหลือ 3 ข้อ",
  "เขียนฟังก์ชัน JavaScript หาเลขคู่ในอาร์เรย์",
  "แปลเป็นอังกฤษ: สวัสดีครับ ยินดีที่ได้รู้จัก",
];

export default function PlaygroundPage() {
  const [models, setModels] = useState<ModelData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/models");
        const json: unknown = await res.json();
        setModels(Array.isArray(json) ? (json as ModelData[]) : []);
      } catch {
        // keep last known list; the empty state explains what to do
      } finally {
        setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  // id = "provider:model_id", unique per provider+model
  const availableModels = useMemo(() => {
    const seen = new Set<string>();
    return models.filter((m) => {
      if (m.health.status !== "available" || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [models]);

  return (
    <>
      <Reveal i={0}>
        <PageHeader
          eyebrow="ทดลองแชท"
          title="ทดลองคุยกับ AI"
          description="ลองคุยกับ AI แล้วดูว่าระบบเลือกโมเดลไหน ใช้เวลาเท่าไร"
          actions={
            <LinkButton href="/models">
              <IconCube size={16} /> ดูอันดับโมเดล
            </LinkButton>
          }
        />
      </Reveal>

      <Reveal i={1}>
        <ol className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="ขั้นตอนการทดลองแชท">
          {STEPS.map((s, idx) => (
            <li key={s.title} className="card flex gap-3 p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-[13px] font-semibold tabular-nums text-violet-100 ring-1 ring-white/10">
                {idx + 1}
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-white">{s.title}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal i={2}>
        {loading ? (
          <Card className="p-5" aria-busy="true">
            <div className="skeleton mb-4 h-11 w-full" />
            <div className="skeleton h-[280px] w-full" />
          </Card>
        ) : availableModels.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconChat size={24} />}
              title="ยังไม่มีโมเดลที่พร้อมใช้งาน"
              description={
                models.length > 0
                  ? "โมเดลทั้งหมดกำลังพักอยู่ (cooldown) ลองใหม่อีกครู่ หรือเพิ่ม API key ของผู้ให้บริการเพิ่ม"
                  : "เพิ่ม API key ของผู้ให้บริการอย่างน้อย 1 ราย ระบบจะตรวจสอบโมเดลให้อัตโนมัติ แล้วกลับมาลองแชทได้ที่นี่"
              }
              action={<LinkButton href="/setup" variant="primary">ไปตั้งค่า API key</LinkButton>}
            />
          </Card>
        ) : (
          <ChatPanel availableModels={availableModels} suggestions={STARTER_PROMPTS} />
        )}
      </Reveal>

      <Reveal i={3}>
        <div className="mt-4">
          <Callout title="เคล็ดลับ">
            หน้านี้เลือกโมเดลเองทีละตัวเพื่อทดสอบ ส่วนแอปของคุณสามารถส่ง <code className="font-mono text-[12px] text-cyan-200">bcai/auto</code> ให้ระบบเลือกโมเดลที่เหมาะที่สุดให้อัตโนมัติ — ดูวิธีเชื่อมต่อที่{" "}
            <Link href="/guide" className="font-medium text-white underline underline-offset-2 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50">
              คู่มือ
            </Link>
          </Callout>
        </div>
      </Reveal>

      <Reveal i={4}>
        <SectionTitle
          title="ทดสอบซ้ำ (Replay)"
          description="เอา request เดิมมายิงซ้ำกับโมเดลอื่น เพื่อเทียบคำตอบและความเร็ว — เหมาะตอนตรวจว่าโมเดลไหนคุ้มกว่า"
        />
        <ReplayPanel />
      </Reveal>
    </>
  );
}
