"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAdminAccess } from "./admin-access";

// Hero vs Villain combat scene
// sceneToken changes every scene → re-mounts → replays animations
function BattleScene({ kind, sceneToken }: { kind: SceneKind; sceneToken: string }) {
  const heroAttacking = kind === "epic" || kind === "win";
  const villainAttacking = kind === "fail";
  const showAction = heroAttacking || villainAttacking;

  // Animation class per role
  const heroAnim = heroAttacking
    ? "animate-hero-strike"
    : villainAttacking
    ? "animate-hero-recoil"
    : "animate-idle-hero";

  const villainAnim = villainAttacking
    ? "animate-villain-strike"
    : heroAttacking
    ? "animate-villain-recoil"
    : "animate-idle-villain";

  // Damage number — shows on the LOSER of the exchange
  const damage =
    kind === "epic" ? { value: "-99!", color: "#00ff41", side: "villain" as const, cry: "💥 CRITICAL!" }
    : kind === "win" ? { value: "-40", color: "#84ff6b", side: "villain" as const, cry: "⚔️ STRIKE!" }
    : kind === "fail" ? { value: "-55", color: "#ff3355", side: "hero" as const, cry: "💢 IMPACT!" }
    : null;

  const clashColor = villainAttacking ? "rgba(255,0,51,0.95)" : "rgba(0,255,65,0.95)";
  const clashSecond = villainAttacking ? "rgba(255,120,120,0.5)" : "rgba(180,255,200,0.5)";

  return (
    <div className="absolute inset-0 pointer-events-none z-[5] overflow-hidden">
      {/* Speed lines radiating when someone attacks */}
      {showAction && (
        <div className="absolute inset-0" key={`speed-${sceneToken}`}>
          {[...Array(6)].map((_, i) => {
            const top = 20 + i * 12;
            const delay = i * 30;
            return (
              <div
                key={i}
                className="absolute left-0 right-0 h-0.5 animate-speed-line origin-left"
                style={{
                  top: `${top}%`,
                  background: `linear-gradient(90deg, transparent 0%, ${heroAttacking ? "#00ff41" : "#ff0033"} 50%, transparent 100%)`,
                  animationDelay: `${delay}ms`,
                  opacity: 0.5,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Hero — left side */}
      <div
        key={`hero-${sceneToken}`}
        className={`absolute bottom-0 left-4 sm:left-16 h-[92%] ${heroAnim}`}
        style={{ transformOrigin: "bottom center" }}
      >
        <img src="/hero.svg" alt="Hero" className="h-full" />
      </div>

      {/* Villain — right side (wrapper animates, img is flipped inside) */}
      <div
        key={`villain-${sceneToken}`}
        className={`absolute bottom-0 right-4 sm:right-16 h-[92%] ${villainAnim}`}
        style={{ transformOrigin: "bottom center" }}
      >
        <img src="/villain.svg" alt="Villain" className="h-full" style={{ transform: "scaleX(-1)" }} />
      </div>

      {/* Clash burst in the center */}
      {showAction && (
        <div
          key={`clash-${sceneToken}`}
          className="absolute top-1/2 left-1/2 animate-clash"
          style={{
            width: 160,
            height: 160,
            marginLeft: -80,
            marginTop: -80,
            background: `radial-gradient(circle, ${clashColor} 0%, ${clashSecond} 35%, transparent 70%)`,
            filter: "blur(1px)",
          }}
        />
      )}

      {/* Shockwave ring */}
      {showAction && (
        <div
          key={`ring-${sceneToken}`}
          className="absolute top-1/2 left-1/2 rounded-full animate-shockwave"
          style={{
            width: 100,
            height: 100,
            marginLeft: -50,
            marginTop: -50,
            border: `4px solid ${clashColor}`,
            boxShadow: `0 0 20px ${clashColor}, inset 0 0 20px ${clashColor}`,
          }}
        />
      )}

      {/* Radiating sparks */}
      {showAction && (
        <div className="absolute top-1/2 left-1/2" key={`sparks-${sceneToken}`}>
          {[...Array(12)].map((_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const dist = 100 + (i % 3) * 20;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            return (
              <span
                key={i}
                className="absolute w-1.5 h-1.5 rounded-full animate-spark"
                style={{
                  background: clashColor,
                  boxShadow: `0 0 8px ${clashColor}, 0 0 16px ${clashColor}`,
                  ["--dx" as string]: `${dx}px`,
                  ["--dy" as string]: `${dy}px`,
                  animationDelay: `${i * 25}ms`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* Battle cry — big text in the center */}
      {damage && (
        <div
          key={`cry-${sceneToken}`}
          className="absolute top-[38%] left-1/2 font-black text-2xl sm:text-4xl animate-battle-cry tracking-wider z-[8]"
          style={{
            color: damage.color,
            textShadow: `0 0 12px ${damage.color}, 0 0 24px ${damage.color}, 2px 2px 0 rgba(0,0,0,0.8)`,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {damage.cry}
        </div>
      )}

      {/* Damage number — pops on the loser */}
      {damage && (
        <div
          key={`dmg-${sceneToken}`}
          className="absolute top-1/3 font-black text-3xl sm:text-5xl animate-damage tracking-tight"
          style={{
            color: damage.color,
            textShadow: `0 0 16px ${damage.color}, 0 0 32px ${damage.color}, 3px 3px 0 rgba(0,0,0,0.9)`,
            left: damage.side === "villain" ? "78%" : "22%",
            fontFamily: "ui-monospace, monospace",
            zIndex: 8,
          }}
        >
          {damage.value}
        </div>
      )}
    </div>
  );
}

// Matrix digital rain — Thai characters falling on canvas
function MatrixRain({ intensity = 1 }: { intensity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);

  // Keep ref in sync without restarting the animation loop
  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  // Empty deps: mount once, never restart on intensity change
  // (intensity is read from ref inside the animation loop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastDraw = 0;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * window.devicePixelRatio);
      canvas.height = Math.floor(height * window.devicePixelRatio);
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Thai consonants + numerals + a few latin/katakana for variety
    const thai = "กขคงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ๐๑๒๓๔๕๖๗๘๙";
    const katakana = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ";
    const chars = (thai + thai + katakana).split("");

    const fontSize = 14;
    let cols = 0;
    let drops: number[] = [];

    const initDrops = () => {
      const w = canvas.getBoundingClientRect().width;
      cols = Math.floor(w / fontSize);
      drops = Array(cols).fill(0).map(() => Math.random() * 30);
    };
    initDrops();
    const ro2 = new ResizeObserver(initDrops);
    ro2.observe(canvas);

    const draw = (t: number) => {
      const dt = t - lastDraw;
      if (dt < 60 / intensityRef.current) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastDraw = t;

      const { width, height } = canvas.getBoundingClientRect();
      // Trail fade
      ctx.fillStyle = "rgba(0, 8, 0, 0.12)";
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${fontSize}px ui-monospace, monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < cols; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Head of column = bright white-green
        ctx.fillStyle = "rgba(220, 255, 220, 0.95)";
        ctx.fillText(ch, x, y);

        // Trail behind = dimmer green
        ctx.fillStyle = "rgba(0, 255, 65, 0.55)";
        if (drops[i] > 1) {
          ctx.fillText(
            chars[Math.floor(Math.random() * chars.length)],
            x,
            y - fontSize,
          );
        }

        // Reset with random chance once past bottom
        if (y > height && Math.random() > 0.965) {
          drops[i] = 0;
        }
        drops[i] += 1;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ro2.disconnect();
    };
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    />
  );
}

// ───────────────────────────────────────────────────────────────
// Live Mascot Theater
// Reads real activity from /api/gateway-logs (สมุดจดงาน)
// and turns each event into an animated cartoon scene
// starring น้องกุ้ง 🦐 + OpenClaw 🦞
// ───────────────────────────────────────────────────────────────

interface GatewayLog {
  id: number;
  provider: string;
  resolvedModel: string | null;
  status: number;
  latencyMs: number;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

type SceneKind = "idle" | "thinking" | "win" | "slow" | "fail" | "epic" | "study";

interface Scene {
  kind: SceneKind;
  provider: string;
  model: string;
  latencyMs: number;
  caption: string;
  bg: string;
}

const SHORT_PROVIDER: Record<string, string> = {
  openrouter: "OpenRouter", groq: "Groq", cerebras: "Cerebras",
  mistral: "Mistral", sambanova: "SambaNova", ollama: "Ollama", google: "Google",
};

function pickScene(log: GatewayLog): Scene {
  const provider = log.provider || "?";
  const model = log.resolvedModel ?? "?";
  const latencyMs = log.latencyMs ?? 0;
  const ok = log.status >= 200 && log.status < 300 && !log.error;
  const display = SHORT_PROVIDER[provider] ?? provider;

  if (!ok) {
    return {
      kind: "fail",
      provider, model, latencyMs,
      caption: `😭 ${display} สอบตก! (${log.status || "error"})`,
      bg: "from-rose-600/30 via-red-700/20 to-rose-900/30",
    };
  }
  if (latencyMs <= 1500) {
    return {
      kind: "epic",
      provider, model, latencyMs,
      caption: `🚀 ${display} ตอบเร็วเหมือนจรวด! (${(latencyMs / 1000).toFixed(1)}s)`,
      bg: "from-emerald-500/30 via-yellow-400/20 to-amber-500/30",
    };
  }
  if (latencyMs <= 4000) {
    return {
      kind: "win",
      provider, model, latencyMs,
      caption: `🏆 ${display} ทำเสร็จเรียบร้อย! (${(latencyMs / 1000).toFixed(1)}s)`,
      bg: "from-emerald-500/25 via-cyan-500/15 to-teal-500/25",
    };
  }
  if (latencyMs <= 10000) {
    return {
      kind: "thinking",
      provider, model, latencyMs,
      caption: `🤔 ${display} กำลังคิดหนัก... (${(latencyMs / 1000).toFixed(1)}s)`,
      bg: "from-sky-500/25 via-indigo-500/15 to-violet-500/25",
    };
  }
  return {
    kind: "slow",
    provider, model, latencyMs,
    caption: `😴 ${display} ใช้เวลานาน ${(latencyMs / 1000).toFixed(1)}s`,
    bg: "from-orange-500/25 via-amber-600/15 to-yellow-700/25",
  };
}

const IDLE_SCENE: Scene = {
  kind: "idle",
  provider: "",
  model: "",
  latencyMs: 0,
  caption: "🦐 น้องกุ้งกับ 🦞 OpenClaw นั่งรอเด็กมาส่งการบ้าน...",
  bg: "from-indigo-500/20 via-purple-500/10 to-cyan-500/20",
};

// Render the cartoon character set for each scene kind
// SceneCharacters removed — Hero vs Villain SVG fighters replaced the emoji cast

// Stat badge with count-up
function useCountUp(target: number, duration = 800): number {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (target === prev.current) return;
    const start = performance.now();
    const from = prev.current;
    let raf = 0;
    const tick = (t: number) => {
      const pct = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - pct, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (pct < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

// Confetti particle layer — only renders when scene.kind is win/epic
function Confetti({ active }: { active: boolean }) {
  if (!active) return null;
  const pieces = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map(i => {
        const left = (i * 7 + 5) % 100;
        const delay = (i * 80) % 1500;
        const dur = 1800 + (i * 90) % 800;
        const colors = ["#fb923c", "#34d399", "#3b82f6", "#f43e5e", "#a855f7", "#facc15"];
        const color = colors[i % colors.length];
        return (
          <span
            key={i}
            className="absolute top-0 text-sm animate-confetti"
            style={{
              left: `${left}%`,
              color,
              animationDelay: `${delay}ms`,
              animationDuration: `${dur}ms`,
            }}
          >
            {i % 3 === 0 ? "✦" : i % 3 === 1 ? "●" : "▲"}
          </span>
        );
      })}
    </div>
  );
}

// Tear-rain layer for fail scenes
function TearRain({ active }: { active: boolean }) {
  if (!active) return null;
  const drops = Array.from({ length: 14 }, (_, i) => i);
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {drops.map(i => {
        const left = (i * 9 + 3) % 100;
        const delay = (i * 130) % 1500;
        return (
          <span
            key={i}
            className="absolute top-0 text-xs text-sky-400 animate-confetti"
            style={{ left: `${left}%`, animationDelay: `${delay}ms`, animationDuration: "1500ms" }}
          >
            💧
          </span>
        );
      })}
    </div>
  );
}

interface BattleScore {
  hero: number;
  villain: number;
  heroWins: number;
  villainWins: number;
  total: number;
  winRate: number;
}

// Cumulative scoreboard — running totals from Redis, persisted across restarts
function BattleScoreboard({ score }: { score: BattleScore }) {
  const heroPct = score.hero + score.villain > 0
    ? Math.round((score.hero / (score.hero + score.villain)) * 100)
    : 50;
  const heroLeading = score.hero >= score.villain;

  return (
    <div
      className="rounded-xl border border-emerald-500/30 bg-black px-4 py-2.5 font-mono text-xs sm:text-sm"
      style={{
        boxShadow: "0 0 16px rgba(0, 255, 65, 0.1), inset 0 0 24px rgba(0, 0, 0, 0.6)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Hero side */}
        <div className="flex items-center gap-2 flex-1">
          <span className="text-2xl">🦸</span>
          <div className="flex flex-col leading-tight">
            <span className="text-[9px] uppercase tracking-wider text-emerald-500/70">HERO</span>
            <span
              className="text-2xl sm:text-3xl font-black tabular-nums text-emerald-300"
              style={{ textShadow: "0 0 8px rgba(0,255,65,0.7)" }}
            >
              {score.hero.toLocaleString()}
            </span>
            <span className="text-[10px] text-emerald-500/60">{score.heroWins} wins</span>
          </div>
        </div>

        {/* Center — VS + win rate */}
        <div className="flex flex-col items-center gap-1 px-2">
          <span className="text-[10px] uppercase tracking-[0.3em] text-amber-400/80">VS</span>
          <span
            className={`text-lg font-black ${heroLeading ? "text-emerald-300" : "text-rose-400"}`}
            style={{
              textShadow: heroLeading
                ? "0 0 8px rgba(0,255,65,0.7)"
                : "0 0 8px rgba(255,0,51,0.7)",
            }}
          >
            {heroPct}%
          </span>
          <span className="text-[9px] text-gray-500">{score.total} battles</span>
        </div>

        {/* Villain side */}
        <div className="flex items-center gap-2 flex-1 justify-end">
          <div className="flex flex-col leading-tight items-end">
            <span className="text-[9px] uppercase tracking-wider text-rose-500/70">VILLAIN</span>
            <span
              className="text-2xl sm:text-3xl font-black tabular-nums text-rose-400"
              style={{ textShadow: "0 0 8px rgba(255,0,51,0.7)" }}
            >
              {score.villain.toLocaleString()}
            </span>
            <span className="text-[10px] text-rose-500/60">{score.villainWins} wins</span>
          </div>
          <span className="text-2xl">👿</span>
        </div>
      </div>

      {/* Win-rate bar */}
      <div className="mt-2 h-1.5 w-full bg-black rounded-full overflow-hidden border border-white/5">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 transition-all duration-700"
          style={{
            width: `${heroPct}%`,
            boxShadow: "0 0 8px rgba(0,255,65,0.6)",
          }}
        />
      </div>
    </div>
  );
}

export function MascotScene() {
  const [logs, setLogs] = useState<GatewayLog[]>([]);
  const [score, setScore] = useState<BattleScore | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Poll real logs + battle score every 5 seconds
  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      try {
        if (!(await getAdminAccess())) {
          if (alive) {
            setLogs([]);
            setScore(null);
          }
          return;
        }
        const [logsRes, infraRes] = await Promise.all([
          fetch("/api/gateway-logs?limit=12"),
          fetch("/api/infra"),
        ]);
        if (!alive) return;
        if (logsRes.ok) {
          const data = await logsRes.json();
          if (alive && Array.isArray(data.logs)) setLogs(data.logs);
        }
        if (infraRes.ok) {
          const infra = await infraRes.json();
          if (alive && infra.battle) setScore(infra.battle as BattleScore);
        }
      } catch { /* silent */ }
    };
    fetchAll();
    const t = window.setInterval(fetchAll, 5000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  // Build scene queue from real logs
  const scenes = useMemo<Scene[]>(() => {
    if (logs.length === 0) return [IDLE_SCENE];
    return logs.slice(0, 8).map(pickScene);
  }, [logs]);

  // Cycle through scenes every 4.5s (unless paused)
  useEffect(() => {
    if (paused || scenes.length <= 1) return;
    const t = window.setInterval(() => {
      setSceneIdx(i => (i + 1) % scenes.length);
    }, 4500);
    return () => window.clearInterval(t);
  }, [paused, scenes.length]);

  // Reset index when scene list changes shape
  useEffect(() => {
    if (sceneIdx >= scenes.length) setSceneIdx(0);
  }, [scenes.length, sceneIdx]);

  const scene = scenes[sceneIdx] ?? IDLE_SCENE;

  // Today's stats from logs (rough — uses fetched window only)
  const stats = useMemo(() => {
    const total = logs.length;
    const success = logs.filter(l => l.status >= 200 && l.status < 300 && !l.error).length;
    const fail = total - success;
    const avgLatency =
      total > 0 ? Math.round(logs.reduce((a, b) => a + (b.latencyMs ?? 0), 0) / total) : 0;
    // Top provider by count
    const counts = new Map<string, number>();
    for (const l of logs) counts.set(l.provider, (counts.get(l.provider) ?? 0) + 1);
    let top = "—"; let topN = 0;
    for (const [p, n] of counts) if (n > topN) { top = p; topN = n; }
    return { total, success, fail, avgLatency, top };
  }, [logs]);

  const animTotal = useCountUp(stats.total);
  const animSuccess = useCountUp(stats.success);
  const animFail = useCountUp(stats.fail);

  // Matrix rain intensity reacts to scene mood
  const intensity =
    scene.kind === "epic" || scene.kind === "win" ? 1.6
    : scene.kind === "fail" ? 1.8
    : scene.kind === "thinking" || scene.kind === "slow" ? 0.6
    : 1;

  return (
    <div className="space-y-3 font-mono">
      {/* Cumulative battle scoreboard */}
      {score && score.total > 0 && <BattleScoreboard score={score} />}

      {/* Stage — Thai Matrix style */}
      <div
        className="relative h-60 sm:h-72 rounded-2xl overflow-hidden cursor-pointer select-none border border-emerald-500/40 bg-black"
        onClick={() => setSceneIdx(i => (i + 1) % Math.max(scenes.length, 1))}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        title="[ คลิกเพื่อข้ามฉาก · hover เพื่อหยุด ]"
        style={{
          boxShadow: "0 0 24px rgba(0, 255, 65, 0.15), inset 0 0 60px rgba(0, 255, 65, 0.08)",
        }}
      >
        {/* Matrix digital rain background */}
        <MatrixRain intensity={intensity} />

        {/* Hero vs Villain battle layer */}
        <BattleScene kind={scene.kind} sceneToken={`${sceneIdx}-${scene.kind}-${scene.provider}`} />

        {/* CRT scanlines overlay */}
        <div
          className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-40"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(0,255,65,0.06) 0px, rgba(0,255,65,0.06) 1px, transparent 1px, transparent 3px)",
          }}
        />

        {/* Vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
          }}
        />

        {/* Live indicator (top-left) */}
        <div className="absolute top-3 left-4 flex items-center gap-2 text-[10px] z-10 text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-bold uppercase tracking-[0.2em] animate-glitch">
            [ LIVE_FEED // สมุดจดงาน ]
          </span>
        </div>

        {/* Top-right status line */}
        <div className="absolute top-3 right-4 text-[9px] z-10 text-emerald-500/80 tracking-wider">
          NODE://{scene.provider || "—"} · {scene.kind.toUpperCase()}
        </div>

        {/* Confetti layer for win/epic — recolored green */}
        <Confetti active={scene.kind === "win" || scene.kind === "epic"} />
        {/* Rain layer for fail */}
        <TearRain active={scene.kind === "fail"} />

        {/* Caption bar — bottom overlay, does not obscure fighters */}
        <div
          key={sceneIdx + scene.kind + scene.caption}
          className="absolute bottom-6 left-0 right-0 flex flex-col items-center justify-center gap-1 animate-scene-in px-4 z-20"
        >
          <div
            className="text-sm sm:text-base text-emerald-300 font-bold font-mono text-center max-w-[90%] tracking-wide animate-glitch bg-black/60 px-3 py-1 rounded border border-emerald-500/30 backdrop-blur-sm"
            style={{
              textShadow:
                "0 0 8px rgba(0,255,65,0.8), 0 0 16px rgba(0,255,65,0.4)",
            }}
          >
            &gt; {scene.caption}
          </div>
          {scene.model && scene.model !== "?" && (
            <div className="text-[10px] text-emerald-500/70 font-mono tracking-wider">
              [ model: {scene.model} ]
            </div>
          )}
        </div>

        {/* Progress dots — green */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
          {scenes.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === sceneIdx
                  ? "w-5 bg-emerald-400 shadow-[0_0_6px_rgba(0,255,65,0.8)]"
                  : "w-1 bg-emerald-900/60"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Live stats strip — terminal style */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
        <StatCard label="HOMEWORK_TOTAL" value={animTotal} icon="▣" />
        <StatCard label="PASS" value={animSuccess} icon="✓" />
        <StatCard label="FAIL" value={animFail} icon="✗" />
        <StatCard
          label="AVG_LATENCY"
          value={(stats.avgLatency / 1000).toFixed(1)}
          suffix="s"
          icon="⚡"
        />
      </div>
    </div>
  );
}

// Terminal-style stat card — green phosphor on black
function StatCard({
  label,
  value,
  suffix,
  icon,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  icon: string;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2 flex items-center gap-2 bg-black border border-emerald-500/40 hover:border-emerald-400 transition-all"
      style={{
        boxShadow: "0 0 8px rgba(0,255,65,0.15), inset 0 0 12px rgba(0,255,65,0.06)",
      }}
    >
      <span className="text-base text-emerald-400" style={{ textShadow: "0 0 6px rgba(0,255,65,0.8)" }}>
        {icon}
      </span>
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[9px] text-emerald-500/70 truncate tracking-wider uppercase">
          {label}
        </span>
        <span
          className="text-sm font-bold tabular-nums text-emerald-300"
          style={{ textShadow: "0 0 6px rgba(0,255,65,0.7)" }}
        >
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}
