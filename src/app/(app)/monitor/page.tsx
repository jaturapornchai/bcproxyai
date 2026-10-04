"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { getAdminAccess } from "@/components/admin-access";
import { Callout, LinkButton, PageHeader, Reveal, SectionTitle, Tabs } from "@/components/ui/ui";
import { IconBook, IconCompass, IconKey, IconPulse, IconServer } from "@/components/ui/icons";
import { AutopilotPanel } from "@/components/AutopilotPanel";
import { CircuitsBanner } from "@/components/CircuitsBanner";
import { CodegenPanel } from "@/components/CodegenPanel";
import { ComplaintPanel } from "@/components/ComplaintPanel";
import { ControlRoomPanel } from "@/components/ControlRoomPanel";
import { CostOptimizerPanel } from "@/components/CostOptimizerPanel";
import { DevSuggestionsPanel } from "@/components/DevSuggestionsPanel";
import { InfraPanel } from "@/components/InfraPanel";
import { PerfInsightsPanel } from "@/components/PerfInsightsPanel";
import { ProviderLimitsPanel } from "@/components/ProviderLimitsPanel";
import { RoutingExplainPanel } from "@/components/RoutingExplainPanel";
import { RoutingLearnPanel } from "@/components/RoutingLearnPanel";
import { SchoolBellPanel } from "@/components/SchoolBellPanel";
import { SemanticCachePanel } from "@/components/SemanticCachePanel";
import { TrendPanel } from "@/components/TrendPanel";
import { UptimePanel } from "@/components/UptimePanel";
import { CostSavings } from "./_parts/CostSavings";
import { GatewayLogs } from "./_parts/GatewayLogs";
import { LiveKpis } from "./_parts/LiveKpis";
import { WorkerLogs } from "./_parts/WorkerLogs";

type TabId = "requests" | "perf" | "routing" | "cost" | "system";

const TABS: Array<{ id: TabId; label: string; icon: ReactNode; hint: string; ownerParts: string }> = [
  {
    id: "requests",
    label: "คำขอล่าสุด",
    icon: <IconBook size={16} />,
    hint: "ดูว่าตอนนี้มีใครเรียกโมเดลอะไรผ่าน gateway ผลสำเร็จหรือไม่ และตอบเร็วแค่ไหน",
    ownerParts: "ตารางคำขอล่าสุด",
  },
  {
    id: "perf",
    label: "ประสิทธิภาพ",
    icon: <IconPulse size={16} />,
    hint: "ภาพรวมความเร็ว ความเสถียร และแนวโน้มของโมเดลและผู้ให้บริการ เพื่อดูว่าระบบเร็วขึ้นหรือช้าลง",
    ownerParts: "",
  },
  {
    id: "routing",
    label: "การเลือกโมเดล",
    icon: <IconCompass size={16} />,
    hint: "ระบบเลือกโมเดลให้แต่ละคำขออย่างไร เรียนรู้จากผลที่ผ่านมา และมีคำแนะนำอะไรให้ปรับ",
    ownerParts: "เหตุผลการเลือกโมเดล, Autopilot และ Control Room",
  },
  {
    id: "cost",
    label: "ค่าใช้จ่าย & โควตา",
    icon: <IconKey size={16} />,
    hint: "ใช้ token ไปเท่าไหร่ ประหยัดได้อีกแค่ไหน และโควตาของแต่ละผู้ให้บริการเหลือเท่าไหร่",
    ownerParts: "โควตาผู้ให้บริการและ semantic cache",
  },
  {
    id: "system",
    label: "ระบบ",
    icon: <IconServer size={16} />,
    hint: "สุขภาพของฐานข้อมูล แคช และเซิร์ฟเวอร์ พร้อมบันทึกการทำงานเบื้องหลัง ข้อร้องเรียน และคำแนะนำสำหรับนักพัฒนา",
    ownerParts: "โครงสร้างระบบ, บันทึก worker, ข้อร้องเรียน และคำแนะนำสำหรับ Dev",
  },
];

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

