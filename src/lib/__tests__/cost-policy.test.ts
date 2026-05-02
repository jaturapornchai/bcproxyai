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
  it("allows only hardcoded remote free models across whitelisted providers", () => {
    expect(getCostAllowedProviders().sort()).toEqual([
      "cerebras", "github", "google", "groq", "mistral", "openrouter", "sambanova",
    ]);
    expect(getFreeModelAllowlist()).toContain("openrouter/openai/gpt-oss-20b:free");
    expect(getFreeModelAllowlist()).toContain("groq/llama-3.3-70b-versatile");
    expect(getFreeModelAllowlist()).toContain("cerebras/llama-3.3-70b");
    expect(getFreeModelAllowlist()).toContain("google/gemini-2.0-flash");
    expect(getFreeModelAllowlist()).toContain("github/openai/gpt-4o-mini");
    expect(getFreeModelAllowlist()).toContain("sambanova/Meta-Llama-3.3-70B-Instruct");
    expect(getFreeModelAllowlist()).toContain("mistral/open-mixtral-8x7b");

    expect(isProviderCostAllowed("ollama")).toBe(false);
    expect(isProviderCostAllowed("pollinations")).toBe(false);
    expect(isProviderCostAllowed("together")).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("groq")).toBe(true);
    expect(isProviderCostAllowed("cerebras")).toBe(true);

    expect(isModelCostAllowed("ollama", "llama3.2")).toBe(false);
    expect(isModelCostAllowed("openrouter", "qwen/qwen3-coder:free")).toBe(true);
    expect(isModelCostAllowed("openrouter", "openrouter/free")).toBe(false);
    expect(isModelCostAllowed("openrouter", "anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isModelCostAllowed("groq", "llama-3.3-70b-versatile")).toBe(true);
    expect(isModelCostAllowed("groq", "llama-3-70b-paid")).toBe(false);
    expect(isModelCostAllowed("google", "gemini-2.5-pro")).toBe(false);
    expect(isModelCostAllowed("google", "gemini-2.5-flash")).toBe(true);
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe(false);
  });

  it("ignores runtime allowlist env vars", () => {
    vi.stubEnv("SML_FREE_PROVIDER_ALLOWLIST", "ollama,pollinations,together");
    vi.stubEnv("SML_FREE_MODEL_ALLOWLIST", "openrouter/*:free,foo/bar-free");

    expect(isProviderCostAllowed("together")).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isModelCostAllowed("openrouter", "x/y:free")).toBe(false);
    expect(isModelCostAllowed("foo", "bar-free")).toBe(false);
    expect(isModelCostAllowed("openrouter", "x/y-paid")).toBe(false);
  });

  it("does not allow paid-provider override", () => {
    vi.stubEnv("SML_ALLOW_PAID_PROVIDERS", "1");

    expect(isPaidProviderOverrideEnabled()).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("anthropic")).toBe(false);
    expect(isModelCostAllowed("together", "any-paid-model")).toBe(false);
  });
});
