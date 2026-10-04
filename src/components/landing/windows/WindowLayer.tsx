"use client";

// Control-room layer. Desktop: KPI ribbon between two window columns + floating windows + a centred dock.
// Phones and portrait tablets: one bottom sheet (vitals row + tabs).
// Only mounted on the client after the first data arrives (it reads localStorage and the viewport on mount).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { dockLabels, isSheet, ribbonBox, useViewport, useWindowLayout, winWidth } from "./layout";
import type { Viewport } from "./layout";
import { WINDOWS } from "./registry";
import type { WinDef } from "./registry";
import { Ribbon, Vitals } from "./Ribbon";
import type { WinCtx } from "./shared";
import { Win } from "./Win";
import type { WinEnter } from "./Win";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300";
/** windows mounted within this long after the layer appears use the staggered entrance */
const INTRO_MS = 3000;

const IconLayout = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" />
  </svg>
);

export function WindowLayer({ ctx }: { ctx: WinCtx }) {
  const vp = useViewport();
  const defs = useMemo(() => WINDOWS.filter((d) => ctx.owner || d.public), [ctx.owner]);
  return isSheet(vp) ? <Sheet defs={defs} ctx={ctx} vp={vp} /> : <Desktop defs={defs} ctx={ctx} vp={vp} />;
}

function Desktop({ defs, ctx, vp }: { defs: WinDef[]; ctx: WinCtx; vp: Viewport }) {
  const { layout, patch, focus, toggle, reset } = useWindowLayout(defs, vp);
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), INTRO_MS);
    return () => clearTimeout(t);
  }, []);

  const open = defs.filter((d) => layout[d.id]?.open);
  // default z values are 1..defs.length; anything above means the user picked that window
  const topZ = Math.max(0, ...open.map((d) => layout[d.id].z));
  const seen = { L: 0, R: 0 };
  // icon-only (title tooltip) unless the labelled capsule fits between the columns; +1 for "จัดใหม่"
  const label = dockLabels(vp, defs.length + 1) ? "whitespace-nowrap" : "sr-only";

  return (
    <>
      <Ribbon ctx={ctx} box={ribbonBox(vp)} />
      {open.map((d) => {
        const st = layout[d.id];
        let enter: WinEnter | null = null;
        if (intro) {
          const side = st.x + winWidth(d, vp) / 2 < vp.w / 2 ? "L" : "R";
          enter = { side, i: seen[side]++ };
        }
        return (
          <Win key={d.id} def={d} st={st} vp={vp} ctx={ctx} active={st.z === topZ && topZ > defs.length} enter={enter} onPatch={patch} onFocus={focus} />
        );
      })}
      <nav
        aria-label="หน้าต่าง"
        className="lp-glass lp-rise pointer-events-auto absolute inset-x-0 bottom-3 z-[1000] mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-0.5 overflow-x-auto rounded-full p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ "--d": 320 } as CSSProperties}
      >
        {defs.map((d) => {
          const on = !!layout[d.id]?.open;
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(d.id)}
              title={d.title}
              className={`lp-dock-chip flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-medium ${FOCUS} ${on ? "bg-violet-400/[0.14] text-white" : "text-gray-400 hover:bg-white/[0.06] hover:text-white"}`}
            >
              <span className={`relative grid place-items-center ${on ? "text-violet-300" : ""}`}>
                {d.icon}
                {on && <i aria-hidden className="absolute -bottom-[5px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-violet-400 shadow-[0_0_6px_1px_rgba(139,123,255,0.9)]" />}
              </span>
              <span className={label}>{d.short}</span>
            </button>
          );
        })}
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-white/10" />
        <button
          type="button"
          onClick={reset}
          title="จัดหน้าต่างใหม่"
          className={`lp-dock-chip flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-medium text-gray-400 hover:bg-white/[0.06] hover:text-white ${FOCUS}`}
        >
          <IconLayout />
          <span className={label}>จัดใหม่</span>
        </button>
      </nav>
    </>
  );
}

function Sheet({ defs, ctx, vp }: { defs: WinDef[]; ctx: WinCtx; vp: Viewport }) {
  const [tab, setTab] = useState(defs[0].id);
  // short screens (landscape phones) start collapsed: grabber + vitals + tabs only
  const [open, setOpen] = useState(() => vp.h >= 640);
  const cur = defs.find((d) => d.id === tab) ?? defs[0];
  const rowRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);

  // slide the underline under the active tab and keep that tab in view (DOM only, no re-render)
  useLayoutEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(`#lp-tab-${cur.id}`);
    const line = lineRef.current;
    if (!row || !el || !line) return;
    line.style.width = `${el.offsetWidth - 20}px`;
    line.style.transform = `translateX(${el.offsetLeft + 10}px)`;
    const pad = 32; // clear of the row's edge fade
    if (el.offsetLeft - pad < row.scrollLeft) row.scrollTo({ left: el.offsetLeft - pad, behavior: "smooth" });
    else if (el.offsetLeft + el.offsetWidth + pad > row.scrollLeft + row.clientWidth) row.scrollTo({ left: el.offsetLeft + el.offsetWidth + pad - row.clientWidth, behavior: "smooth" });
  }, [cur.id]);

  return (
    <div
      className="lp-glass lp-sheet lp-rise pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex flex-col rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      style={{ ...(open ? { height: "44dvh" } : null), "--d": 280 } as CSSProperties}
    >
      <div aria-hidden className="flex cursor-pointer justify-center pb-1.5 pt-2" onClick={() => setOpen((o) => !o)}>
        <span className="h-1 w-9 rounded-full bg-white/25" />
      </div>
      {/* vitals, tabs and panel share one column (capped on tablets) and one 16 px inset */}
      <div className="mx-auto w-full max-w-xl">
        <Vitals ctx={ctx} />
      </div>
      <div className="mt-1 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-xl items-center gap-1 pr-2">
          <div
            ref={rowRef}
            role="tablist"
            aria-label="หน้าต่าง"
            className="lp-fade-x relative flex min-w-0 flex-1 scroll-px-8 gap-0.5 overflow-x-auto px-1 pb-1.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {defs.map((d) => {
              const on = d.id === cur.id;
              return (
                <button
                  key={d.id}
                  role="tab"
                  id={`lp-tab-${d.id}`}
                  aria-selected={on}
                  aria-controls="lp-sheet-panel"
                  title={d.title}
                  onClick={() => {
                    setTab(d.id);
                    setOpen(true);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-violet-300 ${on ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
                >
                  <span className={on ? "text-violet-300" : ""}>{d.icon}</span>
                  {/* only the active tab spells its name, so no Thai label is ever cut by the row edge */}
                  <span className={on ? "" : "sr-only"}>{d.short}</span>
                </button>
              );
            })}
            <span ref={lineRef} aria-hidden className="lp-tab-line pointer-events-none absolute bottom-1 left-0 h-[2px] rounded-full bg-violet-400 shadow-[0_0_8px_rgba(139,123,255,0.8)]" />
          </div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "ย่อแผง" : "ขยายแผง"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={open ? "" : "rotate-180"}>
              <path d="m3 5 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div id="lp-sheet-panel" role="tabpanel" aria-labelledby={`lp-tab-${cur.id}`} className="lp-fade-b min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/[0.06] py-3">
          {/* window bodies are designed ~320 px wide: keep them readable on tablet-wide sheets */}
          <div className="mx-auto max-w-xl px-4">
            <cur.Body ctx={ctx} />
          </div>
        </div>
      )}
    </div>
  );
}
