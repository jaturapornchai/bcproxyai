/**
 * Teacher Hierarchy — เลิก lock ที่ DeepSeek ใช้ model ที่เก่งที่สุดจริงๆ
 *
 * ตำแหน่ง:
 *   👑 Principal (1)   — model เก่งสุด, ตัดสินข้อพิพาท, fall-back judge
 *   📋 Head (1-2 per category) — ตรวจข้อสอบเฉพาะหมวด
 *   👥 Proctor (5-10)  — ยิงคำถาม, วัด latency (ไม่ตัดสิน)
 *
 * Appointment: ทุก worker cycle เรียก appointTeachers() → re-rank + update DB
 */
import { getSqlClient } from "@/lib/db/schema";

const HEADS_PER_CATEGORY = 2;
const MAX_PROCTORS = 10;

export type TeacherRole = "principal" | "head" | "proctor";

export interface Teacher {
  modelId: string;
  role: TeacherRole;
  category: string | null;
  score: number;
  provider: string;
  modelName: string;
  appointedAt: Date;
}

interface ModelStats {
  id: string;
  provider: string;
  model_id: string;
  supports_tools: number;
  score_pct: number | null;
  latency_ms: number | null;
  total_success: number;
  total_fails: number;
  win_categories: number;
  best_category: string | null;
}

/**
 * คำนวณคะแนนรวมของแต่ละ model สำหรับจัดอันดับครู
 * weight: exam 40% · success rate 30% · speed 20% · category wins 10%
 */
function teacherScore(m: ModelStats): number {
  const exam = (m.score_pct ?? 0) / 100;
  const total = m.total_success + m.total_fails;
  const successRate = total > 0 ? m.total_success / total : 0;
  const speed = m.latency_ms && m.latency_ms > 0 ? 1 / (m.latency_ms / 1000) : 0;
  const speedNorm = Math.min(1, speed / 5);
  const catWins = Math.min(1, m.win_categories / 5);
  return exam * 0.4 + successRate * 0.3 + speedNorm * 0.2 + catWins * 0.1;
}

/**
 * ดึง candidate models ที่มีคุณสมบัติเหมาะเป็นครู
 * (ผ่านสอบแล้ว + supports_tools + ไม่ติด cooldown)
 */
async function fetchCandidates(): Promise<ModelStats[]> {
  const sql = getSqlClient();
  const rows = await sql<ModelStats[]>`
    SELECT
      m.id,
      m.provider,
      m.model_id,
      m.supports_tools,
      ea.score_pct,
      ea.total_latency_ms::float / NULLIF(ea.total_questions, 0) AS latency_ms,
      COALESCE(fs.total_success, 0)::int AS total_success,
      COALESCE(fs.total_fails, 0)::int AS total_fails,
      COALESCE(cw.win_count, 0)::int AS win_categories,
      cw.best_category
    FROM models m
    INNER JOIN (
      SELECT DISTINCT ON (model_id)
        model_id, score_pct, passed, total_questions, total_latency_ms
      FROM exam_attempts WHERE finished_at IS NOT NULL
      ORDER BY model_id, started_at DESC
    ) ea ON m.id = ea.model_id AND ea.score_pct >= 50
    LEFT JOIN model_fail_streak fs ON fs.model_id = m.id
    LEFT JOIN (
      SELECT model_id,
             COUNT(DISTINCT category) AS win_count,
             (ARRAY_AGG(category ORDER BY wins DESC))[1] AS best_category
      FROM category_winners
      WHERE wins > 0
      GROUP BY model_id
    ) cw ON cw.model_id = m.id
    LEFT JOIN (
      SELECT DISTINCT ON (model_id) model_id, cooldown_until
      FROM health_logs ORDER BY model_id, id DESC
    ) h ON h.model_id = m.id
    WHERE (h.cooldown_until IS NULL OR h.cooldown_until < now())
      AND ea.score_pct >= 40
  `;
  return rows;
}

/**
 * Rebalance teacher roles ทุก worker cycle
 * — จับ top 1 เป็น principal, top 2 ต่อ category เป็น head, top 10 เป็น proctor
 */
