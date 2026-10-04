"use client";

import type { ModelChange, StatusData } from "@/components/shared";
import { Badge, Card, CardHeader } from "@/components/ui/ui";
import type { Tone } from "@/components/ui/ui";

type Changes = NonNullable<StatusData["modelChanges"]>;

/** True when any bucket (new / warning / missing / expelled) has entries — same condition as the old dashboard. */
export function hasModelChanges(c: Changes | undefined): c is Changes {
  return !!c && (c.new.length > 0 || c.warning.length > 0 || c.missing.length > 0 || (c.expelled?.length ?? 0) > 0);
}

const CHIP: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/5 text-gray-300",
  accent: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-200",
  danger: "border-rose-400/25 bg-rose-400/10 text-rose-200",
  info: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
};

interface BucketProps {
  title: string;
  hint: string;
  tone: Tone;
  items: ModelChange[];
  emptyText?: string;
  chipClass?: string;
  renderExtra?: (m: ModelChange) => React.ReactNode;
}

function Bucket({ title, hint, tone, items, emptyText, chipClass = "", renderExtra }: BucketProps) {
  if (items.length === 0 && !emptyText) return null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{items.length}</Badge>
        <span className="text-[13px] font-semibold text-white">{title}</span>
        <span className="text-[12px] text-[var(--muted)]">{hint}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-1 text-[12px] italic text-[var(--muted)]">{emptyText}</p>
      ) : (
        <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto pr-1">
          {items.map((m) => (
            <span
              key={m.id}
              className={`inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] ${CHIP[tone]} ${chipClass}`}
            >
              {renderExtra?.(m)}
              <span className="truncate">{m.name}</span>
              <span className="shrink-0 opacity-60">({m.provider})</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function daysSince(iso: string | undefined): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
}

export function ModelChanges({ changes }: { changes: Changes }) {
  return (
    <Card>
      <CardHeader
        title="ความเคลื่อนไหวของโมเดล"
        subtitle="โมเดลที่เพิ่งเข้ามาใหม่ หายไป หรือถูกถอดออกจากรายชื่อ ในช่วงที่ผ่านมา"
      />
      <div className="space-y-5 p-5">
        <Bucket
          title="โมเดลใหม่"
          hint="เข้ามาภายใน 24 ชม."
          tone="success"
          items={changes.new}
          renderExtra={(m) => (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${m.checked ? "bg-emerald-400" : "animate-pulse bg-gray-500"}`}
              title={m.checked ? "ตรวจสุขภาพแล้ว" : "รอตรวจสุขภาพ"}
            />
          )}
        />
        <Bucket title="หายไปชั่วคราว" hint="ไม่เจอ 2–48 ชม. อาจแค่พักหรือล่มชั่วคราว" tone="warning" items={changes.warning} />
        <Bucket title="หายไปหลายวัน" hint="ไม่เจอ 2–7 วัน ยังมีโอกาสกลับมา" tone="danger" items={changes.missing} chipClass="line-through opacity-70 hover:opacity-100 transition-opacity" />
        <Bucket
          title="ถูกถอดออกจากระบบ"
          hint="ไม่เจอเกิน 7 วัน — ต้องเข้าระบบใหม่ถึงจะกลับมาใช้ได้"
          tone="danger"
          items={changes.expelled ?? []}
          emptyText="ยังไม่มีโมเดลถูกถอด — ทุกตัวยังโผล่มาสม่ำเสมอ"
          chipClass="line-through opacity-60 hover:opacity-90 transition-opacity"
          renderExtra={(m) => {
            const d = daysSince(m.lastSeen);
            return d !== null ? <span className="shrink-0 font-mono text-[10px] opacity-80">-{d}d</span> : null;
          }}
        />
      </div>
    </Card>
  );
}
