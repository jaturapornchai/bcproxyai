import { getRedis } from "./redis";

// ───────────────────────────────────────────────────────────────
// Cumulative battle score for the Mascot Theater
//
// Every gateway event (success or failure) maps to points for either
// the hero (🦸 SMLGateway) or the villain (👿 Latency/Failure). We store
// running totals in Redis so they persist across restarts.
//
// Redis keys:
//   battle:hero:score     — cumulative hero points
//   battle:villain:score  — cumulative villain points
//   battle:hero:wins      — count of hero-winning events (epic|win)
//   battle:villain:wins   — count of villain-winning events (fail)
//   battle:total          — total events counted
// ───────────────────────────────────────────────────────────────

export type BattleOutcome = "epic" | "win" | "fail" | "neutral";

export function outcomeFromLatency(
  latencyMs: number,
  ok: boolean,
): BattleOutcome {
  if (!ok) return "fail";
  if (latencyMs <= 1500) return "epic";
  if (latencyMs <= 4000) return "win";
  return "neutral"; // thinking/slow — no score change
}

const POINTS: Record<BattleOutcome, { hero: number; villain: number }> = {
  epic:    { hero: 10, villain: 0 },  // critical hit
  win:     { hero: 5,  villain: 0 },  // normal victory
  fail:    { hero: 0,  villain: 5 },  // villain strike
  neutral: { hero: 0,  villain: 0 },
};

export async function recordBattleEvent(outcome: BattleOutcome): Promise<void> {
  if (outcome === "neutral") return;
  try {
    const redis = getRedis();
    const pts = POINTS[outcome];
    const pipe = redis.pipeline();
    pipe.incrby("battle:hero:score",    pts.hero);
    pipe.incrby("battle:villain:score", pts.villain);
    pipe.incr("battle:total");
    if (outcome === "epic" || outcome === "win") {
      pipe.incr("battle:hero:wins");
    } else if (outcome === "fail") {
      pipe.incr("battle:villain:wins");
    }
    await pipe.exec();
  } catch {
    // silent — score is cosmetic, never block a real request
  }
}

export interface BattleScore {
  hero: number;
  villain: number;
  heroWins: number;
  villainWins: number;
  total: number;
  winRate: number; // hero win % (0-100)
}

export async function getBattleScore(): Promise<BattleScore> {
  try {
    const redis = getRedis();
    const [hero, villain, heroWins, villainWins, total] = await Promise.all([
      redis.get("battle:hero:score"),
      redis.get("battle:villain:score"),
      redis.get("battle:hero:wins"),
      redis.get("battle:villain:wins"),
      redis.get("battle:total"),
    ]);
    const h = Number(hero ?? 0);
    const v = Number(villain ?? 0);
    const hw = Number(heroWins ?? 0);
    const vw = Number(villainWins ?? 0);
    const t = Number(total ?? 0);
    const winRate = t > 0 ? Math.round((hw / t) * 100) : 0;
    return { hero: h, villain: v, heroWins: hw, villainWins: vw, total: t, winRate };
  } catch {
    return { hero: 0, villain: 0, heroWins: 0, villainWins: 0, total: 0, winRate: 0 };
  }
}