/** Active tab lives in the URL hash so a refresh or shared link lands on the same tab. */
function useHashTab(): [TabId, (id: TabId) => void] {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");
  const tab = TABS.find((t) => t.id === hash)?.id ?? "requests";
  const select = (id: TabId) => {
    window.history.replaceState(null, "", `#${id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  return [tab, select];
}

export default function MonitorPage() {
  const [tab, setTab] = useHashTab();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    getAdminAccess().then(setIsAdmin);
  }, []);

  const admin = isAdmin === true;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <>
      <PageHeader
        eyebrow="มอนิเตอร์"
        title="ดูสุขภาพของ gateway แบบเรียลไทม์"
        description="ติดตามคำขอ ความเร็ว การเลือกโมเดล ค่าใช้จ่าย และสถานะระบบในที่เดียว เลือกแท็บด้านล่างเพื่อดูแต่ละหัวข้อ"
        actions={<LinkButton href="/guide" size="sm"><IconBook size={14} /> คู่มือการใช้งาน</LinkButton>}
      />

      <Reveal i={1}>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <p className="mt-3 px-1 text-[13px] text-[var(--muted)]">{active.hint}</p>
      </Reveal>

      {isAdmin === false && (
        <div className="mt-4">
          <Callout tone="info" title="บางส่วนต้องเข้าสู่ระบบเจ้าของก่อนจึงจะเห็น">
            {active.ownerParts ? `ส่วนที่ซ่อนอยู่ในแท็บนี้: ${active.ownerParts}. ` : "แท็บอื่นยังมีข้อมูลเพิ่มเติมสำหรับเจ้าของระบบ. "}
            <Link href="/login" className="font-medium text-white underline underline-offset-2">เข้าสู่ระบบเจ้าของ</Link>
          </Callout>
        </div>
      )}

      <div key={tab} role="tabpanel" aria-label={active.label} className="mt-6 space-y-8">
        {tab === "requests" && (
          <>
            <Reveal i={0}><LiveKpis /></Reveal>
            {admin && <Reveal i={1}><GatewayLogs /></Reveal>}
          </>
        )}

        {tab === "perf" && (
          <>
            <CircuitsBanner />
            <Reveal i={0}><PerfInsightsPanel /></Reveal>
            <Reveal i={1}><TrendPanel /></Reveal>
            <Reveal i={2}><UptimePanel /></Reveal>
          </>
        )}

        {tab === "routing" && (
          <>
            {admin && <Reveal i={0}><RoutingExplainPanel /></Reveal>}
            <Reveal i={1}>
              <SectionTitle title="ระบบเรียนรู้ว่าโมเดลไหนเก่งเรื่องอะไร" description="สรุปจากผลคำขอ 7 วันล่าสุด ใช้เลือกโมเดลที่เหมาะกับแต่ละหมวดงานให้อัตโนมัติ" />
              <RoutingLearnPanel />
            </Reveal>
            {admin && <Reveal i={2}><AutopilotPanel /></Reveal>}
            {admin && <Reveal i={3}><ControlRoomPanel /></Reveal>}
          </>
        )}

        {tab === "cost" && (
          <>
            <Reveal i={0}><CostSavings /></Reveal>
            <Reveal i={1}><CostOptimizerPanel /></Reveal>
            {admin && <Reveal i={2}><ProviderLimitsPanel /></Reveal>}
            {admin && <Reveal i={3}><SemanticCachePanel /></Reveal>}
          </>
        )}

        {tab === "system" && (
          <>
            {admin && (
              <Reveal i={0}>
                <SectionTitle title="โครงสร้างระบบ" description="Postgres · Valkey · เซิร์ฟเวอร์ · การจำกัดคำขอ อัปเดตทุก 2 วินาที" />
                <InfraPanel />
              </Reveal>
            )}
            <Reveal i={1}><SchoolBellPanel /></Reveal>
            {admin && <Reveal i={2}><WorkerLogs /></Reveal>}
            {admin && <Reveal i={3}><ComplaintPanel /></Reveal>}
            <Reveal i={4}><CodegenPanel /></Reveal>
            {admin && <Reveal i={5}><DevSuggestionsPanel /></Reveal>}
          </>
        )}
      </div>
    </>
  );
}
