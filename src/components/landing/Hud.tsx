"use client";

// Landing HUD pieces on top of the galaxy: top bar (status, mode, camera, CTA), live ticker, restore button.
// Containers are pointer-events-none so dragging the galaxy works everywhere; only controls opt back in.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LinkButton } from "@/components/ui/ui";
import type { PulseData, PulseEvent } from "@/lib/pulse-types";
import type { DirectorMode } from "./types";
import { StarDot, ago, secs, starName, useNow } from "./windows/shared";
import type { WinCtx } from "./windows/shared";

export type Mode = "view" | "control";

const delay = (ms: number) => ({ "--d": ms }) as CSSProperties;

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300";
const GLASS = "border border-white/10 bg-[rgba(9,11,20,0.62)] backdrop-blur-xl";

const STATUS_VIEW = {
  ok: { label: "ระบบออนไลน์", tone: "text-emerald-300" },
  degraded: { label: "ทำงานบางส่วน", tone: "text-amber-300" },
  down: { label: "ระบบขัดข้อง", tone: "text-rose-300" },
  offline: { label: "ขาดการเชื่อมต่อ", tone: "text-gray-400" },
  loading: { label: "กำลังตรวจสอบ…", tone: "text-gray-400" },
} as const;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const IconEyeOff = () => <Svg><path d="M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 8.5 4.2 9.5 6a12 12 0 0 1-2.6 3.2M6.6 7.6A12.3 12.3 0 0 0 2.5 12C3.5 13.8 7 18 12 18c1.5 0 2.8-.4 4-1M9.9 10a3 3 0 0 0 4.1 4.1" /></Svg>;
const IconExpand = () => <Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>;
const IconTarget = () => <Svg><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /></Svg>;
const IconCamera = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></Svg>;

function IconBtn({ label, onClick, children, className = "" }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`pointer-events-auto grid h-9 w-9 place-items-center rounded-full text-gray-300 transition-colors hover:bg-white/10 hover:text-white ${GLASS} ${FOCUS} ${className}`}>
      {children}
    </button>
  );
}

interface TopBarProps {
  data: PulseData | null;
  online: boolean;
  owner: boolean;
  mode: Mode;
  onMode: (m: Mode) => void;
  director: DirectorMode;
  onDirector: () => void;
  onReset: () => void;
  /** CSS-only fallback: replaces the camera controls (they would do nothing) */
  notice?: string | null;
  onHide: () => void;
  onFullscreen: () => void;
}

