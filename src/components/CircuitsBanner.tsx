"use client";

import { useEffect, useState } from "react";
import { getAdminAccess } from "./admin-access";
import { Callout } from "./ui/ui";

interface CircuitEntry { provider: string; modelId: string; ttlSec: number; fails: number }
interface Circuits { totalOpen: number; totalHalfOpen: number; totalWarnings: number; open: CircuitEntry[] }

/** Owner-only warning when the circuit breaker has paused models; renders nothing when healthy. */
export function CircuitsBanner() {
  const [c, setC] = useState<Circuits | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // /api/admin/circuits is 401 for non-owners — skip the call entirely, as the old dashboard did
      if (!(await getAdminAccess())) return;
      try {
        const res = await fetch("/api/admin/circuits");
        const cb = res.ok ? await res.json() : null;
        if (!alive) return;
        setC(cb?.summary ? {
          totalOpen: cb.summary.totalOpen ?? 0,
          totalHalfOpen: cb.summary.totalHalfOpen ?? 0,
          totalWarnings: cb.summary.totalWarnings ?? 0,
          open: Array.isArray(cb.open) ? cb.open : [],
        } : null);
      } catch { /* keep last value */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!c || (c.totalOpen === 0 && c.totalHalfOpen === 0)) return null;

  return (
    <Callout
      tone="warning"
      title={
        <>
          ระบบพักการใช้โมเดลชั่วคราว (circuit open) {c.totalOpen} ตัว
          {c.totalHalfOpen > 0 && <span className="font-normal"> · กำลังลองใหม่ {c.totalHalfOpen} ตัว</span>}
          {c.totalWarnings > 0 && <span className="font-normal"> · ใกล้ถูกพัก {c.totalWarnings} ตัว</span>}
        </>
      }
    >
      <p>โมเดลเหล่านี้ล้มเหลวติดกันหลายครั้ง ระบบจึงหยุดส่งคำขอไปชั่วคราวและจะลองใหม่เองเมื่อครบเวลา ไม่ต้องทำอะไร เว้นแต่เป็นนานผิดปกติ</p>
      {c.open.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-[12px] [overflow-wrap:anywhere]">
          {c.open.slice(0, 5).map((e) => (
            <li key={`${e.provider}/${e.modelId}`}>
              {e.provider}/{e.modelId} — ล้มเหลว {e.fails} ครั้ง · ลองใหม่ใน {e.ttlSec} วิ
            </li>
          ))}
          {c.open.length > 5 && <li className="opacity-70">+ อีก {c.open.length - 5} ตัว</li>}
        </ul>
      )}
      <a
        href="/api/admin/circuits"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block font-medium text-white underline underline-offset-2"
      >
        ดูข้อมูลทั้งหมด (JSON) ↗
      </a>
    </Callout>
  );
}
