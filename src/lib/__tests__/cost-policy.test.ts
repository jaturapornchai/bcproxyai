import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyNoSpendGuards,
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
      "cerebras", "cohere", "groq",
      "mistral", "nvidia", "ollamacloud", "openrouter", "sambanova", "sealion",
      "thaillm", "typhoon",
    ]);
    expect(getFreeModelAllowlist()).toContain("openrouter/openai/gpt-oss-20b:free");
    expect(getFreeModelAllowlist()).toContain("groq/llama-3.3-70b-versatile");
    expect(getFreeModelAllowlist()).toContain("cerebras/qwen-3-32b");
    // Deprecation watcher should hide models past their deprecatedAfter date
    expect(getFreeModelAllowlist()).not.toContain("cerebras/llama-3.3-70b");
    expect(isModelCostAllowed("cerebras", "llama-3.3-70b")).toBe(false);
    expect(getFreeModelAllowlist()).toContain("sambanova/Meta-Llama-3.3-70B-Instruct");
    expect(getFreeModelAllowlist()).toContain("mistral/codestral-latest");
    expect(getFreeModelAllowlist()).toContain("cohere/command-r-plus");
    expect(getFreeModelAllowlist()).toContain("nvidia/meta/llama-3.3-70b-instruct");
    expect(isProviderCostAllowed("chutes")).toBe(false); // removed (paywall via TAO crypto)
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
    expect(isModelCostAllowed("openrouter", "google/gemma-3-27b-it:free")).toBe(true); // Google-made, served by OpenRouter
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe(false);
    expect(isModelCostAllowed("nvidia", "deepseek-ai/deepseek-r1")).toBe(true);
    expect(isModelCostAllowed("chutes", "deepseek-ai/DeepSeek-R1")).toBe(false); // chutes provider removed
  });

  it("blocks providers with no genuinely free path (together / huggingface / github) and banned Google AI Studio", () => {
    for (const provider of ["together", "huggingface", "github", "google"]) {
      expect(isProviderCostAllowed(provider)).toBe(false);
      expect(getFreeModelAllowlist().some((rule) => rule.startsWith(`${provider}/`))).toBe(false);
    }
    // formerly-listed ids must be rejected even though stale DB rows may still carry them
    expect(isModelCostAllowed("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free")).toBe(false);
    expect(isModelCostAllowed("huggingface", "Qwen/Qwen3-32B")).toBe(false);
    expect(isModelCostAllowed("github", "openai/gpt-4o-mini")).toBe(false);
    expect(isModelCostAllowed("google", "gemini-2.5-flash")).toBe(false);
    expect(isModelCostAllowed("google", "gemini-3-flash-preview")).toBe(false);
  });

  it("ignores runtime allowlist env vars", () => {
    vi.stubEnv("BCAI_FREE_PROVIDER_ALLOWLIST", "ollama,pollinations,cloudflare");
    vi.stubEnv("BCAI_FREE_MODEL_ALLOWLIST", "openrouter/*:free,foo/bar-free");

    expect(isProviderCostAllowed("cloudflare")).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isModelCostAllowed("openrouter", "x/y:free")).toBe(false);
    expect(isModelCostAllowed("foo", "bar-free")).toBe(false);
    expect(isModelCostAllowed("openrouter", "x/y-paid")).toBe(false);
  });

  it("does not allow paid-provider override", () => {
    vi.stubEnv("BCAI_ALLOW_PAID_PROVIDERS", "1");

    expect(isPaidProviderOverrideEnabled()).toBe(false);
    expect(isProviderCostAllowed("openrouter")).toBe(true);
    expect(isProviderCostAllowed("anthropic")).toBe(false);
    expect(isModelCostAllowed("together", "any-paid-model")).toBe(false);
  });
});

describe("applyNoSpendGuards", () => {
  const attack = {
    model: "nvidia/nemotron-3-super-120b-a12b:free",
    messages: [{ role: "user", content: "hi" }],
    models: ["anthropic/claude-opus-4"],
    route: "fallback",
    preset: "@paid",
    provider: { sort: "price", max_price: { prompt: 99 } },
    plugins: [{ id: "web" }],
    web_search_options: {},
  };

  it("OpenRouter: drops paid fallbacks/add-ons and forces a $0 max_price", () => {
    const out = applyNoSpendGuards("OpenRouter", attack);
    expect(out).toEqual({
      model: attack.model,
      messages: attack.messages,
      provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
    });
  });

  it("other providers: strips the same keys without adding provider prefs", () => {
    const out = applyNoSpendGuards("groq", attack);
    expect(Object.keys(out).sort()).toEqual(["messages", "model"]);
  });

  it("does not mutate the caller's body", () => {
    const body = { model: "m", models: ["x"] };
    applyNoSpendGuards("openrouter", body);
    expect(body).toEqual({ model: "m", models: ["x"] });
  });

  const fnTool = { type: "function", function: { name: "get_weather", parameters: { type: "object" } } };

  it("OpenRouter: keeps only function tools (server tools are billed outside max_price)", () => {
    const out = applyNoSpendGuards("openrouter", {
      model: "openai/gpt-oss-120b:free",
      tools: [
        { type: "openrouter:advisor", parameters: { model: "~anthropic/claude-opus-latest" } },
        { type: "openrouter:web_search", parameters: { engine: "exa", max_results: 25 } },
        fnTool,
      ],
      tool_choice: "required",
    });
    expect(out.tools).toEqual([fnTool]);
    expect(out.tool_choice).toBe("required");
  });

  it("groq: drops browser_search/code_interpreter and the tool_choice that needed them", () => {
    const out = applyNoSpendGuards("groq", {
      model: "openai/gpt-oss-120b",
      tools: [{ type: "browser_search" }, { type: "code_interpreter" }],
      tool_choice: "required",
    });
    expect(out).not.toHaveProperty("tools");
    expect(out).not.toHaveProperty("tool_choice");
  });

  it("drops a tool_choice that names a non-function tool, keeps function/string choices", () => {
    expect(applyNoSpendGuards("openrouter", { tools: [fnTool], tool_choice: { type: "openrouter:web_search" } })).not.toHaveProperty("tool_choice");
    const named = { type: "function", function: { name: "get_weather" } };
    expect(applyNoSpendGuards("groq", { tools: [fnTool], tool_choice: named }).tool_choice).toBe(named);
    expect(applyNoSpendGuards("groq", { tool_choice: "none" }).tool_choice).toBe("none");
  });

  it("removes file/document/audio content parts (PDF OCR is billed outside max_price)", () => {
    const image = { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } };
    const out = applyNoSpendGuards("openrouter", {
      messages: [
        { role: "system", content: "be brief" },
        {
          role: "user",
          content: [
            { type: "text", text: "summarize" },
            image,
            { type: "file", file: { filename: "a.pdf", file_data: "https://attacker.example/1000-pages.pdf" } },
            { type: "document_url", document_url: "https://attacker.example/doc.pdf" },
            { type: "input_audio", input_audio: { data: "AA==", format: "wav" } },
          ],
        },
      ],
    });
    expect(out.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: [{ type: "text", text: "summarize" }, image] },
    ]);
  });

  it("keeps untouched tools/messages by reference", () => {
    const body = { tools: [fnTool], messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    const out = applyNoSpendGuards("openrouter", body);
    expect(out.tools).toBe(body.tools);
    expect(out.messages).toBe(body.messages);
  });
});
