"use client";

// One floating desktop window: drag by the title bar (pointer or arrow keys), minimize to the title bar, close.
// Windows on screen at first paint rise in staggered from their side (.lp-win-enter); later ones pop in (.lp-win).
import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { IconX } from "@/components/ui/icons";
import { TITLE_H, clampWin, winHeight, winWidth } from "./layout";
import type { Viewport, WinState } from "./layout";
import type { WinDef } from "./registry";
import type { WinCtx } from "./shared";

const BTN =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-300";

export interface WinEnter { side: "L" | "R"; i: number }

export function Win({
  def, st, vp, ctx, active, enter, onPatch, onFocus,
}: {
  def: WinDef;
  st: WinState;
  vp: Viewport;
  ctx: WinCtx;
  /** last window the user focused: violet edge + glow */
  active: boolean;
  /** first-paint entrance (side + index in its column); frozen at mount so a later re-render never replays it */
  enter: WinEnter | null;
  onPatch: (id: string, p: Partial<WinState>) => void;
  onFocus: (id: string) => void;
}) {
  const w = winWidth(def, vp);
  const h = winHeight(st, vp);
  const pos = clampWin(st.x, st.y, w, h, vp);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const origin = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const at = drag ?? pos;
  const [intro] = useState(enter);

  const down = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as Element).closest("button") || e.button !== 0) return;
    origin.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const o = origin.current;
    if (o) setDrag(clampWin(o.x + e.clientX - o.px, o.y + e.clientY - o.py, w, h, vp));
  };
  const up = () => {
    origin.current = null;
    if (drag) onPatch(def.id, drag);
    setDrag(null);
  };
  const key = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      onPatch(def.id, clampWin(pos.x + d[0], pos.y + d[1], w, h, vp));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPatch(def.id, { min: !st.min });
    }
  };

  return (
    <section
      aria-label={def.title}
      className={`lp-glass ${intro ? "lp-win-enter" : "lp-win"} pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl`}
      data-active={active}
      data-side={intro?.side}
      style={{ left: at.x, top: at.y, width: w, height: h, zIndex: st.z, "--d": (intro?.i ?? 0) * 70 } as CSSProperties}
      onPointerDownCapture={() => onFocus(def.id)}
      onFocusCapture={() => onFocus(def.id)}
    >
      <header
        className={`flex shrink-0 items-center gap-1 pl-3 pr-2 ${st.min ? "" : "border-b border-white/[0.08]"}`}
        style={{ height: TITLE_H }}
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={`${def.title} — ลูกศรเพื่อเลื่อนหน้าต่าง, Enter เพื่อย่อหรือขยาย`}
          className="flex h-full min-w-0 flex-1 cursor-grab touch-none select-none items-center gap-2 text-[12.5px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-300 active:cursor-grabbing"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={() => onPatch(def.id, { min: !st.min })}
          onKeyDown={key}
        >
          <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-white/[0.06] text-violet-300">{def.icon}</span>
          <span className="truncate">{def.title}</span>
          {def.id === "feed" && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />
              สด
            </span>
          )}
        </div>
        <span className="lp-win-btns flex items-center gap-0.5">
          <button type="button" className={BTN} aria-label={st.min ? `ขยาย ${def.title}` : `ย่อ ${def.title}`} aria-expanded={!st.min} onClick={() => onPatch(def.id, { min: !st.min })}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              {st.min ? <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /> : <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
            </svg>
          </button>
          <button type="button" className={BTN} aria-label={`ปิด ${def.title}`} onClick={() => onPatch(def.id, { open: false })}>
            <IconX size={12} />
          </button>
        </span>
      </header>
      {!st.min && (
        <div className="lp-fade-b min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <def.Body ctx={ctx} />
        </div>
      )}
    </section>
  );
}
