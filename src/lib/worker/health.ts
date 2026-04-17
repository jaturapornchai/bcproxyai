import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey } from "@/lib/api-keys";
import { resolveProviderUrl } from "@/lib/provider-resolver";

async function logWorker(step: string, message: string, level = "info") {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})`;
  } catch {
    // silent
  }
}

interface DbModel {
  id: string;
  provider: string;
  model_id: string;
  context_length: number;
  supports_tools: number;
  supports_vision: number;
}

export async function pingModel(
  model: DbModel
): Promise<{ status: string; latency: number; error?: string; isNonChat?: boolean }> {
  const url = resolveProviderUrl(model.provider);
  if (!url) return { status: "error", latency: 0, error: "unknown provider" };

  const key = getNextApiKey(model.provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (model.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://sml-gateway.app";
    headers["X-Title"] = "SMLGateway";
  }

  const body = JSON.stringify({
    model: model.model_id,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 5,
  });

  // Ollama (local) ต้อง timeout นานกว่า cloud เพราะ model ใหญ่ load ช้า
  const timeoutMs = model.provider === "ollama" ? 120000 : 15000;
  const start = Date.now();
  try {
    // Worker pings are sparse (~100 total per hour). Skip the shared
    // upstreamAgent here — its 30s keep-alive window makes dead-socket
    // reuse likely when providers close idle connections, which surfaced
    // as spurious "fetch failed" TypeErrors and knocked good models into
    // cooldown. Node's default fetch creates a fresh connection, which
    // is fine for this cold path.
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = Date.now() - start;

    if (res.ok) {
      // Detect non-chat models by inspecting response structure.
      // A real chat model returns choices[0].message.content as a non-empty string.
      // Audio/TTS/safety models either return different structure or empty content.
      try {
        const json = await res.clone().json() as {
          choices?: Array<{ message?: { content?: string | null } }>;
          audio?: unknown;
          object?: string;
        };
        const content = json.choices?.[0]?.message?.content;
        const isChat = typeof content === "string" && content.trim().length > 0;
        const isAudio = json.audio != null || json.object === "audio";
        if (!isChat || isAudio) {
          return { status: "available", latency, isNonChat: true };
        }
      } catch {
        // Can't parse — assume chat model, health check proceeds normally
      }
      return { status: "available", latency };
    }

    // Check for rate limit
    const text = await res.text().catch(() => "");
    const isRateLimit =
      res.status === 429 ||
      text.toLowerCase().includes("rate limit") ||
      text.toLowerCase().includes("rate_limit");

    if (isRateLimit) {
      return { status: "rate_limited", latency, error: `429 rate limited` };
    }

    // 402 = payment required / quota exhausted → long cooldown, ต่างจาก transient error
    if (res.status === 402) {
      return { status: "quota_exhausted", latency, error: `402 quota exhausted: ${text.slice(0, 200)}` };
    }

    return {
      status: "error",
      latency,
      error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
    };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timeout") || msg.includes("TimeoutError");
    return {
      status: "error",
      latency,
      error: isTimeout ? "timeout after 15s" : msg.slice(0, 200),
    };
  }
}

// Tiny 1x1 red PNG (68 bytes) as base64 for vision test
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

export async function testVisionSupport(
  model: DbModel
): Promise<0 | 1 | -1> {
  const url = resolveProviderUrl(model.provider);
  if (!url) return -1;

  const key = getNextApiKey(model.provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (model.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://sml-gateway.app";
    headers["X-Title"] = "SMLGateway";
  }

  const body = JSON.stringify({
    model: model.model_id,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What color is this?" },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${TINY_PNG_BASE64}`,
            },
          },
        ],
      },
    ],
    max_tokens: 10,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15000),
      // @ts-expect-error undici dispatcher not in standard fetch types
      dispatcher: upstreamAgent,
    });

    if (res.ok) return 1;

    const text = await res.text().catch(() => "");
    const lower = text.toLowerCase();
    const isVisionError =
      lower.includes("image") ||
      lower.includes("vision") ||
      lower.includes("multimodal") ||
      lower.includes("not support") ||
      lower.includes("unsupported") ||
      lower.includes("content type");

    if (isVisionError) return 0;

    // Other error (auth, rate limit etc.) — skip
    return -1;
  } catch {
    return -1;
  }
}

