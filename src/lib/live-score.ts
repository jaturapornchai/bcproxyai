/**
 * Live Score Tracker — EMA (Exponential Moving Average) แบบ in-memory
 * อัพเดททันทีที่ request จบ ไม่ต้องรอ DB round-trip หรือ benchmark cycle
 *
 * ใช้สำหรับ:
 * - reorder candidates ครั้งถัดไปไม่ให้วน provider เดิมที่เพิ่ง fail
 * - penalty latency per provider + per model
 */
import { recordRecentFailure, recordRecentSuccess } from "@/lib/learning";

interface LiveScore {
  successRate: number;   // EMA 0.0-1.0
  avgLatency: number;    // EMA ms (success เท่านั้น)
  samples: number;       // จำนวน event ที่เคยเห็น (cap 100)
  lastUpdate: number;    // timestamp
}

const ALPHA = 0.25;            // smoothing — ยิ่งสูง ยิ่งใหม่มีน้ำหนักมาก
const INITIAL_SCORE = 0.7;     // เริ่มต้นที่ optimistic หน่อย
const INITIAL_LATENCY = 3000;  // เริ่มที่ 3s

const providerScores = new Map<string, LiveScore>();
const modelScores = new Map<string, LiveScore>();

function updateEma(prev: LiveScore | undefined, success: boolean, latencyMs: number): LiveScore {
  if (!prev) {
    return {
      successRate: success ? 1.0 : 0.0,
      avgLatency: success ? latencyMs : INITIAL_LATENCY,
      samples: 1,
      lastUpdate: Date.now(),
    };
  }
  const newRate = prev.successRate * (1 - ALPHA) + (success ? 1.0 : 0.0) * ALPHA;
  const newLat = success
    ? prev.avgLatency * (1 - ALPHA) + latencyMs * ALPHA
    : prev.avgLatency; // fail ไม่ปน latency (มัน misleading)
  return {
    successRate: newRate,
    avgLatency: newLat,
    samples: Math.min(prev.samples + 1, 100),
    lastUpdate: Date.now(),
  };
}

/**
 * บันทึกผล request ทันทีที่ proxy ตอบกลับ
 * เรียกทั้ง success และ fail case
 */
export function recordOutcome(provider: string, modelId: string, success: boolean, latencyMs: number): void {
  providerScores.set(provider, updateEma(providerScores.get(provider), success, latencyMs));
  modelScores.set(modelId, updateEma(modelScores.get(modelId), success, latencyMs));
  // Feed the in-memory circuit breaker so it can throttle subsequent probes.
  if (success) recordRecentSuccess(`${provider}:${modelId}`);
  else recordRecentFailure(`${provider}:${modelId}`);
}

export function getProviderScore(provider: string): LiveScore {
  return providerScores.get(provider) ?? {
    successRate: INITIAL_SCORE,
    avgLatency: INITIAL_LATENCY,
    samples: 0,
    lastUpdate: 0,
  };
}

export function getModelScore(modelId: string): LiveScore {
  return modelScores.get(modelId) ?? {
    successRate: INITIAL_SCORE,
    avgLatency: INITIAL_LATENCY,
    samples: 0,
    lastUpdate: 0,
  };
}

/**
 * Penalty ที่จะบวกเข้า latency ของ candidate ตอน sort
 * - model fail บ่อย → penalty สูง
 * - provider fail บ่อย → penalty สูง
 * - สดกว่า (เพิ่งอัพเดท) → penalty มีน้ำหนักมากกว่า
 */
export function getSortPenalty(provider: string, modelId: string): number {
  const p = getProviderScore(provider);
  const m = getModelScore(modelId);

  // success rate 0 → +15000ms penalty (ดันไปท้าย)
  // success rate 1 → 0ms
  const providerPenalty = (1 - p.successRate) * 15_000;
  const modelPenalty = (1 - m.successRate) * 10_000;

  // ถ้า sample ยังน้อย → penalty น้อยลง (ยังไม่รู้จริง)
  const providerConfidence = Math.min(p.samples / 5, 1);
  const modelConfidence = Math.min(m.samples / 3, 1);

  return providerPenalty * providerConfidence + modelPenalty * modelConfidence;
}

/**
 * คืนว่า model/provider นี้ถูก "ban ชั่วคราว" หรือไม่
 * (fail 3 ครั้งล่าสุดติด ภายใน 2 นาที)
 */
export function isRecentlyDead(provider: string, modelId: string): boolean {
  const m = getModelScore(modelId);
  const freshMs = Date.now() - m.lastUpdate;
  return m.samples >= 3 && m.successRate < 0.15 && freshMs < 2 * 60 * 1000;
}

/**
 * สำหรับ dashboard/debug — คืน snapshot ทั้งหมด
 */
export function getAllScores(): {
  providers: Array<{ provider: string; successRate: number; avgLatency: number; samples: number }>;
  models: Array<{ modelId: string; successRate: number; avgLatency: number; samples: number }>;
} {
  return {
    providers: Array.from(providerScores.entries()).map(([provider, s]) => ({
      provider,
      successRate: s.successRate,
      avgLatency: s.avgLatency,
      samples: s.samples,
    })).sort((a, b) => b.successRate - a.successRate),
    models: Array.from(modelScores.entries()).map(([modelId, s]) => ({
      modelId,
      successRate: s.successRate,
      avgLatency: s.avgLatency,
      samples: s.samples,
    })).sort((a, b) => b.successRate - a.successRate),
  };
}
