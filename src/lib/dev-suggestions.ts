/**
 * Dev Suggestions
 *
 * ระบบ AI/worker ใช้บันทึกคำแนะนำที่ต้องให้ human dev แก้ใน core code
 * (เพราะ AI ห้ามแตะ src/ ตามกฎ codegen-create-only)
 *
 * Workflow:
 *   Worker detect pattern → analyzeAndSuggest() → insert row in dev_suggestions
 *   Dev เปิด dashboard "คำแนะนำสำหรับ Dev" → อ่าน → แก้ core → mark resolved
 */
import { getSqlClient } from "@/lib/db/schema";

export type Severity = "info" | "warn" | "high" | "critical";
export type SuggestionStatus = "open" | "acknowledged" | "resolved" | "dismissed";

export interface DevSuggestion {
  id: number;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  targetFiles: string | null;
  proposedChange: string | null;
  evidence: string | null;
  status: SuggestionStatus;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSuggestionParams {
  severity: Severity;
  category: string;
  title: string;
  description: string;
  targetFiles?: string;
  proposedChange?: string;
  evidence?: string;
  source?: string;
}

/**
 * บันทึกคำแนะนำใหม่ — dedupe ตาม title (ถ้ามี open suggestion title เดียวกันอยู่แล้ว skip)
 */
export async function recordSuggestion(
  params: CreateSuggestionParams
): Promise<number | null> {
  try {
    const sql = getSqlClient();
    // Check for existing open suggestion with same title
    const existing = await sql<{ id: number }[]>`
      SELECT id FROM dev_suggestions
      WHERE title = ${params.title} AND status = 'open'
      LIMIT 1
    `;
    if (existing.length > 0) {
      // Bump updated_at to show it's still happening
      await sql`
        UPDATE dev_suggestions
        SET updated_at = now(),
            evidence = ${params.evidence ?? null}
        WHERE id = ${existing[0].id}
      `;
      return existing[0].id;
    }

    const rows = await sql<{ id: number }[]>`
      INSERT INTO dev_suggestions
        (severity, category, title, description, target_files, proposed_change, evidence, source)
      VALUES
        (${params.severity}, ${params.category}, ${params.title}, ${params.description},
         ${params.targetFiles ?? null}, ${params.proposedChange ?? null},
         ${params.evidence ?? null}, ${params.source ?? "worker"})
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function listSuggestions(
  status?: SuggestionStatus,
  limit = 100
): Promise<DevSuggestion[]> {
  try {
    const sql = getSqlClient();
    const rows = status
      ? await sql<
          Array<{
            id: number;
            severity: Severity;
            category: string;
            title: string;
            description: string;
            target_files: string | null;
            proposed_change: string | null;
            evidence: string | null;
            status: SuggestionStatus;
            source: string | null;
            created_at: Date;
            updated_at: Date;
          }>
        >`
          SELECT id, severity, category, title, description,
                 target_files, proposed_change, evidence,
                 status, source, created_at, updated_at
          FROM dev_suggestions
          WHERE status = ${status}
          ORDER BY
            CASE severity
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'warn' THEN 3
              ELSE 4
            END,
            updated_at DESC
          LIMIT ${limit}
        `
      : await sql<
          Array<{
            id: number;
            severity: Severity;
            category: string;
            title: string;
            description: string;
            target_files: string | null;
            proposed_change: string | null;
            evidence: string | null;
            status: SuggestionStatus;
            source: string | null;
            created_at: Date;
            updated_at: Date;
          }>
        >`
          SELECT id, severity, category, title, description,
                 target_files, proposed_change, evidence,
                 status, source, created_at, updated_at
          FROM dev_suggestions
          ORDER BY
            CASE status WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
            CASE severity
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'warn' THEN 3
              ELSE 4
            END,
            updated_at DESC
          LIMIT ${limit}
        `;
    return rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      category: r.category,
      title: r.title,
      description: r.description,
      targetFiles: r.target_files,
      proposedChange: r.proposed_change,
      evidence: r.evidence,
      status: r.status,
      source: r.source,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  } catch {
    return [];
  }
}

export async function updateSuggestionStatus(
  id: number,
  status: SuggestionStatus
): Promise<void> {
  try {
    const sql = getSqlClient();
    await sql`
      UPDATE dev_suggestions
      SET status = ${status}, updated_at = now()
      WHERE id = ${id}
    `;
  } catch {
    /* silent */
  }
}
