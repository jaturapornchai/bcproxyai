/**
 * Provider Rate Limit Memory
 * ─────────────────────────────
 * ระบบ "จำ" TPM/TPD limit ของแต่ละ model จาก 3 แหล่ง:
 *   1. Response header (X-RateLimit-*) — real-time, แม่นสุด
 *   2. Error 429 message — parse ข้อความ "Limit 100000, Used 91788"
 *   3. Cache Redis 5 วินาที + DB row เป็น source of truth
 *
 * ก่อนยิง request → ตรวจว่า remaining >= projected tokens หรือไม่
 * ถ้าไม่พอ → skip model นี้สำหรับ request ขนาดนี้
 */
import { getSqlClient } from "@/lib/db/schema";
import { getRedis } from "@/lib/redis";

export interface ProviderLimit {
  provider: string;
  modelId: string;
  limitTpm: number | null;
  limitTpd: number | null;
  remainingTpm: number | null;
  remainingTpd: number | null;
  resetTpmAt: Date | null;
  resetTpdAt: Date | null;
  lastUpdated: number;
  source: string;
}

const REDIS_KEY = (p: string, m: string) => `plim:${p}:${m}`;
const CACHE_TTL = 300; // 5 นาที

/**
 * Parse เลขจาก string ต่างๆ เช่น "100000", "100,000", "100_000"
 */
function parseNum(s: string | undefined | null): number | null {
  if (!s) return null;
  const clean = s.replace(/[,_\s]/g, "");
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * แหล่งที่ 1: Parse HTTP response headers (Groq, OpenAI-style)
 * Headers:
 *   x-ratelimit-limit-tokens: 6000
 *   x-ratelimit-remaining-tokens: 2341
 *   x-ratelimit-reset-tokens: 45s  หรือ  2026-04-09T12:00:00Z
 */
export function parseLimitHeaders(
  headers: Headers
): Partial<ProviderLimit> | null {
  const limit = parseNum(headers.get("x-ratelimit-limit-tokens"));
  const remaining = parseNum(headers.get("x-ratelimit-remaining-tokens"));
  const resetRaw = headers.get("x-ratelimit-reset-tokens");

  if (limit == null && remaining == null) return null;

  let resetAt: Date | null = null;
  if (resetRaw) {
    // "45s" / "1m30s" / ISO
    const sec = resetRaw.match(/^(\d+(?:\.\d+)?)s$/)?.[1];
    const ms = resetRaw.match(/^(\d+)ms$/)?.[1];
    const minSec = resetRaw.match(/^(\d+)m(\d+)s$/);
    if (sec) resetAt = new Date(Date.now() + Number(sec) * 1000);
    else if (ms) resetAt = new Date(Date.now() + Number(ms));
    else if (minSec) resetAt = new Date(Date.now() + (Number(minSec[1]) * 60 + Number(minSec[2])) * 1000);
    else {
      const d = new Date(resetRaw);
      if (!Number.isNaN(d.getTime())) resetAt = d;
    }
  }

  return {
    limitTpm: limit,
    remainingTpm: remaining,
    resetTpmAt: resetAt,
    source: "header",
  };
}

/**
 * แหล่งที่ 2: Parse 429 error message
 * ตัวอย่าง:
 *   Groq: "Rate limit reached for model `llama-3.3-70b` in organization ...
 *          on tokens per day (TPD): Limit 100000, Used 91788, Requested 10738"
 *   Groq: "... on tokens per minute (TPM): Limit 6000 ..."
 *   Mistral: "Rate limit exceeded" (ไม่บอกตัวเลข → source=generic)
 *   Cerebras: "queue_exceeded" (ไม่บอกตัวเลข)
 */
export function parseLimitError(errText: string): Partial<ProviderLimit> | null {
  if (!errText) return null;

  const isTpd = /tokens per day|TPD|daily limit|per day/i.test(errText);
  const isTpm = /tokens per minute|TPM|per minute/i.test(errText);

  // หา "Limit NNNNN" หรือ "limit is NNNNN"
  const limitMatch = errText.match(/[Ll]imit[:\s]+(\d[\d,_]*)/);
  const usedMatch = errText.match(/[Uu]sed[:\s]+(\d[\d,_]*)/);
  const requestedMatch = errText.match(/[Rr]equested[:\s]+(\d[\d,_]*)/);

  const limit = parseNum(limitMatch?.[1]);
  const used = parseNum(usedMatch?.[1]);
  // requested = request ที่ทำให้ 429 — ใช้ประเมิน remaining

  if (limit == null) {
    // ไม่มีตัวเลข — บันทึกแค่ "รู้ว่าเคย 429"
    return { source: "error-generic" };
  }

  const remaining = used != null ? Math.max(0, limit - used) : 0;

  // Reset — Groq TPM หมดทุก 1 นาที, TPD หมดเที่ยงคืน UTC
  let resetAt: Date | null = null;
  if (isTpm) {
    resetAt = new Date(Date.now() + 60 * 1000);
  } else if (isTpd) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0); // next UTC midnight
    resetAt = tomorrow;
  }

  if (isTpd) {
    return {
      limitTpd: limit,
      remainingTpd: remaining,
      resetTpdAt: resetAt,
      source: "error-tpd",
    };
  }
  if (isTpm) {
    return {
      limitTpm: limit,
      remainingTpm: remaining,
      resetTpmAt: resetAt,
      source: "error-tpm",
    };
  }
  // ไม่ระบุ window — เดาเป็น TPM (common case)
  return {
    limitTpm: limit,
    remainingTpm: remaining,
    resetTpmAt: new Date(Date.now() + 60 * 1000),
    source: "error-unknown",
  };
}

