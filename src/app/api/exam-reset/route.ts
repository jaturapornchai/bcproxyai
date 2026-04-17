import { NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { runWorkerCycle } from "@/lib/worker";
import { getActiveExamLevel, EXAM_LEVEL_META } from "@/lib/worker/exam";

export const dynamic = "force-dynamic";

/**
 * POST /api/exam-reset
 * Reset exam attempts ของทุก model + ลบ per-category scores → ทุกคนต้องสอบใหม่
 * ลบ history ของเดิม (ไม่ soft-delete) เพื่อให้ routing ใช้คะแนนระดับใหม่ทันที
 * Trigger worker cycle ทันทีเพื่อเริ่มสอบ
 */
export async function POST() {
  try {
    const sql = getSqlClient();
    const level = await getActiveExamLevel();

    // ลบประวัติสอบทั้งหมด — exam_answers ลบตาม cascade จาก exam_attempts
    const deleted = await sql<{ cnt: number }[]>`
      WITH d AS (
        DELETE FROM exam_attempts RETURNING 1
      )
      SELECT COUNT(*)::int AS cnt FROM d
    `;
    await sql`DELETE FROM model_category_scores`;

    // log
    await sql`
      INSERT INTO worker_logs (step, message, level)
      VALUES ('exam', ${`🔄 Reset exam — ลบ ${deleted[0]?.cnt ?? 0} attempts → สอบใหม่หมดในระดับ ${EXAM_LEVEL_META[level].label}`}, 'warn')
    `;

    // Trigger worker cycle (fire-and-forget)
    runWorkerCycle().catch((err) => {
      console.error("[exam-reset] worker trigger error:", err);
    });

    return NextResponse.json({
      ok: true,
      deletedAttempts: deleted[0]?.cnt ?? 0,
      level,
      message: `ล้างผลสอบทั้งหมดแล้ว — เริ่มสอบใหม่ในระดับ ${EXAM_LEVEL_META[level].label}`,
    });
  } catch (err) {
    console.error("[exam-reset] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
