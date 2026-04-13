import { NextRequest } from "next/server";
import { openAIError } from "@/lib/openai-compat";

export const dynamic = "force-dynamic";

/**
 * POST /v1/moderations — Content moderation
 * Returns a permissive "nothing flagged" response so clients don't block
 * SMLGateway is a local proxy — user controls their own content
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const input = body.input;

    if (!input) {
      return openAIError(400, { message: "input is required", param: "input" });
    }

    // Always return "not flagged" — user controls their own proxy
    const inputs = Array.isArray(input) ? input : [input];
    const results = inputs.map(() => ({
      flagged: false,
      categories: {
        sexual: false,
        hate: false,
        harassment: false,
        "self-harm": false,
        "sexual/minors": false,
        "hate/threatening": false,
        "violence/graphic": false,
        "self-harm/intent": false,
        "self-harm/instructions": false,
        "harassment/threatening": false,
        violence: false,
      },
      category_scores: {
        sexual: 0,
        hate: 0,
        harassment: 0,
        "self-harm": 0,
        "sexual/minors": 0,
        "hate/threatening": 0,
        "violence/graphic": 0,
        "self-harm/intent": 0,
        "self-harm/instructions": 0,
        "harassment/threatening": 0,
        violence: 0,
      },
    }));

    return new Response(JSON.stringify({
      id: `modr-sml`,
      model: "text-moderation-latest",
      results,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return openAIError(500, { message: String(err) });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