/**
 * Upsert limit ลง DB + Redis cache
 */
export async function recordLimit(
  provider: string,
  modelId: string,
  partial: Partial<ProviderLimit>
): Promise<void> {
  try {
    const sql = getSqlClient();
    // Fetch current เพื่อ merge
    const existing = await sql<Array<Record<string, unknown>>>`
      SELECT limit_tpm, limit_tpd, remaining_tpm, remaining_tpd,
             reset_tpm_at, reset_tpd_at
      FROM provider_limits
      WHERE provider = ${provider} AND model_id = ${modelId}
    `;
    const cur = existing[0] ?? {};

    const merged = {
      limit_tpm: partial.limitTpm ?? (cur.limit_tpm as number | null) ?? null,
      limit_tpd: partial.limitTpd ?? (cur.limit_tpd as number | null) ?? null,
      remaining_tpm: partial.remainingTpm ?? (cur.remaining_tpm as number | null) ?? null,
      remaining_tpd: partial.remainingTpd ?? (cur.remaining_tpd as number | null) ?? null,
      reset_tpm_at: partial.resetTpmAt ?? (cur.reset_tpm_at as Date | null) ?? null,
      reset_tpd_at: partial.resetTpdAt ?? (cur.reset_tpd_at as Date | null) ?? null,
      source: partial.source ?? "unknown",
    };

    const isError = partial.source?.startsWith("error");

    await sql`
      INSERT INTO provider_limits (provider, model_id, limit_tpm, limit_tpd,
        remaining_tpm, remaining_tpd, reset_tpm_at, reset_tpd_at,
        last_429_at, source, updated_at)
      VALUES (${provider}, ${modelId}, ${merged.limit_tpm}, ${merged.limit_tpd},
        ${merged.remaining_tpm}, ${merged.remaining_tpd},
        ${merged.reset_tpm_at}, ${merged.reset_tpd_at},
        ${isError ? new Date() : null}, ${merged.source}, now())
      ON CONFLICT (provider, model_id) DO UPDATE SET
        limit_tpm = EXCLUDED.limit_tpm,
        limit_tpd = EXCLUDED.limit_tpd,
        remaining_tpm = EXCLUDED.remaining_tpm,
        remaining_tpd = EXCLUDED.remaining_tpd,
        reset_tpm_at = EXCLUDED.reset_tpm_at,
        reset_tpd_at = EXCLUDED.reset_tpd_at,
        last_429_at = COALESCE(EXCLUDED.last_429_at, provider_limits.last_429_at),
        source = EXCLUDED.source,
        updated_at = now()
    `;

    // Invalidate Redis cache
    try {
      const redis = getRedis();
      await redis.del(REDIS_KEY(provider, modelId));
    } catch { /* ignore */ }

    console.log(`[LIMIT-LEARN] ${provider}/${modelId} ${partial.source}: TPM=${merged.limit_tpm} TPD=${merged.limit_tpd} remTPM=${merged.remaining_tpm} remTPD=${merged.remaining_tpd}`);
  } catch (err) {
    console.error(`[LIMIT-RECORD] ${provider}/${modelId} error:`, err);
  }
}

/**
 * Lookup limit สำหรับ model (cached)
 */
