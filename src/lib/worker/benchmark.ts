import { getSqlClient } from "@/lib/db/schema";
import { getNextApiKey } from "@/lib/api-keys";
import { PROVIDER_URLS } from "@/lib/providers";

// DeepSeek as judge (cheap + reliable)
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

// Fallback judges if DeepSeek unavailable
const FALLBACK_JUDGE_MODELS = [
  "qwen/qwen3-235b-a22b:free",
  "meta-llama/llama-4-scout:free",
  "google/gemma-3-27b-it:free",
];

// ─── Benchmark Questions — 10 questions, 8 categories ─────────────────────────

interface BenchmarkQuestion {
  category: string;
  question: string;
  type: "text" | "vision";
  imageUrl?: string;
  judgeCriteria: string;
}

const QUESTIONS: BenchmarkQuestion[] = [
  // Thai (2 questions)
  {
    category: "thai",
    question: "สรุปให้สั้นใน 1 ประโยค: กรุงเทพมหานครเป็นเมืองหลวงของประเทศไทย มีประชากรมากกว่า 10 ล้านคน เป็นศูนย์กลางเศรษฐกิจและการท่องเที่ยวที่สำคัญของเอเชียตะวันออกเฉียงใต้",
    type: "text",
    judgeCriteria: "ตอบภาษาไทยถูกไหม? สรุปเป็นประโยคเดียวได้ไหม? ครบใจความไหม?",
  },
  {
    category: "thai",
    question: "แก้ประโยคนี้ให้ถูกต้องสละสลวย: 'ฉันไปซื้อข้าวที่ร้านค้าที่อยู่ที่หน้าบ้านที่ฉันอยู่'",
    type: "text",
    judgeCriteria: "แก้ซ้ำคำได้ดีไหม? ประโยคสละสลวยขึ้นไหม? ยังคงความหมายเดิมไหม?",
  },
  // Code (1 question)
  {
    category: "code",
    question: "เขียน Python function ชื่อ is_prime(n) ที่ตรวจสอบว่า n เป็นจำนวนเฉพาะหรือไม่ return True/False",
    type: "text",
    judgeCriteria: "โค้ดรันได้จริงไหม? logic ถูกต้องไหม? จัดการ edge case (0, 1, negative) ไหม?",
  },
  // Math (1 question)
  {
    category: "math",
    question: "ถ้า x + 3 = 7 แล้ว x² + 2x = เท่าไร? แสดงวิธีทำ",
    type: "text",
    judgeCriteria: "คำตอบถูกต้องไหม? (x=4, x²+2x=24) แสดงวิธีทำชัดเจนไหม?",
  },
  // Instruction Following (1 question)
  {
    category: "instruction",
    question: 'ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น: {"animal": ชื่อสัตว์ปีกที่บินได้, "legs": จำนวนขา, "can_fly": true}',
    type: "text",
    judgeCriteria: "ตอบเป็น JSON valid ไหม? มีครบทุก field ไหม? ไม่มีข้อความอื่นนอกจาก JSON ไหม? ข้อมูลถูกต้องไหม?",
  },
  // Creative (1 question)
  {
    category: "creative",
    question: "แต่งกลอนสุภาพ 1 บท (4 วรรค) เรื่องฝนตก",
    type: "text",
    judgeCriteria: "มีครบ 4 วรรคไหม? สัมผัสถูกต้องตามฉันทลักษณ์ไหม? เนื้อหาเกี่ยวกับฝนไหม? ภาษาสวยไหม?",
  },
  // Knowledge (1 question)
  {
    category: "knowledge",
    question: "อธิบาย photosynthesis แบบเด็ก 10 ขวบเข้าใจ ใน 3 ประโยค",
    type: "text",
    judgeCriteria: "อธิบายถูกต้องทางวิทยาศาสตร์ไหม? ใช้ภาษาง่ายที่เด็กเข้าใจไหม? สั้นกระชับ 3 ประโยคไหม?",
  },
  // Vision (2 questions)
  {
    category: "vision",
    question: "อธิบายภาพนี้ให้ละเอียด: มีอะไรอยู่ในภาพ? สี อะไรบ้าง?",
    type: "vision",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/320px-Camponotus_flavomarginatus_ant.jpg",
    judgeCriteria: "เห็นภาพจริงไหม? อธิบายได้ตรงกับภาพ (มด/แมลง) ไหม? ถ้าบอกว่าเห็นรูปไม่ได้ = 0 คะแนน",
  },
  {
    category: "vision",
    question: "ในภาพนี้มีตัวเลขอะไรบ้าง? และมีสีอะไร?",
    type: "vision",
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/SNice.svg/220px-SNice.svg.png",
    judgeCriteria: "เห็นภาพจริงไหม? อธิบายได้ตรง (หน้ายิ้ม/smiley) ไหม? ถ้าบอกว่าเห็นรูปไม่ได้ = 0 คะแนน",
  },
  // Audio awareness (1 question)
  {
    category: "audio",
    question: "ระบบนี้รองรับ Speech-to-Text (STT) และ Text-to-Speech (TTS) ผ่าน API endpoint ไหนบ้าง? ตอบตามมาตรฐาน OpenAI",
    type: "text",
    judgeCriteria: "รู้จัก OpenAI audio API ไหม? (/v1/audio/transcriptions, /v1/audio/speech) บอกถูกไหม?",
  },
];

