import http from 'k6/http';
import { check, sleep } from 'k6';
import { reportTo } from './_report.js';
import { pickCategory } from './_categories.js';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<15000'],
    'http_req_failed': ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '30s',
};

export default function () {
  const homepage = http.get(`${BASE_URL}/`);
  check(homepage, {
    'homepage status 200': (r) => r.status === 200,
  });

  const status = http.get(`${BASE_URL}/api/status`);
  check(status, {
    'status endpoint 200': (r) => r.status === 200,
  });

  const cat = pickCategory();
  const res = http.post(
    `${BASE_URL}/v1/chat/completions`,
    JSON.stringify(cat.body),
    { ...params, tags: { category: cat.name } },
  );
  check(res, {
    'chat status 200': (r) => r.status === 200,
    'chat body has content': (r) => r.body && r.body.includes('content'),
  });

  sleep(1);
}

export const handleSummary = reportTo(BASE_URL, 'smoke');
