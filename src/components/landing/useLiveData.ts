"use client";

// Live data for the landing. Asks /api/auth/whoami (always 200, so visitors never log a 401) whether this is the
// owner; only then /api/activity is polled, anyone else gets just the anonymised /api/public/pulse. Every 4 s: ?since=<last event t> returns just the new events while
// stats / series / stars always come back as a full snapshot. Nothing else (/api/models, /api/status, ...) is touched.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PulseData, PulseEvent } from "@/lib/pulse-types";

export interface LiveData {
  data: PulseData | null;
  /** merged, oldest first, last KEEP only. Identity changes only when something new arrived. */
  events: PulseEvent[];
  /** /api/activity answered 200 with scope "owner" */
  owner: boolean;
  /** the latest poll succeeded */
  online: boolean;
  /** poll right now (e.g. after sending a prompt) */
  refresh: () => void;
}

const POLL_MS = 4000;
const KEEP = 200;
const NO_EVENTS: PulseEvent[] = [];

export function useLiveData(): LiveData {
  const [state, setState] = useState<Omit<LiveData, "refresh">>({ data: null, events: NO_EVENTS, owner: false, online: true });
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    const ctl = new AbortController();
    let busy = false;
    let owner: boolean | null = null; // null = not probed yet
    let events = NO_EVENTS;
    let since = "";

    const get = async (path: string): Promise<Response> => {
      const q = since ? `?since=${encodeURIComponent(since)}` : "";
      return fetch(path + q, { cache: "no-store", signal: ctl.signal });
    };
    const reset = () => {
      events = NO_EVENTS;
      since = "";
    };

    const poll = async () => {
      if (busy || document.hidden || ctl.signal.aborted) return;
      busy = true;
      try {
        let res: Response | null = null;
        if (owner === null) {
          // whoami failing → treat as visitor (safe side)
          const who = (await fetch("/api/auth/whoami", { cache: "no-store", signal: ctl.signal })
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}))) as { role?: string };
          if (who.role !== "admin") owner = false;
        }
        if (owner !== false) {
          res = await get("/api/activity");
          if (!res.ok) {
            // visitor on first probe, or the owner session ended → switch to the public feed (ids differ per scope).
            // A 5xx (DB blip, deploy) is just offline: keep the owner scope and retry next tick.
            if (res.status === 401 || res.status === 403 || (owner === null && res.status === 404)) {
              owner = false;
              reset();
              res = null;
            } else throw new Error(`activity ${res.status}`);
          } else owner = true;
        }
        if (!res) {
          res = await get("/api/public/pulse");
          if (!res.ok) throw new Error(`pulse ${res.status}`);
        }
        const d = (await res.json()) as PulseData;
        if (ctl.signal.aborted) return;
        owner = d.scope === "owner";

        if (d.events.length) {
          const byId = new Map(events.map((e) => [e.id, e]));
          for (const e of d.events) byId.set(e.id, e);
          events = [...byId.values()].slice(-KEEP);
          since = events[events.length - 1].t;
        }
        setState({ data: d, events, owner, online: true });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setState((s) => ({ ...s, online: false }));
      } finally {
        busy = false;
      }
    };

    pollRef.current = () => void poll();
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => !document.hidden && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ctl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const refresh = useCallback(() => pollRef.current(), []);
  return { ...state, refresh };
}
