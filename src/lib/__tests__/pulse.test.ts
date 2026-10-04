import { describe, expect, it } from "vitest";
import { filterSince, parseSince, publicStarId, shapePulse, type PulseSnapshot } from "@/lib/pulse";

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const route = { mode: "tools", category: "thai", reason: "selected:healthy", fallbackUsed: false, candidates: 2 };

const snap: PulseSnapshot = {
  health: "degraded",
  hour: { requests: 3, ok: 1, p50: 900 },
  today: 12,
  series: [{ t: minutesAgo(1).toISOString(), requests: 3, failures: 2, p50LatencyMs: 900 }],
  providers: [
    { provider: "openrouter", label: "OpenRouter", hasKey: true, models: 4, available: 4 },
    { provider: "groq", label: "Groq Cloud", hasKey: false, models: 2, available: 0 },
  ],
  modelsHour: [{ provider: "openrouter", model: "nvidia/nemotron-nano:free", requests: 3, ok: 1, p50: 900 }],
  events: [
    { id: "101", createdAt: minutesAgo(10), provider: "openrouter", requestModel: "llama-auto", model: "nvidia/nemotron-nano:free", status: 200, latencyMs: 800, tokensIn: 10, tokensOut: 20, route },
    { id: "102", createdAt: minutesAgo(5), provider: "openrouter", requestModel: "llama-auto", model: "nvidia/nemotron-nano:free", status: 500, latencyMs: 1200, tokensIn: 10, tokensOut: 0, route },
    { id: "103", createdAt: minutesAgo(1), provider: null, requestModel: "llama-auto", model: null, status: 503, latencyMs: 5, tokensIn: 0, tokensOut: 0, route: null },
  ],
};

const OWNER_ONLY_EVENT_KEYS = ["model", "requestModel", "status", "tokensIn", "tokensOut", "route"];

describe("public pulse", () => {
  const data = shapePulse("public", snap, now);

  it("omits every owner-only key", () => {
    expect(data.scope).toBe("public");
    expect(data).not.toHaveProperty("topModels");
    for (const star of data.stars) {
      for (const key of ["label", "models", "available"]) expect(star).not.toHaveProperty(key);
    }
    for (const event of data.events) {
      for (const key of OWNER_ONLY_EVENT_KEYS) expect(event).not.toHaveProperty(key);
    }
  });

  it("contains no provider, model or routing names", () => {
    const json = JSON.stringify(data).toLowerCase();
    for (const name of ["openrouter", "groq", "nemotron", "nvidia", "llama", "tools", "thai", "selected"]) {
      expect(json).not.toContain(name);
    }
  });

  it("uses opaque ids and keeps events attached to their star", () => {
    const starId = publicStarId("openrouter", now);
    expect(data.stars.map((s) => s.id).sort()).toEqual([starId, publicStarId("groq", now)].sort());
    for (const star of data.stars) expect(star.id).toMatch(/^s[0-9a-f]{6}$/);
    for (const event of data.events) expect(event.id).toMatch(/^e[0-9a-f]{12}$/);
    expect(data.events.map((e) => e.star)).toEqual([starId, starId, ""]);
    expect(data.events.map((e) => e.ok)).toEqual([true, false, false]);
  });

  it("derives stats and star status", () => {
    expect(data.status).toBe("degraded");
    expect(data.stats).toMatchObject({ requestsLastHour: 3, requestsToday: 12, providersUp: 1, providersTotal: 2, modelsAvailable: 4, modelsTotal: 6, spentUsd: "0.00" });
    const byStatus = Object.fromEntries(data.stars.map((s) => [s.status, s.load]));
    expect(byStatus).toEqual({ up: 3, nokey: 0 }); // 1/3 ok, but under 5 requests is too few to call it degraded
  });
});

describe("owner pulse", () => {
  const data = shapePulse("owner", snap, now);

  it("keeps real ids, labels, event detail and top models", () => {
    expect(data.stars.find((s) => s.id === "openrouter")?.label).toBe("OpenRouter");
    expect(data.events[0]).toMatchObject({ id: "101", star: "openrouter", model: "nvidia/nemotron-nano:free", requestModel: "llama-auto", status: 200, tokensIn: 10, tokensOut: 20, route });
    expect(data.events[2].star).toBe("");
    expect(data.topModels).toEqual([{ provider: "openrouter", model: "nvidia/nemotron-nano:free", requests: 3, successRate: 0.333, p50LatencyMs: 900 }]);
  });
});

describe("publicStarId", () => {
  it("is stable within a UTC day and changes across days and providers", () => {
    const morning = new Date("2026-10-04T00:00:01Z");
    const night = new Date("2026-10-04T23:59:59Z");
    const nextDay = new Date("2026-10-05T00:00:01Z");
    expect(publicStarId("groq", morning)).toBe(publicStarId("groq", night));
    expect(publicStarId("groq", night)).not.toBe(publicStarId("groq", nextDay));
    expect(publicStarId("groq", morning)).not.toBe(publicStarId("openrouter", morning));
  });
});

describe("since filter", () => {
  const data = shapePulse("public", snap, now);
  const ids = (since: string | null) => filterSince(data, since).events.map((e) => e.star);

  it("returns only events strictly newer than since", () => {
    expect(filterSince(data, minutesAgo(6).toISOString()).events).toEqual(data.events.slice(1));
    expect(filterSince(data, data.events[2].t).events).toEqual([]);
  });

  it("ignores a missing, malformed or too-old since", () => {
    expect(ids(null)).toHaveLength(3);
    expect(ids("yesterday")).toHaveLength(3);
    expect(ids(String(now.getTime()))).toHaveLength(3);
    expect(ids(minutesAgo(16).toISOString())).toHaveLength(3);
    expect(parseSince(minutesAgo(14).toISOString())).toBe(minutesAgo(14).getTime());
  });
});
