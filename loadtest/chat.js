import http from 'k6/http';
import { check, sleep } from 'k6';
import { pickCategory } from './_categories.js';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<15000'],
    'http_req_failed': ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '20s',
};

export default function () {
  const cat = pickCategory();
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    JSON.stringify(cat.body),
    { ...params, tags: { category: cat.name } },
  );

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers['Retry-After'] || '5');
    sleep(retryAfter);
    return;
  }

  check(res, {
    'status 200': (r) => r.status === 200,
    'body contains content': (r) => r.body && r.body.includes('content'),
    'response time < 15s': (r) => r.timings.duration < 15000,
  });

  sleep(1 + Math.random() * 2);
}
