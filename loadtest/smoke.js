import http from 'k6/http';
import { check, sleep } from 'k6';
import { reportTo } from './_report.js';

// Smoke = infra health probe only. Apply strict thresholds to the cheap GET
// routes (homepage + status) which should always be fast and reliable.
// Chat/category coverage lives in chat.js where it can tolerate upstream
// provider variance without poisoning the smoke signal.
export const options = {
  vus: 1,
  duration: '15s',
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<15000'],
    'http_req_failed': ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3334';

export default function () {
  const homepage = http.get(`${BASE_URL}/`);
  check(homepage, {
    'homepage status 200': (r) => r.status === 200,
  });

  const status = http.get(`${BASE_URL}/api/status`);
  check(status, {
    'status endpoint 200': (r) => r.status === 200,
  });

  sleep(1);
}

export const handleSummary = reportTo(BASE_URL, 'smoke');
