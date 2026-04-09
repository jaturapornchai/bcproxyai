import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { pickCategory } from './_categories.js';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 100 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<10000'],
    'http_req_failed': ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const chatDuration = new Trend('chat_req_duration', true);

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '30s',
};

export default function () {
  const cat = pickCategory();
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    JSON.stringify(cat.body),
    { ...params, tags: { category: cat.name } },
  );

  chatDuration.add(res.timings.duration);

  check(res, {
    'not a server error': (r) => r.status < 500,
  });
}