export async function testToolSupport(
  model: DbModel
): Promise<0 | 1 | -1> {
  const url = resolveProviderUrl(model.provider);
  if (!url) return -1;

  const key = getNextApiKey(model.provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (model.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://sml-gateway.app";
    headers["X-Title"] = "SMLGateway";
  }

  const body = JSON.stringify({
    model: model.model_id,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      {
        type: "function",
        function: {
          name: "test_fn",
          description: "test",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    max_tokens: 5,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15000),
      // @ts-expect-error undici dispatcher not in standard fetch types
      dispatcher: upstreamAgent,
    });

    if (res.ok) return 1;

    const text = await res.text().catch(() => "");
    const lower = text.toLowerCase();
    const isToolError =
      lower.includes("tool") ||
      lower.includes("function") ||
      lower.includes("not support") ||
      lower.includes("unsupported");

    if (isToolError) return 0;

    // Other error (auth, rate limit etc.) — skip
    return -1;
  } catch {
    return -1;
  }
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
}

export async function checkHealth(): Promise<{
  checked: number;
  available: number;
  cooldown: number;
}> {
  await logWorker("health", "Starting health check");
  const sql = getSqlClient();

  // Get models eligible for health check
  const models = await sql<DbModel[]>`
    SELECT m.id, m.provider, m.model_id, m.context_length,
      COALESCE(m.supports_tools, -1) AS supports_tools,
      COALESCE(m.supports_vision, -1) AS supports_vision
    FROM models m
    WHERE m.context_length >= 32000
      AND NOT EXISTS (
        SELECT 1 FROM health_logs h
        WHERE h.model_id = m.id
          AND h.cooldown_until IS NOT NULL
          AND h.cooldown_until > now()
        LIMIT 1
      )
  `;

  const eligible = models;

  await logWorker("health", `Checking ${eligible.length} eligible models`);

  let available = 0;
  let cooldownCount = 0;
  let checked = 0;

  // Collect available models that need tool/vision testing
  const availableForToolTest: DbModel[] = [];
  const availableForVisionTest: DbModel[] = [];

  await runConcurrent(eligible, 5, async (model) => {
    const result = await pingModel(model);
    checked++;

    let cooldownUntil: string | null = null;

    // Auto-detect non-chat models (audio, TTS, safety classifiers, etc.)
    // by checking that the response has a real text content in choices[0].message.content
    if (result.status === "available" && result.isNonChat) {
      await sql`UPDATE models SET supports_audio_output = 1 WHERE id = ${model.id}`;
      await logWorker("health", `🔇 ${model.model_id} — ตรวจพบว่าไม่ใช่ chat model → ตั้ง supports_audio_output=1`, "warn");
      cooldownCount++;
      return; // skip health_log insert — gateway filters by supports_audio_output
    }

    if (result.status === "quota_exhausted") {
      // Quota หมด → cooldown 24 ชม.
      cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      cooldownCount++;
    } else if (result.status === "rate_limited" || result.status === "error") {
      // ping fail → cooldown แค่ 5 นาที (worker จะ re-check รอบถัดไป)
      // เดิม 2 ชม. ทำให้ pool หาย → 503 cascade
      cooldownUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      cooldownCount++;
    } else {
      available++;
      if (model.supports_tools === -1) {
        availableForToolTest.push(model);
      }
      if (model.supports_vision === -1) {
        availableForVisionTest.push(model);
      }
    }

    try {
      await sql`
        INSERT INTO health_logs (model_id, status, latency_ms, error, cooldown_until)
        VALUES (${model.id}, ${result.status}, ${result.latency}, ${result.error ?? null}, ${cooldownUntil})
      `;
    } catch (err) {
      await logWorker("health", `DB insert error for ${model.id}: ${err}`, "error");
    }
  });

  // Tool support detection — max 3 per cycle
  const toolTestCandidates = availableForToolTest.slice(0, 3);
  for (const model of toolTestCandidates) {
    const supportsTools = await testToolSupport(model);
    if (supportsTools !== -1) {
      try {
        await sql`UPDATE models SET supports_tools = ${supportsTools} WHERE id = ${model.id}`;
        const icon = supportsTools === 1 ? "✅" : "❌";
        await logWorker(
          "health",
          `🔧 ${model.model_id}: tools ${icon}`
        );
      } catch (err) {
        await logWorker("health", `Tool update error for ${model.id}: ${err}`, "error");
      }
    }
  }

  // Vision support detection — max 3 per cycle
  const visionTestCandidates = availableForVisionTest.slice(0, 3);
  for (const model of visionTestCandidates) {
    const supportsVision = await testVisionSupport(model);
    if (supportsVision !== -1) {
      try {
        await sql`UPDATE models SET supports_vision = ${supportsVision} WHERE id = ${model.id}`;
        const icon = supportsVision === 1 ? "✅" : "❌";
        await logWorker(
          "health",
          `👁️ ${model.model_id}: vision ${icon}`
        );
      } catch (err) {
        await logWorker("health", `Vision update error for ${model.id}: ${err}`, "error");
      }
    }
  }

  const msg = `Health check done: checked=${checked}, available=${available}, cooldown=${cooldownCount}`;
  await logWorker("health", msg);

  return { checked, available, cooldown: cooldownCount };
}
