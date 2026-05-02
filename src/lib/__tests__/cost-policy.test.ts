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
      "cerebras", "chutes", "cohere", "github", "google", "groq", "huggingface",
      "mistral", "nvidia", "ollamacloud", "openrouter", "sambanova", "sealion",
      "thaillm", "together", "typhoon",
    ]);
    expect(getFreeModelAllowlist()).toContain("openrouter/openai/gpt-oss-20b:free");
    expect(getFreeModelAllowlist()).toContain("groq/llama-3.3-70b-versatile");
    expect(getFreeModelAllowlist()).toContain("cerebras/llama-3.3-70b");
    expect(getFreeModelAllowlist()).toContain("google/gemini-2.5-flash");
    expect(getFreeModelAllowlist()).toContain("github/openai/gpt-4o-mini");
    expect(getFreeModelAllowlist()).toContain("sambanova/Meta-Llama-3.3-70B-Instruct");
    expect(getFreeModelAllowlist()).toContain("mistral/codestral-latest");
    expect(getFreeModelAllowlist()).toContain("cohere/command-r-plus");
    expect(getFreeModelAllowlist()).toContain("huggingface/Qwen/Qwen3-32B");
    expect(getFreeModelAllowlist()).toContain("nvidia/meta/llama-3.3-70b-instruct");
    expect(getFreeModelAllowlist()).toContain("together/meta-llama/Llama-3.3-70B-Instruct-Turbo-Free");
    expect(getFreeModelAllowlist()).toContain("chutes/deepseek-ai/DeepSeek-R1");
    expect(getFreeModelAllowlist()).toContain("ollamacloud/gpt-oss:120b-cloud");
    expect(getFreeModelAllowlist()).toContain("typhoon/typhoon-v2.5-30b-a3b-instruct");
    expect(getFreeModelAllowlist()).toContain("thaillm/openthaigpt-thaillm-8b-instruct-v7.2");
    expect(getFreeModelAllowlist()).toContain("sealion/aisingapore/Gemma-SEA-LION-v4-27B-IT");

    expect(isProviderCostAllowed("typhoon")).toBe(true);
    expect(isProviderCostAllowed("thaillm")).toBe(true);
    expect(isProviderCostAllowed("sealion")).toBe(true);
    expect(isModelCostAllowed("typhoon", "typhoon-v2.1-12b-instruct")).toBe(true);
    expect(isModelCostAllowed("typhoon", "typhoon-v2-pro-paid")).toBe(false);

    expect(isProviderCostAllowed("ollama")).toBe(false);
    expect(isProviderCostAllowed("pollinations")).toBe(false);
    expect(isProviderCostAllowed("cloudflare")).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("groq")).toBe(true);
    expect(isProviderCostAllowed("nvidia")).toBe(true);
    expect(isProviderCostAllowed("ollamacloud")).toBe(true);

    expect(isModelCostAllowed("ollama", "llama3.2")).toBe(false);
    expect(isModelCostAllowed("openrouter", "qwen/qwen3-coder:free")).toBe(true);
    expect(isModelCostAllowed("openrouter", "openrouter/free")).toBe(false);
    expect(isModelCostAllowed("openrouter", "anthropic/claude-sonnet-4.5")).toBe(false);
    expect(isModelCostAllowed("groq", "llama-3.3-70b-versatile")).toBe(true);
    expect(isModelCostAllowed("groq", "llama-3-70b-paid")).toBe(false);
    expect(isModelCostAllowed("google", "gemini-2.5-flash")).toBe(true);
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free")).toBe(true);
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe(false);
    expect(isModelCostAllowed("nvidia", "deepseek-ai/deepseek-r1")).toBe(true);
    expect(isModelCostAllowed("chutes", "moonshotai/Kimi-K2.5")).toBe(true);
  });

  it("ignores runtime allowlist env vars", () => {
    vi.stubEnv("SML_FREE_PROVIDER_ALLOWLIST", "ollama,pollinations,cloudflare");
    vi.stubEnv("SML_FREE_MODEL_ALLOWLIST", "openrouter/*:free,foo/bar-free");

    expect(isProviderCostAllowed("cloudflare")).toBe(false);
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
