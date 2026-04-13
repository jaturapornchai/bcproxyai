#!/usr/bin/env node
/**
 * SMLGateway Stress Test
 * ส่ง requests แบบ concurrent ผ่าน Gateway เหมือนที่ OpenClaw เรียก
 */

const BASE_URL = "http://localhost:3333/v1/chat/completions";
const TOTAL_REQUESTS = 10000;
const CONCURRENCY = 20; // realistic: simulate 20 users
const MODELS = ["auto", "bcproxy/fast", "bcproxy/thai"];

const QUESTIONS_TH = [
  "สวัสดีครับ",
  "วันนี้วันอะไร",
  "แนะนำอาหารไทย",
  "กรุงเทพอยู่ที่ไหน",
  "1+1 เท่ากับเท่าไหร่",
  "ช่วยแปลคำว่า hello เป็นไทย",
  "ประเทศไทยมีกี่จังหวัด",
  "แม่น้ำเจ้าพระยาไหลผ่านจังหวัดอะไรบ้าง",
  "อาหารเช้าควรกินอะไร",
  "เล่านิทานสั้นๆ ให้ฟัง",
  "สีรุ้งมีกี่สี",
  "ดาวอังคารอยู่ห่างจากโลกเท่าไหร่",
  "วิธีทำต้มยำกุ้ง",
  "ภาษาอังกฤษคำว่า ขอบคุณ พูดว่าอะไร",
  "น้ำหนัก 1 กิโลกรัม เท่ากับกี่กรัม",
  "ช้างเป็นสัตว์ประจำชาติอะไร",
  "พระอาทิตย์ขึ้นทางไหน",
  "ฝนตกทำไม",
  "คอมพิวเตอร์ทำงานอย่างไร",
  "แนะนำหนังสือดีๆ สักเล่ม",
];

const QUESTIONS_EN = [
  "Hello, how are you?",
  "What is 2+2?",
  "Tell me a joke",
  "What is the capital of France?",
  "Explain gravity in one sentence",
  "What color is the sky?",
  "Name 3 programming languages",
  "What is AI?",
  "How does the internet work?",
  "What is the speed of light?",
];

const ALL_QUESTIONS = [...QUESTIONS_TH, ...QUESTIONS_EN];

// Stats
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  errors: {},        // error type -> count
  providers: {},     // provider -> count
  models: {},        // model -> count
  latencies: [],     // ms
  startTime: 0,
  endTime: 0,
  statusCodes: {},   // status -> count
};

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function sendRequest(i) {
  const model = randomItem(MODELS);
  const question = randomItem(ALL_QUESTIONS);
  const start = Date.now();

  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: question }],
        stream: false,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const latency = Date.now() - start;
    stats.latencies.push(latency);
    stats.total++;

    const code = res.status;
    stats.statusCodes[code] = (stats.statusCodes[code] || 0) + 1;

    const provider = res.headers.get("x-bcproxy-provider") || "unknown";
    const resolvedModel = res.headers.get("x-bcproxy-model") || "unknown";

    if (res.ok) {
      stats.success++;
      stats.providers[provider] = (stats.providers[provider] || 0) + 1;
      stats.models[resolvedModel] = (stats.models[resolvedModel] || 0) + 1;

      // Progress
      if (stats.total % 10 === 0) {
        const pct = Math.round((stats.total / TOTAL_REQUESTS) * 100);
        const avgLat = Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length);
        process.stdout.write(`\r  [${pct}%] ${stats.success}/${stats.total} OK | avg ${avgLat}ms | ${provider}/${resolvedModel}`);
      }
    } else {
      stats.failed++;
      const text = await res.text().catch(() => "");
      const errKey = `HTTP ${code}`;
      stats.errors[errKey] = (stats.errors[errKey] || 0) + 1;
    }
  } catch (err) {
    const latency = Date.now() - start;
    stats.latencies.push(latency);
    stats.total++;
    stats.failed++;
    const errKey = err.name === "TimeoutError" ? "Timeout" : err.message?.slice(0, 50) || "Unknown";
    stats.errors[errKey] = (stats.errors[errKey] || 0) + 1;
  }
}

async function runConcurrent(total, concurrency) {
  let idx = 0;
  async function worker() {
    while (idx < total) {
      const i = idx++;
      await sendRequest(i);
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, i)];
}

function printReport() {
  const duration = (stats.endTime - stats.startTime) / 1000;
  const avgLat = Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length);
  const p50 = percentile(stats.latencies, 50);
  const p90 = percentile(stats.latencies, 90);
  const p99 = percentile(stats.latencies, 99);
  const minLat = Math.min(...stats.latencies);
  const maxLat = Math.max(...stats.latencies);
  const rps = (stats.total / duration).toFixed(1);
  const successRate = ((stats.success / stats.total) * 100).toFixed(1);

  console.log("\n");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  SMLGateway Stress Test Report");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");
  console.log(`  Total Requests:    ${stats.total}`);
  console.log(`  Success:           ${stats.success} (${successRate}%)`);
  console.log(`  Failed:            ${stats.failed}`);
  console.log(`  Duration:          ${duration.toFixed(1)}s`);
  console.log(`  Throughput:        ${rps} req/s`);
  console.log(`  Concurrency:       ${CONCURRENCY}`);
  console.log("");
  console.log("─── Latency ────────────────────────────────────────");
  console.log(`  Average:           ${avgLat}ms`);
  console.log(`  P50 (median):      ${p50}ms`);
  console.log(`  P90:               ${p90}ms`);
  console.log(`  P99:               ${p99}ms`);
  console.log(`  Min:               ${minLat}ms`);
  console.log(`  Max:               ${maxLat}ms`);
  console.log("");
  console.log("─── Status Codes ───────────────────────────────────");
  for (const [code, count] of Object.entries(stats.statusCodes).sort()) {
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${code}:  ${count} (${pct}%)`);
  }
  console.log("");
  console.log("─── Providers ──────────────────────────────────────");
  for (const [p, count] of Object.entries(stats.providers).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.success) * 100).toFixed(1);
    console.log(`  ${p.padEnd(15)} ${count} (${pct}%)`);
  }
  console.log("");
  console.log("─── Models (Top 10) ────────────────────────────────");
  const topModels = Object.entries(stats.models).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [m, count] of topModels) {
    const pct = ((count / stats.success) * 100).toFixed(1);
    console.log(`  ${m.padEnd(40)} ${count} (${pct}%)`);
  }
  if (Object.keys(stats.errors).length > 0) {
    console.log("");
    console.log("─── Errors ─────────────────────────────────────────");
    for (const [err, count] of Object.entries(stats.errors).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${err.padEnd(40)} ${count}`);
    }
  }
  console.log("");
  console.log("═══════════════════════════════════════════════════════");
}

async function main() {
  console.log("SMLGateway Stress Test");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Requests: ${TOTAL_REQUESTS} | Concurrency: ${CONCURRENCY}`);
  console.log(`  Models: ${MODELS.join(", ")}`);
  console.log(`  Questions: ${ALL_QUESTIONS.length} (TH + EN)`);
  console.log("");
  console.log("  Starting...");

  stats.startTime = Date.now();
  await runConcurrent(TOTAL_REQUESTS, CONCURRENCY);
  stats.endTime = Date.now();

  printReport();
}

main().catch(console.error);