export async function getLimit(provider: string, modelId: string): Promise<ProviderLimit | null> {
  try {
    const redis = getRedis();
    const cached = await redis.get(REDIS_KEY(provider, modelId));
    if (cached) {
      const obj = JSON.parse(cached);
      return {
        ...obj,
        resetTpmAt: obj.resetTpmAt ? new Date(obj.resetTpmAt) : null,
        resetTpdAt: obj.resetTpdAt ? new Date(obj.resetTpdAt) : null,
      };
    }
  } catch { /* ignore */ }

  try {
    const sql = getSqlClient();
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT limit_tpm, limit_tpd, remaining_tpm, remaining_tpd,
             reset_tpm_at, reset_tpd_at, source, updated_at
      FROM provider_limits
      WHERE provider = ${provider} AND model_id = ${modelId}
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    const limit: ProviderLimit = {
      provider,
      modelId,
      limitTpm: (r.limit_tpm as number | null) ?? null,
      limitTpd: (r.limit_tpd as number | null) ?? null,
      remainingTpm: (r.remaining_tpm as number | null) ?? null,
      remainingTpd: (r.remaining_tpd as number | null) ?? null,
      resetTpmAt: (r.reset_tpm_at as Date | null) ?? null,
      resetTpdAt: (r.reset_tpd_at as Date | null) ?? null,
      lastUpdated: (r.updated_at as Date).getTime(),
      source: (r.source as string) ?? "unknown",
    };

    try {
      const redis = getRedis();
      await redis.set(REDIS_KEY(provider, modelId), JSON.stringify(limit), "EX", CACHE_TTL);
    } catch { /* ignore */ }

    return limit;
  } catch {
    return null;
  }
}

/**
 * ตรวจว่า model นี้รับ request ขนาด projectedTokens ได้หรือไม่
 *
 * Returns:
 *   { ok: true } — ผ่าน ยิงได้
 *   { ok: false, reason } — ข้าม (ไม่มีทาง fit)
 */
export async function canFitRequest(
  provider: string,
  modelId: string,
  projectedTokens: number
): Promise<{ ok: boolean; reason?: string }> {
  const limit = await getLimit(provider, modelId);
  if (!limit) return { ok: true };

  const now = Date.now();

  // TPD (ต่อวัน) — ถ้ามี remaining และไม่พอ
  if (limit.remainingTpd != null && limit.limitTpd != null) {
    const tpdExpired = limit.resetTpdAt && limit.resetTpdAt.getTime() < now;
    if (!tpdExpired && limit.remainingTpd < projectedTokens) {
      return {
        ok: false,
        reason: `TPD: remaining ${limit.remainingTpd} < needed ${projectedTokens} (resets ${limit.resetTpdAt?.toISOString()})`,
      };
    }
    // ถ้า request เดียวเกิน limit_tpd ทั้งหมด → ไม่มีทางผ่าน
    if (limit.limitTpd < projectedTokens) {
      return { ok: false, reason: `TPD hard: limit ${limit.limitTpd} < needed ${projectedTokens}` };
    }
  }

  // TPM (ต่อนาที) — ถ้ามี limit และ request เดียวเกิน → skip ถาวร
  if (limit.limitTpm != null && limit.limitTpm < projectedTokens) {
    return {
      ok: false,
      reason: `TPM hard: limit ${limit.limitTpm} < needed ${projectedTokens} (ไม่มีทาง fit ต่อให้รอ reset)`,
    };
  }

  // TPM remaining ชั่วคราว — ถ้าไม่พอและยังไม่ reset → skip (request ถัดไปจะลองใหม่)
  if (limit.remainingTpm != null && limit.limitTpm != null) {
    const tpmExpired = limit.resetTpmAt && limit.resetTpmAt.getTime() < now;
    if (!tpmExpired && limit.remainingTpm < projectedTokens) {
      return {
        ok: false,
        reason: `TPM soft: remaining ${limit.remainingTpm} < needed ${projectedTokens} (resets in ${Math.round(((limit.resetTpmAt?.getTime() ?? now) - now) / 1000)}s)`,
      };
    }
  }

  return { ok: true };
}

/**
 * สำหรับ dashboard/debug
 */
export async function getAllLimits(): Promise<ProviderLimit[]> {
  try {
    const sql = getSqlClient();
    const rows = await sql<Array<Record<string, unknown>>>`
      SELECT provider, model_id, limit_tpm, limit_tpd, remaining_tpm, remaining_tpd,
             reset_tpm_at, reset_tpd_at, source, last_429_at, updated_at
      FROM provider_limits
      ORDER BY updated_at DESC
    `;
    return rows.map((r) => ({
      provider: r.provider as string,
      modelId: r.model_id as string,
      limitTpm: (r.limit_tpm as number | null) ?? null,
      limitTpd: (r.limit_tpd as number | null) ?? null,
      remainingTpm: (r.remaining_tpm as number | null) ?? null,
      remainingTpd: (r.remaining_tpd as number | null) ?? null,
      resetTpmAt: (r.reset_tpm_at as Date | null) ?? null,
      resetTpdAt: (r.reset_tpd_at as Date | null) ?? null,
      lastUpdated: (r.updated_at as Date).getTime(),
      source: (r.source as string) ?? "unknown",
    }));
  } catch {
    return [];
  }
}
