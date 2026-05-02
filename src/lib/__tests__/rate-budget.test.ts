import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake Redis: tracks INCR + EXPIRE without needing a real server.
const store = new Map<string, number>();
const fakeRedis = {
  incr: vi.fn(async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  }),
  expire: vi.fn(async (_key: string, _seconds: number) => 1),
  get: vi.fn(async (key: string) => store.get(key)?.toString() ?? null),
};

vi.mock("@/lib/redis", () => ({
  ensureRedisConnected: vi.fn(async () => fakeRedis),
}));

import { tryConsumeRpm, getCurrentRpmUsage } from "@/lib/rate-budget";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("rate-budget", () => {
  it("allows requests when no rpmLimit", async () => {
    const r = await tryConsumeRpm("p", "m", undefined);
    expect(r.ok).toBe(true);
    expect(fakeRedis.incr).not.toHaveBeenCalled();
  });

  it("allows requests when rpmLimit <= 0", async () => {
    const r = await tryConsumeRpm("p", "m", 0);
    expect(r.ok).toBe(true);
    expect(fakeRedis.incr).not.toHaveBeenCalled();
  });

  it("admits requests up to the limit and rejects past it", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await tryConsumeRpm("groq", "test-model", 5);
      expect(r.ok).toBe(true);
    }
    const overflow = await tryConsumeRpm("groq", "test-model", 5);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.usage).toBe(6);
      expect(overflow.limit).toBe(5);
      expect(overflow.retryInMs).toBeGreaterThan(0);
    }
  });

  it("calls EXPIRE on the first request only", async () => {
    await tryConsumeRpm("p", "m", 10);
    await tryConsumeRpm("p", "m", 10);
    await tryConsumeRpm("p", "m", 10);
    expect(fakeRedis.expire).toHaveBeenCalledTimes(1);
  });

  it("isolates buckets per (provider, model)", async () => {
    await tryConsumeRpm("groq", "modelA", 2);
    await tryConsumeRpm("groq", "modelA", 2);
    // Different model — own bucket
    const otherModel = await tryConsumeRpm("groq", "modelB", 2);
    expect(otherModel.ok).toBe(true);
    // Different provider — own bucket
    const otherProvider = await tryConsumeRpm("cerebras", "modelA", 2);
    expect(otherProvider.ok).toBe(true);
  });

  it("fails open when Redis throws", async () => {
    fakeRedis.incr.mockRejectedValueOnce(new Error("redis down"));
    const r = await tryConsumeRpm("p", "m", 1);
    expect(r.ok).toBe(true);
  });

  it("getCurrentRpmUsage returns 0 when bucket is empty", async () => {
    expect(await getCurrentRpmUsage("p", "m")).toBe(0);
  });

  it("getCurrentRpmUsage reflects consumed slots", async () => {
    await tryConsumeRpm("p", "m", 10);
    await tryConsumeRpm("p", "m", 10);
    const usage = await getCurrentRpmUsage("p", "m");
    expect(usage).toBe(2);
  });
});
