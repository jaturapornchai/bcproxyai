import { describe, expect, it } from "vitest";
import { parseLastCycle, shapeInsights, type InsightsSnapshot } from "@/lib/insights";
import { EXAM_SUBJECTS } from "@/lib/insights-types";
import { FREE_MODEL_CATALOG } from "@/lib/free-model-catalog";

const now = new Date();
const ago = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const PROVIDERS = [...new Set(FREE_MODEL_CATALOG.map((m) => m.provider))];
const TITLE = "groq: nvidia/nemotron-nano failed thai check";
// "incidents" is also the per-hour count inside day[], so owner-only keys are checked where they live.
const OWNER_ONLY = { top: ["incidents", "systems", "perf", "limits", "cooldowns", "errors"], exam: ["leaders", "level", "judgeModel"], worker: ["lastCycle"], kpi: ["selfHealed"] };

const zeros = () => EXAM_SUBJECTS.map(() => 0);
const day = Array.from({ length: 24 }, (_, i) => ({ t: ago((23 - i) * 60), requests: i, failures: i % 3, p50LatencyMs: 900, incidents: i % 2 }));

const snap: InsightsSnapshot = {
  kpi: { p95LatencyMs: 3400, selfHealed: 2, tokensToday: 1_234_567 },
  day,
  worker: {
    status: "running",
    lastRun: ago(5),
    nextRun: ago(-10),
    lastCycle: { scan: { found: 88, new: 1 }, health: { checked: 80, available: 70, cooldown: 4 }, exam: { examined: 5, passed: 3, failed: 2 } },
  },
  fleet: { serving: 23, cooling: 4, newModels24h: 1 },
  exam: {
    top5: [81.2, 70, 65.5, 90, 88, 99],
    passing: [12, 10, 9, 14, 13, 15],
    attempts24h: { passed: 18, failed: 3, running: 2 },
    leaders: EXAM_SUBJECTS.map((_, i) => (i === 1 ? null : { provider: "groq", model: "nvidia/nemotron-nano:free", scorePct: 95 })),
    level: "middle",
    judgeModel: "openrouter/nvidia/nemotron-judge",
  },
  incidents: [{ t: ago(30), type: "thai_quality_fail", severity: "warn", title: TITLE, provider: "groq" }],
  systems: { database: { ok: true, latencyMs: 4 }, redis: { ok: true }, alerts: ["Internal error: groq exploded"] },
  perf: { "cache:hit": 1, "cache:miss": 2, "hedge:win": 0, "hedge:loss": 0, "spec:fire": 0, "spec:win": 0, "sticky:hit": 3, "semantic:hit": 0, "demote:rate-limit": 1 },
  limits: [{ provider: "groq", tpmLeft: 0.1, tpdLeft: null, nextReset: ago(-1), last429: ago(2), models: 3 }],
  cooldowns: { total: 4, items: [{ provider: "groq", model: "nvidia/nemotron-nano:free", status: "rate_limited", until: ago(-3), error: "provider_error 429 from groq" }] },
  errors: {
    classes: { rateLimited: 8, server: 3, client: 1, timeout: 2 },
    recent: [{ t: ago(1), provider: "groq", model: "nvidia/nemotron-nano:free", status: 429, error: "provider_error: rate limited" }],
  },
};

