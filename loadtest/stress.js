import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 300 },
    { duration: '2m', target: 300 },
    { duration: '1m', target: 500 },
    { duration: '1m', target: 500 },
    { duration: '30s', target: 0 },
  ],
  // No strict thresholds — goal is to observe where errors start
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3333';

const chatDuration = new Trend('chat_req_duration', true);

const payload = JSON.stringify({
  model: 'auto',
  messages: [{ role: 'user', content: 'say hi in 1 word' }],
});

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '30s',
};

export default function () {
  const res = http.post(`${BASE_URL}/v1/chat/completions`, payload, params);

  chatDuration.add(res.timings.duration);

  check(res, {
    'not a server error': (r) => r.status < 500,
  });
}
