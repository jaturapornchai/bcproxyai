import { getDb } from "@/lib/db/schema";
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

const QUESTIONS = [
  "สวัสดีครับ วันนี้อากาศเป็นยังไงบ้าง?",
  "แนะนำอาหารไทยมา 3 เมนู",
  "กรุงเทพมหานครอยู่ประเทศอะไร?",
];

const MAX_MODELS_PER_RUN = 10;
const FAIL_SCORE_THRESHOLD = 3; // < 3/10 = สอบตก, ไม่สอบซ้ำ
const RETEST_DAYS = 7; // สอบซ้ำได้หลัง 7 วัน

function logWorker(step: string, message: string, level = "info") {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO worker_logs (step, message, level) VALUES (?, ?, ?)"
    ).run(step, message, level);
  } catch {
    // silent
  }
}

interface DbModel {
  id: string;
  provider: string;
  model_id: string;
  benchmark_count: number;
}

interface BenchmarkSummary {
  avg_score: number | null;
  latest_tested_at: string | null;
}

function buildHeaders(provider: string): Record<string, string> {
  const key = getNextApiKey(provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://bcproxyai.app";
    headers["X-Title"] = "BCProxyAI";
  }
  return headers;
}

export async function askModel(
  provider: string,
  modelId: string,
  question: string
): Promise<{ answer: string; latency: number; error?: string }> {
  const url = PROVIDER_URLS[provider];
  if (!url) return { answer: "", latency: 0, error: "unknown provider" };

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: buildHeaders(provider),
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: question }],
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

export async function judgeAnswer(
  question: string,
  answer: string
): Promise<{ score: number; reasoning: string }> {
  if (!answer) return { score: 0, reasoning: "No answer provided" };

  const prompt = `ให้คะแนน 0-10 คำตอบนี้ตอบภาษาไทยถูกไหม?\nQ: ${question}\nA: ${answer.slice(0, 300)}\nตอบ JSON: {"score":N,"reasoning":"สั้นๆ"}`;

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
        let content: string =
          json.choices?.[0]?.message?.content ?? "";
        content = content.replace(/```json\s*/gi, "").replace(/```\s*/g, "").replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const score = Math.min(10, Math.max(0, Number(parsed.score) || 0));
          const reasoning = String(parsed.reasoning ?? "").slice(0, 500);
          return { score, reasoning: `[DeepSeek] ${reasoning}` };
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
      return { score, reasoning };
    } catch {
      continue;
    }
  }

  // Last fallback: heuristic
  const hasContent = answer.trim().length > 10;
  return {
    score: hasContent ? 5 : 0,
    reasoning: "Judge unavailable, heuristic score applied",
  };
}

