"use client";

// BCAiRouter UI primitives — every page builds from these so the look stays consistent.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { IconAlert, IconCheck, IconCopy, IconInfo, IconSparkle } from "./icons";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/** Staggered entrance: <Reveal i={2}> delays by 2 × 70ms. */
export function Reveal({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cx("reveal", className)} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

export function Card({
  className,
  hover,
  glow,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean; glow?: boolean }) {
  return (
    <div className={cx("card", hover && "card-hover", glow && "glow-border", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--muted)]">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-violet-200">
            <IconSparkle size={12} /> {eyebrow}
          </div>
        )}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
          <span className="text-gradient">{title}</span>
        </h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

type BtnVariant = "primary" | "ghost";
export function Button({
  variant = "ghost",
  size,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" }) {
  return (
    <button className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "ghost",
  size,
  className,
  children,
}: { href: string; variant?: BtnVariant; size?: "sm"; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)}>
      {children}
    </Link>
  );
}

const BADGE_TONES = {
  neutral: "bg-white/5 text-gray-300 ring-white/10",
  accent: "bg-violet-400/10 text-violet-200 ring-violet-400/25",
  success: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  warning: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  danger: "bg-rose-400/10 text-rose-300 ring-rose-400/25",
  info: "bg-cyan-400/10 text-cyan-200 ring-cyan-400/25",
} as const;
export type Tone = keyof typeof BADGE_TONES;

export function Badge({ tone = "neutral", dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", BADGE_TONES[tone], className)}>
      {dot && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Animates 0 → value when first visible; later value changes (polling) tween from the last shown value. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  const seen = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const show = (v: number) => { last.current = v; setShown(v); };
    const run = () => {
      seen.current = true;
      if (reduce) return show(value);
      const start = performance.now();
      const from = last.current;
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / 900);
        show(from + (value - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (seen.current) {
      raf = requestAnimationFrame(run);
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { run(); io.disconnect(); }
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref} className="tabular-nums">{shown.toFixed(decimals)}{suffix}</span>;
}

export function Stat({ label, value, hint, icon, tone = "accent", loading }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; loading?: boolean }) {
  return (
    <Card hover className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--muted)]">{label}</span>
        {icon && <span className={cx("grid h-8 w-8 place-items-center rounded-lg ring-1 ring-inset", BADGE_TONES[tone])}>{icon}</span>}
      </div>
      <div className="mt-3 text-[28px] font-semibold tracking-tight text-white">
        {loading ? <span className="skeleton inline-block h-8 w-20 align-middle" /> : value}
      </div>
      {hint && <div className="mt-1 text-[12px] text-[var(--muted)]">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="animate-pop mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
        {icon ?? <IconSparkle size={22} />}
      </div>
      <div className="text-[15px] font-semibold text-white">{title}</div>
      {description && <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Inline guidance box — use it to explain what a page/section is for. */
export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning" | "success"; title?: ReactNode; children: ReactNode }) {
  const styles = {
    info: "border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-100",
    warning: "border-amber-400/25 bg-amber-400/[0.07] text-amber-100",
    success: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100",
  }[tone];
  const Icon = tone === "warning" ? IconAlert : tone === "success" ? IconCheck : IconInfo;
  return (
    <div className={cx("flex gap-3 rounded-2xl border px-4 py-3.5 text-[13px] leading-relaxed", styles)}>
      <Icon size={18} className="mt-0.5 shrink-0 opacity-80" />
      <div className="min-w-0">
        {title && <div className="mb-0.5 font-semibold text-white">{title}</div>}
        <div className="text-[13px] opacity-90">{children}</div>
      </div>
    </div>
  );
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/40">
      {label && <div className="border-b border-white/5 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted)]">{label}</div>}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-gray-200"><code>{code}</code></pre>
      <button
        onClick={copy}
        className="btn btn-ghost btn-sm absolute right-2 top-2 opacity-70 transition-opacity group-hover:opacity-100"
        aria-label="คัดลอก"
      >
        {copied ? <IconCheck size={14} className="text-emerald-300" /> : <IconCopy size={14} />}
        {copied ? "คัดลอกแล้ว" : "คัดลอก"}
      </button>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; icon?: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cx(
              "relative flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all duration-300",
              active ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" : "text-[var(--muted)] hover:bg-white/5 hover:text-gray-200",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4 mt-10 first:mt-0">
      <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-[var(--muted)]">{description}</p>}
    </div>
  );
}
