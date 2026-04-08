import { Agent, setGlobalDispatcher } from "undici";

/**
 * Shared HTTP agent for all LLM provider upstream calls.
 * - 128 connections per origin so multiple in-flight calls to the same provider don't queue
 * - 30s keep-alive so batches inside the same minute reuse the TLS handshake
 * - 5s connect timeout so dead providers fail fast instead of hanging
 *
 * Registered as the global dispatcher so all fetch() calls automatically use it
 * (Node.js built-in fetch forwards to undici under the hood).
 */
export const upstreamAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 128,
  connect: { timeout: 5_000 },
  pipelining: 0, // safe default for chat APIs that may stream
});

// Register globally — applies to all fetch() calls in this process
setGlobalDispatcher(upstreamAgent);
