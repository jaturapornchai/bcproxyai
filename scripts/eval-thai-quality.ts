/**
 * Ground-truth Thai evaluation — tests each catalogued model with real Thai
 * prompts, counts Thai codepoints + `?` pollution in the response, and emits
 * SQL to overwrite the placeholder scores in benchmark_results and
 * model_category_scores for category='thai'.
 *
 * Usage:
 *   tsx scripts/eval-thai-quality.ts > /tmp/thai-seed.sql
 *   ssh root@<droplet> 'docker exec -i bcai-router-postgres-1 psql -U bcai -d bcairouter' < /tmp/thai-seed.sql
 *
 * Reads GATEWAY_API_KEY + GATEWAY_URL from env (or argv).
 * Progress goes to stderr; SQL goes to stdout.
 */

const API_URL = process.env.GATEWAY_URL ?? 'https://smlgateway.smlsoftdemo.com';
const KEY = process.env.GATEWAY_API_KEY ?? process.argv[2];
if (!KEY) {
  console.error('ERR: need GATEWAY_API_KEY env or first arg');
  process.exit(1);
}

const PROMPTS = [
  'ตอบสั้นๆ 1 ประโยค: ฝนตกเกิดจากอะไร?',
  'เมืองหลวงของประเทศไทยชื่ออะไร? ตอบเป็นภาษาไทยประโยคเดียว',
  'พิมพ์คำว่า "สวัสดีครับ" พร้อมอธิบายความหมายสั้นๆ 1-2 ประโยค',
];

const THAI_MIN_CHARS = 15;
const QMARK_MAX_RATIO = 0.15;
const REQUEST_TIMEOUT_MS = 30_000;
const INTER_PROMPT_DELAY_MS = 300;

function countThai(s: string): number {
  let n = 0;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (cp >= 0x0e00 && cp <= 0x0e7f) n++;
  }
  return n;
}

function qMarkRatio(s: string): number {
  if (!s.length) return 1;
  let n = 0;
  for (const c of s) if (c === '?') n++;
  return n / s.length;
}

type Result = { model_id: string; passes: number; total: number; probes: string[] };

async function testOne(modelId: string, prompt: string): Promise<{ pass: boolean; probe: string }> {
  try {
    const r = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.2,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!r.ok) return { pass: false, probe: `H${r.status}` };
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? '';
    const thai = countThai(content);
    const q = qMarkRatio(content);
    const pass = thai >= THAI_MIN_CHARS && q <= QMARK_MAX_RATIO;
    return { pass, probe: `${pass ? 'P' : 'F'}(t=${thai},q=${q.toFixed(2)})` };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 20);
    return { pass: false, probe: `ERR:${msg}` };
  }
}

async function runThaiEval() {
  console.error(`[eval] fetching model catalog from ${API_URL}`);
  // /v1/models/search returns rows keyed by the DB model_id which has the
  // `provider:name` form we can rewrite to `provider/name` for direct routing.
  const mResp = await fetch(`${API_URL}/v1/models/search?top=500`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!mResp.ok) {
    console.error(`ERR: /v1/models/search returned ${mResp.status}`);
    process.exit(1);
  }
  const mJson = (await mResp.json()) as {
    models?: Array<{ id: string; provider: string; context_length: number }>;
  };
  const rows = mJson.models ?? [];
  const modelIds = rows
    .filter((r) => r.context_length >= 8000)
    .map((r) => {
      const parts = r.id.split(':');
      const modelName = parts.length > 1 ? parts.slice(1).join(':') : r.id;
      return { dbId: r.id, directId: `${r.provider}/${modelName}` };
    });

  console.error(`[eval] testing ${modelIds.length} models × ${PROMPTS.length} prompts`);
  const results: Result[] = [];

  for (let i = 0; i < modelIds.length; i++) {
    const { dbId, directId } = modelIds[i];
    let passes = 0;
    const probes: string[] = [];
    for (const prompt of PROMPTS) {
      const { pass, probe } = await testOne(directId, prompt);
      if (pass) passes++;
      probes.push(probe);
      await new Promise((r) => setTimeout(r, INTER_PROMPT_DELAY_MS));
    }
    results.push({ model_id: dbId, passes, total: PROMPTS.length, probes });
    const score = ((passes / PROMPTS.length) * 10).toFixed(1);
    console.error(
      `[${i + 1}/${modelIds.length}] score=${score}/10  ${dbId}  ${probes.join(' | ')}`,
    );
  }

  // Emit SQL
  console.log('-- ground-truth Thai evaluation seed');
  console.log(`-- generated ${new Date().toISOString()}, ${results.length} models tested`);
  console.log('BEGIN;');
  console.log(`DELETE FROM benchmark_results WHERE category = 'thai';`);
  console.log(`DELETE FROM model_category_scores WHERE category = 'thai';`);
  console.log();
  for (const r of results) {
    const id = r.model_id.replace(/'/g, "''");
    const score10 = (r.passes / r.total) * 10;
    const pct = (r.passes / r.total) * 100;
    console.log(
      `INSERT INTO benchmark_results (model_id, category, score) VALUES ('${id}', 'thai', ${score10.toFixed(2)});`,
    );
    console.log(
      `INSERT INTO model_category_scores (model_id, category, score_pct, passed_count, total_count) VALUES ('${id}', 'thai', ${pct.toFixed(2)}, ${r.passes}, ${r.total});`,
    );
  }
  console.log('COMMIT;');

  // Summary to stderr
  const perfect = results.filter((r) => r.passes === r.total).length;
  const partial = results.filter((r) => r.passes > 0 && r.passes < r.total).length;
  const fail = results.filter((r) => r.passes === 0).length;
  console.error(`\n=== SUMMARY ===`);
  console.error(`perfect: ${perfect}  partial: ${partial}  fail: ${fail}  total: ${results.length}`);
}

runThaiEval().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
