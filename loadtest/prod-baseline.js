import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// Target: production https://smlgateway.smlsoftdemo.com through Cloudflare.
// Two back-to-back profiles: cached (repeat prompt) then uncached (unique).
export const options = {
  scenarios: {
    cached: {
      executor: 'ramping-vus',
      exec: 'cached',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 30 },
        { duration: '40s', target: 60 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
    uncached: {
      executor: 'ramping-vus',
      exec: 'uncached',
      startTime: '1m30s',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '40s', target: 40 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: { 'http_req_failed': ['rate<0.3'] },
};

const URL = 'https://smlgateway.smlsoftdemo.com/v1/chat/completions';
const KEY = __ENV.KEY || '';

const cachedMs = new Trend('cached_ms', true);
const uncachedMs = new Trend('uncached_ms', true);
const cache200 = new Counter('cache_200');
const uncache200 = new Counter('uncache_200');
const r429 = new Counter('r_429');
const r5xx = new Counter('r_5xx');
const rOther = new Counter('r_other');

const params = {
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
  timeout: '30s',
};

export function cached() {
  const body = JSON.stringify({
    model: 'bcai/fast',
    messages: [{ role: 'user', content: 'say hi' }],
    max_tokens: 5,
  });
  const res = http.post(URL, body, params);
  cachedMs.add(res.timings.duration);
  if (res.status === 200) cache200.add(1);
  else if (res.status === 429) r429.add(1);
  else if (res.status >= 500) r5xx.add(1);
  else rOther.add(1);
  check(res, { 'cached ok': (r) => r.status === 200 });
}

export function uncached() {
  const unique = `${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({
    model: 'bcai/fast',
    messages: [{ role: 'user', content: `Reply ok. test ${unique}` }],
    max_tokens: 5,
  });
  const res = http.post(URL, body, params);
  uncachedMs.add(res.timings.duration);
  if (res.status === 200) uncache200.add(1);
  else if (res.status === 429) r429.add(1);
  else if (res.status >= 500) r5xx.add(1);
  else rOther.add(1);
  check(res, { 'uncached ok or 429': (r) => r.status === 200 || r.status === 429 });
}
