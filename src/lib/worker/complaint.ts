import { getSqlClient } from "@/lib/db/schema";
import { askModel, judgeAnswer } from "./benchmark";
import { generateNickname } from "./scanner";
import { emitEvent } from "@/lib/routing-learn";

// Complaint category to exam question mapping
const CATEGORY_EXAM_QUESTIONS: Record<string, string[]> = {
  wrong_answer: [
    "ประเทศไทยมีกี่จังหวัด?",
    "น้ำแข็งแห้งทำมาจากอะไร?",
    "ดวงอาทิตย์ขึ้นทางทิศไหน?",
  ],
  gibberish: [
    "อธิบายว่าฝนตกเกิดจากอะไร ใน 2-3 ประโยค",
    "เล่าเรื่องย่อนิทานเรื่องกระต่ายกับเต่า",
  ],
  wrong_language: [
    "ตอบเป็นภาษาไทยเท่านั้น: ประเทศไทยอยู่ทวีปอะไร?",
    "ตอบเป็นภาษาไทย: อาหารไทยที่ชาวต่างชาตินิยมคืออะไร?",
  ],
  refused: [
    "แนะนำหนังสือน่าอ่าน 3 เล่ม",
    "เล่าเรื่องตลกสั้นๆ ให้ฟังหน่อย",
  ],
  hallucination: [
    "1+1 เท่ากับเท่าไหร่?",
    "ประเทศญี่ปุ่นอยู่ทวีปอะไร?",
    "น้ำเดือดที่อุณหภูมิกี่องศาเซลเซียส?",
  ],
  too_short: [
    "อธิบายความแตกต่างระหว่างแมวกับสุนัข อย่างน้อย 3 ข้อ",
    "แนะนำสถานที่ท่องเที่ยวในกรุงเทพ 5 แห่ง พร้อมเหตุผล",
  ],
  irrelevant: [
    "กรุณาตอบคำถามนี้ตรงๆ: เมืองหลวงของไทยคืออะไร?",
    "ตอบให้ตรงประเด็น: 2+2 เท่ากับเท่าไหร่?",
  ],
};

// Score threshold: below this = failed re-exam
const PASS_THRESHOLD = 5;

