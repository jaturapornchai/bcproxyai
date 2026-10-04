import { getSqlClient } from "@/lib/db/schema";
import { emitEvent } from "@/lib/routing-learn";
import { invalidateModelListCache } from "@/lib/model-list-cache";
import { isModelCostAllowed } from "@/lib/cost-policy";
import { getActiveFreeModelCatalog, getModelsDeprecatingSoon } from "@/lib/free-model-catalog";

interface ModelRow {
  id: string;
  name: string;
  provider: string;
  model_id: string;
  context_length: number;
  tier: string;
  description?: string;
  supports_vision?: number;
  supports_tools?: number;
  supports_audio_input?: number;
  supports_audio_output?: number;
  supports_image_gen?: number;
  supports_embedding?: number;
  supports_json_mode?: number;
  supports_reasoning?: number;
  supports_code?: number;
  max_output_tokens?: number;
  pricing_input?: number;
  pricing_output?: number;
}

// ─── Capability detection from model name / metadata ─────────────────────────

// Models known to support an explicit "thinking / reasoning" mode.
// Detected by name at scan-time → stored in models.supports_reasoning.
// The exam worker + forward path use the DB flag (not this regex at runtime),
// so adding a new pattern here auto-propagates after the next scan cycle.
const REASONING_PATTERNS = [
  /deepseek-r\d/i,           // deepseek-r1, deepseek-r2
  /r1[-_](distill|preview)/i,
  /\bo[134]\b/i, /o1-/i, /o3-/i, /o4-/i, // OpenAI reasoning series
  /qwq/i,                     // Alibaba QwQ
  /\bqwen3\b/i,               // Qwen3 family (dual-mode thinking by default)
  /thinking/i, /\bthink\b/i,  // any model with "think" / "thinking"
  /reasoning/i, /reason-/i,
  /magistral/i,               // Mistral reasoning variant
  /gemini.*thinking/i,
  /\blfm-.*thinking/i,        // Liquid LFM thinking
  /nemotron-.*reasoning/i,    // NVIDIA Nemotron reasoning
  /pathumma.*think/i,         // NECTEC Pathumma think
];

const CODE_PATTERNS = [
  /codestral/i, /starcoder/i, /codellama/i, /code-/i, /coder/i,
  /devstral/i, /deepseek-coder/i, /granite-code/i, /leanstral/i,
];

const EMBEDDING_PATTERNS = [
  /embed/i, /e5-/i, /bge-/i, /gte-/i, /nomic-embed/i, /text-embedding/i,
];

const IMAGE_GEN_PATTERNS = [
  /dall-e/i, /stable-diffusion/i, /sdxl/i, /flux/i, /imagen/i,
  /lyria/i, /playground/i,
];

const AUDIO_INPUT_PATTERNS = [
  /whisper/i, /transcri/i, /voxtral/i, /speech-to/i,
];

const AUDIO_OUTPUT_PATTERNS = [
  /tts/i, /speech/i, /voxtral.*tts/i, /audio.*output/i,
];

const JSON_MODE_PATTERNS = [
  /gpt-4/i, /gpt-3\.5/i, /gemini/i, /claude/i, /mistral.*large/i,
  /mistral.*medium/i, /mistral.*small/i, /qwen/i, /llama-3/i, /llama-4/i,
  /deepseek/i, /gemma/i, /command-r/i,
];

function detectCaps(
  modelId: string,
  name: string,
  providerMeta?: { reasoning?: boolean },
): Partial<ModelRow> {
  const combined = `${modelId} ${name}`;
  // Reasoning: prefer provider metadata when available (OpenRouter tells us via
  // `supported_parameters: ["reasoning", ...]`). Fall back to name regex.
  const reasoning = providerMeta?.reasoning === true
    ? 1
    : providerMeta?.reasoning === false
      ? 0
      : REASONING_PATTERNS.some(p => p.test(combined)) ? 1 : 0;
  return {
    supports_reasoning: reasoning,
    supports_code: CODE_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_embedding: EMBEDDING_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_image_gen: IMAGE_GEN_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_audio_input: AUDIO_INPUT_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_audio_output: AUDIO_OUTPUT_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
    supports_json_mode: JSON_MODE_PATTERNS.some(p => p.test(combined)) ? 1 : 0,
  };
}

