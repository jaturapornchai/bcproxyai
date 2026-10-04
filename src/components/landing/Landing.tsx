"use client";

// Landing stage: a full-viewport galaxy (WebGL, lazy + client-only) with a glass HUD on top.
//   "ศูนย์ควบคุม" (control) the default: KPI ribbon + draggable windows (bottom sheet on phones / portrait tablets)
//   "ชม" (view)          minimal top bar + live ticker, cinematic
// If WebGL2 is missing / init fails, a CSS-only scene takes over and the windows keep working. A lost context gets one
// retry on a fresh canvas first; 3D-only controls are swapped for a small "โหมดประหยัด" notice once the fallback is final.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PulseStar } from "@/lib/pulse-types";
import "./landing.css";
import { FallbackScene } from "./FallbackScene";
import { RestoreButton, Ticker, TopBar } from "./Hud";
import type { Mode } from "./Hud";
import { ProviderTip } from "./ProviderTip";
import type { HoverState } from "./ProviderTip";
import type { DirectorMode } from "./types";
import { useLiveData } from "./useLiveData";
import { useInsights } from "./windows/useInsights";
import { WindowLayer } from "./windows/WindowLayer";
import { STATUS_VIEW, starName } from "./windows/shared";
import type { WinCtx } from "./windows/shared";

const NexusCanvas = dynamic(() => import("./NexusCanvas"), { ssr: false });

const NO_STARS: PulseStar[] = [];
const MODE_KEY = "bcai.landing.mode.v2";

// Reveal the HUD anyway if the engine has not reported in by then (slow chunk, slow GPU init).
const READY_TIMEOUT_MS = 4000;
/** after a lost WebGL context, wait this long before trying one fresh canvas + engine */
const RECOVER_MS = 1500;
const NOTICE = {
  none: "โหมดประหยัด — เบราว์เซอร์นี้ไม่รองรับ 3D",
  lost: "โหมดประหยัด — กราฟิก 3D หยุดทำงาน",
} as const;

// Saved mode lives in localStorage (only an explicit "view" sticks); useSyncExternalStore keeps the server HTML ("control") and hydration consistent.
let modeNow: Mode | null = null;
const modeListeners = new Set<() => void>();
const subscribeMode = (cb: () => void) => {
  modeListeners.add(cb);
  return () => void modeListeners.delete(cb);
};
const readMode = (): Mode => {
  if (modeNow) return modeNow;
  try {
    return localStorage.getItem(MODE_KEY) === "view" ? "view" : "control";
  } catch {
    return "control";
  }
};
const writeMode = (m: Mode) => {
  modeNow = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch { /* storage blocked: keep it in memory */ }
  modeListeners.forEach((l) => l());
};

