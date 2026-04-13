import { NextRequest, NextResponse } from "next/server";
import { getSqlClient } from "@/lib/db/schema";
import {
  createGeneratedFile,
  listGeneratedFiles,
  type CodegenKind,
} from "@/lib/codegen";

export const dynamic = "force-dynamic";

interface CodegenResponse {
  entries: Array<{
    id: number;
    filename: string;
    purpose: string;
    kind: string;
    sizeBytes: number;
    lines: number;
    source: string | null;
    outcome: string | null;
    createdAt: string;
  }>;
  totalCount: number;
}

export async function GET() {
  try {
    // Check table exists
    const sql = getSqlClient();
    const tableExists = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'codegen_log'
      )
    `;

    if (!tableExists[0]?.exists) {
      return NextResponse.json<CodegenResponse>({ entries: [], totalCount: 0 });
    }

    const rows = await listGeneratedFiles(100);
    const countRows = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM codegen_log
    `;

    return NextResponse.json<CodegenResponse>({
      entries: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      totalCount: countRows[0]?.count ?? 0,
    });
  } catch {
    return NextResponse.json<CodegenResponse>({ entries: [], totalCount: 0 });
  }
}

/**
 * POST /api/codegen — create new generated file in sandbox
 * body: { kind, slug, purpose, extension, content, source? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { kind, slug, purpose, extension, content, source } = body as {
      kind: CodegenKind;
      slug: string;
      purpose: string;
      extension: "ts" | "js" | "sql" | "json" | "md" | "py";
      content: string;
      source?: string;
    };

    if (!kind || !slug || !purpose || !extension || !content) {
      return NextResponse.json(
        { error: "missing required fields: kind, slug, purpose, extension, content" },
        { status: 400 }
      );
    }

    const result = await createGeneratedFile({
      kind,
      slug,
      purpose,
      extension,
      content,
      source,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
