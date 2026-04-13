import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const PRICING = {
  gpt4o:   { input: 2.50,  output: 10.00, label: "GPT-4o" },
  claude:  { input: 3.00,  output: 15.00, label: "Claude Sonnet 4.6" },
  gemini:  { input: 1.25,  output: 10.00, label: "Gemini 2.5 Pro" },
  qwen:    { input: 0.40,  output: 1.20,  label: "Qwen Plus" },
  deepseek:{ input: 0.28,  output: 0.42,  label: "DeepSeek V3" },
};

const USD_TO_THB = 33.5;

export async function GET() {
  try {
    const sql = getSqlClient();

    const allTimeRows = await sql<{ total_input: number; total_output: number }[]>`
      SELECT COALESCE(SUM(input_tokens), 0) AS total_input, COALESCE(SUM(output_tokens), 0) AS total_output
      FROM token_usage
    `;
    const allTime = allTimeRows[0] ?? { total_input: 0, total_output: 0 };

    const today = new Date().toISOString().slice(0, 10);
    const todayRows = await sql<{ total_input: number; total_output: number }[]>`
      SELECT COALESCE(SUM(input_tokens), 0) AS total_input, COALESCE(SUM(output_tokens), 0) AS total_output
      FROM token_usage WHERE created_at >= ${today + 'T00:00:00'}::timestamptz
    `;
    const todayUsage = todayRows[0] ?? { total_input: 0, total_output: 0 };

    const totalReqRows = await sql<{ c: number }[]>`SELECT COUNT(*) as c FROM token_usage`;
    const totalRequests = Number(totalReqRows[0]?.c ?? 0);

    const todayReqRows = await sql<{ c: number }[]>`
      SELECT COUNT(*) as c FROM token_usage WHERE created_at >= ${today + 'T00:00:00'}::timestamptz
    `;
    const todayRequests = Number(todayReqRows[0]?.c ?? 0);

    const calcCost = (input: number, output: number, pricing: { input: number; output: number }) =>
      (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;

    const r = (n: number) => Math.round(n * 10000) / 10000;

    const providers = Object.entries(PRICING).map(([key, p]) => {
      const cost = calcCost(Number(allTime.total_input), Number(allTime.total_output), p);
      const todayCost = calcCost(Number(todayUsage.total_input), Number(todayUsage.total_output), p);
      return {
        id: key, label: p.label, inputPrice: p.input, outputPrice: p.output,
        cost: r(cost), costThb: r(cost * USD_TO_THB),
        todayCost: r(todayCost), todayCostThb: r(todayCost * USD_TO_THB),
      };
    });

    const maxCost = Math.max(...providers.map(p => p.cost));
    const todayMaxCost = Math.max(...providers.map(p => p.todayCost));

    return NextResponse.json({
      totalInputTokens: Number(allTime.total_input),
      totalOutputTokens: Number(allTime.total_output),
      totalTokens: Number(allTime.total_input) + Number(allTime.total_output),
      totalRequests, todayRequests, providers, actualCost: 0,
      totalSaved: r(maxCost), totalSavedThb: r(maxCost * USD_TO_THB),
      todaySaved: r(todayMaxCost), todaySavedThb: r(todayMaxCost * USD_TO_THB),
      usdToThb: USD_TO_THB,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