export async function appointTeachers(): Promise<{
  principal: string | null;
  heads: number;
  proctors: number;
}> {
  const sql = getSqlClient();
  const candidates = await fetchCandidates();

  if (candidates.length === 0) {
    return { principal: null, heads: 0, proctors: 0 };
  }

  // Sort by weighted score
  const scored = candidates
    .map((c) => ({ ...c, score: teacherScore(c) }))
    .sort((a, b) => b.score - a.score);

  // Pick principal: top 1 with tools support
  const principal = scored.find((c) => c.supports_tools === 1) ?? scored[0];

  // Pick heads: top 1 per exam category from model_category_scores (must score >= 80%)
  const catHeadRows = await sql<{ model_id: string; category: string; score_pct: number }[]>`
    SELECT DISTINCT ON (category) model_id, category, score_pct
    FROM model_category_scores
    WHERE score_pct >= 80
      AND model_id IN (SELECT id FROM models WHERE COALESCE(supports_embedding, 0) != 1)
    ORDER BY category, score_pct DESC, model_id
  `;

  // Pick proctors: top 10 overall (any model, must support tools)
  const proctors = scored
    .filter((c) => c.supports_tools === 1 && c.id !== principal.id)
    .slice(0, MAX_PROCTORS);

  // Clear + repopulate teachers table (atomic swap)
  await sql`DELETE FROM teachers`;

  // Principal
  await sql`
    INSERT INTO teachers (model_id, role, category, score)
    VALUES (${principal.id}, 'principal', NULL, ${principal.score})
  `;

  // Heads — model เดียวเป็น head หลาย category ได้ (คนเก่งหลายอย่าง ก็แบ่งงานให้ทำ)
  let headCount = 0;
  for (const row of catHeadRows) {
    if (row.model_id === principal.id) continue;
    await sql`
      INSERT INTO teachers (model_id, role, category, score)
      VALUES (${row.model_id}, 'head', ${row.category}, ${row.score_pct / 100})
    `;
    headCount++;
  }

  // Proctors (ไม่ overlap กับ principal/heads)
  const headIds = new Set(catHeadRows.map(r => r.model_id));
  let proctorCount = 0;
  for (const p of proctors) {
    if (p.id === principal.id || headIds.has(p.id)) continue;
    await sql`
      INSERT INTO teachers (model_id, role, category, score)
      VALUES (${p.id}, 'proctor', NULL, ${p.score})
    `;
    proctorCount++;
  }

  return {
    principal: principal.id,
    heads: headCount,
    proctors: proctorCount,
  };
}

/**
 * เรียกใช้ใน exam.ts — คืน model id ของครูที่ควรใช้ตรวจข้อสอบ
 * เรียงตามลำดับ: head of category → principal → null (fallback to rule-based)
 */
export async function getGrader(category: string): Promise<{ modelId: string; role: TeacherRole } | null> {
  try {
    const sql = getSqlClient();
    // Try head of category first
    const headRows = await sql<{ model_id: string }[]>`
      SELECT model_id FROM teachers
      WHERE role = 'head' AND category = ${category}
      ORDER BY score DESC LIMIT 1
    `;
    if (headRows.length > 0) {
      return { modelId: headRows[0].model_id, role: "head" };
    }
    // Fall back to principal
    const principalRows = await sql<{ model_id: string }[]>`
      SELECT model_id FROM teachers WHERE role = 'principal' LIMIT 1
    `;
    if (principalRows.length > 0) {
      return { modelId: principalRows[0].model_id, role: "principal" };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Dashboard helper — ดึงครูทั้งหมด + info
 */
export async function getAllTeachers(): Promise<Teacher[]> {
  try {
    const sql = getSqlClient();
    const rows = await sql<
      Array<{
        model_id: string;
        role: TeacherRole;
        category: string | null;
        score: number;
        appointed_at: Date;
        provider: string;
        model_name: string;
      }>
    >`
      SELECT t.model_id, t.role, t.category, t.score, t.appointed_at,
             m.provider, m.name AS model_name
      FROM teachers t
      JOIN models m ON m.id = t.model_id
      ORDER BY
        CASE t.role WHEN 'principal' THEN 1 WHEN 'head' THEN 2 ELSE 3 END,
        t.score DESC
    `;
    return rows.map((r) => ({
      modelId: r.model_id,
      role: r.role,
      category: r.category,
      score: r.score,
      provider: r.provider,
      modelName: r.model_name,
      appointedAt: r.appointed_at,
    }));
  } catch {
    return [];
  }
}

/**
 * บันทึกว่าใครให้คะแนนใคร เอาไว้ดูประวัติ + detect bias
 */
export async function logGrading(params: {
  attemptId: number | null;
  graderModelId: string;
  graderRole: TeacherRole | "rule";
  questionId: string;
  category: string;
  originalScore: number | null;
  finalScore: number;
  reasoning: string | null;
  method: "rule-based" | "ai-grader" | "hybrid";
}): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`
      INSERT INTO grading_history
        (attempt_id, grader_model_id, grader_role, question_id, category,
         original_score, final_score, reasoning, method)
      VALUES
        (${params.attemptId}, ${params.graderModelId}, ${params.graderRole},
         ${params.questionId}, ${params.category},
         ${params.originalScore}, ${params.finalScore},
         ${params.reasoning?.slice(0, 1000) ?? null}, ${params.method})
    `;
  } catch {
    /* silent */
  }
}

export async function getRecentGradings(limit = 30): Promise<
  Array<{
    id: number;
    graderModelId: string;
    graderRole: string;
    questionId: string;
    category: string;
    finalScore: number;
    method: string;
    gradedAt: Date;
  }>
> {
  try {
    const sql = getSqlClient();
    const rows = await sql<
      Array<{
        id: number;
        grader_model_id: string;
        grader_role: string;
        question_id: string;
        category: string;
        final_score: number;
        method: string;
        graded_at: Date;
      }>
    >`
      SELECT id, grader_model_id, grader_role, question_id, category,
             final_score, method, graded_at
      FROM grading_history
      ORDER BY graded_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      graderModelId: r.grader_model_id,
      graderRole: r.grader_role,
      questionId: r.question_id,
      category: r.category,
      finalScore: r.final_score,
      method: r.method,
      gradedAt: r.graded_at,
    }));
  } catch {
    return [];
  }
}
