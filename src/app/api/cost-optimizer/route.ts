import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const PRICING: Record<string, { input: number; output: number; free?: boolean }> = {
  openrouter: { input: 0.5, output: 1.5 },
  kilo:       { input: 0, output: 0, free: true },
  google:     { input: 0, output: 0, free: true },
  groq:       { input: 0, output: 0, free: true },
  cerebras:   { input: 0, output: 0, free: true },
  sambanova:  { input: 0, output: 0, free: true },
  mistral:    { input: 0, output: 0, free: true },
  ollama:     { input: 0, output: 0, free: true },
  github:     { input: 0, output: 0, free: true },
  fireworks:  { input: 0, output: 0, free: true },
  cohere:     { input: 0, output: 0, free: true },
  cloudflare: { input: 0, output: 0, free: true },
  huggingface: { input: 0, output: 0, free: true },
};

export async function GET() {
  try {
    const sql = getSqlClient();

    // Postgres doesn't resolve column aliases inside ORDER BY expressions,
    // so repeat the SUMs instead of referencing total_input + total_output.
    const providerUsage = await sql<{ provider: string; total_input: number; total_output: number; requests: number }[]>`
      SELECT provider,
        SUM(input_tokens) as total_input, SUM(output_tokens) as total_output, COUNT(*) as requests
      FROM token_usage
      WHERE created_at >= now() - interval '30 days'
      GROUP BY provider
      ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC
    `;

    const modelUsage = await sql<{
      provider: string; model_id: string; nickname: string | null;
      total_input: number; total_output: number; requests: number; benchmark_score: number;
    }[]>`
      SELECT
        tu.provider, tu.model_id, m.nickname,
        SUM(tu.input_tokens) as total_input, SUM(tu.output_tokens) as total_output,
        COUNT(*) as requests, COALESCE(b.avg_score, 0) as benchmark_score
      FROM token_usage tu
      LEFT JOIN models m ON tu.model_id = m.model_id AND tu.provider = m.provider
      LEFT JOIN (
        SELECT model_id, AVG(score) as avg_score FROM benchmark_results GROUP BY model_id
      ) b ON m.id = b.model_id
      WHERE tu.created_at >= now() - interval '30 days'
      GROUP BY tu.provider, tu.model_id, m.nickname, b.avg_score
      ORDER BY SUM(tu.input_tokens) + SUM(tu.output_tokens) DESC
      LIMIT 20
    `;

    const providerCosts = providerUsage.map(p => {
      const pricing = PRICING[p.provider] ?? { input: 0, output: 0 };
      const cost = (p.total_input / 1_000_000) * pricing.input + (p.total_output / 1_000_000) * pricing.output;
      return { ...p, cost, free: pricing.free ?? false };
    });

    const suggestions: { message: string; savings_pct: number; priority: "high" | "medium" | "low" }[] = [];

    const paidProviders = providerCosts.filter(p => !p.free && p.cost > 0);
    const freeProviders = providerCosts.filter(p => p.free && p.requests > 0);

    if (paidProviders.length > 0 && freeProviders.length > 0) {
      for (const paid of paidProviders) {
        const totalTokens = paid.total_input + paid.total_output;
        suggestions.push({
          message: `${paid.provider} ใช้ ${fmtTokens(totalTokens)} tokens (${paid.cost.toFixed(4)} USD) - ย้ายไป ${freeProviders[0].provider} ประหยัดได้ 100%`,
          savings_pct: 100,
          priority: "high",
        });
      }
    }

    for (const mu of modelUsage) {
      if (mu.benchmark_score > 0 && mu.benchmark_score < 4 && mu.requests > 5) {
        suggestions.push({
          message: `${mu.nickname ?? mu.model_id} (${mu.provider}) คะแนนต่ำ ${Number(mu.benchmark_score).toFixed(1)}/10 แต่ใช้ ${mu.requests} ครั้ง - ควรเปลี่ยนไป model ที่คะแนนสูงกว่า`,
          savings_pct: 0,
          priority: "medium",
        });
      }
    }

    if (providerUsage.length >= 2) {
      const topProvider = providerUsage[0];
      const totalReqs = providerUsage.reduce((s, p) => s + Number(p.requests), 0);
      const topPct = (Number(topProvider.requests) / totalReqs) * 100;
      if (topPct > 70) {
        suggestions.push({
          message: `${topProvider.provider} รับ ${topPct.toFixed(0)}% ของ traffic - กระจายไป provider อื่นเพื่อลดความเสี่ยง`,
          savings_pct: 0,
          priority: "low",
        });
      }
    }

    const totalCost = providerCosts.reduce((s, p) => s + p.cost, 0);
    const totalTokens = providerUsage.reduce((s, p) => s + Number(p.total_input) + Number(p.total_output), 0);
    const freePct = providerCosts.filter(p => p.free).reduce((s, p) => s + Number(p.requests), 0) /
      Math.max(providerUsage.reduce((s, p) => s + Number(p.requests), 0), 1) * 100;

    return NextResponse.json({
      providerCosts, modelUsage, suggestions,
      summary: {
        totalCost, totalTokens, freePct,
        totalRequests: providerUsage.reduce((s, p) => s + Number(p.requests), 0),
      },
    });
  } catch (err) {
    console.error("[cost-optimizer] error:", err);
    return NextResponse.json({ providerCosts: [], modelUsage: [], suggestions: [], summary: { totalCost: 0, totalTokens: 0, freePct: 0, totalRequests: 0 } }, { status: 500 });
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
