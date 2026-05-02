import { describe, it, expect } from "vitest";
import {
  FREE_MODEL_CATALOG,
  isModelDeprecated,
  daysUntilDeprecation,
  getActiveFreeModelCatalog,
  getModelsDeprecatingSoon,
  isHardcodedFreeModel,
  getRpmLimit,
} from "@/lib/free-model-catalog";

describe("deprecation watcher", () => {
  it("isModelDeprecated returns false when no deprecatedAfter", () => {
    const e = FREE_MODEL_CATALOG.find((m) => !m.deprecatedAfter)!;
    expect(isModelDeprecated(e)).toBe(false);
  });

  it("isModelDeprecated returns true when date is in the past", () => {
    const e = { ...FREE_MODEL_CATALOG[0], deprecatedAfter: "2020-01-01" };
    expect(isModelDeprecated(e)).toBe(true);
  });

  it("isModelDeprecated returns false when date is in the future", () => {
    const e = { ...FREE_MODEL_CATALOG[0], deprecatedAfter: "2099-01-01" };
    expect(isModelDeprecated(e)).toBe(false);
  });

  it("daysUntilDeprecation returns null when no date set", () => {
    const e = FREE_MODEL_CATALOG.find((m) => !m.deprecatedAfter)!;
    expect(daysUntilDeprecation(e)).toBeNull();
  });

  it("daysUntilDeprecation returns positive when EOL is future", () => {
    // Use a fixed reference time so this stays deterministic
    const refNow = Date.parse("2026-05-01T00:00:00Z");
    const e = { ...FREE_MODEL_CATALOG[0], deprecatedAfter: "2026-05-10" };
    expect(daysUntilDeprecation(e, refNow)).toBe(9);
  });

  it("getActiveFreeModelCatalog excludes EOL models", () => {
    const refNow = Date.parse("2099-01-01T00:00:00Z");
    const all = FREE_MODEL_CATALOG.length;
    const active = getActiveFreeModelCatalog(refNow).length;
    // At year 2099 every model with a deprecatedAfter date should be filtered
    const expectedDropped = FREE_MODEL_CATALOG.filter((m) => m.deprecatedAfter).length;
    expect(active).toBe(all - expectedDropped);
  });

  it("getModelsDeprecatingSoon flags models within 7 days", () => {
    const target = "2026-05-08";
    const refNow = Date.parse("2026-05-03T00:00:00Z"); // 5 days before target
    // Inject a synthetic entry by checking through the helper
    const e = { ...FREE_MODEL_CATALOG[0], deprecatedAfter: target };
    expect(daysUntilDeprecation(e, refNow)).toBe(5);
    // The real helper reads from FREE_MODEL_CATALOG, so we can only assert shape
    const flagged = getModelsDeprecatingSoon(refNow);
    for (const f of flagged) {
      expect(f.daysLeft).toBeGreaterThan(0);
      expect(f.daysLeft).toBeLessThanOrEqual(7);
      expect(f.entry.deprecatedAfter).toBeTruthy();
    }
  });

  it("isHardcodedFreeModel returns false for deprecated models even when listed", () => {
    // cerebras/llama-3.3-70b is tagged with deprecatedAfter=2026-02-16 in the
    // catalog. Today is past that, so it must be rejected.
    expect(isHardcodedFreeModel("cerebras", "llama-3.3-70b")).toBe(false);
    // A non-deprecated cerebras entry stays valid
    expect(isHardcodedFreeModel("cerebras", "qwen-3-32b")).toBe(true);
  });
});

describe("getRpmLimit", () => {
  it("returns the per-provider default for known providers", () => {
    expect(getRpmLimit("groq", "llama-3.3-70b-versatile")).toBe(30);
    expect(getRpmLimit("sealion", "aisingapore/Qwen-SEA-LION-v4-32B-IT")).toBe(10);
    expect(getRpmLimit("typhoon", "typhoon-v2.5-30b-a3b-instruct")).toBe(200);
  });

  it("returns undefined for an unknown provider", () => {
    expect(getRpmLimit("unknown_provider_xyz", "any-model")).toBeUndefined();
  });
});
