import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /v1/structured
 *
 * Chat completion with JSON schema validation + auto-retry on invalid output.
 *
 * Body:
 *   {
 *     model?: string,               // default "bcai/auto"
 *     messages: [...],              // OpenAI-style
 *     schema: object,                // JSON schema (keys-only validation)
 *     max_retries?: number,          // default 2
 *     temperature?: number,
 *     max_tokens?: number,
 *     ...only PASSTHROUGH_KEYS extras are forwarded (prefer/exclude/strategy headers work too)
 *   }
 *
 * Response:
 *   {
 *     ok: true | false,
 *     attempts: number,
 *     data?: <parsed+validated JSON object>,
 *     raw?: string,                  // last raw assistant reply if validation failed
 *     error?: string,
 *     model, provider, latency_ms, request_ids: [...]
 *   }
 *
 * Validation (intentionally lightweight — no external deps):
 *   - Parses content as JSON (strips ```json fences)
 *   - If schema.type === "object" and schema.required: checks all required keys exist
 *   - If schema.properties.<k>.type set: checks typeof matches (string/number/boolean/array/object)
 *   - Other schema features (enum, pattern, nested) NOT enforced — use json_schema
 *     on provider side for stricter guarantees. This is a safety net, not a validator.
 */

type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string }>;
};

// Standard OpenAI chat params only — routing/provider/plugin keys never reach the internal chat call.
const PASSTHROUGH_KEYS = ["top_p", "stop", "seed", "presence_penalty", "frequency_penalty", "max_completion_tokens", "user"];

function tryParseJson(content: string): unknown {
  const stripped = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // try to find first { ... } or [ ... ] block
    const match = stripped.match(/[\[{][\s\S]*[\]}]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

function validate(data: unknown, schema: Schema): { ok: boolean; error?: string } {
  if (!schema || typeof schema !== "object") return { ok: true };
  if (schema.type === "object") {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "expected object" };
    }
    const obj = data as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) return { ok: false, error: `missing required key "${key}"` };
    }
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      if (!(key in obj)) continue;
      const expected = prop.type;
      if (!expected) continue;
      const actual = Array.isArray(obj[key]) ? "array" : typeof obj[key];
      if (expected === "integer") {
        if (typeof obj[key] !== "number" || !Number.isInteger(obj[key])) {
          return { ok: false, error: `"${key}" must be integer, got ${actual}` };
        }
      } else if (expected !== actual) {
        return { ok: false, error: `"${key}" must be ${expected}, got ${actual}` };
      }
    }
  }
  if (schema.type === "array" && !Array.isArray(data)) {
    return { ok: false, error: "expected array" };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const {
      model = "bcai/auto",
      messages,
      schema,
      max_retries = 2,
      temperature,
      max_tokens,
      ...extra
    } = body as {
      model?: string;
      messages: unknown;
      schema: Schema;
      max_retries?: number;
      temperature?: number;
      max_tokens?: number;
      [k: string]: unknown;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: { message: "messages required" } }, { status: 400 });
    }
    if (!schema || typeof schema !== "object") {
      return NextResponse.json({ error: { message: "schema required" } }, { status: 400 });
    }

    const baseUrl = process.env.INTERNAL_BASE_URL ?? "http://localhost:3000";
    const maxAttempts = Math.min(Math.max(max_retries + 1, 1), 5);
    const requestIds: string[] = [];
    let currentMessages = messages as Array<{ role: string; content: string }>;
    let lastRaw = "";
    let lastError = "";
    let lastModel: string | null = null;
    let lastProvider: string | null = null;

    // Augment with schema instruction on the first turn
    const schemaHint = `You MUST respond with ONLY valid JSON matching this schema:\n${JSON.stringify(schema)}\n\nNo markdown, no prose — just JSON.`;
    const hasSystem = currentMessages.length > 0 && currentMessages[0].role === "system";
    currentMessages = hasSystem
      ? [
          { role: "system", content: currentMessages[0].content + "\n\n" + schemaHint },
          ...currentMessages.slice(1),
        ]
      : [{ role: "system", content: schemaHint }, ...currentMessages];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // pass through auth (the /v1 gate needs the caller's Bearer) + dev headers from the outer request
      for (const h of ["authorization", "x-bcairouter-prefer", "x-bcairouter-exclude", "x-bcairouter-strategy", "x-bcairouter-max-latency"]) {
        const v = req.headers.get(h);
        if (v) headers[h] = v;
      }

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: currentMessages,
          temperature: temperature ?? 0,
          max_tokens,
          response_format: { type: "json_object" },
          stream: false,
          ...Object.fromEntries(Object.entries(extra).filter(([key]) => PASSTHROUGH_KEYS.includes(key))),
        }),
      });

      const reqId = res.headers.get("x-bcairouter-request-id");
      if (reqId) requestIds.push(reqId);
      lastProvider = res.headers.get("x-bcairouter-provider") || lastProvider;
      lastModel = res.headers.get("x-bcairouter-model") || lastModel;

      if (!res.ok) {
        lastError = `HTTP ${res.status} from gateway`;
        break;
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        lastError = "no string content in response";
        break;
      }
      lastRaw = content;

      const parsed = tryParseJson(content);
      if (parsed === null) {
        lastError = "not valid JSON";
      } else {
        const v = validate(parsed, schema);
        if (v.ok) {
          return NextResponse.json({
            ok: true,
            attempts: attempt,
            data: parsed,
            model: lastModel,
            provider: lastProvider,
            latency_ms: Date.now() - t0,
            request_ids: requestIds,
          });
        }
        lastError = v.error ?? "validation failed";
      }

      // Retry — append feedback, stricter instruction
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content },
        {
          role: "user",
          content: `Your previous answer was invalid: ${lastError}. Return ONLY valid JSON matching the schema. No text outside JSON.`,
        },
      ];
    }

    return NextResponse.json({
      ok: false,
      attempts: maxAttempts,
      raw: lastRaw,
      error: lastError,
      model: lastModel,
      provider: lastProvider,
      latency_ms: Date.now() - t0,
      request_ids: requestIds,
    }, { status: 422 });
  } catch (err) {
    return NextResponse.json(
      { error: { message: String(err), type: "structured_error" } },
      { status: 500 }
    );
  }
}
