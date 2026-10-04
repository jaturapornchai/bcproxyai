// Contract between the galaxy engine (engine.ts / engine/*) and the page (Landing.tsx / Hud / windows).
import type { PulseEvent, PulseStar } from "@/lib/pulse-types";

export type { ProviderStatus, PulseEvent, PulseStar } from "@/lib/pulse-types";

export type DirectorMode = "auto" | "manual";

export interface GalaxyOptions {
  reducedMotion: boolean;
  /** owner view: render star labels (PulseStar.label); public view: no labels at all */
  showLabels: boolean;
  /** first frame rendered + intro started */
  onReady?: () => void;
  /** camera fly-in finished */
  onIntroDone?: () => void;
  /** screen = CSS px relative to the host element */
  onHover?: (starId: string | null, screen: { x: number; y: number } | null) => void;
  onSelect?: (starId: string) => void;
  /** director switched (user input → "manual"; resumes "auto" after idle unless locked) */
  onDirector?: (mode: DirectorMode) => void;
  /** no WebGL2 / context lost / init error: the page shows its static fallback */
  onFallback?: (reason: string) => void;
}

export interface GalaxyHandle {
  /** full replace; engine reconciles (adds/removes/updates star systems) */
  setStars(stars: PulseStar[]): void;
  /** new real events only; engine dedupes by id and replays them with their real relative timing.
   *  Every comet on screen comes from one of these — there is no ambient/fake traffic. */
  pushEvents(events: PulseEvent[]): void;
  /** fly the camera to a star (null = back to the wide shot) */
  focusStar(starId: string | null): void;
  /** "manual" locks the director off until set back to "auto" */
  setDirector(mode: DirectorMode): void;
  resetView(): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}
