import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Quick baseline: ramp to 60 VUs in 30s, hold 60s, cooldown 30s. ≈ 2 min total.
// Designed to measure the sustained RPS ceiling of the *gateway path* (not the
// upstream model's real latency) — so we send the cheapest possible prompt.

export const options = {
  stages: [
    { duration: '30s', target: 30 },
    { duration: '30s', target: 60 },
    { duration: '30s', target: 60 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_failed': ['rate<0.1'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3334';
const CHAT_URL = `${BASE_URL}/v1/chat/completions`;

const chatDuration = new Trend('chat_ms', true);
const req200 = new Counter('k6_req_200');
const req429 = new Counter('k6_req_429');
const req5xx = new Counter('k6_req_5xx');

const payload = JSON.stringify({
  model: 'bcai/fast',
  messages: [{ role: 'user', content: 'say hi' }],
  max_tokens: 5,
});

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '30s',
};

export default function () {
  const res = http.post(CHAT_URL, payload, params);
  chatDuration.add(res.timings.duration);
  if (res.status === 200) req200.add(1);
  else if (res.status === 429) req429.add(1);
  else if (res.status >= 500) req5xx.add(1);
  check(res, { 'status ok or 429': (r) => r.status === 200 || r.status === 429 });
}
