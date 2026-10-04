"use client";

// สนามสอบ & รอบตรวจ: exam radar (mean score of the 5 best models per subject), the worker's next-cycle countdown and
// the last 24 h of exam attempts. Public arrays are positional (EXAM_SUBJECTS order), so no subject key or model name
// reaches visitors; leaders / level / judge / last cycle are owner-only fields.
import type { ReactNode } from "react";
import type { InsightsData, InsightsWorker } from "@/lib/insights-types";
import { BAD, CYAN, Countdown, GOOD, Pending, WARN, ago, clock, int, useNow } from "./shared";
import type { WinCtx } from "./shared";

/** same order as EXAM_SUBJECTS */
const SUBJECTS = ["ภาษาไทย", "คณิต", "JSON", "ทำตามคำสั่ง", "จัดหมวด", "ความปลอดภัย"];
const LEVEL: Record<string, string> = { primary: "ประถม", middle: "ม.ต้น", high: "ม.ปลาย", university: "มหาวิทยาลัย" };

/** compact for the owner (extra lines below); visitors get the larger radar so the window has no empty band */
const GEOM = { small: { w: 184, h: 136, cx: 96, cy: 70, r: 40 }, big: { w: 198, h: 150, cx: 106, cy: 77, r: 46 } };
type Geom = (typeof GEOM)["small"];
const pt = (g: Geom, i: number, k: number) => {
  const a = ((-90 + i * 60) * Math.PI) / 180;
  return [g.cx + Math.cos(a) * g.r * k, g.cy + Math.sin(a) * g.r * k];
};
const ring = (g: Geom, k: number) => SUBJECTS.map((_, i) => pt(g, i, k).map((v) => v.toFixed(1)).join(",")).join(" ");

