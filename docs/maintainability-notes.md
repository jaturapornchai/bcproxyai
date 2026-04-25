# Performance & maintainability — current state

## Files of note

### `src/app/v1/chat/completions/route.ts` — 2,561 lines

The single hottest file in the gateway. Holds the entire chat-completions
request lifecycle: parsing, model selection, candidate filtering, hedging,
streaming, retries, circuit breaking, sticky routing, gateway logging,
cooldown bookkeeping, Ollama-loaded probe.

The `POST` handler runs from line 1185 to 2456 (~1,270 lines).

Helpers grouped by concern (already in this file):

| Concern | Helpers |
|---------|---------|
| Provider memory state | `recordProviderAttempt`, `recordProviderSuccess`, `recordProviderFailureMem`, `recordProviderRateLimitHit`, `setProviderCooldownMem`, `isProviderCooledDownMem` |
| Circuit breaker | `isCircuitOpen`, `recordCircuitProbeResult`, `recordCircuitFailure` |
| Model selection | `getAvailableModels`, `getAllModelsIncludingCooldown`, `selectModelsByMode`, `reorderForLatency` |
| Capabilities + budget | `detectRequestCapabilities`, `estimateTokens`, `modelListCacheKey` |
| Sticky routing | `stickyKey`, `getSticky`, `setSticky` |
| Logging | `flushGatewayLogs`, `logGateway`, `extractUserMessage`, `logCooldown`, `cooldownProvider` |
| Forwarding | `forwardToProvider`, `hedgeRace`, `streamHedgeRace` |
| Response | `buildProxiedResponse`, `isResponseBad`, `cleanResponseContent`, `isRetryableStatus` |
| Provider quirks | `patchMistralMessageOrder`, `isOllamaModelLoaded` |

### Refactor candidates (low-risk, do later)

These groups have well-defined inputs/outputs and minimal coupling to the
hot path. Splitting them reduces the file size without changing behavior:

- `recordProviderAttempt` / `recordProviderSuccess` / `recordProviderFailureMem` / `recordProviderRateLimitHit` / `setProviderCooldownMem` / `isProviderCooledDownMem` → `src/lib/gateway/provider-state.ts`
- `isCircuitOpen` / `recordCircuitProbeResult` / `recordCircuitFailure` → `src/lib/gateway/circuit.ts`
- `flushGatewayLogs` / `logGateway` / `extractUserMessage` → `src/lib/gateway/log.ts`
- `stickyKey` / `getSticky` / `setSticky` → `src/lib/gateway/sticky.ts`
- `detectRequestCapabilities` / `estimateTokens` / `modelListCacheKey` → `src/lib/gateway/capabilities.ts`

Keep these in the route file for now (do not refactor in the same PR
that ships unrelated changes):

- `forwardToProvider` (~240 lines) — central path, deeply tied to the
  request/response cycle
- `hedgeRace` / `streamHedgeRace` — talk to forwardToProvider via closure
- `buildProxiedResponse` — uses request-scoped streams
- `selectModelsByMode` / `reorderForLatency` — depend on filtered model
  arrays built inline in `POST`

### Method

When extracting a helper:

1. Do it in a dedicated PR with no behavior change.
2. Run `npm run loadtest:smoke` before/after — p50/p95/p99 must stay flat.
3. The route file shrinks; functionality stays in one place at runtime.

## Other files

- `src/lib/cache.ts` — bounded by `CACHE_MAX_ENTRIES` (default 2,000;
  range 100–100,000). LRU-ish via Map insertion-order bumping.
- `src/lib/db/client.ts` — `PG_POOL_MAX` (default 20; range 1–200),
  `PG_IDLE_TIMEOUT_SEC` (default 30), `PG_CONNECT_TIMEOUT_SEC` (default 10).
- `src/lib/worker/leader.ts` — fail-closed in production when Redis is
  unreachable. Override with `WORKER_LEADER_FAIL_OPEN=1`. Default-open
  outside production for ergonomic dev.
- `src/proxy.ts` — `SENSITIVE_GET_PREFIXES` gates `/api/gateway-logs`,
  `/v1/trace/`, `/api/dev-suggestions`, `/api/k6-report`, `/api/infra`
  behind master Bearer / admin cookie / owner Google session.
