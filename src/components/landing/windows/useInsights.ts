"use client";

// Slow aggregates for the control room (GET /api/insights for the owner, /api/public/insights for everyone else).
// Every 30 s while the tab is visible; owner === null pauses polling (no pulse data yet, or the windows are hidden).
// The owner endpoint is tried first; only a 401/403 drops to the public one. Anything else (404 before the route
// exists, 5xx, offline) keeps the last good answer and retries on the next tick.
import { useEffect, useState } from "react";
import type { InsightsData } from "@/lib/insights-types";

const POLL_MS = 30_000;

export interface InsightsState {
  insights: InsightsData | null;
  /** no answer yet and the last fetch failed */
  failed: boolean;
  /** server clock minus browser clock (HTTP Date header, else generatedAt) */
  skewMs: number;
}

const EMPTY: InsightsState = { insights: null, failed: false, skewMs: 0 };

export function useInsights(owner: boolean | null): InsightsState {
  const [st, setSt] = useState<InsightsState & { owner: boolean | null }>({ ...EMPTY, owner: null });

  useEffect(() => {
    if (owner === null) return;
    const ctl = new AbortController();
    const opts: RequestInit = { cache: "no-store", signal: ctl.signal };
    let busy = false;
    let last = 0;

    const load = async () => {
      if (busy || document.hidden || ctl.signal.aborted) return;
      busy = true;
      last = Date.now();
      try {
        let res: Response | null = owner ? await fetch("/api/insights", opts) : null;
        if (res && (res.status === 401 || res.status === 403)) res = null;
        res ??= await fetch("/api/public/insights", opts);
        if (!res.ok) throw new Error(`insights ${res.status}`);
        const d = (await res.json()) as InsightsData;
        const server = Date.parse(res.headers.get("date") ?? "") || Date.parse(d.generatedAt);
        if (!ctl.signal.aborted) setSt({ insights: d, failed: false, skewMs: Number.isFinite(server) ? server - Date.now() : 0, owner });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setSt((s) => (s.owner === owner && s.insights ? s : { ...EMPTY, failed: true, owner }));
      } finally {
        busy = false;
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => !document.hidden && Date.now() - last >= POLL_MS && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ctl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner]);

  // scope switched (session ended / signed in): never show the other scope's numbers while the new answer is pending
  return owner !== null && st.owner !== owner ? EMPTY : st;
}
