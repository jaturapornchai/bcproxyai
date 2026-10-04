/**
 * OpenRouter key status + spend tripwire.
 *
 * Reads GET /api/v1/key (docs: openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) for every
 * stored OpenRouter key and reports whether a charge is possible. The first successful check stores each
 * key's `usage` (USD, all-time) as a baseline; any later increase means real money was spent, so the
 * provider is switched off and stays off until the owner re-enables it by hand in /setup (which starts a
 * fresh baseline). Free-model limits: openrouter.ai/docs/api-reference/limits.
 */
import { createHash } from "node:crypto";
import { getSqlClient } from "@/lib/db/schema";
import { open as openSecret } from "@/lib/secret-vault";
import { isProviderEnabled, setProviderEnabled } from "@/lib/provider-toggle";

export interface OpenRouterKeyStatus {
  configured: boolean;
  level: "ok" | "warn" | "alert" | "unknown";
  /** Thai, ready to show. Alerts first, then warnings, then notes. */
  messages: string[];
  isFreeTier?: boolean;
  /** null = at least one key has no credit limit */
  limit?: number | null;
  limitRemaining?: number | null;
  usage?: number;
  usageDaily?: number;
  freeDailyLimit?: number;
  freeUsedToday?: number;
  disabledByTripwire?: boolean;
  checkedAt?: string;
}

const KEY_URL = "https://openrouter.ai/api/v1/key";
const REMOTE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const FREE_DAILY_LIMIT = 50; // :free requests/day without ≥ $10 purchased credits
const FREE_DAILY_LIMIT_WITH_CREDITS = 1000;
const WARN_RATIO = 0.8;
const BASELINE_PREFIX = "or_usage_baseline:";
const TRIPWIRE_KEY = "or_tripwire";

interface KeyInfo {
  id: string;
  usage?: number;
  usageDaily?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  isFreeTier?: boolean;
  freeLimit?: number;
  freeUsed?: number;
}
type KeyResult = { ok: true; info: KeyInfo } | { ok: false; reason: string };
interface Tripwire { at?: string; baseline?: number; usage?: number }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const numOrNull = (v: unknown) => (v === null ? null : num(v));
const keyId = (apiKey: string) => createHash("sha256").update(apiKey).digest("hex").slice(0, 16); // never store/log the key itself

function sum(xs: Array<number | undefined>): number | undefined {
  const v = xs.filter((x): x is number => x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) : undefined;
}

// ── DB helpers ──

