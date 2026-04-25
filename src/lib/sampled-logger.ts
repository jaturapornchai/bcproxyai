/**
 * Sampled logger — keeps the hot request path quiet without losing insight.
 *
 * Three call sites:
 *   • info()  — per-request "REQ" line. 1-in-N sampled (LOG_SAMPLE_RATE).
 *               Always logged when LOG_LEVEL=debug.
 *   • slow()  — emitted from the route only when it has the latency value
 *               and slowness threshold has been crossed. Always logged.
 *   • error() — always logged. Errors must never be sampled.
 *
 * Why: writing 6-10 console.log lines per chat request was inflating
 * latency p99 under load. Sampling cuts I/O while keeping debug visibility.
 *
 * Env knobs:
 *   LOG_LEVEL=debug         — disables sampling (logs every line)
 *   LOG_SAMPLE_RATE=N       — log 1-in-N (default 1 = log everything;
 *                             ในการรัน prod ใส่ 10 หรือ 20)
 */

const LEVEL_DEBUG = process.env.LOG_LEVEL === "debug";

function sampleRate(): number {
  const raw = Number(process.env.LOG_SAMPLE_RATE);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(Math.max(Math.floor(raw), 1), 1000);
}

let counter = 0;
function shouldLogInfo(): boolean {
  if (LEVEL_DEBUG) return true;
  counter = (counter + 1) % sampleRate();
  return counter === 0;
}

export const log = {
  info(line: string): void {
    if (shouldLogInfo()) console.log(line);
  },
  // Reserved for "always-log" debug lines in CI / soak runs
  debug(line: string): void {
    if (LEVEL_DEBUG) console.log(line);
  },
  // Slow-path notices (pass when condition met) — always emit
  slow(line: string): void {
    console.log(line);
  },
  warn(line: string): void {
    console.warn(line);
  },
  error(line: string, err?: unknown): void {
    if (err) console.error(line, err);
    else console.error(line);
  },
};
