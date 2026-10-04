import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  keys: [] as string[],
  state: new Map<string, string>(),
  enabled: true,
  gatewayToday: 0,
  logs: [] as string[],
  setEnabled: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  getSqlClient: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM api_keys")) return db.keys.map((api_key) => ({ api_key }));
    if (text.includes("SELECT value FROM worker_state")) {
      const v = db.state.get(values[0] as string);
      return v === undefined ? [] : [{ value: v }];
    }
    if (text.includes("INSERT INTO worker_state")) {
      db.state.set(values[0] as string, values[1] as string);
      return [];
    }
    if (text.includes("DELETE FROM worker_state")) {
      for (const k of [...db.state.keys()]) if (k === values[0] || k.startsWith(values[1] as string)) db.state.delete(k);
      return [];
    }
    if (text.includes("FROM gateway_logs")) return [{ n: String(db.gatewayToday) }];
    if (text.includes("INSERT INTO worker_logs")) {
      db.logs.push(String(values[0]));
      return [];
    }
    return [];
  },
}));
vi.mock("@/lib/secret-vault", () => ({ open: (v: string) => v }));
vi.mock("@/lib/provider-toggle", () => ({
  isProviderEnabled: async () => db.enabled,
  setProviderEnabled: async (provider: string, enabled: boolean) => {
    db.setEnabled(provider, enabled);
    db.enabled = enabled;
  },
}));

const SAFE = {
  usage: 0,
  usage_daily: 0,
  limit: 0,
  limit_remaining: 0,
  is_free_tier: true,
  free_model_daily_requests: { limit: 50, used: 3, remaining: 47 },
};

function stubKey(data: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data }), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A fresh module drops the 5-minute remote cache; the DB (db.*) survives like it does in production.
async function freshStatus() {
  vi.resetModules();
  return (await import("@/lib/openrouter-key-status")).getOpenRouterKeyStatus();
}

beforeEach(() => {
  db.keys = ["sk-or-test"];
  db.state.clear();
  db.enabled = true;
  db.gatewayToday = 0;
  db.logs = [];
  db.setEnabled.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getOpenRouterKeyStatus levels", () => {
  it("no stored key → not configured, unknown, no upstream call", async () => {
    db.keys = [];
    const f = stubKey(SAFE);
    const s = await freshStatus();
    expect(s).toMatchObject({ configured: false, level: "unknown" });
    expect(f).not.toHaveBeenCalled();
  });

  it("limit = 0, free tier, low quota → ok, baseline stored, provider untouched", async () => {
    stubKey(SAFE);
    const s = await freshStatus();
    expect(s).toMatchObject({ configured: true, level: "ok", isFreeTier: true, limit: 0, usage: 0, freeDailyLimit: 50, freeUsedToday: 3, disabledByTripwire: false });
    expect(s.messages).toEqual([]);
    expect([...db.state.keys()].some((k) => k.startsWith("or_usage_baseline:"))).toBe(true);
    expect(db.setEnabled).not.toHaveBeenCalled();
  });

  it("key without credit limit (limit null) → warn", async () => {
    stubKey({ ...SAFE, limit: null, limit_remaining: null });
    const s = await freshStatus();
    expect(s.level).toBe("warn");
    expect(s.limit).toBeNull();
    expect(s.messages.join("\n")).toContain("credit limit");
  });

  it("account that bought credits (not free tier) → warn", async () => {
    stubKey({ ...SAFE, is_free_tier: false });
    const s = await freshStatus();
    expect(s.level).toBe("warn");
    expect(s.isFreeTier).toBe(false);
    expect(s.messages.join("\n")).toContain("free tier");
  });

  it("free quota ≥ 80% (API counter) → warn", async () => {
    stubKey({ ...SAFE, free_model_daily_requests: { limit: 50, used: 41, remaining: 9 } });
    const s = await freshStatus();
    expect(s.level).toBe("warn");
    expect(s.messages.join("\n")).toContain("41/50");
    expect(s.messages.join("\n")).not.toContain("ประมาณ");
  });

  it("no API counter → falls back to today's gateway rows and labels it an estimate", async () => {
    stubKey({ ...SAFE, free_model_daily_requests: undefined });
    db.gatewayToday = 45;
    const s = await freshStatus();
    expect(s).toMatchObject({ level: "warn", freeDailyLimit: 50, freeUsedToday: 45 });
    expect(s.messages.join("\n")).toContain("ประมาณ");
  });

  it("upstream HTTP error → unknown", async () => {
    stubKey({}, 401);
    const s = await freshStatus();
    expect(s.level).toBe("unknown");
    expect(s.messages.join("\n")).toContain("401");
  });

  it("caches the OpenRouter response for repeat calls", async () => {
    const f = stubKey(SAFE);
    vi.resetModules();
    const { getOpenRouterKeyStatus } = await import("@/lib/openrouter-key-status");
    await getOpenRouterKeyStatus();
    await getOpenRouterKeyStatus();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("spend tripwire", () => {
  it("usage above the stored baseline → alert + provider disabled + worker log, stays tripped", async () => {
    stubKey(SAFE);
    expect((await freshStatus()).level).toBe("ok");

    stubKey({ ...SAFE, usage: 0.0123 });
    const tripped = await freshStatus();
    expect(tripped).toMatchObject({ level: "alert", disabledByTripwire: true });
    expect(db.setEnabled).toHaveBeenCalledWith("openrouter", false);
    expect(db.logs.some((m) => m.includes("TRIPWIRE"))).toBe(true);

    db.setEnabled.mockClear();
    stubKey({ ...SAFE, usage: 0.0123 });
    const again = await freshStatus();
    expect(again).toMatchObject({ level: "alert", disabledByTripwire: true });
    expect(db.setEnabled).not.toHaveBeenCalled();
  });

  it("owner re-enables by hand → tripwire cleared, baseline restarts at current usage", async () => {
    stubKey(SAFE);
    await freshStatus();
    stubKey({ ...SAFE, usage: 0.5 });
    await freshStatus();
    expect(db.enabled).toBe(false);

    db.enabled = true; // manual re-enable in /setup
    stubKey({ ...SAFE, usage: 0.5 });
    const s = await freshStatus();
    expect(s.disabledByTripwire).toBe(false);
    expect(s.level).not.toBe("alert");
    expect(db.state.has("or_tripwire")).toBe(false);
    expect([...db.state.values()]).toContain("0.5");
    expect(db.setEnabled).toHaveBeenCalledTimes(1); // only the original trip
  });
});
