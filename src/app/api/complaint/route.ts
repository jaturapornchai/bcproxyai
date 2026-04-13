import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import { processComplaint } from "@/lib/worker/complaint";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = [
  "wrong_answer",
  "gibberish",
  "wrong_language",
  "refused",
  "hallucination",
  "too_short",
  "irrelevant",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  wrong_answer: "ตอบผิด",
  gibberish: "พูดไม่รู้เรื่อง",
  wrong_language: "ตอบผิดภาษา",
  refused: "ปฏิเสธตอบ",
  hallucination: "แต่งเรื่อง",
  too_short: "ตอบสั้นเกินไป",
  irrelevant: "ตอบไม่ตรงคำถาม",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { model_id, category, reason, user_message, assistant_message } = body;

    if (!model_id || typeof model_id !== "string") {
      return NextResponse.json({ error: "model_id is required" }, { status: 400 });
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` }, { status: 400 });
    }

    const sql = getSqlClient();

    const models = await sql<{ id: string; provider: string; model_id: string; nickname: string | null }[]>`
      SELECT id, provider, model_id, nickname FROM models
      WHERE id = ${model_id} OR model_id = ${model_id} OR (provider || '/' || model_id) = ${model_id}
      LIMIT 1
    `;

    if (models.length === 0) {
      return NextResponse.json({ error: `Model not found: ${model_id}` }, { status: 404 });
    }
    const model = models[0];

    const today = new Date().toISOString().slice(0, 10);
    const dailyRows = await sql<{ cnt: number }[]>`
      SELECT COUNT(*) as cnt FROM complaints
      WHERE model_id = ${model.id} AND created_at >= ${today + 'T00:00:00'}::timestamptz
    `;
    const dailyCount = Number(dailyRows[0]?.cnt ?? 0);

    if (dailyCount >= 10) {
      const cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await sql`
        INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
        VALUES (${model.id}, 'blacklisted', ${'Blacklisted: ' + (dailyCount + 1) + ' complaints today'}, ${cooldownUntil}, now())
      `;
      return NextResponse.json({
        message: `Model ${model.model_id} blacklisted for 24hr (${dailyCount + 1} complaints today)`,
        blacklisted: true,
      });
    }

    const insertRows = await sql<{ id: number }[]>`
      INSERT INTO complaints (model_id, category, reason, user_message, assistant_message, source)
      VALUES (
        ${model.id}, ${category},
        ${reason?.slice(0, 500) ?? null},
        ${user_message?.slice(0, 500) ?? null},
        ${assistant_message?.slice(0, 500) ?? null},
        ${body.source ?? "api"}
      )
      RETURNING id
    `;
    const complaintId = insertRows[0].id;

    const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
      VALUES (${model.id}, 'complained', ${'Complaint #' + complaintId + ': ' + CATEGORY_LABELS[category]}, ${cooldownUntil}, now())
    `;

    processComplaint(complaintId, model.id, model.provider, model.model_id, category, user_message).catch(() => {});

    return NextResponse.json({
      id: complaintId, model_id: model.model_id, provider: model.provider, nickname: model.nickname,
      category, category_label: CATEGORY_LABELS[category], cooldown_until: cooldownUntil,
      message: `Complaint filed. ${model.model_id} cooldown 30 min, re-exam scheduled.`,
      daily_complaints: dailyCount + 1,
    });
  } catch (err) {
    console.error("[Complaint] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sql = getSqlClient();
    const url = new URL(req.url);
    const modelId = url.searchParams.get("model_id");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

    const complaints = modelId
      ? await sql`
          SELECT
            c.id, c.model_id as db_model_id, m.model_id, m.provider, m.nickname,
            c.category, c.reason, c.user_message, c.assistant_message, c.source, c.status, c.created_at,
            ce.score as exam_score, ce.passed as exam_passed, ce.question as exam_question,
            ce.answer as exam_answer, ce.reasoning as exam_reasoning
          FROM complaints c
          JOIN models m ON c.model_id = m.id
          LEFT JOIN complaint_exams ce ON ce.complaint_id = c.id
          WHERE c.model_id = ${modelId} OR m.model_id = ${modelId}
          ORDER BY c.created_at DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT
            c.id, c.model_id as db_model_id, m.model_id, m.provider, m.nickname,
            c.category, c.reason, c.user_message, c.assistant_message, c.source, c.status, c.created_at,
            ce.score as exam_score, ce.passed as exam_passed, ce.question as exam_question,
            ce.answer as exam_answer, ce.reasoning as exam_reasoning
          FROM complaints c
          JOIN models m ON c.model_id = m.id
          LEFT JOIN complaint_exams ce ON ce.complaint_id = c.id
          ORDER BY c.created_at DESC
          LIMIT ${limit}
        `;

    const statsRows = await sql<{ total: number; pending: number; passed: number; failed: number; blacklisted: number }[]>`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'exam_passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN status = 'exam_failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'blacklisted' THEN 1 ELSE 0 END) as blacklisted
      FROM complaints
    `;
    const stats = statsRows[0];

    const topComplained = await sql`
      SELECT m.model_id, m.provider, m.nickname, COUNT(*) as complaint_count
      FROM complaints c
      JOIN models m ON c.model_id = m.id
      GROUP BY c.model_id, m.model_id, m.provider, m.nickname
      ORDER BY complaint_count DESC
      LIMIT 10
    `;

    return NextResponse.json({ complaints, stats, top_complained: topComplained, categories: CATEGORY_LABELS });
  } catch (err) {
    console.error("[Complaint] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
