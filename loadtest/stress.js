import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { reportTo } from './_report.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3334';
const CHAT_URL = `${BASE_URL}/v1/chat/completions`;

const chatDuration = new Trend('chat_req_duration', true);

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '60s',
};

// --- payload builders by size -------------------------------------------------
const SMALL = 'say hi in 1 word'; // ~16 chars
const MEDIUM = 'Please summarize the following paragraph in one sentence:\n\n' +
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(35); // ~2K
const LARGE = 'Please summarize the following document in one sentence:\n\n' +
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(175); // ~10K

function body(content, extra = {}) {
  return JSON.stringify({
    model: 'sml/auto',
    messages: [{ role: 'user', content }],
    ...extra,
  });
}

// Category variants for mixed traffic (thai / code / tools / long-context)
const CATEGORIES = [
  { name: 'small', payload: body(SMALL) },
  { name: 'thai', payload: body('ตอบสั้นๆ ว่า "สวัสดี"') },
  {
    name: 'code',
    payload: body('Write a python one-liner that reverses a string.'),
  },
  {
    name: 'tools',
    payload: body('What time is it in Tokyo? Use a tool if available.', {
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_time',
            description: 'Get current time for a city',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
    }),
  },
  { name: 'long-context', payload: body(LARGE) },
];

const HEDGE_SIZES = [
  { name: 'small', payload: body(SMALL) },
  { name: 'medium', payload: body(MEDIUM) },
  { name: 'large', payload: body(LARGE) },
];

export const options = {
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<15000'],
    'http_req_failed': ['rate<0.02'],
  },
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      exec: 'ramp',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '2m', target: 100 },
        { duration: '1m', target: 300 },
        { duration: '2m', target: 300 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    // Fires small/medium/large payloads concurrently to exercise the hedge
    // path from multiple payload-size angles at once.
    hedge_stress: {
      executor: 'constant-vus',
      exec: 'hedgeMixed',
      vus: 60,
      duration: '8m',
      startTime: '30s',
      gracefulStop: '30s',
    },
  },
};

export function ramp() {
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const res = http.post(CHAT_URL, cat.payload, {
    ...params,
    tags: { category: cat.name, scenario: 'ramp' },
  });
  chatDuration.add(res.timings.duration);
  check(res, {
    'not a server error': (r) => r.status < 500,
  });
}

// Each VU rotates through small/medium/large so all three sizes are in-flight
// concurrently across the fleet.
export function hedgeMixed() {
  const pick = HEDGE_SIZES[(__ITER + __VU) % HEDGE_SIZES.length];
  const res = http.post(CHAT_URL, pick.payload, {
    ...params,
    tags: { size: pick.name, scenario: 'hedge_stress' },
  });
  chatDuration.add(res.timings.duration);
  check(res, {
    'not a server error': (r) => r.status < 500,
    'hedge status 200': (r) => r.status === 200,
  });
}

export const handleSummary = reportTo(BASE_URL, 'stress');
