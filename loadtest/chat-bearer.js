import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '40s', target: 10 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<15000'],
    'http_req_failed': ['rate<0.10'],
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

const CATEGORIES = [
  { name: 'thai', body: () => ({
    model: 'bcai/auto',
    messages: [{ role: 'user', content: 'ตอบสั้นๆว่า "สวัสดี" คำเดียว' }],
    max_tokens: 10,
  }) },
  { name: 'code', body: () => ({
    model: 'bcai/auto',
    messages: [{ role: 'user', content: 'Reverse a string in Python one-liner.' }],
    max_tokens: 30,
  }) },
  { name: 'simple', body: () => ({
    model: 'bcai/auto',
    messages: [{ role: 'user', content: 'What is 2+2? Just the number.' }],
    max_tokens: 5,
  }) },
  { name: 'uniq-' + Math.random(), body: () => ({
    model: 'bcai/auto',
    messages: [{ role: 'user', content: `Random number: ${Math.random()}. Say hi.` }],
    max_tokens: 10,
  }) },
];

export default function () {
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const payload = JSON.stringify(cat.body());

  const res = http.post(CHAT_URL, payload, {
    ...params,
    tags: { category: cat.name },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers['Retry-After'] || '5');
    sleep(retryAfter);
    return;
  }

  check(res, {
    'status 200': (r) => r.status === 200,
    'has content': (r) => r.body && r.body.includes('content'),
  });

  sleep(0.5 + Math.random());
}

export function handleSummary(data) {
  const m = data.metrics;
  const summary = {
    total: m.http_reqs?.values?.count ?? 0,
    failed_rate: m.http_req_failed?.values?.rate ?? 0,
    duration: {
      avg: m.http_req_duration?.values?.avg ?? 0,
      p50: m['http_req_duration']?.values?.['med'] ?? 0,
      p95: m['http_req_duration']?.values?.['p(95)'] ?? 0,
      p99: m['http_req_duration']?.values?.['p(99)'] ?? 0,
      max: m.http_req_duration?.values?.max ?? 0,
    },
    checks: {
      passed: m.checks?.values?.passes ?? 0,
      failed: m.checks?.values?.fails ?? 0,
    },
  };
  return { stdout: JSON.stringify(summary, null, 2) + '\n' };
}
