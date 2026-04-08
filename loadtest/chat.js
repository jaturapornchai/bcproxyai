import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 30 },
    { duration: '1m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.15'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const payload = JSON.stringify({
  model: 'auto',
  messages: [{ role: 'user', content: 'say hi in 1 word' }],
});

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '20s',
};

export default function () {
  const res = http.post(`${BASE_URL}/v1/chat/completions`, payload, params);

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
