"use client";

// First-visit guided tour: spotlights elements marked with data-tour="<id>".
// Re-open anytime via window.dispatchEvent(new Event("bcai:tour")).
import { useCallback, useEffect, useState } from "react";
import { IconArrowRight, IconX } from "./icons";

export interface TourStep {
  target: string; // data-tour value
  title: string;
  body: string;
}

const STORAGE_KEY = "bcai.tour.v1.done";

export const TOUR_STEPS: TourStep[] = [
  { target: "nav-home", title: "ยินดีต้อนรับสู่ BCAiRouter", body: "หน้าภาพรวมมีเช็กลิสต์เริ่มต้นใช้งาน ทำตามทีละขั้นได้เลย ระบบจะติ๊กให้เองเมื่อทำเสร็จ" },
  { target: "nav-setup", title: "1. ใส่ API key", body: "เริ่มจากใส่ key ฟรีของผู้ให้บริการอย่างน้อย 1 เจ้า ระบบจะค้นหาและสอบโมเดลให้อัตโนมัติ" },
  { target: "nav-playground", title: "2. ทดลองแชท", body: "ลองคุยกับ AI เพื่อดูว่าระบบเลือกโมเดลไหนตอบ และใช้เวลาเท่าไร" },
  { target: "nav-monitor", title: "3. ติดตามการทำงาน", body: "ดูคำขอทุกรายการ ความเร็ว อัตราสำเร็จ และสถานะผู้ให้บริการแบบเรียลไทม์" },
  { target: "nav-guide", title: "ต้องการความช่วยเหลือ?", body: "คู่มือมีตัวอย่างโค้ดสำหรับเชื่อมแอปของคุณ กดปุ่ม \"ทัวร์แนะนำ\" เพื่อดูทัวร์นี้อีกครั้ง" },
];

type Rect = { top: number; left: number; width: number; height: number };

export function Tour({ steps = TOUR_STEPS }: { steps?: TourStep[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const finish = useCallback(() => {
    setIndex(null);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* ignore */ }
    const t = seen ? undefined : setTimeout(() => setIndex(0), 900);
    const reopen = () => setIndex(0);
    window.addEventListener("bcai:tour", reopen);
    return () => { if (t) clearTimeout(t); window.removeEventListener("bcai:tour", reopen); };
  }, []);

  const measure = useCallback(() => {
    if (index === null) return;
    // Pick the first visible match (sidebar on desktop, drawer on mobile).
    const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${steps[index].target}"]`));
    const el = els.find((e) => e.getClientRects().length > 0 && e.offsetParent !== null);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [index, steps]);

  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [measure]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : Math.min(steps.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, finish]);

  if (index === null) return null;
  const step = steps[index];
  const last = index === steps.length - 1;
  const pad = 6;

  // Popover sits right of the target on wide screens, below it otherwise.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const popW = Math.min(340, vw - 24);
  let popStyle: React.CSSProperties = { left: (vw - popW) / 2, top: 96, width: popW };
  if (rect) {
    const right = rect.left + rect.width + 16;
    popStyle = right + popW < vw
      ? { left: right, top: Math.max(12, rect.top - 8), width: popW }
      : { left: Math.max(12, Math.min(rect.left, vw - popW - 12)), top: rect.top + rect.height + 14, width: popW };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal aria-label="ทัวร์แนะนำการใช้งาน">
      {/* dim layer with a spotlight hole */}
      <div
        className="absolute transition-all duration-500"
        style={rect ? {
          top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
          borderRadius: 14, boxShadow: "0 0 0 9999px rgba(3,4,8,0.72), 0 0 0 2px rgba(139,123,255,0.9), 0 0 30px 4px rgba(139,123,255,0.45)",
          transitionTimingFunction: "var(--ease-out)",
        } : { inset: 0, background: "rgba(3,4,8,0.72)" }}
        onClick={finish}
      />
      <div key={index} className="animate-page card absolute p-5" style={{ ...popStyle, background: "rgba(14,15,24,0.96)" }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-violet-300">
            ขั้นที่ {index + 1} / {steps.length}
          </span>
          <button onClick={finish} className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white" aria-label="ปิดทัวร์">
            <IconX size={16} />
          </button>
        </div>
        <div className="text-[16px] font-semibold text-white">{step.title}</div>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-300">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? "w-5 bg-violet-400" : "w-1.5 bg-white/20"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setIndex(index - 1)}>ย้อนกลับ</button>}
            <button className="btn btn-primary btn-sm" onClick={() => (last ? finish() : setIndex(index + 1))}>
              {last ? "เริ่มใช้งาน" : "ถัดไป"} {!last && <IconArrowRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function openTour() {
  window.dispatchEvent(new Event("bcai:tour"));
}
