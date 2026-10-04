import type { CSSProperties } from "react";
import type { PulseStar } from "@/lib/pulse-types";
import { providerColor } from "./palette";

// CSS-only stand-in for the WebGL galaxy: drifting aurora orbs + a slowly rotating orrery with one dot per live star.
// Shown while the engine loads, and permanently when WebGL2 is unavailable / the context is lost.
// Dots carry no text, so it is safe in public mode too.

// radius factor + angle offset — matches .lp-ring-1/2/3 insets in landing.css
const RINGS: Array<[number, number]> = [[1, 0], [0.7, 18], [0.38, 40]];
const PLACEHOLDER = ["#8b7bff", "#38d6f5", "#f2a6ff", "#4d9bff", "#7affd9", "#ffb52e", "#ff5a1f", "#4dff8a"];

export function FallbackScene({ stars, off }: { stars: PulseStar[]; off: boolean }) {
  const dots = stars.length
    ? stars.map((s) => ({ color: providerColor(s.id), dim: s.status === "down" || s.status === "nokey" }))
    : PLACEHOLDER.map((color) => ({ color, dim: false }));
  const outer = Math.ceil(dots.length * 0.5);
  const mid = Math.ceil(dots.length * 0.3);
  const rings = [dots.slice(0, outer), dots.slice(outer, outer + mid), dots.slice(outer + mid)];

  return (
    <div className="lp-fallback pointer-events-none absolute inset-0 overflow-hidden" data-off={off} aria-hidden>
      <div className="lp-orb lp-orb-a" />
      <div className="lp-orb lp-orb-b" />
      <div className="lp-orb lp-orb-c" />
      <div className="lp-nexus">
        <div className="lp-sweep" />
        {rings.map((ring, r) => (
          <div key={r} className={`lp-ring lp-ring-${r + 1}`}>
            {ring.map((d, i) => (
              <span
                key={i}
                className="lp-dot"
                style={
                  {
                    "--a": `${RINGS[r][1] + (360 / ring.length) * i}deg`,
                    "--k": RINGS[r][0],
                    "--c": d.color,
                    opacity: d.dim ? 0.35 : 1,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        ))}
        <div className="lp-core" />
      </div>
    </div>
  );
}
