import { NextRequest, NextResponse } from "next/server";
import {
  listSuggestions,
  recordSuggestion,
  updateSuggestionStatus,
  type Severity,
  type SuggestionStatus,
} from "@/lib/dev-suggestions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as SuggestionStatus | null;
  const suggestions = await listSuggestions(status ?? undefined, 200);

  const counts = {
    total: suggestions.length,
    open: suggestions.filter((s) => s.status === "open").length,
    critical: suggestions.filter((s) => s.severity === "critical" && s.status === "open").length,
    high: suggestions.filter((s) => s.severity === "high" && s.status === "open").length,
    warn: suggestions.filter((s) => s.severity === "warn" && s.status === "open").length,
  };

  return NextResponse.json({
    suggestions: suggestions.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    counts,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      severity,
      category,
      title,
      description,
      targetFiles,
      proposedChange,
      evidence,
      source,
    } = body as {
      severity: Severity;
      category: string;
      title: string;
      description: string;
      targetFiles?: string;
      proposedChange?: string;
      evidence?: string;
      source?: string;
    };

    if (!severity || !category || !title || !description) {
      return NextResponse.json(
        { error: "missing required fields: severity, category, title, description" },
        { status: 400 }
      );
    }

    const id = await recordSuggestion({
      severity,
      category,
      title,
      description,
      targetFiles,
      proposedChange,
      evidence,
      source,
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body as { id: number; status: SuggestionStatus };
    if (!id || !status) {
      return NextResponse.json({ error: "missing id or status" }, { status: 400 });
    }
    await updateSuggestionStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