async function logWorker(step: string, message: string, level = "info") {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})`;
  } catch {
    // silent
  }
}

/**
 * Process a complaint: re-exam the model with targeted questions
 * Called async from the complaint API (non-blocking)
 */
export async function processComplaint(
  complaintId: number,
  dbModelId: string,
  provider: string,
  modelId: string,
  category: string,
  originalQuestion?: string
): Promise<void> {
  const sql = getSqlClient();

  await logWorker("complaint", `Processing complaint #${complaintId} for ${provider}/${modelId} [${category}]`);

  // Pick a question matching the complaint category
  const questions = CATEGORY_EXAM_QUESTIONS[category] ?? CATEGORY_EXAM_QUESTIONS.wrong_answer;
  const question = originalQuestion
    ? originalQuestion
    : questions[Math.floor(Math.random() * questions.length)];

  // Ask the model
  const { answer, latency, error } = await askModel(provider, modelId, question);

  if (error) {
    await logWorker("complaint", `Re-exam failed for ${modelId}: ${error}`, "warn");

    await sql`
      INSERT INTO complaint_exams (complaint_id, model_id, question, answer, score, passed, reasoning, latency_ms)
      VALUES (${complaintId}, ${dbModelId}, ${question}, ${''},
        ${0}, ${0}, ${'Re-exam error: ' + error}, ${latency})
    `;

    await sql`UPDATE complaints SET status = 'exam_failed' WHERE id = ${complaintId}`;

    const cooldownUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
      VALUES (${dbModelId}, 'complained', ${'Re-exam failed: ' + error}, ${cooldownUntil}, now())
    `;

    // Note: benchmark_results ตอนนี้เป็น VIEW — บันทึกเป็น exam failure แทน
    return;
  }

  // Judge the answer
  const { score, reasoning } = await judgeAnswer({
    category: "general",
    question,
    type: "text",
    judgeCriteria: "คำตอบถูกต้องและมีคุณภาพหรือไม่?",
  }, answer);
  const passed = score >= PASS_THRESHOLD;

  await logWorker(
    "complaint",
    `Re-exam result: ${modelId} scored ${score}/10 on "${question.slice(0, 30)}..." — ${passed ? "PASSED" : "FAILED"}`,
    passed ? "success" : "warn"
  );

  // Save exam result
  await sql`
    INSERT INTO complaint_exams (complaint_id, model_id, question, answer, score, passed, reasoning, latency_ms)
    VALUES (${complaintId}, ${dbModelId}, ${question}, ${answer.slice(0, 2000)},
      ${score}, ${passed ? 1 : 0}, ${reasoning}, ${latency})
  `;

  // Update complaint status
  await sql`
    UPDATE complaints SET status = ${passed ? 'exam_passed' : 'exam_failed'} WHERE id = ${complaintId}
  `;

  // Note: benchmark_results = VIEW — complaint result persisted in complaint_exams already

  if (passed) {
    // Passed: clear cooldown, model can resume
    await sql`
      DELETE FROM health_logs WHERE model_id = ${dbModelId} AND cooldown_until > now() AND status = 'complained'
    `;
    await logWorker("complaint", `${modelId} passed re-exam (${score}/10) — cleared cooldown`, "success");
  } else {
    // Failed: extend cooldown to 2 hours + score penalty
    const cooldownUntil = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
      VALUES (${dbModelId}, 'complained', ${'Re-exam failed: ' + score + '/10'}, ${cooldownUntil}, now())
    `;

    // Nickname update removed — models shown as provider/model_id
    void provider;
    void category;
    await logWorker("complaint", `${modelId} failed re-exam (${score}/10) — cooldown extended 2hr`, "warn");
  }

  // Check total daily complaints for blacklist
  const today = new Date().toISOString().slice(0, 10);
  const dailyRows = await sql<{ cnt: number }[]>`
    SELECT COUNT(*) as cnt FROM complaints WHERE model_id = ${dbModelId} AND created_at >= ${today + 'T00:00:00'}::timestamptz
  `;
  const dailyCount = dailyRows[0]?.cnt ?? 0;

  if (dailyCount >= 10) {
    const cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO health_logs (model_id, status, error, cooldown_until, checked_at)
      VALUES (${dbModelId}, 'blacklisted', ${'Blacklisted: ' + dailyCount + ' complaints today'}, ${cooldownUntil}, now())
    `;

    await sql`
      UPDATE complaints SET status = 'blacklisted'
      WHERE model_id = ${dbModelId} AND created_at >= ${today + 'T00:00:00'}::timestamptz
    `;

    await emitEvent("model_banned", `${modelId} ถูกแบน 24 ชม.`, `ถูกร้องเรียน ${dailyCount} ครั้งวันนี้`, provider, dbModelId, "error");
    await logWorker("complaint", `${modelId} BLACKLISTED — ${dailyCount} complaints today`, "error");
  }
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    wrong_answer: "ตอบผิด",
    gibberish: "พูดไม่รู้เรื่อง",
    wrong_language: "ตอบผิดภาษา",
    refused: "ปฏิเสธตอบ",
    hallucination: "แต่งเรื่อง",
    too_short: "ตอบสั้นเกินไป",
    irrelevant: "ตอบไม่ตรงคำถาม",
  };
  return labels[category] ?? category;
}

/**
 * Get complaint reputation score for a model (0-100, lower = more complaints)
 * Used by gateway to deprioritize models with many complaints
 */
export async function getReputationScore(dbModelId: string): Promise<number> {
  const scores = await getReputationScores([dbModelId]);
  return scores.get(dbModelId) ?? 100;
}

export async function getReputationScores(dbModelIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(dbModelIds.filter(Boolean))];
  const scores = new Map<string, number>();
  for (const id of uniqueIds) scores.set(id, 100);
  if (uniqueIds.length === 0) return scores;

  try {
    const sql = getSqlClient();
    const rows = await sql<{ model_id: string; total: number; failed: number }[]>`
      SELECT
        model_id::text,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'exam_failed' THEN 1 ELSE 0 END) as failed
      FROM complaints
      WHERE model_id = ANY(${uniqueIds})
        AND created_at >= now() - interval '7 days'
      GROUP BY model_id
    `;

    for (const result of rows) {
      if (!result || Number(result.total) === 0) continue;
      const penalty = Number(result.total) * 10 + Number(result.failed ?? 0) * 10;
      scores.set(result.model_id, Math.max(0, 100 - penalty));
    }
  } catch {
    return scores;
  }
  return scores;
}
