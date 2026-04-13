import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getDb
const mockRun = vi.fn(() => ({ changes: 0 }));
const mockGet = vi.fn();
const mockAll = vi.fn(() => []);
const mockPrepare = vi.fn(() => ({
  run: mockRun,
  get: mockGet,
  all: mockAll,
}));
const mockDb = { prepare: mockPrepare };

vi.mock("@/lib/db/schema", () => ({
  getDb: vi.fn(() => mockDb),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  isNonChatModel,
  pingModel,
  testToolSupport,
  testVisionSupport,
  checkHealth,
} from "../health";

// Helper to create a model object matching the DbModel interface
function makeModel(provider = "openrouter", modelId = "test-model") {
  return {
    id: `${provider}:${modelId}`,
    provider,
    model_id: modelId,
    context_length: 128000,
    supports_tools: -1,
    supports_vision: -1,
  };
}

describe("isNonChatModel", () => {
  it("returns true for whisper models", () => {
    expect(isNonChatModel("openai/whisper-large-v3")).toBe(true);
  });

  it("returns true for lyria models", () => {
    expect(isNonChatModel("google/lyria-2")).toBe(true);
  });

  it("returns true for orpheus models", () => {
    expect(isNonChatModel("canopy/orpheus-tts")).toBe(true);
  });

  it("returns true for prompt-guard models", () => {
    expect(isNonChatModel("meta-llama/prompt-guard")).toBe(true);
  });

  it("returns true for safeguard models", () => {
    expect(isNonChatModel("ibm/safeguard-8b")).toBe(true);
  });

  it("returns true for compound models", () => {
    expect(isNonChatModel("groq/compound-beta")).toBe(true);
  });

  it("returns true for allam models", () => {
    expect(isNonChatModel("ibm/allam-2-7b")).toBe(true);
  });

  it("returns false for normal chat models", () => {
    expect(isNonChatModel("meta-llama/llama-3-70b")).toBe(false);
    expect(isNonChatModel("google/gemini-2.0-flash")).toBe(false);
    expect(isNonChatModel("qwen/qwen3-235b-a22b:free")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isNonChatModel("OpenAI/WHISPER-Large-V3")).toBe(true);
    expect(isNonChatModel("IBM/ALLAM-2-7B")).toBe(true);
  });
});

describe("pingModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'available' when fetch responds ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await pingModel(makeModel());
    expect(result.status).toBe("available");
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns 'rate_limited' on HTTP 429", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Too Many Requests",
    });

    const result = await pingModel(makeModel());
    expect(result.status).toBe("rate_limited");
    expect(result.error).toContain("429");
  });

  it("returns 'rate_limited' when body contains 'rate limit'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "You have exceeded the rate limit for this model",
    });

    const result = await pingModel(makeModel());
    expect(result.status).toBe("rate_limited");
  });

  it("returns 'rate_limited' when body contains 'rate_limit'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error": {"type": "rate_limit_exceeded"}}',
    });

    const result = await pingModel(makeModel());
    expect(result.status).toBe("rate_limited");
  });

  it("returns 'error' for non-rate-limit HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await pingModel(makeModel());
    expect(result.status).toBe("error");
    expect(result.error).toContain("HTTP 500");
  });

  it("returns 'error' with timeout message on timeout", async () => {
    mockFetch.mockRejectedValueOnce(new Error("TimeoutError: signal timed out"));

    const result = await pingModel(makeModel());
    expect(result.status).toBe("error");
    expect(result.error).toContain("timeout");
  });

  it("returns 'error' for unknown provider", async () => {
    const result = await pingModel(makeModel("unknown_provider"));
    expect(result.status).toBe("error");
    expect(result.error).toBe("unknown provider");
    expect(result.latency).toBe(0);
  });

  it("sets OpenRouter-specific headers", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await pingModel(makeModel("openrouter"));

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers["HTTP-Referer"]).toBe("https://sml-gateway.app");
    expect(headers["X-Title"]).toBe("SMLGateway");
  });

  it("does not set OpenRouter headers for other providers", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await pingModel(makeModel("groq"));

    const callArgs = mockFetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(headers["X-Title"]).toBeUndefined();
  });
});

