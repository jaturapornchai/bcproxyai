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
  it("allows only hardcoded remote free models", () => {
    expect(getCostAllowedProviders().sort()).toEqual(["openrouter"]);
    expect(getFreeModelAllowlist()).toContain("openrouter/openai/gpt-oss-20b:free");
    expect(getFreeModelAllowlist()).toContain("openrouter/qwen/qwen3-coder:free");
    expect(isProviderCostAllowed("ollama")).toBe(false);
    expect(isProviderCostAllowed("pollinations")).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("groq")).toBe(false);
    expect(isModelCostAllowed("ollama", "llama3.2")).toBe(false);
    expect(isModelCostAllowed("pollinations", "openai-fast")).toBe(false);
    expect(isModelCostAllowed("openrouter", "qwen/qwen3-coder:free")).toBe(true);
    expect(isModelCostAllowed("openrouter", "openrouter/free")).toBe(false);
    expect(isModelCostAllowed("openrouter", "anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe(false);
  });

  it("ignores runtime allowlist env vars", () => {
    vi.stubEnv("SML_FREE_PROVIDER_ALLOWLIST", "ollama,pollinations,groq");
    vi.stubEnv("SML_FREE_MODEL_ALLOWLIST", "openrouter/*:free,foo/bar-free");

    expect(isProviderCostAllowed("groq")).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isModelCostAllowed("openrouter", "x/y:free")).toBe(false);
    expect(isModelCostAllowed("foo", "bar-free")).toBe(false);
    expect(isModelCostAllowed("openrouter", "x/y-paid")).toBe(false);
  });

  it("does not allow paid-provider override", () => {
    vi.stubEnv("SML_ALLOW_PAID_PROVIDERS", "1");

    expect(isPaidProviderOverrideEnabled()).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("mistral")).toBe(false);
    expect(isModelCostAllowed("together", "any-paid-model")).toBe(false);
  });
});
