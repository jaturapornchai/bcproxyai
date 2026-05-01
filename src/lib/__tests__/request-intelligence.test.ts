import { describe, expect, it } from "vitest";
import { analyzeRequestProfile, rankCandidatesByRequestProfile } from "../request-intelligence";

const baseCaps = { hasTools: false, hasImages: false, needsJsonSchema: false };

describe("request intelligence", () => {
  it("treats short greetings as fast simple chat", () => {
    const profile = analyzeRequestProfile({
      caps: baseCaps,
      userMessage: "สวัสดี",
      estTokens: 20,
      maxTokens: 128,
      temperature: 0,
    });

    expect(profile.intent).toBe("simple-chat");
    expect(profile.preferFast).toBe(true);
    expect(profile.hedgeLimit).toBe(2);
    expect(profile.retryBudget).toBeLessThan(25);
  });

  it("keeps Thai short-reply greetings in the simple-chat lane", () => {
    const profile = analyzeRequestProfile({
      caps: baseCaps,
      userMessage: "สวัสดี ตอบสั้นๆ",
      estTokens: 20,
      maxTokens: 128,
      temperature: 0,
    });

    expect(profile.intent).toBe("simple-chat");
    expect(profile.preferFast).toBe(true);
    expect(profile.hedgeLimit).toBe(2);
  });

  it("routes tool requests toward stronger larger-context models", () => {
    const profile = analyzeRequestProfile({
      caps: { ...baseCaps, hasTools: true },
      userMessage: "deploy แล้วเช็ค inbox ให้ด้วย",
      estTokens: 2400,
    });

    expect(profile.intent).toBe("tools");
    expect(profile.preferStrong).toBe(true);
    expect(profile.hedgeLimit).toBe(0);
    expect(profile.minContext).toBeGreaterThanOrEqual(32_000);
  });

  it("ranks Thai-capable models ahead for Thai text", () => {
    const profile = analyzeRequestProfile({
      caps: baseCaps,
      userMessage: "ช่วยสรุปรายงานยอดขายรายเดือนเป็นภาษาไทย",
      estTokens: 500,
    });

    const ranked = rankCandidatesByRequestProfile([
      {
        provider: "groq",
        model_id: "llama-3.1-8b-instant",
        supports_tools: 0,
        supports_vision: 0,
        tier: "small",
        context_length: 32_000,
        avg_score: 80,
        avg_latency: 800,
      },
      {
        provider: "thaillm",
        model_id: "OpenThaiGPT-ThaiLLM-8B-Instruct",
        supports_tools: 0,
        supports_vision: 0,
        tier: "small",
        context_length: 32_000,
        avg_score: 80,
        avg_latency: 1200,
      },
    ], profile);

    expect(ranked[0].provider).toBe("thaillm");
  });

  it("penalizes models that cannot fit the request profile", () => {
    const profile = analyzeRequestProfile({
      caps: baseCaps,
      userMessage: "วิเคราะห์เอกสารยาวมาก",
      estTokens: 30_000,
    });

    const ranked = rankCandidatesByRequestProfile([
      {
        provider: "fast",
        model_id: "small-fast",
        supports_tools: 0,
        supports_vision: 0,
        tier: "small",
        context_length: 8_000,
        avg_score: 95,
        avg_latency: 300,
      },
      {
        provider: "strong",
        model_id: "long-context",
        supports_tools: 0,
        supports_vision: 0,
        tier: "large",
        context_length: 128_000,
        avg_score: 85,
        avg_latency: 2000,
      },
    ], profile);

    expect(ranked[0].provider).toBe("strong");
  });
});
