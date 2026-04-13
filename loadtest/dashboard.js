import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const endpoints = [
  '/',
  '/api/status',
  '/api/providers',
  '/api/trend',
  '/api/uptime',
  '/api/leaderboard',
];

export default function () {
  for (const path of endpoints) {
    const res = http.get(`${BASE_URL}${path}`);
    check(res, {
      [`${path} status 200`]: (r) => r.status === 200,
      [`${path} response time < 2000ms`]: (r) => r.timings.duration < 2000,
    });
    sleep(0.5 + Math.random() * 1.5);
  }
}
