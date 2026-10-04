"use client";

import type { ReactNode } from "react";
import { IconChat, IconCompass, IconCube, IconLock, IconPlug, IconPulse, IconServer } from "@/components/ui/icons";
import { ChartWindow, DayWindow } from "./Chart";
import { CostWindow } from "./Cost";
import { ExamWindow } from "./Exam";
import { FeedWindow, RouterWindow } from "./Feed";
import { HealthWindow, ModelsWindow } from "./Fleet";
import { LimitsWindow, OpsWindow } from "./Ops";
import { AskWindow, ConnectWindow } from "./Owner";
import type { WinCtx } from "./shared";

export interface WinDef {
  id: string;
  title: string;
  /** dock chip / sheet tab label */
  short: string;
  icon: ReactNode;
  /** desktop width / preferred height in px */
  w: number;
  h: number;
  /** as the last window of its column, the default layout may stretch it into the leftover height up to this */
  grow?: number;
  /** default dock column on wide screens */
  col: "L" | "R";
  /** visitors may see it (owner always sees everything) */
  public: boolean;
  /** open on first visit when there is room */
  open: boolean;
  Body: (p: { ctx: WinCtx }) => ReactNode;
}

const ICON = 14;

// icons.tsx has no chart / hex / gauge / hourglass / clock glyphs
const glyph = (paths: ReactNode) => (
  <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths}
  </svg>
);
const IconBars = glyph(<path d="M5 20v-9M12 20V4M19 20v-6" />);
const IconHex = glyph(<><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z" /><path d="m12 8 4 2.3v3.4L12 16l-4-2.3v-3.4Z" /></>);
const IconGauge = glyph(<><path d="M4 16a8 8 0 1 1 16 0" /><path d="m12 16 4-5" /><path d="M4 20h16" /></>);
const IconHourglass = glyph(<><path d="M6 3h12M6 21h12" /><path d="M7 3v2a5 5 0 0 0 10 0V3M7 21v-2a5 5 0 0 1 10 0v2" /></>);
const IconClock = glyph(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);

// Array order = stacking order inside its column = sheet tab order. In R the sparse quota window sits below the 24 h chart,
// so on short screens it is the one squeezed to a title bar.
export const WINDOWS: WinDef[] = [
  { id: "feed", short: "กิจกรรม", title: "กิจกรรมสด", icon: <IconPulse size={ICON} />, w: 340, h: 280, col: "L", public: true, open: true, Body: FeedWindow },
  { id: "exam", short: "สนามสอบ", title: "สนามสอบ & รอบตรวจ", icon: IconHex, w: 340, h: 260, col: "L", public: true, open: true, Body: ExamWindow },
  { id: "ops", short: "ห้องเครื่อง", title: "ห้องเครื่อง", icon: IconGauge, w: 340, h: 280, grow: 448, col: "L", public: false, open: true, Body: OpsWindow },
  { id: "router", short: "Router", title: "การตัดสินใจของ Router", icon: <IconCompass size={ICON} />, w: 340, h: 256, col: "L", public: true, open: false, Body: RouterWindow },
  { id: "ask", short: "ถามเลย", title: "ถามเลย", icon: <IconChat size={ICON} />, w: 340, h: 330, col: "L", public: false, open: false, Body: AskWindow },
  { id: "connect", short: "เชื่อมต่อ", title: "เชื่อมต่อ", icon: <IconPlug size={ICON} />, w: 340, h: 380, col: "L", public: false, open: false, Body: ConnectWindow },
  { id: "health", short: "ผู้ให้บริการ", title: "สุขภาพผู้ให้บริการ", icon: <IconServer size={ICON} />, w: 340, h: 214, col: "R", public: true, open: true, Body: HealthWindow },
  { id: "day", short: "24 ชม.", title: "24 ชั่วโมงล่าสุด", icon: IconClock, w: 340, h: 196, col: "R", public: true, open: true, Body: DayWindow },
  { id: "limits", short: "โควตา", title: "โควตา & การพักโมเดล", icon: IconHourglass, w: 340, h: 240, col: "R", public: false, open: true, Body: LimitsWindow },
  { id: "chart", short: "กราฟ", title: "ปริมาณงาน & ความหน่วง", icon: IconBars, w: 340, h: 180, grow: 260, col: "R", public: true, open: true, Body: ChartWindow },
  { id: "cost", short: "ค่าใช้จ่าย", title: "ป้องกันค่าใช้จ่าย", icon: <IconLock size={ICON} />, w: 340, h: 182, col: "R", public: true, open: false, Body: CostWindow },
  { id: "models", short: "โมเดล", title: "โมเดลยอดนิยม", icon: <IconCube size={ICON} />, w: 340, h: 280, col: "R", public: false, open: false, Body: ModelsWindow },
];
