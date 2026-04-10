/**
 * Upstream agent for LLM provider calls (SMLGateway).
 *
 * undici 8 custom dispatchers hang on some providers (nvidia confirmed).
 * Node 20's built-in fetch already uses undici internally with keep-alive,
 * so we disable the custom dispatcher and rely on:
 *   - AbortSignal.timeout for per-attempt timeouts (12s non-stream)
 *   - TOTAL_TIMEOUT_MS for overall retry budget
 *   - App-level retry loop (MAX_RETRIES) for retries
 *
 * Callers pass `dispatcher: upstreamAgent` which is now a no-op (undefined
 * dispatcher = Node's default HTTP client). The export exists to avoid
 * changing every callsite.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const upstreamAgent: any = undefined;
