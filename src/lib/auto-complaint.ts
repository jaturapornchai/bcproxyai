import { getSqlClient } from "@/lib/db/schema";
import { processComplaint } from "@/lib/worker/complaint";
import { emitEvent } from "@/lib/routing-learn";

/**
 * Auto-detect bad responses and file complaints automatically
 * Called from gateway after every non-streaming response
 * Non-blocking: runs complaint processing in background
 */
export function autoDetectComplaint(
  provider: string,
  modelId: string,
  content: string
): void {
  // Skip Ollama (local, user controls quality)
  if (provider === "ollama") return;

  const trimmed = (content ?? "").trim();
  let category: string | null = null;

  // Empty response
  if (!trimmed) {
    category = "refused";
  }
  // Too short (< 5 chars for a response)
  else if (trimmed.length < 5) {
    category = "too_short";
  }
  // Gibberish: mostly non-printable or replacement characters
  else if (hasGarbageChars(trimmed)) {
    category = "gibberish";
  }

  if (!category) return;

  // Find model in DB and file complaint (async, non-blocking)
  autoDetectComplaintAsync(provider, modelId, category).catch(() => {});
}

async function autoDetectComplaintAsync(
  provider: string,
  modelId: string,
  category: string
): Promise<void> {
  try {
    const sql = getSqlClient();
    const models = await sql<{ id: string }[]>`
      SELECT id FROM models WHERE provider = ${provider} AND model_id = ${modelId} LIMIT 1
    `;

    if (models.length === 0) return;
    const model = models[0];

    // Rate limit: max 1 auto-complaint per model per 30 min
    const recentRows = await sql<{ id: number }[]>`
      SELECT id FROM complaints
      WHERE model_id = ${model.id} AND source = 'auto'
        AND created_at >= now() - interval '30 minutes'
      LIMIT 1
    `;

    if (recentRows.length > 0) return; // Already complained recently

    // File complaint
    const result = await sql<{ id: number }[]>`
      INSERT INTO complaints (model_id, category, reason, source)
      VALUES (${model.id}, ${category}, ${'Auto-detected: ' + category}, 'auto')
      RETURNING id
    `;

    const complaintId = result[0].id;

    // Cooldown 30 min
    const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
      VALUES (${model.id}, 'complained', ${'Auto-complaint: ' + category}, ${cooldownUntil}, now())
    `;

    // Process re-exam in background
    processComplaint(complaintId, model.id, provider, modelId, category).catch(() => {});

    await emitEvent("complaint", `ร้องเรียนอัตโนมัติ: ${modelId}`, `ประเภท: ${category}`, provider, modelId, "warn");
    console.log(`[Auto-Complaint] ${provider}/${modelId}: ${category}`);
  } catch {
    // Non-critical
  }
}

/**
 * Check if text contains mostly garbage/non-printable characters
 */
function hasGarbageChars(text: string): boolean {
  let garbage = 0;
  for (let i = 0; i < Math.min(text.length, 100); i++) {
    const code = text.charCodeAt(i);
    if (code === 0xFFFD || (code < 32 && code !== 10 && code !== 13 && code !== 9)) {
      garbage++;
    }
  }
  return garbage > text.length * 0.3; // >30% garbage
}
