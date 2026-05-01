import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCostAllowedProviders,
  getFreeModelAllowlist,
  isModelCostAllowed,
  isPaidProviderOverrideEnabled,
  isProviderCostAllowed,
} from "@/lib/cost-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cost policy", () => {
  it("allows only trusted providers and explicit free model rules by default", () => {
    expect(getCostAllowedProviders().sort()).toEqual(["ollama", "openrouter", "pollinations"]);
    expect(getFreeModelAllowlist().sort()).toEqual(["openrouter/*:free", "openrouter/openrouter/free"]);
    expect(isProviderCostAllowed("ollama")).toBe(true);
    expect(isProviderCostAllowed("pollinations")).toBe(true);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("groq")).toBe(false);
    expect(isModelCostAllowed("ollama", "llama3.2")).toBe(true);
    expect(isModelCostAllowed("pollinations", "openai-fast")).toBe(true);
    expect(isModelCostAllowed("openrouter", "qwen/qwen3-coder:free")).toBe(true);
    expect(isModelCostAllowed("openrouter", "openrouter/free")).toBe(true);
    expect(isModelCostAllowed("openrouter", "anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe(false);
  });

  it("allows explicitly verified free providers and model rules", () => {
    vi.stubEnv("SML_FREE_PROVIDER_ALLOWLIST", "ollama,pollinations,groq");
    vi.stubEnv("SML_FREE_MODEL_ALLOWLIST", "openrouter/*:free,foo/bar-free");

    expect(isProviderCostAllowed("groq")).toBe(true);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isModelCostAllowed("openrouter", "x/y:free")).toBe(true);
    expect(isModelCostAllowed("foo", "bar-free")).toBe(true);
    expect(isModelCostAllowed("openrouter", "x/y-paid")).toBe(false);
  });

  it("can be overridden for paid-provider deployments", () => {
    vi.stubEnv("SML_ALLOW_PAID_PROVIDERS", "1");

    expect(isPaidProviderOverrideEnabled()).toBe(true);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("mistral")).toBe(true);
    expect(isModelCostAllowed("together", "any-paid-model")).toBe(true);
  });
});
