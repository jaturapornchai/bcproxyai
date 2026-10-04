"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createGalaxy } from "./engine";
import type { DirectorMode, GalaxyHandle, GalaxyOptions, PulseEvent, PulseStar } from "./types";

type Callbacks = Omit<GalaxyOptions, "reducedMotion" | "showLabels">;

interface Props extends Callbacks {
  stars: PulseStar[];
  events: PulseEvent[];
  /** owner view only: public view must render no names at all */
  showLabels: boolean;
  director: DirectorMode;
  focusStarId: string | null;
  paused?: boolean;
  /** bump to send the camera back to the wide shot */
  resetSignal?: number;
}

/**
 * Fills its (positioned) parent with the galaxy WebGL scene. Load it with
 * `next/dynamic(() => import("./NexusCanvas"), { ssr: false })` so three.js stays out of every other route's bundle.
 * The engine is created once (again only if showLabels flips: the handle has no live switch for it) and props are pushed
 * through the handle. It owns pausing on document.hidden / off-screen, resizing, and context-loss reporting (onFallback).
 */
export default function NexusCanvas({ stars, events, showLabels, director, focusStarId, paused = false, resetSignal = 0, ...callbacks }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GalaxyHandle | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const resetRef = useRef(resetSignal);
  // last mode the engine reported or was told: a parent echoing onDirector back must not turn into a lock
  const modeRef = useRef<DirectorMode>("auto");
  // latest props without re-creating the engine: callbacks change identity on every parent render
  const latest = useRef({ stars, events, director, focusStarId, paused, callbacks });
  useLayoutEffect(() => {
    latest.current = { stars, events, director, focusStarId, paused, callbacks };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const cb = () => latest.current.callbacks;
    const handle = createGalaxy(host, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      showLabels,
      onReady: () => cb().onReady?.(),
      onIntroDone: () => cb().onIntroDone?.(),
      onHover: (id, screen) => cb().onHover?.(id, screen),
      onSelect: (id) => cb().onSelect?.(id),
      onDirector: (mode) => {
        modeRef.current = mode;
        cb().onDirector?.(mode);
      },
      onFallback: (reason) => cb().onFallback?.(reason),
    });
    handleRef.current = handle;
    const l = latest.current;
    handle.setStars(l.stars);
    modeRef.current = l.director;
    handle.setDirector(l.director);
    handle.focusStar(l.focusStarId);
    handle.setPaused(l.paused);
    // a fresh engine has seen nothing (StrictMode remount, showLabels flip): hand it the current batch
    seenRef.current = new Set(l.events.map((e) => e.id));
    handle.pushEvents(l.events);
    return () => {
      handle.dispose();
      handleRef.current = null;
    };
  }, [showLabels]);

  useEffect(() => {
    handleRef.current?.setStars(stars);
  }, [stars]);

  useEffect(() => {
    const seen = seenRef.current;
    const fresh = events.filter((e) => !seen.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seen.add(e.id);
    if (seen.size > 4000) seenRef.current = new Set([...seen].slice(-2000));
    handleRef.current?.pushEvents(fresh);
  }, [events]);

  useEffect(() => {
    if (director === modeRef.current) return;
    modeRef.current = director;
    handleRef.current?.setDirector(director);
  }, [director]);

  useEffect(() => {
    handleRef.current?.focusStar(focusStarId);
  }, [focusStarId]);

  useEffect(() => {
    handleRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    if (resetSignal === resetRef.current) return;
    resetRef.current = resetSignal;
    handleRef.current?.resetView();
  }, [resetSignal]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" aria-hidden="true" />;
}
