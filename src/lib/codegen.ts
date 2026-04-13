/**
 * Codegen Sandbox
 *
 * Helper สำหรับระบบ AI / worker สร้างไฟล์ code ใหม่ในโฟลเดอร์ `generated/`
 * ตามกฎ: ห้ามแก้ src/ core — สร้างไฟล์ใหม่เท่านั้น
 *
 * Usage จาก worker หรือ API route:
 *   await createGeneratedFile({
 *     kind: "analysis",
 *     slug: "analyze-tpm-bottleneck",
 *     purpose: "Find which Groq model hits TPM cap most often",
 *     extension: "ts",
 *     content: "import ... ",
 *     source: "worker",
 *   });
 */
import { promises as fs } from "fs";
import path from "path";
import { getSqlClient } from "@/lib/db/schema";

export type CodegenKind =
  | "analysis"
  | "migration"
  | "script"
  | "test"
  | "component"
  | "api"
  | "fix"
  | "refactor"
  | "feature"
  | "report"
  | "query"
  | "patch"
  | "other";

export interface CreateGeneratedFileParams {
  kind: CodegenKind;
  slug: string;
  purpose: string;
  extension: "ts" | "js" | "sql" | "json" | "md" | "py";
  content: string;
  source?: string;
}

export interface CreateGeneratedFileResult {
  id: number;
  filename: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  lines: number;
}

/**
 * กำหนด subfolder ตาม extension
 */
function subfolderFor(extension: string): string {
  switch (extension) {
    case "ts":
    case "js":
    case "py":
      return "scripts";
    case "sql":
      return "queries";
    case "json":
    case "md":
      return "reports";
    default:
      return "misc";
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

/**
 * สร้างไฟล์ใหม่ในโฟลเดอร์ generated/ + log ลง codegen_log
 * ⚠️ ห้ามเขียนทับไฟล์เดิม — filename ต้อง unique (ใช้ timestamp)
 */
export async function createGeneratedFile(
  params: CreateGeneratedFileParams
): Promise<CreateGeneratedFileResult> {
  const { kind, slug, purpose, extension, content, source = "ai" } = params;

  // Sanity: block any attempt to write outside generated/
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw new Error(`codegen: slug contains invalid characters: ${slug}`);
  }

  const subfolder = subfolderFor(extension);
  const cleanSlug = slugify(slug);
  const filename = `${timestamp()}-${cleanSlug}.${extension}`;

  // Resolve to generated/ at project root
  const projectRoot = process.cwd();
  const targetDir = path.join(projectRoot, "generated", subfolder);
  const absolutePath = path.join(targetDir, filename);
  const relativePath = path.join("generated", subfolder, filename);

  // Ensure we're not escaping the generated/ sandbox
  const generatedRoot = path.join(projectRoot, "generated");
  if (!absolutePath.startsWith(generatedRoot + path.sep)) {
    throw new Error(`codegen: path escapes sandbox: ${absolutePath}`);
  }

  // Create dir + write file
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(absolutePath, content, "utf-8");

  const sizeBytes = Buffer.byteLength(content, "utf-8");
  const lines = content.split("\n").length;

  // Log to codegen_log table
  let id = 0;
  try {
    const sql = getSqlClient();
    const rows = await sql<{ id: number }[]>`
      INSERT INTO codegen_log (filename, purpose, kind, size_bytes, lines, source, outcome)
      VALUES (${relativePath}, ${purpose}, ${kind}, ${sizeBytes}, ${lines}, ${source}, 'created')
      RETURNING id
    `;
    id = rows[0]?.id ?? 0;
  } catch {
    /* DB unavailable — file still written */
  }

  return {
    id,
    filename,
    absolutePath,
    relativePath: relativePath.replace(/\\/g, "/"),
    sizeBytes,
    lines,
  };
}

/**
 * Update outcome ของไฟล์ที่เคย generate ไว้แล้ว (หลังรันเสร็จ)
 */
export async function updateCodegenOutcome(
  id: number,
  outcome: string
): Promise<void> {
  if (!id) return;
  try {
    const sql = getSqlClient();
    await sql`
      UPDATE codegen_log
      SET outcome = ${outcome.slice(0, 500)}
      WHERE id = ${id}
    `;
  } catch {
    /* silent */
  }
}

/**
 * List ไฟล์ที่ถูก generate แล้วทั้งหมด (จาก DB)
 */
export async function listGeneratedFiles(limit = 100): Promise<
  Array<{
    id: number;
    filename: string;
    purpose: string;
    kind: string;
    sizeBytes: number;
    lines: number;
    source: string | null;
    outcome: string | null;
    createdAt: Date;
  }>
> {
  try {
    const sql = getSqlClient();
    const rows = await sql<
      Array<{
        id: number;
        filename: string;
        purpose: string;
        kind: string;
        size_bytes: number;
        lines: number;
        source: string | null;
        outcome: string | null;
        created_at: Date;
      }>
    >`
      SELECT id, filename, purpose, kind, size_bytes, lines, source, outcome, created_at
      FROM codegen_log
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      purpose: r.purpose,
      kind: r.kind,
      sizeBytes: r.size_bytes,
      lines: r.lines,
      source: r.source,
      outcome: r.outcome,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}