export function calcTier(contextLength: number): string {
  if (contextLength >= 128000) return "large";
  if (contextLength >= 32000) return "medium";
  return "small";
}

async function logWorker(step: string, message: string, level = "info") {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})`;
  } catch {
    // silent
  }
}

// Nickname generation removed — UI shows provider + model_id directly.
// Kept as no-op export for backward compat with other modules that still import it.
export async function generateNickname(): Promise<string | null> {
  return null;
}

export async function scanModels(): Promise<{ found: number; new: number; disappeared: number }> {
  await logWorker("scan", "Starting hardcoded free model sync");
  const sql = getSqlClient();

  try {
    const existing = await sql<{ id: string; provider: string; model_id: string }[]>`
      SELECT id, provider, model_id FROM models
    `;
    const blockedIds = existing
      .filter((m) => !isModelCostAllowed(m.provider, m.model_id))
      .map((m) => m.id);
    if (blockedIds.length > 0) {
      await sql`DELETE FROM models WHERE id IN ${sql(blockedIds)}`;
      await logWorker("scan", `🧹 ลบ ${blockedIds.length} model ที่ไม่อยู่ใน free model whitelist`, "warn");
    }
  } catch (err) {
    await logWorker("scan", `ลบ model นอก free whitelist ล้มเหลว: ${err}`, "error");
  }

  const expiringSoon = getModelsDeprecatingSoon();
  for (const { entry, daysLeft } of expiringSoon) {
    await logWorker(
      "scan",
      `⏰ Deprecation watch: ${entry.provider}/${entry.modelId} EOL in ${daysLeft} day(s) (${entry.deprecatedAfter})`,
      "warn",
    );
  }

  const allModels: ModelRow[] = getActiveFreeModelCatalog().map((m) => ({
    id: `${m.provider}:${m.modelId}`,
    name: m.name,
    provider: m.provider,
    model_id: m.modelId,
    context_length: m.contextLength,
    tier: m.tier,
    description: "Hardcoded remote free model. Local/Ollama and paid models are disabled.",
    supports_vision: m.supportsVision ? 1 : 0,
    supports_tools: m.supportsTools ? 1 : 0,
    supports_audio_input: 0,
    supports_audio_output: 0,
    supports_image_gen: 0,
    supports_embedding: 0,
    supports_json_mode: m.supportsJsonMode ? 1 : 0,
    supports_reasoning: m.supportsReasoning ? 1 : 0,
    supports_code: m.supportsCode ? 1 : 0,
    pricing_input: 0,
    pricing_output: 0,
  })).filter((m) => isModelCostAllowed(m.provider, m.model_id));
  const foundIds = new Set(allModels.map(m => m.id));
  let newCount = 0;

  const newModels: ModelRow[] = [];

  // Upsert models one at a time (postgres tagged templates don't support batch upsert cleanly)
  for (const m of allModels) {
    // Honor reasoning flag set by the fetcher (e.g. OpenRouter's
    // `supported_parameters: ["reasoning", ...]`) when present — cap detection
    // only uses name-regex so metadata beats guesswork.
    const detectedCaps = detectCaps(m.model_id, m.name, {
      reasoning: m.supports_reasoning === 1 ? true : undefined,
    });
    const caps = {
      ...detectedCaps,
      supports_json_mode: m.supports_json_mode ?? detectedCaps.supports_json_mode,
      supports_reasoning: m.supports_reasoning ?? detectedCaps.supports_reasoning,
      supports_code: m.supports_code ?? detectedCaps.supports_code,
    };
    try {
      const result = await sql<{ xmax: string }[]>`
        INSERT INTO models (id, name, provider, model_id, context_length, tier, description,
          supports_vision, supports_tools, supports_audio_input, supports_audio_output,
          supports_image_gen, supports_embedding, supports_json_mode, supports_reasoning, supports_code,
          max_output_tokens, pricing_input, pricing_output)
        VALUES (
          ${m.id}, ${m.name}, ${m.provider}, ${m.model_id}, ${m.context_length}, ${m.tier},
          ${m.description ?? null},
          ${m.supports_vision ?? -1}, ${m.supports_tools ?? -1},
          ${caps.supports_audio_input ?? 0}, ${caps.supports_audio_output ?? 0},
          ${caps.supports_image_gen ?? 0}, ${caps.supports_embedding ?? 0},
          ${caps.supports_json_mode ?? 0}, ${caps.supports_reasoning ?? 0}, ${caps.supports_code ?? 0},
          ${m.max_output_tokens ?? 0}, ${m.pricing_input ?? 0}, ${m.pricing_output ?? 0}
        )
        ON CONFLICT (id) DO UPDATE SET
          last_seen = now(), context_length = EXCLUDED.context_length, tier = EXCLUDED.tier,
          supports_vision = EXCLUDED.supports_vision, supports_tools = EXCLUDED.supports_tools,
          supports_audio_input = EXCLUDED.supports_audio_input, supports_audio_output = EXCLUDED.supports_audio_output,
          supports_image_gen = EXCLUDED.supports_image_gen, supports_embedding = EXCLUDED.supports_embedding,
          supports_json_mode = EXCLUDED.supports_json_mode, supports_reasoning = EXCLUDED.supports_reasoning,
          supports_code = EXCLUDED.supports_code, max_output_tokens = EXCLUDED.max_output_tokens,
          pricing_input = EXCLUDED.pricing_input, pricing_output = EXCLUDED.pricing_output
        RETURNING (xmax = 0) as inserted
      `;
      // xmax=0 means it was a fresh INSERT (not UPDATE)
      const inserted = (result as unknown as Array<{ inserted: boolean }>)[0]?.inserted;
      if (inserted) {
        newCount++;
        newModels.push(m);
        await emitEvent("model_new", `โมเดลใหม่: ${m.name}`, `${m.provider} — ${calcTier(m.context_length).toUpperCase()} ${m.context_length >= 1000 ? Math.round(m.context_length/1000)+"K" : m.context_length} ctx`, m.provider, m.id, "success");
        await logWorker("scan", `🆕 โมเดลใหม่: ${m.name} (${m.provider}) — ${calcTier(m.context_length).toUpperCase()} ${m.context_length >= 1000 ? Math.round(m.context_length/1000)+"K" : m.context_length} ctx`, "success");
      }
    } catch (err) {
      await logWorker("scan", `DB upsert error for ${m.id}: ${err}`, "error");
    }
  }

  // Nickname generation removed — model shown as `provider/model_id` everywhere.

  // ตรวจจับ model ที่หายไป
  let disappearedCount = 0;
  try {
    const recentModels = await sql<{ id: string; name: string; provider: string; last_seen: Date }[]>`
      SELECT id, name, provider, last_seen FROM models
      WHERE last_seen < now() - interval '1 hour'
    `;

    for (const m of recentModels) {
      if (foundIds.has(m.id)) continue;

      const lastSeen = new Date(m.last_seen);
      const hoursAgo = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursAgo >= 48) {
        await logWorker("scan", `💀 หายถาวร: ${m.name} (${m.provider}) — ไม่เจอมา ${Math.round(hoursAgo)} ชม.`, "error");
        disappearedCount++;
      } else if (hoursAgo >= 2) {
        await logWorker("scan", `⚠️ หายชั่วคราว: ${m.name} (${m.provider}) — ไม่เจอมา ${Math.round(hoursAgo)} ชม.`, "warn");
      }
    }
  } catch { /* silent */ }

  const msg = `Hardcoded free model sync: พบ ${allModels.length} | providers=openrouter | local=disabled | auto-discovery=disabled | ใหม่ ${newCount} | หายไป ${disappearedCount}`;
  await logWorker("scan", msg);

  invalidateModelListCache();
  return { found: allModels.length, new: newCount, disappeared: disappearedCount };
}
