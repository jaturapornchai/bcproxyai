# SMLGateway Load Tests

Load testing suite for the SMLGateway gateway using [k6](https://k6.io/).

## Scripts

| Script | Purpose | Duration | Max VUs |
|---|---|---|---|
| `smoke.js` | Sanity check — homepage + /api/status must return 200 | 10s | 1 |
| `dashboard.js` | Simulates users browsing UI endpoints | ~2m | 50 |
| `chat.js` | AI gateway load — POST /v1/chat/completions | ~3.5m | 30 |
| `ratelimit.js` | Proves the Redis rate limiter kicks in after 100 req/60s | 60s | 1 |
| `stress.js` | Ramps to 500 VUs to find the breaking point | ~8.5m | 500 |

## Prerequisites

Install k6:

```bash
# Windows
winget install k6 --source winget

# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo apt install k6
```

Or run via Docker (no install needed):

```bash
docker run --rm -i grafana/k6 run - < loadtest/smoke.js
```

## Baseline URL

All scripts default to `http://localhost:3333` (via in-compose Caddy).  
Override with `BASE_URL`:

```bash
k6 run -e BASE_URL=http://localhost:3333 loadtest/smoke.js
```

## Running the scripts

```bash
# Smoke — quick sanity check
npm run loadtest:smoke
# or: k6 run loadtest/smoke.js

# Dashboard — UI browsing simulation
npm run loadtest:dashboard
# or: k6 run loadtest/dashboard.js

# Chat — AI gateway load
npm run loadtest:chat
# or: k6 run loadtest/chat.js

# Rate limit verification
npm run loadtest:ratelimit
# or: k6 run loadtest/ratelimit.js

# Stress — find the breaking point
npm run loadtest:stress
# or: k6 run loadtest/stress.js
```

## Interpreting output

- **p(95) / p(99)**: 95th / 99th percentile response time. p(95) < 3000ms = 95% of requests completed under 3s.
- **http_req_failed rate**: Fraction of requests that failed (non-2xx or network error). Lower is better.
- **checks%**: Percentage of inline `check()` assertions that passed. Should be close to 100%.

## Gotchas

- `chat.js` will hit the Redis rate limiter (100 req/60s per IP) during longer runs — this is expected, not a bug. On 429 responses the script backs off using the `Retry-After` header.
- `ratelimit.js` intentionally fires 150 requests into the rate limiter to prove it works; expect the summary to report >100 rejected requests.
- **The gateway forwards to real LLM providers — running `chat.js` and `stress.js` consumes provider quota. Use `smoke`, `dashboard`, and `ratelimit` for free testing.**
- Results are written to `loadtest/results/` and `loadtest/summary.html` (gitignored).
