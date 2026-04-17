import { NextRequest, NextResponse } from "next/server";
import {
  EXAM_LEVELS,
  EXAM_LEVEL_META,
  type ExamLevel,
  getActiveExamLevel,
  setActiveExamLevel,
  getExamQuestions,
} from "@/lib/worker/exam";

export const dynamic = "force-dynamic";

function isExamLevel(v: unknown): v is ExamLevel {
  return typeof v === "string" && (EXAM_LEVELS as string[]).includes(v);
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const queryLevel = url.searchParams.get("level");
    const includeQuestions = url.searchParams.get("includeQuestions") === "1";

    const active = await getActiveExamLevel();
    const level: ExamLevel = isExamLevel(queryLevel) ? queryLevel : active;

    const levels = EXAM_LEVELS.map((lv) => {
      const qs = getExamQuestions(lv);
      const meta = EXAM_LEVEL_META[lv];
      return {
        id: lv,
        label: meta.label,
        emoji: meta.emoji,
        threshold: meta.threshold,
        description: meta.description,
        questionCount: qs.length,
      };
    });

    let questions: Array<Record<string, unknown>> | undefined;
    if (includeQuestions) {
      questions = getExamQuestions(level).map((q) => ({
        id: q.id,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        expected: q.expected,
        withTools: !!q.withTools,
        withVision: !!q.withVision,
      }));
    }

    return NextResponse.json({
      active,
      level,
      levels,
      questions,
    });
  } catch (err) {
    console.error("[exam-config] GET error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { level?: unknown } | null;
    const level = body?.level;
    if (!isExamLevel(level)) {
      return NextResponse.json(
        { error: `invalid level — must be one of: ${EXAM_LEVELS.join(", ")}` },
        { status: 400 },
      );
    }
    await setActiveExamLevel(level);
    return NextResponse.json({ ok: true, level, meta: EXAM_LEVEL_META[level] });
  } catch (err) {
    console.error("[exam-config] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