describe("testToolSupport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 when model supports tools (ok response)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await testToolSupport(makeModel())).toBe(1);
  });

  it("returns 0 when error mentions 'tool'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "This model does not support tool calling",
    });
    expect(await testToolSupport(makeModel())).toBe(0);
  });

  it("returns 0 when error mentions 'not support'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Feature not supported for this model",
    });
    expect(await testToolSupport(makeModel())).toBe(0);
  });

  it("returns 0 when error mentions 'function'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "function calling is not available",
    });
    expect(await testToolSupport(makeModel())).toBe(0);
  });

  it("returns -1 for non-tool-related errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Invalid API key",
    });
    expect(await testToolSupport(makeModel())).toBe(-1);
  });

  it("returns -1 for unknown provider", async () => {
    expect(await testToolSupport(makeModel("unknown"))).toBe(-1);
  });

  it("returns -1 on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    expect(await testToolSupport(makeModel())).toBe(-1);
  });
});

describe("testVisionSupport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 1 when model supports vision (ok response)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await testVisionSupport(makeModel())).toBe(1);
  });

  it("returns 0 when error mentions 'image'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Image input is not supported by this model",
    });
    expect(await testVisionSupport(makeModel())).toBe(0);
  });

  it("returns 0 when error mentions 'vision'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "This model does not have vision capabilities",
    });
    expect(await testVisionSupport(makeModel())).toBe(0);
  });

  it("returns 0 when error mentions 'multimodal'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Multimodal input not available",
    });
    expect(await testVisionSupport(makeModel())).toBe(0);
  });

  it("returns 0 when error mentions 'content type'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Invalid content type in message",
    });
    expect(await testVisionSupport(makeModel())).toBe(0);
  });

  it("returns -1 for non-vision-related errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Invalid API key",
    });
    expect(await testVisionSupport(makeModel())).toBe(-1);
  });

  it("returns -1 for unknown provider", async () => {
    expect(await testVisionSupport(makeModel("unknown"))).toBe(-1);
  });

  it("returns -1 on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    expect(await testVisionSupport(makeModel())).toBe(-1);
  });
});

describe("checkHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when no eligible models", async () => {
    mockAll.mockReturnValueOnce([]); // no models from DB

    const result = await checkHealth();
    expect(result).toEqual({ checked: 0, available: 0, cooldown: 0 });
  });

  it("sets cooldown for rate_limited models", async () => {
    mockAll.mockReturnValueOnce([
      makeModel("openrouter", "test-chat"),
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limit exceeded",
    });

    const result = await checkHealth();
    expect(result.checked).toBe(1);
    expect(result.cooldown).toBe(1);
    expect(result.available).toBe(0);

    // Verify insertLog was called with a cooldown_until value
    const healthInsert = mockRun.mock.calls.find(
      (call) => call[0] === "openrouter:test-chat"
    );
    expect(healthInsert).toBeDefined();
    // 5th param (index 4) is cooldown_until, should not be null
    expect(healthInsert![4]).not.toBeNull();
  });

  it("marks available models correctly", async () => {
    const model = makeModel("groq", "llama-3-70b");
    model.supports_tools = 1;
    model.supports_vision = 1;
    mockAll.mockReturnValueOnce([model]);

    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await checkHealth();
    expect(result.available).toBe(1);
    expect(result.cooldown).toBe(0);
  });

  it("filters out non-chat models", async () => {
    const whisper = makeModel("groq", "whisper-large-v3");
    whisper.supports_tools = -1;
    const llama = makeModel("groq", "llama-3-70b");
    llama.supports_tools = 1;
    llama.supports_vision = 1;
    mockAll.mockReturnValueOnce([whisper, llama]);

    mockFetch.mockResolvedValueOnce({ ok: true }); // only llama gets pinged

    const result = await checkHealth();
    expect(result.checked).toBe(1);
    expect(result.available).toBe(1);
  });
});