describe("public insights", () => {
  const data = shapeInsights("public", snap, now);
  const json = JSON.stringify(data).toLowerCase();

  it("omits every owner-only key (absent, not empty)", () => {
    for (const key of OWNER_ONLY.top) expect(data).not.toHaveProperty(key);
    for (const key of OWNER_ONLY.exam) expect(data.exam).not.toHaveProperty(key);
    for (const key of OWNER_ONLY.worker) expect(data.worker).not.toHaveProperty(key);
    for (const key of OWNER_ONLY.kpi) expect(data.kpi).not.toHaveProperty(key);
    expect(Object.keys(data).sort()).toEqual(["day", "exam", "fleet", "generatedAt", "kpi", "scope", "worker"]);
    for (const h of data.day) expect(Object.keys(h).sort()).toEqual(["failures", "incidents", "p50LatencyMs", "requests", "t"]);
  });

  it("contains no provider, model, title or category strings", () => {
    expect(PROVIDERS.length).toBeGreaterThan(0);
    for (const name of [...PROVIDERS, "nemotron", "nvidia", "thai", "provider_error", TITLE, "internal error", "rate_limited"]) {
      expect(json).not.toContain(name.toLowerCase());
    }
  });

  const pub = (kpi: Partial<InsightsSnapshot["kpi"]>) => shapeInsights("public", { ...snap, kpi: { ...snap.kpi, ...kpi } }, now).kpi;

  it("floors tokensToday to a 100K grid and hides it below one step", () => {
    expect(data.kpi.tokensToday).toBe(1_200_000);
    // small-N: the first requests of the day must not be readable, exactly or nearly
    for (const n of [0, 37, 1234, 37 + 1234, 99_999]) expect(pub({ tokensToday: n }).tokensToday).toBeNull();
    expect(pub({ tokensToday: 100_000 }).tokensToday).toBe(100_000);
    expect(pub({ tokensToday: 199_999 }).tokensToday).toBe(100_000);
    // two snapshots one request apart differ by 0 or a full grid step, never by the request size
    expect(pub({ tokensToday: 150_000 + 1234 }).tokensToday).toBe(pub({ tokensToday: 150_000 }).tokensToday);
  });

  it("never publishes selfHealed, even when one request healed", () => {
    const k = pub({ selfHealed: 1 });
    expect(k).not.toHaveProperty("selfHealed");
    expect(JSON.stringify(k)).not.toContain("selfHealed");
  });

  it("keeps the anonymous aggregates", () => {
    expect(data.scope).toBe("public");
    expect(data.day).toHaveLength(24);
    expect(data.worker).toEqual({ status: "running", lastRun: snap.worker.lastRun, nextRun: snap.worker.nextRun });
    expect(data.fleet).toEqual(snap.fleet);
    expect(data.exam).toEqual({ top5: snap.exam.top5, passing: snap.exam.passing, attempts24h: snap.exam.attempts24h });
    expect(data.exam.top5).toHaveLength(EXAM_SUBJECTS.length);
  });

  it("maps an unexpected worker status to unknown", () => {
    const odd = shapeInsights("public", { ...snap, worker: { ...snap.worker, status: "groq tripwire" } }, now);
    expect(odd.worker.status).toBe("unknown");
  });
});

describe("owner insights", () => {
  const data = shapeInsights("owner", snap, now);

  it("keeps every owner-only field and the exact token count", () => {
    expect(data.kpi).toEqual(snap.kpi);
    expect(data.worker.lastCycle).toEqual(snap.worker.lastCycle);
    expect(data.exam).toMatchObject({ leaders: snap.exam.leaders, level: "middle", judgeModel: snap.exam.judgeModel });
    expect(data).toMatchObject({
      incidents: snap.incidents,
      systems: snap.systems,
      perf: snap.perf,
      limits: snap.limits,
      cooldowns: snap.cooldowns,
      errors: snap.errors,
    });
  });
});

describe("empty data", () => {
  const empty: InsightsSnapshot = {
    ...snap,
    kpi: { p95LatencyMs: 0, selfHealed: 0, tokensToday: 0 },
    day: day.map((h) => ({ ...h, requests: 0, failures: 0, p50LatencyMs: 0, incidents: 0 })),
    worker: { status: "unknown", lastRun: null, nextRun: null, lastCycle: null },
    fleet: { serving: 0, cooling: 0, newModels24h: 0 },
    exam: { top5: zeros(), passing: zeros(), attempts24h: { passed: 0, failed: 0, running: 0 }, leaders: EXAM_SUBJECTS.map(() => null), level: null, judgeModel: null },
    incidents: [],
    limits: [],
    cooldowns: { total: 0, items: [] },
    errors: { classes: { rateLimited: 0, server: 0, client: 0, timeout: 0 }, recent: [] },
  };

  it("shapes without NaN in either scope", () => {
    for (const scope of ["public", "owner"] as const) {
      const json = JSON.stringify(shapeInsights(scope, empty, now));
      expect(json).not.toMatch(/NaN|Infinity|Invalid/);
    }
  });

  it("parses last_stats defensively", () => {
    expect(parseLastCycle(null)).toBeNull();
    expect(parseLastCycle("not json")).toBeNull();
    expect(parseLastCycle("42")).toBeNull();
    expect(parseLastCycle('{"scan":{"found":88,"new":0,"disappeared":0},"exam":{"examined":"x","level":"middle"}}')).toEqual({
      scan: { found: 88, new: 0 },
      health: { checked: 0, available: 0, cooldown: 0 },
      exam: { examined: 0, passed: 0, failed: 0 },
    });
  });
});
