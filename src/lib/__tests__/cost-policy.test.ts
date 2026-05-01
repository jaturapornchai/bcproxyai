import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCostAllowedProviders,
  isPaidProviderOverrideEnabled,
  isProviderCostAllowed,
} from "@/lib/cost-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cost policy", () => {
  it("allows only local/no-key providers by default", () => {
    expect(getCostAllowedProviders().sort()).toEqual(["ollama", "pollinations"]);
    expect(isProviderCostAllowed("ollama")).toBe(true);
    expect(isProviderCostAllowed("pollinations")).toBe(true);
    expect(isProviderCostAllowed("openrouter")).toBe(false);
    expect(isProviderCostAllowed("groq")).toBe(false);
  });

  it("allows explicitly verified free providers", () => {
    vi.stubEnv("SML_FREE_PROVIDER_ALLOWLIST", "ollama,pollinations,groq");

    expect(isProviderCostAllowed("groq")).toBe(true);
    expect(isProviderCostAllowed("openrouter")).toBe(false);
  });

  it("can be overridden for paid-provider deployments", () => {
    vi.stubEnv("SML_ALLOW_PAID_PROVIDERS", "1");

    expect(isPaidProviderOverrideEnabled()).toBe(true);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("mistral")).toBe(true);
  });
});
