import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const options = {
  vus: 1,
  iterations: 150,
  duration: '60s',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const req200 = new Counter('k6_req_200');
const req429 = new Counter('k6_req_429');

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

  if (res.status === 200) {
    req200.add(1);
  } else if (res.status === 429) {
    req429.add(1);
  }

  check(res, {
    'response is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}

export function handleSummary(data) {
  const count200 = data.metrics['k6_req_200'] ? data.metrics['k6_req_200'].values.count : 0;
  const count429 = data.metrics['k6_req_429'] ? data.metrics['k6_req_429'].values.count : 0;

  console.log('=== Rate Limit Summary ===');
  console.log(`200 (success):      ${count200}`);
  console.log(`429 (rate limited): ${count429}`);
  console.log(`Total requests:     ${count200 + count429}`);
  console.log(
    count429 > 100
      ? 'PASS: Rate limiter is working — got >100 rejected requests'
      : 'WARN: Expected >100 rate-limited responses; got ' + count429
  );

  return {};
}