const TOTAL_QUESTIONS = QUESTIONS.length;
const MAX_MODELS_PER_RUN = 10;
const FAIL_SCORE_THRESHOLD = 3;
const RETEST_DAYS = 7;

async function logWorker(step: string, message: string, level = "info") {
  try {
    const sql = getSqlClient();
    await sql`INSERT INTO worker_logs (step, message, level) VALUES (${step}, ${message}, ${level})`;
  } catch {
    // silent
  }
}

interface DbModel {
  id: string;
  provider: string;
  model_id: string;
  supports_vision: number;
  benchmark_count: number;
}

function buildHeaders(provider: string): Record<string, string> {
  const key = getNextApiKey(provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://sml-gateway.app";
    headers["X-Title"] = "SMLGateway";
  }
  return headers;
}

// ─── Ask Model (text or vision) ───────────────────────────────────────────────

export async function askModel(
  provider: string,
  modelId: string,
  question: string,
  options?: { imageUrl?: string }
): Promise<{ answer: string; latency: number; error?: string }> {
  const url = PROVIDER_URLS[provider];
  if (!url) return { answer: "", latency: 0, error: "unknown provider" };

  const start = Date.now();
  try {
    let content: unknown;
    if (options?.imageUrl) {
      content = [
        { type: "text", text: question },
        { type: "image_url", image_url: { url: options.imageUrl } },
      ];
    } else {
      content = question;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(provider),
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content }],
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const latency = Date.now() - start;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { answer: "", latency, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const json = await res.json();
    const answer: string =
      json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? "";
    return { answer, latency };
  } catch (err) {
    const latency = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { answer: "", latency, error: msg.slice(0, 200) };
  }
}

// ─── Judge Answer ─────────────────────────────────────────────────────────────