async function getState(key: string): Promise<string | null> {
  const sql = getSqlClient();
  const rows = await sql<{ value: string }[]>`SELECT value FROM worker_state WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

async function setState(key: string, value: string): Promise<void> {
  const sql = getSqlClient();
  await sql`
    INSERT INTO worker_state (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
}

async function logWorker(message: string, level: string): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES ('openrouter-tripwire', ${message}, ${level})`;
  } catch { /* logging must never break the check */ }
}

/** Raw key list straight from the table — getNextApiKey() returns "" once the provider is switched off. */
async function loadKeys(): Promise<Array<{ id: string; key: string }>> {
  const sql = getSqlClient();
  const rows = await sql<{ api_key: string }[]>`SELECT api_key FROM api_keys WHERE provider = 'openrouter'`;
  const keys = rows.flatMap((r) => openSecret(r.api_key).split(",").map((k) => k.trim()).filter(Boolean));
  return [...new Set(keys)].map((key) => ({ id: keyId(key), key }));
}

async function readTripwire(): Promise<Tripwire | null> {
  const raw = await getState(TRIPWIRE_KEY);
  if (raw === null) return null;
  try { return (JSON.parse(raw) as Tripwire | null) ?? {}; } catch { return {}; }
}

async function resetTripwire(): Promise<void> {
  const sql = getSqlClient();
  await sql`DELETE FROM worker_state WHERE key = ${TRIPWIRE_KEY} OR starts_with(key, ${BASELINE_PREFIX})`;
}

async function baselineFor(id: string, usage: number): Promise<number> {
  const raw = await getState(BASELINE_PREFIX + id);
  const stored = raw === null ? NaN : Number(raw);
  if (Number.isFinite(stored)) return stored;
  await setState(BASELINE_PREFIX + id, String(usage));
  return usage;
}

/** Estimate: today's (UTC) gateway rows for openrouter — used only when the API gives no free-quota counter. */
async function countGatewayToday(): Promise<number | undefined> {
  try {
    const sql = getSqlClient();
    const rows = await sql<{ n: string }[]>`
      SELECT COUNT(*) AS n FROM gateway_logs
      WHERE provider = 'openrouter' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    `;
    return Number(rows[0]?.n ?? 0);
  } catch {
    return undefined;
  }
}

// ── OpenRouter API ──

async function fetchKeyInfo(id: string, apiKey: string): Promise<KeyResult> {
  try {
    const res = await fetch(KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const d = ((await res.json()) as { data?: Record<string, unknown> } | null)?.data ?? {};
    const free = (d.free_model_daily_requests ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      info: {
        id,
        usage: num(d.usage),
        usageDaily: num(d.usage_daily),
        limit: numOrNull(d.limit),
        limitRemaining: numOrNull(d.limit_remaining),
        isFreeTier: typeof d.is_free_tier === "boolean" ? d.is_free_tier : undefined,
        freeLimit: num(free.limit),
        freeUsed: num(free.used),
      },
    };
  } catch {
    return { ok: false, reason: "เชื่อมต่อ OpenRouter ไม่ได้" };
  }
}

// Remote responses are cached; everything derived from the DB (tripwire, toggle, baseline) is recomputed per call.
let remote: { at: number; sig: string; results: KeyResult[] } | null = null;

async function fetchAll(keys: Array<{ id: string; key: string }>): Promise<KeyResult[]> {
  const sig = keys.map((k) => k.id).join(",");
  if (remote && remote.sig === sig && Date.now() - remote.at < REMOTE_TTL_MS) return remote.results;
  const results = await Promise.all(keys.map((k) => fetchKeyInfo(k.id, k.key)));
  remote = results.every((r) => r.ok) ? { at: Date.now(), sig, results } : null; // don't pin a failure for 5 min
  return results;
}

// ── tripwire ──

const usd = (n: number) => `$${n.toFixed(6)}`;

function tripMessages(t: Tripwire): string[] {
  const when = t.at ? ` เมื่อ ${t.at.slice(0, 16).replace("T", " ")} UTC` : "";
  const delta = t.baseline !== undefined && t.usage !== undefined ? ` จาก ${usd(t.baseline)} เป็น ${usd(t.usage)}` : "";
  return [
    `ระบบปิด OpenRouter อัตโนมัติ${when} — ยอดใช้งานจริง (usage) ของ key เพิ่มขึ้น${delta} แปลว่ามีเงินถูกตัด`,
    "ตรวจที่ openrouter.ai/activity และ openrouter.ai/settings/credits ว่าถูกตัดจากอะไร แล้วคงยอดเครดิต $0 / ตั้ง credit limit = $0 ให้ key ก่อนเปิดคืนที่หน้า /setup (เปิดคืน = เริ่มนับยอดใหม่)",
  ];
}

async function tripProvider(baseline: number, usage: number): Promise<Tripwire> {
  const trip: Tripwire = { at: new Date().toISOString(), baseline, usage };
  if (await isProviderEnabled("openrouter")) await setProviderEnabled("openrouter", false);
  await setState(TRIPWIRE_KEY, JSON.stringify(trip));
  await logWorker(`TRIPWIRE: OpenRouter usage ${usd(baseline)} -> ${usd(usage)} — provider disabled`, "error");
  return trip;
}

// ── status ──

async function compute(): Promise<OpenRouterKeyStatus> {
  const checkedAt = new Date().toISOString();
  const keys = await loadKeys();
  if (keys.length === 0) return { configured: false, level: "unknown", messages: ["ยังไม่ได้ใส่ OpenRouter key"], checkedAt };

  let trip = await readTripwire();
  if (trip && (await isProviderEnabled("openrouter"))) {
    // owner switched the provider back on by hand → forget the tripwire, next successful check = new baseline
    await resetTripwire();
    trip = null;
    remote = null;
  }

  const results = await fetchAll(keys);
  const infos = results.flatMap((r) => (r.ok ? [r.info] : []));
  const failures = results.flatMap((r) => (r.ok ? [] : [r.reason]));
  const alerts: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  if (!trip) {
    for (const i of infos) {
      if (i.usage === undefined) continue;
      const baseline = await baselineFor(i.id, i.usage);
      if (i.usage > baseline) {
        trip = await tripProvider(baseline, i.usage);
        break;
      }
    }
  }
  if (trip) alerts.push(...tripMessages(trip));
  if (failures.length > 0) notes.push(`ตรวจสถานะ key ไม่สำเร็จ ${failures.length}/${results.length} ตัว (${[...new Set(failures)].join(", ")})`);

  if (infos.length === 0) {
    return { configured: true, level: trip ? "alert" : "unknown", messages: [...alerts, ...notes], disabledByTripwire: Boolean(trip), checkedAt };
  }

  const limit = infos.some((i) => i.limit === null) ? null : sum(infos.map((i) => i.limit ?? undefined));
  const limitRemaining = infos.some((i) => i.limitRemaining === null) ? null : sum(infos.map((i) => i.limitRemaining ?? undefined));
  const isFreeTier = infos.some((i) => i.isFreeTier === false) ? false : infos.every((i) => i.isFreeTier === true) ? true : undefined;

  const unlimited = infos.filter((i) => i.limit === null).length;
  if (unlimited > 0) {
    warnings.push(`${infos.length > 1 ? `${unlimited}/${infos.length} key` : "key"} ไม่มี credit limit — ตั้ง limit = $0 ที่ openrouter.ai/settings/keys เพื่อกันเงินรั่ว`);
  }
  if (isFreeTier === false) {
    warnings.push("บัญชีนี้เคยซื้อเครดิต (ไม่ใช่ free tier) — model ที่ไม่ใช่ :free อาจตัดเงินจริงได้ ตรวจให้ยอดเครดิตเหลือ $0 และปิด auto top-up");
  }

  // Free quota: prefer OpenRouter's own counter (also counts non-gateway traffic); fall back to a gateway-log estimate.
  const quotas = infos.flatMap((i) => (i.freeLimit && i.freeLimit > 0 && i.freeUsed !== undefined ? [{ limit: i.freeLimit, used: i.freeUsed }] : []));
  const q = quotas.sort((a, b) => b.used / b.limit - a.used / a.limit)[0];
  const freeDailyLimit = q?.limit ?? (isFreeTier === false ? FREE_DAILY_LIMIT_WITH_CREDITS : FREE_DAILY_LIMIT);
  const freeUsedToday = q?.used ?? (await countGatewayToday());
  if (freeUsedToday !== undefined && freeUsedToday >= WARN_RATIO * freeDailyLimit) {
    warnings.push(`โควตา model ฟรีวันนี้ใช้ไป ${freeUsedToday}/${freeDailyLimit} request (${Math.round((freeUsedToday / freeDailyLimit) * 100)}%)${q ? "" : " — ประมาณจาก log ของ gateway"}`);
  }

  return {
    configured: true,
    level: alerts.length > 0 ? "alert" : warnings.length > 0 ? "warn" : "ok",
    messages: [...alerts, ...warnings, ...notes],
    isFreeTier,
    limit,
    limitRemaining,
    usage: sum(infos.map((i) => i.usage)),
    usageDaily: sum(infos.map((i) => i.usageDaily)),
    freeDailyLimit,
    freeUsedToday,
    disabledByTripwire: Boolean(trip),
    checkedAt,
  };
}

let inflight: Promise<OpenRouterKeyStatus> | null = null;

/** Status of every stored OpenRouter key (remote calls cached ~5 min). Also runs the spend tripwire. */
export function getOpenRouterKeyStatus(): Promise<OpenRouterKeyStatus> {
  inflight ??= compute().finally(() => { inflight = null; });
  return inflight;
}
