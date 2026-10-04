import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Uncached: unique prompt per (VU, iter) to force upstream call each time.
// This measures the real gateway+upstream ceiling.
export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '60s', target: 40 },
    { duration: '20s', target: 0 },
  ],
  thresholds: { 'http_req_failed': ['rate<0.3'] },
};

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3334';
const CHAT_URL = `${BASE_URL}/v1/chat/completions`;

const chatMs = new Trend('chat_ms', true);
const c200 = new Counter('k6_200');
const c429 = new Counter('k6_429');
const c5xx = new Counter('k6_5xx');
const cOther = new Counter('k6_other');

export default function () {
  const unique = `${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    model: 'bcai/fast',
    messages: [{ role: 'user', content: `Reply with only the word "ok" for test ${unique}` }],
    max_tokens: 5,
  });
  const res = http.post(CHAT_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  });
  chatMs.add(res.timings.duration);
  if (res.status === 200) c200.add(1);
  else if (res.status === 429) c429.add(1);
  else if (res.status >= 500) c5xx.add(1);
  else cOther.add(1);
  check(res, { 'ok or known-fail': (r) => r.status === 200 || r.status === 429 || r.status === 503 });
}