export function TopBar({ data, online, owner, mode, onMode, director, onDirector, onReset, notice, onHide, onFullscreen }: TopBarProps) {
  const view = STATUS_VIEW[!data ? "loading" : !online ? "offline" : data.status];
  const s = data?.stats;
  return (
    <header className="px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="lp-rise flex min-w-0 items-center gap-3" style={delay(0)}>
          <Link href="/" aria-label="BCAiRouter หน้าแรก" className={`pointer-events-auto flex items-center gap-2.5 rounded-xl ${FOCUS}`}>
            <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 text-[13px] font-black text-white shadow-[0_8px_30px_-8px_rgba(139,123,255,0.95)]">
              BC
              <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/30" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-white">BCAiRouter</span>
          </Link>
          <span role="status" className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${GLASS}`}>
            <span className={`pulse-dot h-2 w-2 shrink-0 rounded-full bg-current ${view.tone}`} />
            <span className={`text-[12px] font-medium ${view.tone}`}>{view.label}</span>
            {s && online && <span className="hidden text-[11.5px] tabular-nums text-gray-400 sm:inline">{s.providersUp}/{s.providersTotal}</span>}
          </span>
        </div>

        <div className="lp-rise order-last flex w-full items-center gap-2 overflow-x-auto lg:order-none lg:w-auto lg:overflow-visible" style={delay(120)}>
          <div role="group" aria-label="โหมดการแสดงผล" className={`flex shrink-0 rounded-full p-0.5 ${GLASS}`}>
            {([["view", "ชม"], ["control", "ศูนย์ควบคุม"]] as const).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => onMode(m)}
                className={`pointer-events-auto rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${FOCUS} ${mode === m ? "bg-violet-400/25 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {notice ? (
            <span role="status" className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[12px] text-gray-300 ${GLASS}`}>
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/80" />
              {notice}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={onDirector}
                aria-pressed={director === "auto"}
                title="สลับกล้องระหว่างอัตโนมัติ (ผู้กำกับ) กับควบคุมเอง"
                className={`pointer-events-auto flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[12px] font-medium text-gray-200 transition-colors hover:bg-white/10 ${GLASS} ${FOCUS}`}
              >
                <IconCamera />
                <span className="whitespace-nowrap">กล้อง: <b className={director === "auto" ? "text-cyan-300" : "text-amber-300"}>{director === "auto" ? "อัตโนมัติ" : "ควบคุมเอง"}</b></span>
              </button>
              <IconBtn label="รีเซ็ตมุมมอง" onClick={onReset}><IconTarget /></IconBtn>
            </>
          )}
          <IconBtn label="ซ่อน UI ทั้งหมด (H)" onClick={onHide}><IconEyeOff /></IconBtn>
          <IconBtn label="เต็มจอ (F)" onClick={onFullscreen} className="max-sm:hidden"><IconExpand /></IconBtn>
        </div>

        <div className="lp-rise flex items-center gap-2" style={delay(240)}>
          {data && (owner ? (
            <LinkButton href="/overview" variant="primary" size="sm" className="pointer-events-auto">ไปแดชบอร์ด</LinkButton>
          ) : (
            <LinkButton href="/login" variant="primary" size="sm" className="pointer-events-auto">
              <span className="lg:hidden">เข้าสู่ระบบ</span>
              <span className="hidden lg:inline xl:hidden">เข้าสู่ระบบด้วย Google</span>
              <span className="hidden xl:inline">เข้าสู่ระบบด้วย Google (เจ้าของระบบ)</span>
            </LinkButton>
          ))}
        </div>
      </div>
      {/* in control mode on desktop the windows start right under the bar: the login button already says it is owner-only */}
      {data && !owner && (
        <p className={`lp-rise mt-2 max-w-[44rem] text-[12px] leading-relaxed text-gray-400 [text-shadow:0_1px_12px_rgba(5,6,10,0.9)] ${mode === "control" ? "lg:hidden" : ""}`} style={delay(360)}>
          เกตเวย์ AI ส่วนตัวของเจ้าของระบบ — ชมการทำงานสดได้ แต่ใช้งานได้เฉพาะเจ้าของที่เข้าสู่ระบบ
        </p>
      )}
    </header>
  );
}

// ---------- live ticker (view mode) ----------

const TICK_ROWS = 4;

export function Ticker({ events, ctx, hint }: { events: PulseEvent[]; ctx: Pick<WinCtx, "owner" | "stars">; hint: boolean }) {
  const now = useNow();
  const rows = events.slice(-TICK_ROWS);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex items-end justify-between gap-3 sm:inset-x-5 sm:bottom-4">
      <ul className="flex min-w-0 flex-col gap-1.5" aria-label="คำขอล่าสุด">
        {rows.length === 0 && (
          <li className={`flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[12px] text-gray-400 ${GLASS}`}>
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current text-cyan-300" /> รอคำขอใหม่…
          </li>
        )}
        {rows.map((e, i) => (
          <li
            key={e.id}
            className={`lp-tick flex w-fit max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[12px] tabular-nums ${GLASS}`}
            style={{ opacity: 0.45 + (0.55 * (i + 1)) / rows.length }}
          >
            <StarDot id={e.star} />
            <span className="min-w-0 truncate font-medium text-white">
              {starName(ctx, e.star)}
              {ctx.owner && e.model ? <span className="font-normal text-gray-400"> · {e.model}</span> : null}
            </span>
            <span className={`shrink-0 font-semibold ${e.ok ? "text-emerald-300" : "text-rose-300"}`}>{e.ok ? "✓" : "✕"}</span>
            <span className="shrink-0 text-gray-400">{secs(e.latencyMs)}</span>
            <span className="hidden shrink-0 text-gray-500 sm:inline">{ago(e.t, now)}</span>
          </li>
        ))}
      </ul>
      {hint && <p aria-hidden className="hidden shrink-0 rounded-full px-3 py-1.5 text-[11.5px] text-gray-400 md:block [@media(pointer:coarse)]:hidden">
        ลากเพื่อหมุน · ชี้ดาวเพื่อดูข้อมูล · <kbd className="font-sans text-gray-300">H</kbd> ซ่อน UI
      </p>}
    </div>
  );
}

// ---------- restore (UI hidden) ----------

export function RestoreButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-10 flex items-center gap-2 sm:bottom-4 sm:right-5">
      <span aria-hidden className="lp-hint-fade text-[11.5px] text-gray-400">กด H เพื่อแสดงเมนูอีกครั้ง</span>
      <button
        type="button"
        onClick={onClick}
        aria-label="แสดง UI (H)"
        title="แสดง UI (H)"
        className={`grid h-9 w-9 place-items-center rounded-full text-gray-300 opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100 ${GLASS} ${FOCUS}`}
      >
        <IconEyeOff />
      </button>
    </div>
  );
}
