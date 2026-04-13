"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROVIDER_COLORS, fmtTime } from "./shared";

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

const EVENT_STYLES: Record<string, { icon: string; bg: string; text: string; sound: string }> = {
  model_new:      { icon: "🆕", bg: "bg-emerald-500/20", text: "text-emerald-400", sound: "ding" },
  model_banned:   { icon: "🚫", bg: "bg-red-500/20", text: "text-red-400", sound: "alarm" },
  complaint:      { icon: "📝", bg: "bg-amber-500/20", text: "text-amber-400", sound: "bell" },
  provider_error: { icon: "💥", bg: "bg-red-500/20", text: "text-red-400", sound: "alarm" },
  provider_back:  { icon: "✅", bg: "bg-emerald-500/20", text: "text-emerald-400", sound: "ding" },
};

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

  if (loading) return <div className="text-gray-500 text-center py-8">กำลังโหลดระฆัง...</div>;

  return (
    <div className="space-y-3">
      {/* Bell Header */}
      <div className="flex items-center gap-3">
        <span className={`text-3xl transition-transform ${bellRing ? "animate-bounce" : ""}`}>
          🔔
        </span>
        {newCount > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 animate-pulse">
            +{newCount} ใหม่
          </span>
        )}
        <button
          onClick={() => setNewCount(0)}
          className="text-xs text-gray-500 hover:text-white ml-auto"
        >
          เคลียร์
        </button>
      </div>

      {/* Events Timeline */}
      {events.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-gray-500">
          <div className="text-3xl mb-2">🔕</div>
          <p className="text-sm">เงียบสงบ — ไม่มีเรื่องวุ่นวายใน 1 ชม. ที่ผ่านมา เด็กๆ ตั้งใจเรียนดี!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map(evt => {
            const style = EVENT_STYLES[evt.type] ?? { icon: "📢", bg: "bg-gray-500/20", text: "text-gray-400", sound: "" };
            const colors = evt.provider ? (PROVIDER_COLORS[evt.provider] ?? PROVIDER_COLORS.openrouter) : null;
            const isNew = evt.id > (lastIdRef.current - newCount);

            return (
              <div
                key={evt.id}
                className={`${style.bg} rounded-lg p-3 flex items-start gap-3 border border-transparent ${
                  isNew ? "border-white/10 animate-pulse" : ""
                } transition-all`}
              >
                <span className="text-xl shrink-0">{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${style.text}`}>{evt.title}</span>
                    {colors && (
                      <span className={`text-[10px] ${colors.text}`}>{evt.provider}</span>
                    )}
                  </div>
                  {evt.detail && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{evt.detail}</div>
                  )}
                </div>
                <div className="text-[10px] text-gray-600 shrink-0">
                  {fmtTime(evt.created_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
