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

import { askModel, judgeAnswer, runBenchmarks } from "../benchmark";

describe("askModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns answer from successful response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "สวัสดีครับ" } }],
      }),
    });

    const result = await askModel("openrouter", "test-model", "สวัสดี");
    expect(result.answer).toBe("สวัสดีครับ");
    expect(result.latency).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("handles text-only response format (choices[0].text)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ text: "Hello from text field" }],
      }),
    });

    const result = await askModel("groq", "test-model", "hi");
    expect(result.answer).toBe("Hello from text field");
  });

  it("returns error for HTTP failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Server Error",
    });

    const result = await askModel("openrouter", "test-model", "hi");
    expect(result.answer).toBe("");
    expect(result.error).toContain("HTTP 500");
  });

  it("returns error for unknown provider", async () => {
    const result = await askModel("unknown", "test-model", "hi");
    expect(result.answer).toBe("");
    expect(result.error).toBe("unknown provider");
  });

  it("returns error on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const result = await askModel("openrouter", "test-model", "hi");
    expect(result.answer).toBe("");
    expect(result.error).toContain("Network failure");
  });

  it("sets OpenRouter-specific headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });

    await askModel("openrouter", "test-model", "hi");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["HTTP-Referer"]).toBe("https://sml-gateway.app");
    expect(headers["X-Title"]).toBe("SMLGateway");
  });
});

describe("judgeAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns score 0 for empty answer", async () => {
    const result = await judgeAnswer("test question", "");
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No answer provided");
    // No fetch should be called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parses JSON score from judge model response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '{"score": 8, "reasoning": "Good Thai response"}',
          },
        }],
      }),
    });

    const result = await judgeAnswer("สวัสดี", "สวัสดีครับ");
    expect(result.score).toBe(8);
    expect(result.reasoning).toBe("Good Thai response");
  });

  it("handles markdown code fences around JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '```json\n{"score": 7, "reasoning": "Pretty good"}\n```',
          },
        }],
      }),
    });

    const result = await judgeAnswer("question", "answer");
    expect(result.score).toBe(7);
    expect(result.reasoning).toBe("Pretty good");
  });

  it("clamps score to 0-10 range", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: '{"score": 15, "reasoning": "overflow"}' },
        }],
      }),
    });

    const result = await judgeAnswer("q", "a");
    expect(result.score).toBe(10);
  });

  it("clamps negative score to 0", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: '{"score": -5, "reasoning": "negative"}' },
        }],
      }),
    });

    const result = await judgeAnswer("q", "a");
    expect(result.score).toBe(0);
  });

  it("falls back to next judge model when first fails", async () => {
    // First judge model fails
    mockFetch.mockResolvedValueOnce({ ok: false });
    // Second judge model succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: '{"score": 6, "reasoning": "ok from fallback"}' },
        }],
      }),
    });

    const result = await judgeAnswer("q", "some answer");
    expect(result.score).toBe(6);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns heuristic score when all judge models fail", async () => {
    // All 3 judges fail
    mockFetch.mockResolvedValue({ ok: false });

    const result = await judgeAnswer("q", "This is a long enough answer to get heuristic");
    expect(result.score).toBe(5); // hasContent = true -> score 5
    expect(result.reasoning).toContain("heuristic");
  });

  it("returns heuristic score 0 for short answer when all judges fail", async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const result = await judgeAnswer("q", "short");
    expect(result.score).toBe(0); // <= 10 chars
    expect(result.reasoning).toContain("heuristic");
  });
});

describe("runBenchmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeros when no models need benchmarking", async () => {
    mockAll.mockReturnValueOnce([]); // no models from DB query

    const result = await runBenchmarks();
    expect(result).toEqual({ tested: 0, questions: 0 });
  });

  it("skips models that failed recently (avg < 3 and < 7 days)", async () => {
    // models query returns 1 model
    mockAll.mockReturnValueOnce([
      { id: "openrouter:bad-model", provider: "openrouter", model_id: "bad-model", benchmark_count: 1 },
    ]);

    // summaryStmt.get returns low score tested 1 day ago
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const testedAt = oneDayAgo.toISOString().replace("T", " ").slice(0, 19);
    mockGet.mockReturnValueOnce({
      avg_score: 2.0, // below threshold of 3
      latest_tested_at: testedAt,
    });

    const result = await runBenchmarks();
    expect(result.tested).toBe(0);
    expect(result.questions).toBe(0);
  });

  it("retests models that failed but past the 7-day window", async () => {
    // models query returns 1 model
    mockAll
      .mockReturnValueOnce([
        { id: "openrouter:old-fail", provider: "openrouter", model_id: "old-fail", benchmark_count: 1 },
      ])
      // answeredStmt.all returns no answered questions
      .mockReturnValueOnce([]);

    // summaryStmt.get: failed 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const testedAt = tenDaysAgo.toISOString().replace("T", " ").slice(0, 19);
    mockGet.mockReturnValueOnce({
      avg_score: 1.0,
      latest_tested_at: testedAt,
    });

    // askModel response for each of 3 questions
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "answer 1" } }] }),
      })
      // judgeAnswer for Q1
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"score": 5, "reasoning": "ok"}' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "answer 2" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"score": 6, "reasoning": "ok"}' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "answer 3" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"score": 7, "reasoning": "ok"}' } }],
        }),
      });

    const result = await runBenchmarks();
    expect(result.tested).toBe(1);
    expect(result.questions).toBe(3);
  });

  it("skips already-answered questions", async () => {
    mockAll
      .mockReturnValueOnce([
        { id: "openrouter:partial", provider: "openrouter", model_id: "partial", benchmark_count: 2 },
      ])
      // answeredStmt.all returns 2 already-answered questions
      .mockReturnValueOnce([
        { question: "สวัสดีครับ วันนี้อากาศเป็นยังไงบ้าง?" },
        { question: "แนะนำอาหารไทยมา 3 เมนู" },
      ]);

    // summaryStmt.get — good score, no skip
    mockGet.mockReturnValueOnce({ avg_score: 7.0, latest_tested_at: null });

    // Only 1 question pending: "กรุงเทพมหานครอยู่ประเทศอะไร?"
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "Thailand" } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"score": 9, "reasoning": "correct"}' } }],
        }),
      });

    const result = await runBenchmarks();
    expect(result.tested).toBe(1);
    expect(result.questions).toBe(1);
  });
});
