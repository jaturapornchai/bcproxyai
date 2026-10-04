// Quality tiers + a downgrade-only frame-time governor (pattern from the memory-hub brain scene).
export type Tier = "high" | "medium" | "low";
export const TIER_ORDER: readonly Tier[] = ["low", "medium", "high"];

export interface TierSpec {
  dprCap: number;
  dprFloor: number;
  /** MSAA samples inside the composer (0 = none) */
  msaa: number;
  /** false = no composer: plain render with the renderer's ACES */
  post: boolean;
  bloomLevels: number;
  /** galaxy disk / bar / bulge / halo stars */
  stars: number;
  /** dust-lane sprites */
  dust: number;
  /** HII nebula knots */
  knots: number;
  /** background sky stars */
  sky: number;
  nebulaOctaves: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  high: { dprCap: 2, dprFloor: 1, msaa: 2, post: true, bloomLevels: 6, stars: 120_000, dust: 1600, knots: 320, sky: 6000, nebulaOctaves: 5 },
  medium: { dprCap: 1.5, dprFloor: 1, msaa: 0, post: true, bloomLevels: 5, stars: 60_000, dust: 900, knots: 200, sky: 3500, nebulaOctaves: 4 },
  low: { dprCap: 1, dprFloor: 0.75, msaa: 0, post: false, bloomLevels: 4, stars: 25_000, dust: 450, knots: 120, sky: 2000, nebulaOctaves: 3 },
};

const TIER_KEY = "bcai-galaxy-tier";
const isTier = (s: string | null): s is Tier => s === "high" || s === "medium" || s === "low";

export function loadStoredTier(): Tier | null {
  try {
    const q = new URLSearchParams(location.search).get("nx"); // ?nx=low|medium|high for QA
    if (isTier(q)) return q;
    const s = localStorage.getItem(TIER_KEY);
    return isTier(s) ? s : null;
  } catch {
    return null;
  }
}

export function storeTier(t: Tier): void {
  try {
    localStorage.setItem(TIER_KEY, t);
  } catch {
    /* storage blocked: the downgrade still applies to this session */
  }
}

/** Device hints -> starting tier. A stored (previously downgraded) tier only ever lowers it. */
export function initialTier(stored: Tier | null): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const coarse = matchMedia("(pointer: coarse)").matches;
  const cores = nav.hardwareConcurrency;
  const mem = nav.deviceMemory;
  let t: Tier;
  if (nav.connection?.saveData) t = "low";
  else if (coarse && ((mem !== undefined && mem <= 3) || (mem !== undefined && cores !== undefined && cores <= 4))) t = "low";
  else if (coarse || (cores !== undefined && cores <= 4)) t = "medium";
  else t = "high";
  if (!stored) return t;
  return TIER_ORDER.indexOf(stored) < TIER_ORDER.indexOf(t) || new URLSearchParams(location.search).has("nx") ? stored : t;
}

export type GovAction = { kind: "dpr"; dpr: number } | { kind: "tier"; tier: Tier } | { kind: "probe" };

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

/**
 * Median rAF delta per 2 s window. Two slow windows in a row (> 1.25x target) first shave DPR by 0.85 down to the tier
 * floor, then drop one tier. Never promotes. A slow rAF can be the browser/display cap (Energy Saver 30 Hz, iOS Low
 * Power Mode) rather than us, so before acting it asks for a "probe": the engine idles a few rAFs and reports the bare
 * cadence via probed(); frames only count as slow against max(target, that cap).
 */
export class Governor {
  locked = false;
  tier: Tier;
  dpr: number;
  private win: number[] = [];
  private winStart = -1;
  private slow = 0;
  private capMs = 0;
  private pending: number | null = null;
  private drops = 0;

  constructor(
    tier: Tier,
    dpr: number,
    public floor: number,
    private readonly startMs: number,
    private readonly targetMs = 1000 / 60,
  ) {
    this.tier = tier;
    this.dpr = dpr;
  }

  /** `skip`: frame belongs to the intro fly-in (expensive by design, not a device signal). */
  sample(dtMs: number, nowMs: number, skip: boolean): GovAction | null {
    if (this.locked || this.pending !== null || skip || dtMs > 250 || nowMs - this.startMs < 4000) return null;
    if (this.winStart < 0) this.winStart = nowMs;
    this.win.push(dtMs);
    if (nowMs - this.winStart < 2000) return null;
    const med = median(this.win);
    this.win = [];
    this.winStart = nowMs;
    this.slow = med > 1.25 * Math.max(this.targetMs, this.capMs) ? this.slow + 1 : 0;
    if (this.slow < 2) return null;
    this.slow = 0;
    this.pending = med;
    return { kind: "probe" };
  }

  probed(capMs: number): GovAction | null {
    const med = this.pending;
    this.pending = null;
    if (Number.isFinite(capMs)) this.capMs = capMs;
    if (med === null || med <= 1.25 * Math.max(this.targetMs, this.capMs)) return null;
    if (this.dpr > this.floor + 1e-3) {
      this.dpr = Math.max(this.floor, this.dpr * 0.85);
      return { kind: "dpr", dpr: this.dpr };
    }
    const i = TIER_ORDER.indexOf(this.tier);
    if (i <= 0) {
      this.locked = true;
      return null;
    }
    this.tier = TIER_ORDER[i - 1];
    if (++this.drops >= 2) this.locked = true;
    return { kind: "tier", tier: this.tier };
  }
}
