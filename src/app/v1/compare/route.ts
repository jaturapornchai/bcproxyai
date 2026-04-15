import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /v1/compare
 *
 * Run the same prompt through multiple models in parallel, return side-by-side.
 *
 * Body:
 *   {
 *     messages: [...],          // same as /v1/chat/completions
 *     models: ["groq/moonshotai/kimi-k2-instruct-0905", "cerebras/qwen-3-235b-a22b-instruct-2507", ...],
 *     max_tokens?: number,
 *     temperature?: number,
 *     timeout_ms?: number        // per-model timeout (default 30000)
 *   }
 *
 * Response:
 *   {
 *     total: number,
 *     ok_count: number,
 *     results: [{
 *       model, provider, ok, status, latency_ms, content, error
 *     }]
 *   }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, models, max_tokens, temperature, timeout_ms = 30000 } = body as {
      messages: unknown;
      models: string[];
      max_tokens?: number;
      temperature?: number;
      timeout_ms?: number;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: { message: "messages required" } },
        { status: 400 }
      );
    }
    if (!Array.isArray(models) || models.length === 0) {
      return NextResponse.json(
        { error: { message: "models required (non-empty array)" } },
        { status: 400 }
      );
    }
    if (models.length > 10) {
      return NextResponse.json(
        { error: { message: "max 10 models per compare request" } },
        { status: 400 }
      );
    }

    // Internal URL — when running in docker compose, localhost:3000 is the Next.js
    // app itself. We call the chat endpoint through the in-container port to avoid
    // round-tripping through caddy.
    const baseUrl = process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";

    const results = await Promise.all(
      models.map(async (model) => {
        const t0 = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout_ms);
        try {
          const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model, messages, max_tokens, temperature, stream: false,
            }),
            signal: controller.signal,
          });
          const latency = Date.now() - t0;
          const provider = res.headers.get("x-smlgateway-provider");
          const actualModel = res.headers.get("x-smlgateway-model");

          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            return {
              model, provider, actual_model: actualModel, ok: false,
              status: res.status, latency_ms: latency,
              content: null, error: errText.slice(0, 500),
            };
          }

          const json = await res.json();
          const content = json?.choices?.[0]?.message?.content ?? null;
          return {
            model, provider, actual_model: actualModel, ok: true,
            status: 200, latency_ms: latency,
            content: typeof content === "string" ? content : JSON.stringify(content),
            error: null,
          };
        } catch (err) {
          const latency = Date.now() - t0;
          const errMsg = (err as Error).name === "AbortError"
            ? `timeout after ${timeout_ms}ms`
            : String(err);
          return {
            model, provider: null, actual_model: null, ok: false,
            status: 0, latency_ms: latency,
            content: null, error: errMsg,
          };
        } finally {
          clearTimeout(timer);
        }
      })
    );

    const okCount = results.filter(r => r.ok).length;

    return NextResponse.json({
      total: results.length,
      ok_count: okCount,
      results,
    }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: String(err), type: "compare_error" } },
      { status: 500 }
    );
  }
}
