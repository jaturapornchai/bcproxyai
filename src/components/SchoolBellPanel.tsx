"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PROVIDER_COLORS, fmtTime } from "./shared";
import { Badge, Button, Card, CardHeader, EmptyState } from "./ui/ui";
import type { Tone } from "./ui/ui";

interface SystemEvent {
  id: number;
  type: string;
  title: string;
  detail: string | null;
  provider: string | null;
  model_id: string | null;
  severity: string;
  created_at: string;
}

const EVENT_META: Record<string, { label: string; tone: Tone; dot: string }> = {
  model_new:      { label: "โมเดลใหม่", tone: "success", dot: "bg-emerald-400" },
  model_banned:   { label: "โมเดลถูกแบน", tone: "danger", dot: "bg-rose-400" },
  complaint:      { label: "ข้อร้องเรียน", tone: "warning", dot: "bg-amber-400" },
  provider_error: { label: "ผู้ให้บริการขัดข้อง", tone: "danger", dot: "bg-rose-400" },
  provider_back:  { label: "ผู้ให้บริการกลับมา", tone: "success", dot: "bg-emerald-400" },
};
const FALLBACK_META = { label: "ประกาศ", tone: "neutral" as Tone, dot: "bg-gray-400" };

function IconBell({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function SchoolBellPanel() {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const lastIdRef = useRef<number>(0);
  const [bellRing, setBellRing] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const since = lastIdRef.current > 0
        ? new Date(Date.now() - 3600000).toISOString()
        : undefined;
      const url = since ? `/api/events?since=${encodeURIComponent(since)}` : "/api/events";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const fetched = data.events as SystemEvent[];
        if (fetched.length > 0) {
          const maxId = Math.max(...fetched.map(e => e.id));
          if (maxId > lastIdRef.current && lastIdRef.current > 0) {
            // New events arrived!
            const newEvents = fetched.filter(e => e.id > lastIdRef.current);
            setNewCount(prev => prev + newEvents.length);
            setBellRing(true);
            setTimeout(() => setBellRing(false), 2000);
          }
          lastIdRef.current = maxId;
        }
        setEvents(fetched);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEvents();
    const t = setInterval(fetchEvents, 5000); // Poll every 5s for real-time feel
    return () => clearInterval(t);
  }, [fetchEvents]);

  // Newest id currently shown — the last `newCount` ids are the unread ones.
  const latestId = events.reduce((m, e) => Math.max(m, e.id), 0);

  const shell = (body: ReactNode) => (
    <Card>
      <CardHeader
        icon={<IconBell className={bellRing ? "animate-bounce" : ""} />}
        title="การแจ้งเตือนระบบ"
        subtitle="เหตุการณ์สำคัญแบบเรียลไทม์ เช่น โมเดลใหม่ โมเดลถูกแบน ผู้ให้บริการขัดข้องหรือกลับมาใช้ได้ — อัปเดตทุก 5 วินาที"
        action={
          <div className="flex items-center gap-2">
            {newCount > 0 && <Badge tone="danger" dot>+{newCount} ใหม่</Badge>}
            <Button size="sm" onClick={() => setNewCount(0)} disabled={newCount === 0}>เคลียร์</Button>
          </div>
        }
      />
      {body}
    </Card>
  );

  if (loading) {
    return shell(
      <div className="space-y-2.5 p-5" aria-busy="true" aria-label="กำลังโหลดการแจ้งเตือน">
        {[0, 1, 2].map(i => <div key={i} className="skeleton h-14" />)}
      </div>,
    );
  }

  if (events.length === 0) {
    return shell(
      <EmptyState
        icon={<IconBell size={22} />}
        title="ยังไม่มีเหตุการณ์ใน 1 ชั่วโมงที่ผ่านมา"
        description="ระบบทำงานปกติ — เมื่อมีโมเดลใหม่ โมเดลถูกแบน หรือผู้ให้บริการขัดข้อง จะแจ้งที่นี่ทันที"
      />,
    );
  }

  return shell(
    <ol className="max-h-[480px] space-y-2 overflow-y-auto p-5" aria-live="polite">
      {events.map(evt => {
        const meta = EVENT_META[evt.type] ?? FALLBACK_META;
        const colors = evt.provider ? (PROVIDER_COLORS[evt.provider] ?? PROVIDER_COLORS.openrouter) : null;
        const isNew = evt.id > latestId - newCount;

        return (
          <li
            key={evt.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${
              isNew ? "border-violet-400/30 bg-violet-400/[0.07]" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-medium text-white">{evt.title}</span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {isNew && <Badge tone="accent" dot>ใหม่</Badge>}
                {colors && <span className={`text-[11px] ${colors.text}`}>{evt.provider}</span>}
              </div>
              {evt.detail && (
                <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{evt.detail}</div>
              )}
            </div>
            <time className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]" dateTime={evt.created_at}>
              {fmtTime(evt.created_at)}
            </time>
          </li>
        );
      })}
    </ol>,
  );
}