export async function runBenchmarks(): Promise<{
  tested: number;
  questions: number;
}> {
  logWorker("benchmark", "เริ่มรัน benchmark");
  const db = getDb();

  // Get available models with fewer than 3 benchmark results
  const models = db
    .prepare(
      `
    SELECT
      m.id,
      m.provider,
      m.model_id,
      COUNT(b.id) AS benchmark_count
    FROM models m
    INNER JOIN health_logs hl ON hl.model_id = m.id
    LEFT JOIN benchmark_results b ON b.model_id = m.id
    WHERE hl.status = 'available'
      AND hl.checked_at = (
        SELECT MAX(h2.checked_at) FROM health_logs h2 WHERE h2.model_id = m.id
      )
    GROUP BY m.id
    HAVING benchmark_count < 3
    LIMIT ?
  `
    )
    .all(MAX_MODELS_PER_RUN) as DbModel[];

  logWorker("benchmark", `พบ ${models.length} โมเดลที่ต้อง benchmark`);

  if (models.length === 0) {
    return { tested: 0, questions: 0 };
  }

  // Statements
  const answeredStmt = db.prepare(
    "SELECT question FROM benchmark_results WHERE model_id = ?"
  );
  const summaryStmt = db.prepare(
    `SELECT AVG(score) AS avg_score, MAX(tested_at) AS latest_tested_at
     FROM benchmark_results WHERE model_id = ?`
  );
  const insertResult = db.prepare(`
    INSERT INTO benchmark_results (model_id, question, answer, score, max_score, reasoning, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let totalQuestions = 0;
  let testedModels = 0;

  // Parallel benchmark — 5 models at a time
  const CONCURRENCY = 5;
  let idx = 0;
  async function benchmarkWorker() {
    while (idx < models.length) {
      const model = models[idx++];
    // ตรวจสอบว่าสอบแล้วและสอบตกซ้ำ — skip ถ้าคะแนนต่ำและยังไม่ถึง 7 วัน
    const summary = summaryStmt.get(model.id) as BenchmarkSummary;
    if (summary && summary.avg_score !== null && summary.latest_tested_at) {
      const avgScore = summary.avg_score;
      const lastTestedAt = new Date(summary.latest_tested_at + "Z");
      const daysSince = (Date.now() - lastTestedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (avgScore < FAIL_SCORE_THRESHOLD && daysSince < RETEST_DAYS) {
        logWorker(
          "benchmark",
          `⏭️ ข้าม ${model.model_id} — สอบตก (${avgScore.toFixed(1)}/10) และยังไม่ถึง ${RETEST_DAYS} วัน`
        );
        continue;
      }
    }

    // ตรวจ 3 คำถามที่สอบแล้ว
    const answered = new Set(
      (answeredStmt.all(model.id) as { question: string }[]).map((r) => r.question)
    );
    const pending = QUESTIONS.filter((q) => !answered.has(q));

    if (pending.length === 0) {
      logWorker("benchmark", `⏭️ ข้าม ${model.model_id} — สอบครบแล้ว`);
      continue;
    }

    testedModels++;
    let modelTotalScore = 0;
    let modelQuestionCount = 0;

    for (const question of pending) {
      const { answer, latency, error } = await askModel(
        model.provider,
        model.model_id,
        question
      );

      if (error) {
        logWorker(
          "benchmark",
          `โมเดล ${model.model_id} ผิดพลาด: ${error}`,
          "warn"
        );
      }

      const { score, reasoning } = await judgeAnswer(question, answer);

      try {
        insertResult.run(
          model.id,
          question,
          answer.slice(0, 2000),
          score,
          10,
          reasoning,
          latency
        );
        totalQuestions++;
        modelTotalScore += score;
        modelQuestionCount++;
      } catch (err) {
        logWorker(
          "benchmark",
          `DB insert error สำหรับ ${model.id}: ${err}`,
          "error"
        );
      }
    }

    // สรุปผลรายโมเดล + ตั้งชื่อใหม่ตามคะแนน
    if (modelQuestionCount > 0) {
      const avgScore = modelTotalScore / modelQuestionCount;
      const pct = Math.round((avgScore / 10) * 100);
      const passed = avgScore >= 5;

      logWorker(
        "benchmark",
        `${passed ? "✅ สอบผ่าน" : "❌ สอบตก"}: ${model.model_id} — คะแนน ${avgScore.toFixed(1)}/10 (${pct}%)`,
        passed ? "success" : "warn"
      );

      // ตั้งชื่อเล่นใหม่ตามคะแนน + ความประพฤติ
      if (DEEPSEEK_API_KEY) {
        try {
          const { generateNickname } = await import("./scanner");
          const existingNicknames = (db.prepare("SELECT nickname FROM models WHERE nickname IS NOT NULL AND id != ?").all(model.id) as { nickname: string }[]).map(r => r.nickname);

          let behavior = "";
          if (pct >= 90) behavior = ` คะแนนสูงมาก ${pct}% เด่นมาก ขยัน เก่ง`;
          else if (pct >= 70) behavior = ` คะแนนดี ${pct}% ตั้งใจเรียน`;
          else if (pct >= 50) behavior = ` คะแนนพอผ่าน ${pct}% ขี้เกียจนิดหน่อย`;
          else if (pct >= 30) behavior = ` คะแนนต่ำ ${pct}% ชอบหลับในห้อง`;
          else behavior = ` สอบตก ${pct}% ไม่ตั้งใจเรียนเลย`;

          const nickname = await generateNickname(model.model_id, model.provider, existingNicknames, behavior);
          if (nickname) {
            db.prepare("UPDATE models SET nickname = ? WHERE id = ?").run(nickname, model.id);
            logWorker("benchmark", `🎭 ตั้งชื่อ: ${model.model_id} → "${nickname}" (${pct}%)`, "success");
          }
        } catch { /* silent */ }
      }
    }
  }}
  const workers = Array.from({ length: Math.min(CONCURRENCY, models.length) }, () => benchmarkWorker());
  await Promise.all(workers);

  const msg = `Benchmark เสร็จ: ทดสอบ ${testedModels} โมเดล, ${totalQuestions} คำถาม`;
  logWorker("benchmark", msg);

  return { tested: testedModels, questions: totalQuestions };
}
