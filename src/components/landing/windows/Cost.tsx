"use client";

// 6. cost guard — everyone sees the $0 spending ceiling (policy, not measured spend) and the free-only rules;
// only the owner gets the account watch, loaded as a separate chunk.
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { IconCheck } from "@/components/ui/icons";
import type { WinCtx } from "./shared";

const OpenRouterWatch = dynamic(() => import("./OpenRouterWatch"), { ssr: false });

function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[12.5px] leading-snug text-gray-200">
      <IconCheck size={14} className="mt-0.5 shrink-0 text-emerald-300" />
      <span>{children}</span>
    </li>
  );
}

export function CostWindow({ ctx }: { ctx: WinCtx }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-gradient text-[34px] font-semibold leading-none tabular-nums">${ctx.data.stats.spentUsd}</span>
          <span className="text-[12px] text-[var(--muted)]">เพดานค่าใช้จ่าย · ตั้งใจใช้เฉพาะโมเดลฟรี</span>
        </div>
      </div>
      <ul className="space-y-1.5">
        <Check>ผู้ให้บริการที่คิดเงินได้ถูกล็อก max_price = 0</Check>
        <Check>แคตตาล็อกมีเฉพาะโมเดลฟรี (free-only)</Check>
      </ul>
      {ctx.owner && <OpenRouterWatch />}
    </div>
  );
}