export async function judgeAnswer(
  q: BenchmarkQuestion,
  answer: string
): Promise<{ score: number; reasoning: string; judgeModel: string }> {
  if (!answer) return { score: 0, reasoning: "No answer provided", judgeModel: "heuristic" };

  const prompt = `ให้คะแนน 0-10 คำตอบนี้:
หมวด: ${q.category}
คำถาม: ${q.question}
เกณฑ์: ${q.judgeCriteria}
คำตอบ: ${answer.slice(0, 500)}

ตอบ JSON เท่านั้น: {"score":N,"reasoning":"อธิบายสั้นๆ"}`;

  // Try DeepSeek first (cheap + reliable)
  if (DEEPSEEK_API_KEY) {
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (res.ok) {
        const json = await res.json();
        let content: string = json.choices?.[0]?.message?.content ?? "";
        content = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const score = Math.min(10, Math.max(0, Number(parsed.score) || 0));
          const reasoning = String(parsed.reasoning ?? "").slice(0, 500);
          return { score, reasoning: `[DeepSeek] ${reasoning}`, judgeModel: DEEPSEEK_MODEL };
        }
      }
    } catch {
      // fall through to fallback judges
    }
  }

  // Fallback: free models from OpenRouter
  for (const judgeModel of FALLBACK_JUDGE_MODELS) {
    try {
      const res = await fetch(PROVIDER_URLS.openrouter, {
        method: "POST",
        headers: buildHeaders("openrouter"),
        body: JSON.stringify({
          model: judgeModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) continue;

      const json = await res.json();
      let content: string =
        json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? "";
      content = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) continue;

      const parsed = JSON.parse(match[0]);
      const score = Math.min(10, Math.max(0, Number(parsed.score) || 0));
      const reasoning = String(parsed.reasoning ?? "").slice(0, 500);
      return { score, reasoning, judgeModel };
    } catch {
      continue;
    }
  }

  // Last fallback: heuristic
  const hasContent = answer.trim().length > 10;
  return {
    score: hasContent ? 5 : 0,
    reasoning: "Judge unavailable, heuristic score applied",
    judgeModel: "heuristic",
  };
}

// ─── Run Benchmarks ───────────────────────────────────────────────────────────

export async function runBenchmarks(): Promise<{
  tested: number;
  questions: number;
}> {
  await logWorker("benchmark", "เริ่มรัน benchmark (8 หมวด, 10 ข้อ)");
  const sql = getSqlClient();

  // Get available models with fewer than TOTAL_QUESTIONS benchmark results
  const models = await sql<DbModel[]>`
    SELECT
      m.id,
      m.provider,
      m.model_id,
      m.supports_vision,
      COUNT(b.id) AS benchmark_count
    FROM models m
    INNER JOIN health_logs hl ON hl.model_id = m.id
    LEFT JOIN benchmark_results b ON b.model_id = m.id
    WHERE hl.status = 'available'
      AND hl.checked_at = (
        SELECT MAX(h2.checked_at) FROM health_logs h2 WHERE h2.model_id = m.id
      )
    GROUP BY m.id, m.provider, m.model_id, m.supports_vision
    HAVING COUNT(b.id) < ${TOTAL_QUESTIONS}
    LIMIT ${MAX_MODELS_PER_RUN}
  `;

  await logWorker("benchmark", `พบ ${models.length} โมเดลที่ต้อง benchmark`);

  if (models.length === 0) {
    return { tested: 0, questions: 0 };
  }

  let totalQuestions = 0;
  let testedModels = 0;
  let lastJudgeModel = DEEPSEEK_API_KEY ? DEEPSEEK_MODEL : FALLBACK_JUDGE_MODELS[0];

  const CONCURRENCY = 20;
  let idx = 0;

  async function benchmarkWorker() {
    while (idx < models.length) {
      const model = models[idx++];

      // Skip if failed recently
      const summaryRows = await sql<{ avg_score: number | null; latest_tested_at: Date | null }[]>`
        SELECT AVG(score) AS avg_score, MAX(tested_at) AS latest_tested_at
        FROM benchmark_results WHERE model_id = ${model.id}
      `;
      const summary = summaryRows[0];
      if (summary && summary.avg_score !== null && summary.latest_tested_at) {
        const avgScore = summary.avg_score;
        const lastTestedAt = new Date(summary.latest_tested_at);
        const daysSince = (Date.now() - lastTestedAt.getTime()) / (1000 * 60 * 60 * 24);

        if (avgScore < FAIL_SCORE_THRESHOLD && daysSince < RETEST_DAYS) {
          await logWorker(
            "benchmark",
            `⏭️ ข้าม ${model.model_id} — สอบตก (${avgScore.toFixed(1)}/10) รอ ${RETEST_DAYS} วัน`
          );
          continue;
        }
      }

      // Find unanswered questions
      const answeredRows = await sql<{ question: string }[]>`
        SELECT question FROM benchmark_results WHERE model_id = ${model.id}
      `;
      const answered = new Set(answeredRows.map((r) => r.question));

      // Filter questions: skip vision questions for non-vision models
      const pending = QUESTIONS.filter((q) => {
        if (answered.has(q.question)) return false;
        if (q.type === "vision" && model.supports_vision !== 1) return false;
        return true;
      });

      if (pending.length === 0) continue;

      testedModels++;
      const categoryScores: Record<string, { total: number; count: number }> = {};

      for (const q of pending) {
        const { answer, latency, error } = await askModel(
          model.provider,
          model.model_id,
          q.question,
          q.type === "vision" ? { imageUrl: q.imageUrl } : undefined
        );

        if (error) {
          await logWorker(
            "benchmark",
            `${model.model_id} [${q.category}] ผิดพลาด: ${error}`,
            "warn"
          );
        }

        const { score, reasoning, judgeModel: jm } = await judgeAnswer(q, answer);
        if (jm !== "heuristic") lastJudgeModel = jm;

        // Vision-specific: if model says it can't see the image, force score = 0
        if (q.type === "vision" && answer) {
          const cantSee = /(?:ไม่สามารถ|ไม่ได้|cannot|can't|unable).*(?:ดู|เห็น|see|view|image|รูป|ภาพ)/i.test(answer);
          if (cantSee) {
            try {
              await sql`
                INSERT INTO benchmark_results (model_id, category, question, answer, score, max_score, reasoning, latency_ms)
                VALUES (${model.id}, ${q.category}, ${q.question}, ${answer.slice(0, 2000)},
                  ${0}, ${10}, ${'Model ไม่สามารถเห็นภาพได้จริง'}, ${latency})
              `;
              totalQuestions++;
              await sql`UPDATE models SET supports_vision = 0 WHERE id = ${model.id}`;
              await logWorker("benchmark", `👁️ ${model.model_id} ไม่เห็นรูปจริง → supports_vision = 0`, "warn");
            } catch (err) {
              await logWorker("benchmark", `DB insert error: ${err}`, "error");
            }
            if (!categoryScores[q.category]) categoryScores[q.category] = { total: 0, count: 0 };
            categoryScores[q.category].total += 0;
            categoryScores[q.category].count++;
            continue;
          }
        }

        try {
          await sql`
            INSERT INTO benchmark_results (model_id, category, question, answer, score, max_score, reasoning, latency_ms)
            VALUES (${model.id}, ${q.category}, ${q.question}, ${answer.slice(0, 2000)},
              ${score}, ${10}, ${reasoning}, ${latency})
          `;
          totalQuestions++;
          if (!categoryScores[q.category]) categoryScores[q.category] = { total: 0, count: 0 };
          categoryScores[q.category].total += score;
          categoryScores[q.category].count++;
        } catch (err) {
          await logWorker("benchmark", `DB insert error สำหรับ ${model.id}: ${err}`, "error");
        }
      }

      // Summary per model
      const allScores = Object.values(categoryScores);
      if (allScores.length > 0) {
        const totalScore = allScores.reduce((s, c) => s + c.total, 0);
        const totalCount = allScores.reduce((s, c) => s + c.count, 0);
        const avgScore = totalScore / totalCount;
        const pct = Math.round((avgScore / 10) * 100);
        const passed = avgScore >= 5;

        const catSummary = Object.entries(categoryScores)
          .map(([cat, s]) => `${cat}:${(s.total / s.count).toFixed(1)}`)
          .join(" ");

        await logWorker(
          "benchmark",
          `${passed ? "✅ สอบผ่าน" : "❌ สอบตก"}: ${model.model_id} — ${avgScore.toFixed(1)}/10 (${pct}%) [${catSummary}]`,
          passed ? "success" : "warn"
        );

        // Nickname generation removed — models shown as provider/model_id
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, models.length) }, () => benchmarkWorker());
  await Promise.all(workers);

  const msg = `Benchmark เสร็จ: ทดสอบ ${testedModels} โมเดล, ${totalQuestions} คำถาม (8 หมวด)`;
  await logWorker("benchmark", msg);

  // Save judge model used in this run to worker_state
  try {
    await sql`
      INSERT INTO worker_state (key, value) VALUES ('judge_model', ${lastJudgeModel})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `;
  } catch { /* silent */ }

  return { tested: testedModels, questions: totalQuestions };
}