const isTyping = (el: EventTarget | null) => !!(el as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");

export function Landing() {
  const { data, events, owner, online, refresh } = useLiveData();
  const mode = useSyncExternalStore(subscribeMode, readMode, () => "control" as const);
  const [uiHidden, setUiHidden] = useState(false);
  const [director, setDirector] = useState<DirectorMode>("auto");
  const [focusStarId, setFocusStarId] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  /** final CSS-only mode (null = WebGL is, or may again be, running) */
  const [fallback, setFallback] = useState<keyof typeof NOTICE | null>(null);
  /** bump = remount NexusCanvas: a fresh canvas and engine */
  const [glKey, setGlKey] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const retried = useRef(false);
  const [timedOut, setTimedOut] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  // slow aggregates only while the control room is on screen
  const { insights, failed: insightsFailed, skewMs } = useInsights(data && mode === "control" ? owner : null);

  const stars = data?.stars ?? NO_STARS;
  const starMap = useMemo(() => new Map(stars.map((s) => [s.id, s])), [stars]);
  // once revealed, the HUD stays revealed through a context-loss retry
  const ready = sceneReady || !!fallback || timedOut || recovering || glKey > 0;
  const live = introDone || !!fallback || timedOut; // camera fly-in finished (or there is no 3D at all)

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  const resetView = useCallback(() => {
    setFocusStarId(null);
    setResetSignal((n) => n + 1);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  // H hides/shows every control, F = fullscreen, Esc = un-hide, then back to the wide shot. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "h") setUiHidden((v) => !v);
      else if (k === "f") toggleFullscreen();
      else if (e.key === "Escape") {
        if (uiHidden) setUiHidden(false);
        else if (focusStarId) resetView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [uiHidden, focusStarId, resetView, toggleFullscreen]);

  // Stable handlers: NexusCanvas must not see new callbacks on every hover re-render.
  const onReady = useCallback(() => setSceneReady(true), []);
  const onIntroDone = useCallback(() => setIntroDone(true), []);
  const onFallback = useCallback((reason: string) => {
    setSceneReady(false);
    setHover(null);
    if (reason === "context-lost" && !retried.current) {
      retried.current = true;
      setRecovering(true); // unmount the dead canvas; the CSS scene covers the gap
      setTimeout(() => {
        setRecovering(false);
        setGlKey((k) => k + 1);
      }, RECOVER_MS);
      return;
    }
    setFallback(retried.current || reason === "context-lost" ? "lost" : "none");
  }, []);
  const onHover = useCallback((id: string | null, at: { x: number; y: number } | null) => {
    const box = sceneRef.current;
    setHover(id && at && box ? { id, x: at.x, y: at.y, w: box.clientWidth, h: box.clientHeight } : null);
  }, []);

  const ctx = useMemo<WinCtx | null>(
    () => (data ? { data, events, owner, stars: starMap, focusStarId, onFocusStar: setFocusStarId, refresh, insights, insightsFailed, skewMs } : null),
    [data, events, owner, starMap, focusStarId, refresh, insights, insightsFailed, skewMs],
  );

  return (
    <main className="lp-stage relative h-[100dvh] w-full overflow-hidden text-white" data-ready={ready} data-mode={mode}>
      <h1 className="sr-only">BCAiRouter — เกตเวย์ AI ส่วนตัว แสดงการทำงานสด</h1>
      <FallbackScene stars={stars} off={sceneReady && !fallback} />

      {/* Pointer coords from the engine are relative to this box, so the tooltip layer below uses the same box.
          Mounted once the first data says owner-or-visitor: the engine is rebuilt whenever showLabels flips. */}
      {!fallback && !recovering && data && (
        <div key={glKey} className="absolute inset-0">
          <NexusCanvas
            stars={stars}
            events={events}
            showLabels={owner}
            director={director}
            focusStarId={focusStarId}
            resetSignal={resetSignal}
            onReady={onReady}
            onIntroDone={onIntroDone}
            onHover={onHover}
            onSelect={setFocusStarId}
            onDirector={setDirector}
            onFallback={onFallback}
          />
        </div>
      )}
      <div className="lp-scrim pointer-events-none absolute inset-0" aria-hidden />

      {/* The galaxy is decorative (aria-hidden): screen readers get the same facts as text. */}
      {data && (
        <section className="sr-only" aria-label="สรุปสถานะสด">
          <p>
            คำขอใน 1 ชั่วโมง {data.stats.requestsLastHour} อัตราสำเร็จ {Math.round(data.stats.successRate * 100)}% ผู้ให้บริการออนไลน์ {data.stats.providersUp} จาก {data.stats.providersTotal}
          </p>
          <ul>
            {stars.map((s) => (
              <li key={s.id}>{starName({ owner, stars: starMap }, s.id)}: {STATUS_VIEW[s.status].label}{s.models !== undefined && ` พร้อมใช้ ${s.available} จาก ${s.models} โมเดล`}</li>
            ))}
          </ul>
        </section>
      )}

      <div className={`pointer-events-none absolute inset-0 z-10 ${uiHidden ? "hidden" : ""}`}>
        <TopBar
          data={data}
          online={online}
          owner={owner}
          mode={mode}
          onMode={writeMode}
          director={director}
          onDirector={() => setDirector((d) => (d === "auto" ? "manual" : "auto"))}
          onReset={resetView}
          notice={fallback && NOTICE[fallback]}
          onHide={() => setUiHidden(true)}
          onFullscreen={toggleFullscreen}
        />
        {mode === "view" && live && <Ticker events={events} ctx={{ owner, stars: starMap }} hint={!fallback} />}
        {/* kept mounted in view mode so window state (e.g. a half-typed prompt) survives a mode switch */}
        {ctx && <div className={mode === "control" ? "contents" : "hidden"}><WindowLayer ctx={ctx} /></div>}
      </div>
      {uiHidden && <RestoreButton onClick={() => setUiHidden(false)} />}

      <div ref={sceneRef} className="pointer-events-none absolute inset-0 z-20">
        <ProviderTip hover={hover} star={hover ? starMap.get(hover.id) : undefined} owner={owner} />
      </div>

      <div
        className="lp-veil absolute inset-0 z-50 grid place-items-center bg-[#05060a]"
        data-off={ready}
        role="status"
        aria-hidden={ready}
      >
        <div className="flex flex-col items-center gap-5">
          {/* ring is masked, so the logo tile sits beside it rather than inside it */}
          <div className="relative grid h-16 w-16 place-items-center">
            <div className="lp-ring-spin absolute inset-0" />
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 text-[12px] font-black text-white">
              BC
            </span>
          </div>
          <p className="text-[13px] text-gray-400">กำลังเชื่อมต่อกาแล็กซี…</p>
        </div>
      </div>
    </main>
  );
}
