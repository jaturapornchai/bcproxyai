import http from 'k6/http';
import { check, sleep } from 'k6';
import { reportTo } from './_report.js';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 30 },
    { duration: '1m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(95)<5000', 'p(99)<15000'],
    'http_req_failed': ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3334';
const CHAT_URL = `${BASE_URL}/v1/chat/completions`;

const params = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '30s',
};

// Mixed categories so the test exercises Thai / code / tools / vision /
// long-context code paths in roughly equal proportion.
const CATEGORIES = [
  {
    name: 'thai',
    body: () => ({
      model: 'sml/auto',
      messages: [{ role: 'user', content: 'ตอบสั้นๆว่า "สวัสดี" คำเดียว' }],
    }),
  },
  {
    name: 'code',
    body: () => ({
      model: 'sml/auto',
      messages: [
        {
          role: 'user',
          content: 'Write a python one-liner that prints the fibonacci sequence up to n=5.',
        },
      ],
    }),
  },
  {
    name: 'tools',
    body: () => ({
      model: 'sml/auto',
      messages: [
        { role: 'user', content: 'What is the weather in Bangkok? Use tools if needed.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather for a city',
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
  {
    name: 'vision',
    body: () => ({
      model: 'sml/auto',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What colour is this pixel? Answer in one word.' },
            {
              type: 'image_url',
              image_url: {
                url:
                  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
              },
            },
          ],
        },
      ],
    }),
  },
  {
    name: 'long-context',
    body: () => ({
      model: 'sml/auto',
      messages: [
        {
          role: 'user',
          content:
            'Summarize the following text in one short sentence:\n\n' +
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(300),
        },
      ],
    }),
  },
];

export default function () {
  const cat = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const payload = JSON.stringify(cat.body());

  const res = http.post(CHAT_URL, payload, {
    ...params,
    tags: { category: cat.name },
  });

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers['Retry-After'] || '5');
    sleep(retryAfter);
    return;
  }

  check(res, {
    'status 200': (r) => r.status === 200,
    'body contains content': (r) => r.body && r.body.includes('content'),
    'response time < 15s': (r) => r.timings.duration < 15000,
  });

  sleep(1 + Math.random() * 2);
}

export const handleSummary = reportTo(BASE_URL, 'chat');
