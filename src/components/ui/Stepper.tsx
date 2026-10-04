"use client";

import Link from "next/link";
import type { OnboardingStep } from "@/lib/onboarding";
import { IconArrowRight } from "./icons";

/** Vertical getting-started stepper with an animated progress rail. */
export function Stepper({ steps }: { steps: OnboardingStep[] }) {
  return (
    <ol className="relative">
      {steps.map((s, idx) => {
        const last = idx === steps.length - 1;
        return (
          <li key={s.id} className="reveal relative flex gap-4 pb-6 last:pb-0" style={{ "--i": idx } as React.CSSProperties}>
            {!last && (
              <span className="absolute left-[17px] top-10 bottom-1 w-px bg-white/10" aria-hidden>
                <span
                  className="block w-px bg-gradient-to-b from-violet-400 to-cyan-300 transition-[height] duration-700"
                  style={{ height: s.status === "done" ? "100%" : "0%" }}
                />
              </span>
            )}
            <StepDot status={s.status} index={idx + 1} />
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[15px] font-semibold ${s.status === "todo" ? "text-gray-400" : "text-white"}`}>{s.title}</span>
                {s.status === "current" && (
                  <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-[11px] font-medium text-violet-200 ring-1 ring-inset ring-violet-400/30">ขั้นตอนถัดไป</span>
                )}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{s.description}</p>
              {s.status !== "done" && (
                <Link
                  href={s.href}
                  className={`btn btn-sm mt-3 ${s.status === "current" ? "btn-primary" : "btn-ghost"}`}
                >
                  {s.cta} <IconArrowRight size={14} />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({ status, index }: { status: OnboardingStep["status"]; index: number }) {
  if (status === "done") {
    return (
      <span className="animate-pop relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-[0_0_20px_-4px_rgba(52,211,153,0.7)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path className="check-draw" d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-[13px] font-bold text-white shadow-[0_0_24px_-4px_rgba(139,123,255,0.9)]">
        <span className="absolute inset-0 rounded-full bg-violet-400/40" style={{ animation: "ping-soft 2s var(--ease-out) infinite" }} />
        <span className="relative">{index}</span>
      </span>
    );
  }
  return (
    <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.03] text-[13px] font-semibold text-gray-400">
      {index}
    </span>
  );
}

/** Circular progress ring (stroke animates on change). */
export function ProgressRing({ percent, size = 76 }: { percent: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#8b7bff" />
            <stop offset="100%" stopColor="#38d6f5" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={7} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ring-grad)"
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - (c * percent) / 100}
          style={{ transition: "stroke-dashoffset 1.1s var(--ease-out)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-[17px] font-semibold tabular-nums text-white">{percent}%</div>
    </div>
  );
}