function Radar({ exam, g }: { exam: InsightsData["exam"]; g: Geom }) {
  const score = (i: number) => Math.min(100, Math.max(0, exam.top5[i] ?? 0));
  const has = exam.top5.some((v) => v > 0);
  const poly = SUBJECTS.map((_, i) => pt(g, i, score(i) / 100).map((v) => v.toFixed(1)).join(",")).join(" ");
  const tip = (i: number) => {
    const lead = exam.leaders?.[i];
    const base = `${SUBJECTS[i]}: เฉลี่ย 5 อันดับแรก ${score(i)}% · ผ่าน ${exam.passing[i] ?? 0} โมเดล`;
    return lead ? `${base}\nอันดับ 1: ${lead.provider} · ${lead.model} (${lead.scorePct}%)` : base;
  };
  return (
    <svg width={g.w} height={g.h} viewBox={`0 0 ${g.w} ${g.h}`} role="img" aria-label={`คะแนนสอบ: ${SUBJECTS.map((s, i) => `${s} ${score(i)}%`).join(", ")}`} className="shrink-0 overflow-visible">
      {[0.25, 0.75, 1].map((k) => (
        <polygon key={k} points={ring(g, k)} fill={k === 1 ? "rgba(255,255,255,0.02)" : "none"} stroke="rgba(255,255,255,0.08)" />
      ))}
      {SUBJECTS.map((_, i) => {
        const [x, y] = pt(g, i, 1);
        return <line key={i} x1={g.cx} y1={g.cy} x2={x} y2={y} stroke="rgba(255,255,255,0.06)" />;
      })}
      <polygon points={ring(g, 0.5)} fill="none" stroke={CYAN} strokeOpacity={0.6} strokeDasharray="3 3" />
      {has && (
        <g className="lp-radar">
          <polygon points={poly} fill="rgba(139,123,255,0.28)" stroke="#a99bff" strokeWidth={1.5} strokeLinejoin="round" />
          {SUBJECTS.map((_, i) => {
            const [x, y] = pt(g, i, score(i) / 100);
            return <circle key={i} cx={x} cy={y} r={2.2} fill="#e4dfff" />;
          })}
        </g>
      )}
      {SUBJECTS.map((s, i) => {
        const a = -90 + i * 60;
        const [x, y] = pt(g, i, 1.2);
        const cos = Math.cos((a * Math.PI) / 180);
        const sin = Math.sin((a * Math.PI) / 180);
        return (
          <g key={s}>
            <title>{tip(i)}</title>
            <text
              x={x}
              y={y + (sin < -0.5 ? -1 : sin > 0.5 ? 9 : 3.5)}
              textAnchor={cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle"}
              className="fill-gray-300 text-[11px]"
            >
              {s}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function NextCycle({ w, fleet, skewMs }: { w: InsightsWorker; fleet: InsightsData["fleet"]; skewMs: number }) {
  const now = useNow() + skewMs;
  const next = w.nextRun ? Date.parse(w.nextRun) : NaN;
  const last = w.lastRun ? Date.parse(w.lastRun) : NaN;

  let ringEl: ReactNode;
  let caption: ReactNode = "ตรวจรอบถัดไป";
  if (w.status === "running") {
    ringEl = <Countdown p={0.28} spin><span className="text-[10.5px] text-cyan-200">ตรวจ</span></Countdown>;
    caption = <span className="text-cyan-200">กำลังตรวจ…</span>;
  } else if (!Number.isFinite(next)) {
    ringEl = <Countdown p={0}><span className="text-[13px] text-gray-400">—</span></Countdown>;
    caption = "ยังไม่มีกำหนดตรวจ";
  } else if (next <= now) {
    ringEl = <Countdown p={1} color={WARN}><span className="text-[13px] font-semibold text-amber-300">!</span></Countdown>;
    caption = <span className="text-amber-300">เกินกำหนด {Math.max(1, Math.round((now - next) / 60_000))} นาที</span>;
  } else {
    const p = Number.isFinite(last) && next > last ? (now - last) / (next - last) : 0;
    ringEl = <Countdown p={p}><span className="text-[13px] font-semibold tabular-nums text-white">{clock(next - now)}</span></Countdown>;
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-center">
      {ringEl}
      <span className="text-[11px] leading-tight text-gray-300">{caption}</span>
      {w.status === "error" && <span className="text-[10.5px] text-rose-300">รอบล่าสุดขัดข้อง</span>}
      {w.lastRun && w.status !== "running" && <span className="text-[10px] text-[var(--muted)]">ล่าสุด {ago(w.lastRun, now, "ที่แล้ว")}</span>}
      <span className="mt-1 grid w-full max-w-[150px] grid-cols-2 gap-1 text-[10px] leading-tight text-[var(--muted)]">
        <span title="โมเดลที่สอบผ่านและไม่ได้พักอยู่">พร้อมเสิร์ฟ<b className="block text-[13px] font-semibold tabular-nums text-white">{int(fleet.serving)}</b></span>
        <span title={fleet.newModels24h ? `โมเดลใหม่ใน 24 ชม. ${int(fleet.newModels24h)}` : undefined}>พักชั่วคราว<b className="block text-[13px] font-semibold tabular-nums text-white">{int(fleet.cooling)}</b></span>
      </span>
    </div>
  );
}

export function ExamWindow({ ctx }: { ctx: WinCtx }) {
  const ins = ctx.insights;
  if (!ins) return <Pending ctx={ctx} />;
  const { exam, worker, fleet } = ins;
  const a = exam.attempts24h;
  const tries = a.passed + a.failed + a.running;
  const lc = worker.lastCycle;
  return (
    // centred in the window body when it has spare height (desktop); the sheet just stacks
    <div className="flex min-h-full flex-col justify-center gap-2">
      {ctx.owner && (exam.level || exam.judgeModel) && (
        <p className="flex min-w-0 items-center gap-2 text-[11px] text-gray-300">
          {exam.level && (
            <span className="shrink-0 rounded-full border border-violet-300/30 bg-violet-400/10 px-2 py-0.5 text-[10.5px] font-medium text-violet-200">
              ระดับ {LEVEL[exam.level] ?? exam.level}
            </span>
          )}
          {exam.judgeModel && <span className="truncate" title={exam.judgeModel}>ผู้ตรวจ: {exam.judgeModel}</span>}
        </p>
      )}
      <div className="flex items-center gap-1">
        <Radar exam={exam} g={ctx.owner ? GEOM.small : GEOM.big} />
        <NextCycle w={worker} fleet={fleet} skewMs={ctx.skewMs} />
      </div>
      {exam.passing.every((n) => !n) && <p className="text-center text-[11px] text-[var(--muted)]">ผลสอบยังน้อย — รอบถัดไปจะอัปเดตเอง</p>}
      <div>
        <div className="flex h-[5px] overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
          {tries > 0 && (
            <>
              <span style={{ width: `${(a.passed / tries) * 100}%`, background: GOOD }} />
              <span style={{ width: `${(a.failed / tries) * 100}%`, background: BAD }} />
              <span className="bg-white/30" style={{ width: `${(a.running / tries) * 100}%` }} />
            </>
          )}
        </div>
        <p className="mt-1 text-[10.5px] tabular-nums text-[var(--muted)]">
          {tries ? (
            <>
              สอบ 24 ชม. ผ่าน <span className="text-emerald-300">{int(a.passed)}</span> · ตก <span className="text-rose-300">{int(a.failed)}</span> · กำลังสอบ {int(a.running)}
            </>
          ) : (
            "ยังไม่มีการสอบใน 24 ชม."
          )}
        </p>
      </div>
      {ctx.owner && lc && (
        <p className="text-[10.5px] tabular-nums text-[var(--muted)]">
          รอบล่าสุด: ตรวจ {int(lc.health.checked)} · พร้อม {int(lc.health.available)} · พัก {int(lc.health.cooldown)} · สอบผ่าน {int(lc.exam.passed)}/{int(lc.exam.examined)}
        </p>
      )}
    </div>
  );
}
