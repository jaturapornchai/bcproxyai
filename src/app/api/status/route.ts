import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { getCached, setCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cached = getCached<object>("api:status");
    if (cached) return NextResponse.json(cached);

    const sql = getSqlClient();

    // Worker state
    const workerRows = await sql<{ key: string; value: string }[]>`
      SELECT key, value FROM worker_state WHERE key IN ('status', 'last_run', 'next_run', 'judge_model')
    `;
    const workerMap = new Map(workerRows.map(r => [r.key, r.value]));

    const workerStatus = workerMap.get("status") ?? "idle";
    const lastRun = workerMap.get("last_run") ?? null;
    const nextRun = workerMap.get("next_run") ?? null;
    const judgeModel = workerMap.get("judge_model") ?? null;

    // Total models — cast to int so the postgres driver returns a real JS number
    const totalRows = await sql<{ count: number }[]>`SELECT COUNT(*)::int as count FROM models`;
    const totalCount = Number(totalRows[0]?.count ?? 0);

    // Available = total - cooldown
    const availableRows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int as count FROM models
      WHERE id NOT IN (
        SELECT h.model_id FROM health_logs h
        INNER JOIN (SELECT model_id, MAX(id) as max_id FROM health_logs GROUP BY model_id) l
          ON h.model_id = l.model_id AND h.id = l.max_id
        WHERE h.cooldown_until > now()
      )
    `;
    const availableCount = Number(availableRows[0]?.count ?? 0);

    // Cooldown models
    const cooldownRows = await sql<{ count: number }[]>`
      SELECT COUNT(DISTINCT h.model_id)::int as count
      FROM health_logs h
      INNER JOIN (SELECT model_id, MAX(id) as max_id FROM health_logs GROUP BY model_id) l
        ON h.model_id = l.model_id AND h.id = l.max_id
      WHERE h.cooldown_until > now()
    `;
    const cooldownCount = Number(cooldownRows[0]?.count ?? 0);

    // สอบผ่าน — model ที่ attempt ล่าสุด passed = true
    const passedRows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int as count FROM (
        SELECT DISTINCT ON (model_id) passed FROM exam_attempts
        WHERE finished_at IS NOT NULL ORDER BY model_id, started_at DESC
      ) sub WHERE passed = true
    `;
    const passedExamCount = Number(passedRows[0]?.count ?? 0);

    // สอบตก — model ที่ attempt ล่าสุด passed = false
    const failedRows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int as count FROM (
        SELECT DISTINCT ON (model_id) passed FROM exam_attempts
        WHERE finished_at IS NOT NULL ORDER BY model_id, started_at DESC
      ) sub WHERE passed = false
    `;
    const failedExamCount = Number(failedRows[0]?.count ?? 0);

    // คะแนนเฉลี่ยของ model ที่ผ่าน
    const avgRows = await sql<{ avg_score: number | null }[]>`
      SELECT AVG(score_pct) as avg_score FROM (
        SELECT DISTINCT ON (model_id) score_pct FROM exam_attempts
        WHERE finished_at IS NOT NULL AND passed = true
        ORDER BY model_id, started_at DESC
      ) sub
    `;
    const avgScore = avgRows[0]?.avg_score;

    // Recent logs (last 50)
    const recentLogs = await sql`
      SELECT step, message, level, created_at as "createdAt"
      FROM worker_logs ORDER BY created_at DESC LIMIT 50
    `;

    // โมเดลใหม่ (first_seen ภายใน 24 ชม.) + ตรวจสอบว่าถูก health check แล้วหรือยัง
    const newModels = await sql`
      SELECT m.id, m.name, m.provider, m.model_id, m.context_length, m.tier,
             m.first_seen as "firstSeen",
             EXISTS(SELECT 1 FROM health_logs h WHERE h.model_id = m.id LIMIT 1) AS checked
      FROM models m
      WHERE m.first_seen >= now() - interval '24 hours'
      ORDER BY m.first_seen DESC
    `;

    // โมเดลลาออก (last_seen 48h - 7 วัน)
    const missingModels = await sql`
      SELECT id, name, provider, model_id, context_length, tier, last_seen as "lastSeen"
      FROM models
      WHERE last_seen < now() - interval '48 hours'
        AND last_seen >= now() - interval '7 days'
      ORDER BY last_seen DESC
    `;

    // โมเดลโดนไล่ออก (last_seen เกิน 7 วัน)
    const expelledModels = await sql`
      SELECT id, name, provider, model_id, context_length, tier, last_seen as "lastSeen"
      FROM models
      WHERE last_seen < now() - interval '7 days'
      ORDER BY last_seen DESC
    `;

    // โมเดลหายชั่วคราว (last_seen 2-48 ชม.)
    const warningModels = await sql`
      SELECT id, name, provider, model_id, context_length, tier, last_seen as "lastSeen"
      FROM models
      WHERE last_seen < now() - interval '2 hours'
        AND last_seen >= now() - interval '48 hours'
        AND first_seen < now() - interval '24 hours'
      ORDER BY last_seen DESC
    `;

    const result = {
      worker: {
        status: workerStatus,
        lastRun,
        nextRun,
        judgeModel,
      },
      stats: {
        totalModels: totalCount,
        availableModels: availableCount,
        cooldownModels: cooldownCount,
        passedExam: passedExamCount,
        failedExam: failedExamCount,
        benchmarkedModels: passedExamCount,
        avgScore: avgScore ? Math.round(avgScore * 10) / 10 : 0,
      },
      modelChanges: {
        new: newModels,
        missing: missingModels,
        warning: warningModels,
        expelled: expelledModels,
      },
      recentLogs,
    };
    setCache("api:status", result, 5000);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[status] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
