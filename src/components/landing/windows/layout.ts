"use client";

// Window geometry + persistence. Positions/open/minimized survive reloads (localStorage); the viewport clamp runs at
// render time, so a layout saved on a big monitor still lands fully on screen on a small one.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WinDef } from "./registry";

export interface WinState {
  x: number;
  y: number;
  /** expanded height in px */
  h: number;
  open: boolean;
  min: boolean;
  z: number;
}
type Layout = Record<string, WinState>;
export interface Viewport { w: number; h: number }

/** below the top bar (the visitor caption is hidden in control mode from 1024px); under 1024px the bar wraps to two rows */
export const topOf = (vp: Viewport) => (vp.w >= 1024 ? 84 : 132);
export const TITLE_H = 38;
const EDGE = 12;
const GAP = 10;
/** dock footprint (bottom-3 + ~39 px capsule) + GAP */
const BOTTOM = 62;
/** shortest useful squeezed window (below this it starts as a title bar) */
const SQUEEZE_MIN = 140;
const KEY = "bcai.landing.windows.v2";
/** two window columns side by side (narrower: only the left column opens by default) */
const WIDE_MIN = 1100;
/** a column window plus breathing room: the ribbon lives between the columns */
const COL_BAND = EDGE + 340 + 16;
/** labelled dock chip, average width */
const DOCK_CHIP_W = 84;

export const MOBILE_MAX = 767;

/** phones, portrait tablets and short (landscape-phone) screens get the bottom sheet instead of floating windows */
export const isSheet = (vp: Viewport) => vp.w <= MOBILE_MAX || vp.h < 520 || (vp.w < WIDE_MIN && vp.h > vp.w);

/** dock shows text labels only when the labelled capsule fits between the window columns */
export const dockLabels = (vp: Viewport, chips: number) => vp.w - 2 * COL_BAND >= chips * DOCK_CHIP_W;

export interface RibbonBox { x: number; y: number; w: number; h: number; cells: number }

/** KPI ribbon: centred in the band between the window columns, under the top bar; 104 px per cell, 3..6 cells */
export function ribbonBox(vp: Viewport): RibbonBox {
  const right = vp.w >= WIDE_MIN ? COL_BAND : EDGE;
  const band = vp.w - COL_BAND - right;
  const w = Math.min(760, band);
  return { x: Math.round(COL_BAND + (band - w) / 2), y: topOf(vp), w, h: 64, cells: Math.min(6, Math.max(3, Math.floor(w / 104))) };
}

export const winWidth = (d: WinDef, vp: Viewport) => Math.min(d.w, vp.w - 2 * EDGE);
export const winHeight = (st: WinState, vp: Viewport) => (st.min ? TITLE_H : Math.min(st.h, vp.h - topOf(vp) - EDGE));

export function clampWin(x: number, y: number, w: number, h: number, vp: Viewport) {
  const top = topOf(vp);
  return {
    x: Math.round(Math.min(Math.max(x, EDGE), Math.max(EDGE, vp.w - w - EDGE))),
    y: Math.round(Math.min(Math.max(y, top), Math.max(top, vp.h - h - EDGE))),
  };
}

/** Wide screens: left column + right column. Narrow: only the left column opens, the rest wait in the dock. A window
 *  that does not fit starts collapsed to its title bar rather than overlapping the next one. Closed windows cascade
 *  mid-screen, under the ribbon. */
function defaultLayout(defs: WinDef[], vp: Viewport): Layout {
  const wide = vp.w >= WIDE_MIN;
  const opens = (d: WinDef) => d.open && (wide || d.col === "L");
  const limit = vp.h - BOTTOM;
  const out: Layout = {};
  let z = 1;
  for (const col of ["L", "R"] as const) {
    const list = defs.filter((d) => opens(d) && d.col === col);
    let y = topOf(vp);
    list.forEach((d, i) => {
      const w = winWidth(d, vp);
      const avail = limit - y - (list.length - i - 1) * (TITLE_H + GAP);
      const min = avail < SQUEEZE_MIN;
      let h = min ? d.h : Math.min(d.h, avail);
      // the column's last window takes the leftover height, up to its own cap (content-rich windows only)
      if (!min && i === list.length - 1 && d.grow) h = Math.max(h, Math.min(d.grow, limit - y));
      out[d.id] = { x: col === "L" ? EDGE : vp.w - w - EDGE, y, h, open: true, min, z: z++ };
      y += (min ? TITLE_H : h) + GAP;
    });
  }
  defs.filter((d) => !opens(d)).forEach((d, i) => {
    const w = winWidth(d, vp);
    out[d.id] = { x: Math.round((vp.w - w) / 2) + i * 24, y: topOf(vp) + 74 + i * 24, h: d.h, open: false, min: false, z: z++ };
  });
  return out;
}

function read(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Partial<WinState>>;
    const ok: Layout = {};
    for (const [id, s] of Object.entries(raw)) {
      if ([s.x, s.y, s.h, s.z].every((n) => typeof n === "number" && Number.isFinite(n)) && typeof s.open === "boolean" && typeof s.min === "boolean") {
        ok[id] = s as WinState;
      }
    }
    return ok;
  } catch {
    return {};
  }
}

/** Client-only (the page renders the window layer after the first data arrives). */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

export function useWindowLayout(defs: WinDef[], vp: Viewport) {
  const [saved, setSaved] = useState<Layout>(read);

  // the owner gets more windows than a visitor: anything without a saved slot gets its default one
  const complete = useCallback((l: Layout): Layout => (defs.every((d) => l[d.id]) ? l : { ...defaultLayout(defs, vp), ...l }), [defs, vp]);
  const layout = useMemo(() => complete(saved), [complete, saved]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch { /* storage blocked */ }
  }, [saved]);

  const update = useCallback((fn: (l: Layout) => Layout) => setSaved((prev) => fn(complete(prev))), [complete]);
  const topZ = (l: Layout) => Math.max(0, ...Object.values(l).map((s) => s.z));

  const patch = useCallback((id: string, p: Partial<WinState>) => update((l) => ({ ...l, [id]: { ...l[id], ...p } })), [update]);

  const focus = useCallback(
    (id: string) => update((l) => (l[id].z < topZ(l) ? { ...l, [id]: { ...l[id], z: topZ(l) + 1 } } : l)),
    [update],
  );

  /** dock chip: closed → open (expanded, on top); open → closed */
  const toggle = useCallback(
    (id: string) => update((l) => ({ ...l, [id]: l[id].open ? { ...l[id], open: false } : { ...l[id], open: true, min: false, z: topZ(l) + 1 } })),
    [update],
  );

  const reset = useCallback(() => setSaved(defaultLayout(defs, vp)), [defs, vp]);

  return { layout, patch, focus, toggle, reset };
}
