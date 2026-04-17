import { getSqlClient } from "./client";

let migrationDone = false;

export async function runMigrations(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;

  const sql = getSqlClient();

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        context_length INTEGER DEFAULT 0,
        tier TEXT DEFAULT 'small',
        description TEXT,
        supports_tools INTEGER DEFAULT -1,
        supports_vision INTEGER DEFAULT -1,
        nickname TEXT,
        supports_audio_input INTEGER DEFAULT 0,
        supports_audio_output INTEGER DEFAULT 0,
        supports_image_gen INTEGER DEFAULT 0,
        supports_embedding INTEGER DEFAULT 0,
        supports_json_mode INTEGER DEFAULT 0,
        supports_reasoning INTEGER DEFAULT 0,
        supports_code INTEGER DEFAULT 0,
        max_output_tokens INTEGER DEFAULT 0,
        pricing_input REAL DEFAULT 0,
        pricing_output REAL DEFAULT 0,
        first_seen TIMESTAMPTZ DEFAULT now(),
        last_seen TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS health_logs (
        id BIGSERIAL PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        latency_ms INTEGER DEFAULT 0,
        error TEXT,
        checked_at TIMESTAMPTZ DEFAULT now(),
        cooldown_until TIMESTAMPTZ
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_health_model ON health_logs(model_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_health_checked ON health_logs(checked_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS exam_attempts (
        id BIGSERIAL PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        started_at TIMESTAMPTZ DEFAULT now(),
        finished_at TIMESTAMPTZ,
        total_questions INTEGER NOT NULL DEFAULT 0,
        passed_questions INTEGER NOT NULL DEFAULT 0,
        score_pct REAL NOT NULL DEFAULT 0,
        passed BOOLEAN NOT NULL DEFAULT false,
        total_latency_ms INTEGER DEFAULT 0,
        error TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_exam_attempts_model ON exam_attempts(model_id, started_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_exam_attempts_passed ON exam_attempts(passed, started_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS exam_answers (
        id BIGSERIAL PRIMARY KEY,
        attempt_id BIGINT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL,
        category TEXT NOT NULL,
        question TEXT NOT NULL,
        expected TEXT,
        answer TEXT,
        passed BOOLEAN NOT NULL DEFAULT false,
        check_method TEXT,
        fail_reason TEXT,
        latency_ms INTEGER DEFAULT 0
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt ON exam_answers(attempt_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_exam_answers_qid ON exam_answers(question_id)`;

    // ─── Self-Tuning: Phase 1+2+3 ────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS model_fail_streak (
        model_id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
        streak_count INT NOT NULL DEFAULT 0,
        last_fail_at TIMESTAMPTZ,
        last_success_at TIMESTAMPTZ,
        total_fails INT NOT NULL DEFAULT 0,
        total_success INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS model_capacity (
        model_id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
        max_successful_tokens INT DEFAULT 0,
        p90_successful_tokens INT DEFAULT 0,
        avg_successful_tokens INT DEFAULT 0,
        min_failed_tokens INT,
        success_count INT DEFAULT 0,
        fail_count INT DEFAULT 0,
        avg_latency_ms INT DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS model_samples (
        id BIGSERIAL PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        tokens INT NOT NULL,
        latency_ms INT NOT NULL,
        success BOOLEAN NOT NULL,
        has_tools BOOLEAN DEFAULT false,
        category TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_model_samples_model ON model_samples(model_id, created_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS category_winners (
        category TEXT NOT NULL,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        avg_latency_ms REAL DEFAULT 0,
        win_streak INT DEFAULT 0,
        loss_streak INT DEFAULT 0,
        last_win_at TIMESTAMPTZ,
        last_loss_at TIMESTAMPTZ,
        PRIMARY KEY (category, model_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_category_winners_cat ON category_winners(category, wins DESC)`;
    await sql`ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS next_exam_at TIMESTAMPTZ`;
    await sql`ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS consecutive_fails INT DEFAULT 0`;
    await sql`ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS exam_level TEXT`;
    await sql`
      CREATE TABLE IF NOT EXISTS discovered_questions (
        id BIGSERIAL PRIMARY KEY,
        question_hash TEXT UNIQUE NOT NULL,
        question TEXT NOT NULL,
        category TEXT,
        fail_count INT DEFAULT 1,
        first_seen_at TIMESTAMPTZ DEFAULT now(),
        last_seen_at TIMESTAMPTZ DEFAULT now(),
        promoted BOOLEAN DEFAULT false
      )
    `;

    // Backward-compat view: code เดิมที่อ้าง benchmark_results จะอ่านผลสอบใหม่แทน
    await sql`DROP TABLE IF EXISTS benchmark_results CASCADE`.catch(() => {});
    await sql`
      CREATE OR REPLACE VIEW benchmark_results AS
      SELECT
        ea.id,
        a.model_id,
        ea.category,
        ea.question,
        ea.answer,
        CASE WHEN ea.passed THEN 10.0 ELSE 0.0 END as score,
        10.0 as max_score,
        COALESCE(ea.fail_reason, 'passed') as reasoning,
        ea.latency_ms,
        a.started_at as tested_at
      FROM exam_answers ea
      INNER JOIN exam_attempts a ON a.id = ea.attempt_id
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS worker_logs (
        id BIGSERIAL PRIMARY KEY,
        step TEXT NOT NULL,
        message TEXT NOT NULL,
        level TEXT DEFAULT 'info',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_worker_logs_created ON worker_logs(created_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS worker_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS gateway_logs (
        id BIGSERIAL PRIMARY KEY,
        request_model TEXT NOT NULL,
        resolved_model TEXT,
        provider TEXT,
        status INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        error TEXT,
        user_message TEXT,
        assistant_message TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_gateway_logs_created ON gateway_logs(created_at)`;

    // Add request_id + client_ip for /v1/trace/:reqId + /api/my-stats endpoints
    await sql`ALTER TABLE gateway_logs ADD COLUMN IF NOT EXISTS request_id TEXT`;
    await sql`ALTER TABLE gateway_logs ADD COLUMN IF NOT EXISTS client_ip TEXT`;

    // Prompt library — reusable system prompts
    await sql`
      CREATE TABLE IF NOT EXISTS prompts (
        name         TEXT PRIMARY KEY,
        content      TEXT NOT NULL,
        description  TEXT,
        use_count    INTEGER DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT now(),
        updated_at   TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_gateway_logs_req_id ON gateway_logs(request_id) WHERE request_id IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_gateway_logs_client_ip ON gateway_logs(client_ip, created_at DESC) WHERE client_ip IS NOT NULL`;

    // ตารางจำ rate limit per provider/model จาก error message + header
    await sql`
      CREATE TABLE IF NOT EXISTS provider_limits (
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        limit_tpm INTEGER,
        limit_tpd INTEGER,
        remaining_tpm INTEGER,
        remaining_tpd INTEGER,
        reset_tpm_at TIMESTAMPTZ,
        reset_tpd_at TIMESTAMPTZ,
        last_429_at TIMESTAMPTZ,
        source TEXT,
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (provider, model_id)
      )
    `;

    // ตาราง toggle เปิด/ปิด provider โดยผู้ใช้
    await sql`
      CREATE TABLE IF NOT EXISTS provider_settings (
        provider TEXT PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS token_usage (
        id BIGSERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        estimated_cost_usd REAL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(created_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS complaints (
        id BIGSERIAL PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        reason TEXT,
        user_message TEXT,
        assistant_message TEXT,
        source TEXT DEFAULT 'api',
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_complaints_model ON complaints(model_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_complaints_created ON complaints(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status)`;

    await sql`
      CREATE TABLE IF NOT EXISTS complaint_exams (
        id BIGSERIAL PRIMARY KEY,
        complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        answer TEXT,
        score REAL DEFAULT 0,
        max_score REAL DEFAULT 10,
        reasoning TEXT,
        latency_ms INTEGER DEFAULT 0,
        passed INTEGER DEFAULT 0,
        tested_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS routing_stats (
        id BIGSERIAL PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        prompt_category TEXT NOT NULL DEFAULT 'general',
        success INTEGER DEFAULT 1,
        latency_ms INTEGER DEFAULT 0,
        complaint_after INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_routing_stats_cat ON routing_stats(prompt_category, provider)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_routing_stats_model ON routing_stats(model_id)`;

    await sql`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        provider TEXT,
        model_id TEXT,
        severity TEXT DEFAULT 'info',
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`;

    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        provider TEXT PRIMARY KEY,
        api_key TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    // ─── Teacher Hierarchy ───────────────────────────────────────────────────
    // role: 'principal' (1), 'head' (per-category), 'proctor' (5-10)
    // ครูถูกเลือกอัตโนมัติจาก exam/live score ทุกรอบ worker
    // เปลี่ยน PK จาก model_id → BIGSERIAL เพื่อให้ model เดียวเป็น head หลาย category ได้
    await sql`DROP TABLE IF EXISTS teachers CASCADE`;
    await sql`
      CREATE TABLE IF NOT EXISTS teachers (
        id BIGSERIAL PRIMARY KEY,
        model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('principal', 'head', 'proctor')),
        category TEXT,
        score REAL NOT NULL DEFAULT 0,
        appointed_at TIMESTAMPTZ DEFAULT now(),
        reappointed_count INT DEFAULT 0
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_teachers_role ON teachers(role)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_teachers_category ON teachers(category) WHERE category IS NOT NULL`;

    await sql`
      CREATE TABLE IF NOT EXISTS grading_history (
        id BIGSERIAL PRIMARY KEY,
        attempt_id BIGINT,
        grader_model_id TEXT NOT NULL,
        grader_role TEXT NOT NULL,
        question_id TEXT NOT NULL,
        category TEXT,
        original_score REAL,
        final_score REAL,
        reasoning TEXT,
        method TEXT,
        graded_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_grading_attempt ON grading_history(attempt_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_grading_grader ON grading_history(grader_model_id, graded_at DESC)`;

    // Code generation log — ระบบเขียน code/script อะไรให้ใครรันบ้าง (self-introspection)
    await sql`
      CREATE TABLE IF NOT EXISTS codegen_log (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        purpose TEXT NOT NULL,
        kind TEXT NOT NULL,
        size_bytes INT DEFAULT 0,
        lines INT DEFAULT 0,
        source TEXT,
        outcome TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_codegen_recent ON codegen_log(created_at DESC)`;

    // Dev suggestions — ระบบพบปัญหาที่ต้องให้ Dev แก้ core (AI ห้ามแตะ src/)
    await sql`
      CREATE TABLE IF NOT EXISTS dev_suggestions (
        id BIGSERIAL PRIMARY KEY,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'high', 'critical')),
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        target_files TEXT,
        proposed_change TEXT,
        evidence TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
        source TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_dev_sugg_open ON dev_suggestions(status, severity, created_at DESC) WHERE status = 'open'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dev_sugg_recent ON dev_suggestions(created_at DESC)`;

    // ─── Per-category exam scores ────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS model_category_scores (
        model_id TEXT NOT NULL,
        category TEXT NOT NULL,
        score_pct REAL NOT NULL DEFAULT 0,
        passed_count INT NOT NULL DEFAULT 0,
        total_count INT NOT NULL DEFAULT 0,
        attempt_id BIGINT,
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (model_id, category)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mcs_lookup ON model_category_scores(category, score_pct DESC)`;

    // ─── Performance indexes (U5) ────────────────────────────────────────────
    // Note: partial WHERE cooldown_until > now() ใช้ไม่ได้ (now() ไม่ IMMUTABLE)
    // ใช้ WHERE cooldown_until IS NOT NULL แทน — queries กรอง > now() รันไปเถอะ
    await sql`CREATE INDEX IF NOT EXISTS idx_health_cooldown_active ON health_logs(model_id, cooldown_until DESC) WHERE cooldown_until IS NOT NULL`.catch(
      (e) => console.warn("[migrate] idx_health_cooldown_active skipped:", (e as Error).message),
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_gateway_recent ON gateway_logs(created_at DESC, status)`.catch(
      (e) => console.warn("[migrate] idx_gateway_recent skipped:", (e as Error).message),
    );
    await sql`CREATE INDEX IF NOT EXISTS idx_exam_passed_recent ON exam_attempts(model_id, started_at DESC) WHERE passed = true`.catch(
      (e) => console.warn("[migrate] idx_exam_passed_recent skipped:", (e as Error).message),
    );

    // ─── Semantic cache (pgvector) ───────────────────────────────────────────
    // pgvector อาจไม่ติดตั้งใน Postgres image — swallow error แล้วให้ระบบรันต่อ
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
      await sql`
        CREATE TABLE IF NOT EXISTS semantic_cache (
          id BIGSERIAL PRIMARY KEY,
          query_hash TEXT UNIQUE NOT NULL,
          query TEXT NOT NULL,
          embedding vector(768),
          response JSONB NOT NULL,
          provider TEXT,
          model TEXT,
          hit_count INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now(),
          last_used_at TIMESTAMPTZ DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_semantic_cache_embedding ON semantic_cache USING ivfflat (embedding vector_cosine_ops)`;
      console.log("[migrate] pgvector semantic_cache ready");
    } catch (e) {
      console.warn("[migrate] pgvector unavailable — semantic_cache skipped:", (e as Error).message);
    }

    console.log("[migrate] All tables created/verified");
  } catch (err) {
    console.error("[migrate] Migration failed:", err);
    throw err;
  }
}
