"use client";

import { Badge } from "@/components/ui/ui";
import type { PulseStar } from "@/lib/pulse-types";
import { providerColor } from "./palette";
import { STATUS_VIEW } from "./windows/shared";

/** x/y: pointer in scene-box px; w/h: the scene box size (for edge flipping) */
export interface HoverState { id: string; x: number; y: number; w: number; h: number }

/** Follows the pointer over a star. Visitors see "ดาว <id>" only; the owner sees the provider label. */
export function ProviderTip({ hover, star, owner }: { hover: HoverState | null; star: PulseStar | undefined; owner: boolean }) {
  if (!hover || !star) return null;

  const view = STATUS_VIEW[star.status];
  const color = providerColor(star.id);
  // Flip to the other side of the cursor near the right/bottom edges so the card never leaves the viewport.
  const flipX = hover.x > hover.w - 260;
  const flipY = hover.y > hover.h - 170;
  const pos = `translate3d(${hover.x}px, ${hover.y}px, 0) translate(${flipX ? "calc(-100% - 18px)" : "18px"}, ${flipY ? "calc(-100% - 18px)" : "18px"})`;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute left-0 top-0" style={{ transform: pos }}>
        <div className="lp-tip w-[232px] rounded-2xl border border-white/15 bg-[rgba(10,12,22,0.82)] p-3.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px 2px ${color}` }} />
              <span className="truncate text-[14px] font-semibold text-white">{owner ? (star.label ?? star.id) : `ดาว ${star.id}`}</span>
            </span>
            <Badge tone={view.tone} dot={star.status === "up"}>{view.label}</Badge>
          </div>
          {star.models !== undefined && (
            <p className="mt-2.5 text-[12.5px] text-gray-300">
              พร้อมใช้ <span className="font-semibold tabular-nums text-white">{star.available}</span>
              <span className="text-gray-500"> / {star.models} โมเดล</span>
            </p>
          )}
          <p className="mt-2 text-[12px] text-gray-400">
            <span className="tabular-nums text-gray-200">{star.load}</span> คำขอใน 60 นาที
          </p>
          <p className="mt-1.5 text-[11.5px] font-medium text-violet-200">คลิกเพื่อโฟกัสดาวนี้ →</p>
        </div>
      </div>
    </div>
  );
}
