import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 30 },
    { duration: '1m30s', target: 30 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<8000'],
    'http_req_failed': ['rate<0.15'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8335';
const AUTH = __ENV.AUTH_TOKEN || '';
const CHAT_URL = `${BASE_URL}/v1/chat/completions`;

const params = {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH}`,
  },
  timeout: '30s',
};

// Generate unique prompts so cache can't absorb load — this measures true throughput
function uniquePrompt() {
  const topics = ['hello', 'คำนวณ 5+3', 'list 3 colors', 'what is python', 'แปล OK เป็นไทย', 'reverse abc'];
  const idx = Math.floor(Math.random() * topics.length);
  const nonce = Math.floor(Math.random() * 100000);
  return {
    model: 'bcai/auto',
    messages: [{ role: 'user', content: `${topics[idx]} [n=${nonce}]` }],
    max_tokens: 15,
  };
}

export default function () {
  const res = http.post(CHAT_URL, JSON.stringify(uniquePrompt()), params);

  if (res.status === 429) {
    sleep(parseInt(res.headers['Retry-After'] || '3'));
    return;
  }

  check(res, {
    'status 200': (r) => r.status === 200,
    'has content': (r) => r.body && r.body.includes('content'),
  });

  sleep(0.2 + Math.random() * 0.8);
}

export function handleSummary(data) {
  const m = data.metrics;
  const dur = m.http_req_duration?.values ?? {};
  const summary = {
    total_req: m.http_reqs?.values?.count ?? 0,
    req_per_sec: m.http_reqs?.values?.rate?.toFixed(1) ?? 0,
    failed_rate_pct: ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2),
    latency: {
      avg: Math.round(dur.avg ?? 0),
      med: Math.round(dur.med ?? 0),
      p90: Math.round(dur['p(90)'] ?? 0),
      p95: Math.round(dur['p(95)'] ?? 0),
      p99: Math.round(dur['p(99)'] ?? 0),
      max: Math.round(dur.max ?? 0),
    },
    checks: { passed: m.checks?.values?.passes ?? 0, failed: m.checks?.values?.fails ?? 0 },
  };
  return { stdout: JSON.stringify(summary, null, 2) + '\n' };
}
