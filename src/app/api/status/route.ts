import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";
import { ensureWorkerStarted } from "@/lib/worker/startup";

export const dynamic = "force-dynamic";

ensureWorkerStarted();

export async function GET() {
  try {
    const cached = getCached<object>("api:status");
    if (cached) return NextResponse.json(cached);

    const db = getDb();

    // Worker state
    const statusRow = db
      .prepare("SELECT value FROM worker_state WHERE key = 'status'")
      .get() as { value: string } | undefined;
    const lastRunRow = db
      .prepare("SELECT value FROM worker_state WHERE key = 'last_run'")
      .get() as { value: string } | undefined;
    const nextRunRow = db
      .prepare("SELECT value FROM worker_state WHERE key = 'next_run'")
      .get() as { value: string } | undefined;

    const workerStatus = statusRow?.value ?? "idle";
    const lastRun = lastRunRow?.value ?? null;
    const nextRun = nextRunRow?.value ?? null;

    // Total models
    const totalRow = db
      .prepare("SELECT COUNT(*) as count FROM models")
      .get() as { count: number };

    // Available models: latest health_log status='available' and no active cooldown
    const availableRow = db
      .prepare(`
        SELECT COUNT(DISTINCT h.model_id) as count
        FROM health_logs h
        INNER JOIN (
          SELECT model_id, MAX(checked_at) as max_checked
          FROM health_logs
          GROUP BY model_id
        ) latest ON h.model_id = latest.model_id AND h.checked_at = latest.max_checked
        WHERE h.status = 'available'
          AND (h.cooldown_until IS NULL OR h.cooldown_until <= datetime('now'))
      `)
      .get() as { count: number };

    // Cooldown models
    const cooldownRow = db
      .prepare(`
        SELECT COUNT(DISTINCT h.model_id) as count
        FROM health_logs h
        INNER JOIN (
          SELECT model_id, MAX(checked_at) as max_checked
          FROM health_logs
          GROUP BY model_id
        ) latest ON h.model_id = latest.model_id AND h.checked_at = latest.max_checked
        WHERE h.cooldown_until > datetime('now')
      `)
      .get() as { count: number };

    // Benchmarked models
    const benchmarkedRow = db
      .prepare(
        "SELECT COUNT(DISTINCT model_id) as count FROM benchmark_results"
      )
      .get() as { count: number };

    // Average score
    const avgRow = db
      .prepare(`
        SELECT AVG(avg_score) as avg_score
        FROM (
          SELECT model_id, AVG(score) as avg_score
          FROM benchmark_results
          GROUP BY model_id
        )
      `)
      .get() as { avg_score: number | null };

    // Recent logs (last 50)
    const recentLogs = db
      .prepare(
        "SELECT step, message, level, created_at as createdAt FROM worker_logs ORDER BY created_at DESC LIMIT 50"
      )
      .all();

    // โมเดลใหม่ (first_seen ภายใน 24 ชม.)
    const newModels = db.prepare(`
      SELECT id, name, provider, model_id, context_length, tier, first_seen as firstSeen
      FROM models WHERE first_seen >= datetime('now', '-24 hours')
      ORDER BY first_seen DESC
    `).all();

    // โมเดลหายไป (last_seen เกิน 48 ชม.)
    const missingModels = db.prepare(`
      SELECT id, name, provider, model_id, context_length, tier, last_seen as lastSeen
      FROM models WHERE last_seen < datetime('now', '-48 hours')
      ORDER BY last_seen DESC
    `).all();

    // โมเดลหายชั่วคราว (last_seen 2-48 ชม.)
    const warningModels = db.prepare(`
      SELECT id, name, provider, model_id, context_length, tier, last_seen as lastSeen
      FROM models WHERE last_seen < datetime('now', '-2 hours') AND last_seen >= datetime('now', '-48 hours')
      ORDER BY last_seen DESC
    `).all();

    const result = {
      worker: {
        status: workerStatus,
        lastRun,
        nextRun,
      },
      stats: {
        totalModels: totalRow.count,
        availableModels: availableRow.count,
        cooldownModels: cooldownRow.count,
        benchmarkedModels: benchmarkedRow.count,
        avgScore: avgRow.avg_score ? Math.round(avgRow.avg_score * 10) / 10 : 0,
      },
      modelChanges: {
        new: newModels,
        missing: missingModels,
        warning: warningModels,
      },
      recentLogs,
    };
    setCache("api:status", result, 5000); // cache 5 seconds
    return NextResponse.json(result);
  } catch (err) {
    console.error("[status] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
