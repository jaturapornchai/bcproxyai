"use client";

import { useCallback, useEffect, useState } from "react";
import { IconRefresh } from "./ui/icons";
import { Badge, Button, Card, CardHeader } from "./ui/ui";

type ExamLevel = "primary" | "middle" | "high" | "university";

interface LevelInfo {
  id: ExamLevel;
  label: string;
  emoji: string;
  threshold: number;
  description: string;
  questionCount: number;
}

interface SampleQuestion {
  id: string;
  category: string;
  difficulty: ExamLevel;
  question: string;
  expected: string;
  withTools: boolean;
  withVision: boolean;
}

interface ExamConfig {
  active: ExamLevel;
  level: ExamLevel;
  levels: LevelInfo[];
  questions?: SampleQuestion[];
}

const LEVEL_BORDER: Record<ExamLevel, string> = {
  primary:    "border-emerald-400/40 bg-emerald-400/[0.07]",
  middle:     "border-yellow-400/40 bg-yellow-400/[0.07]",
  high:       "border-orange-400/40 bg-orange-400/[0.07]",
  university: "border-rose-400/40 bg-rose-400/[0.07]",
};

const LEVEL_TEXT: Record<ExamLevel, string> = {
  primary:    "text-emerald-300",
  middle:     "text-yellow-300",
  high:       "text-orange-300",
  university: "text-rose-300",
};

export function ExamLevelPanel() {
  const [data, setData] = useState<ExamConfig | null>(null);
  const [previewLevel, setPreviewLevel] = useState<ExamLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const fetchConfig = useCallback(
    async (level?: ExamLevel) => {
      const url = level
        ? `/api/exam-config?level=${level}&includeQuestions=1`
        : `/api/exam-config?includeQuestions=1`;
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as ExamConfig;
      setData(json);
      if (!previewLevel) setPreviewLevel(json.active);
    },
    [previewLevel],
  );

  useEffect(() => {
    fetchConfig().catch((err) => {
      console.error("[ExamLevelPanel] fetch error", err);
    });
  }, [fetchConfig]);

  // คลิกการ์ดระดับ → save ทันที (ไม่ต้องกดปุ่มบันทึกอีก)
  const onSelectAndSave = async (lv: ExamLevel) => {
    if (saving) return;
    setPreviewLevel(lv);
    setShowAll(false);
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/exam-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: lv }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const meta = data?.levels.find((x) => x.id === lv);
      setStatusMsg({
        kind: "ok",
        text: `ตั้งค่าเป็น ${meta?.emoji ?? ""} ${meta?.label ?? lv} แล้ว — สอบรอบหน้าใช้ ${meta?.questionCount ?? "?"} ข้อ ผ่าน ≥ ${meta?.threshold ?? "?"}%`,
      });
      await fetchConfig(lv);
    } catch (err) {
      setStatusMsg({ kind: "err", text: `บันทึกล้มเหลว: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const onResetAll = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5000);
      return;
    }
    setResetting(true);
    setConfirmReset(false);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/exam-reset", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setStatusMsg({
        kind: "ok",
        text: `ล้าง ${json.deletedAttempts} attempts แล้ว — worker เริ่มสอบใหม่ในระดับ ${json.level}`,
      });
    } catch (err) {
      setStatusMsg({ kind: "err", text: `Reset ล้มเหลว: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setResetting(false);
    }
  };

  if (!data) {
    return (
      <Card className="p-5">
        <div className="skeleton mb-4 h-6 w-64" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}
        </div>
      </Card>
    );
  }

  const active = data.active;
  const activeMeta = data.levels.find((l) => l.id === active);
  const selected = previewLevel ?? active;
  const questions = data.questions ?? [];
  const visibleQs = showAll ? questions : questions.slice(0, 5);

  return (
    <Card>
      <CardHeader
        title="ระดับความยากของข้อสอบ"
        subtitle="เลือกระดับ แล้วทุกโมเดลที่สอบใหม่จะใช้ชุดข้อสอบและเกณฑ์ผ่านตามระดับนี้ — ยิ่งยากยิ่งได้โมเดลคุณภาพสูง แต่ผ่านน้อยลง"
        action={
          <Badge tone="success" dot>
            ใช้อยู่: {activeMeta?.emoji} {activeMeta?.label}
          </Badge>
        }
      />

      {/* Level selector — click saves immediately */}
      <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
        {data.levels.map((lv) => {
          const isActive = active === lv.id;
          const isPreview = selected === lv.id && !isActive;
          return (
            <button
              key={lv.id}
              type="button"
              onClick={() => onSelectAndSave(lv.id)}
              disabled={saving}
              aria-pressed={isActive}
              className={`relative rounded-2xl border p-4 text-left transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 ${
                isActive
                  ? `${LEVEL_BORDER[lv.id]} ring-2 ring-emerald-400/40`
                  : isPreview
                    ? LEVEL_BORDER[lv.id]
                    : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]"
              }`}
            >
              {(isActive || (saving && selected === lv.id)) && (
                <span className="absolute right-2.5 top-2.5">
                  <Badge tone={isActive && !saving ? "success" : "accent"}>
                    {saving && selected === lv.id ? "กำลังบันทึก…" : "ใช้งานอยู่"}
                  </Badge>
                </span>
              )}
              <div className="mb-2 text-2xl">{lv.emoji}</div>
              <div className={`text-[14px] font-semibold ${isActive ? LEVEL_TEXT[lv.id] : "text-white"}`}>{lv.label}</div>
              <div className="mt-1 text-[12px] tabular-nums text-[var(--muted)]">
                {lv.questionCount} ข้อ · ผ่าน ≥ {lv.threshold}%
              </div>
              <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]/80">{lv.description}</div>
            </button>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] bg-black/20 px-5 py-3.5">
        <span className="text-[12px] text-[var(--muted)]">คลิกการ์ดระดับเพื่อบันทึกทันที ไม่ต้องกดปุ่มยืนยัน</span>
        <span className="flex-1" />
        <Button
          size="sm"
          onClick={onResetAll}
          disabled={resetting}
          className={confirmReset ? "animate-pulse border-rose-400/60 bg-rose-600! text-white" : "border-amber-400/30 text-amber-200"}
          title="ล้างผลสอบทั้งหมด แล้วสั่ง worker ให้สอบใหม่ทันที"
        >
          <IconRefresh size={14} className={resetting ? "animate-spin" : ""} />
          {resetting ? "กำลังรีเซ็ต…" : confirmReset ? "กดอีกครั้งเพื่อยืนยัน — จะลบประวัติสอบทั้งหมด" : "สอบใหม่ทุกคน"}
        </Button>
        {statusMsg && (
          <div
            role="status"
            className={`w-full rounded-xl border px-3 py-2 text-[12px] ${
              statusMsg.kind === "ok"
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                : "border-rose-400/25 bg-rose-400/10 text-rose-200"
            }`}
          >
            {statusMsg.text}
          </div>
        )}
      </div>

      {/* Question preview */}
      <div className="border-t border-white/[0.06] px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-white">
            ตัวอย่างข้อสอบระดับ {data.levels.find((l) => l.id === selected)?.label}
          </span>
          <span className="text-[12px] text-[var(--muted)]">({questions.length} ข้อทั้งหมด)</span>
          {questions.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="ml-auto rounded-lg px-2 py-1 text-[12px] text-violet-300 transition-colors hover:bg-white/5 hover:text-white"
            >
              {showAll ? "ย่อ" : `แสดงทั้งหมด (${questions.length} ข้อ)`}
            </button>
          )}
        </div>
        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {visibleQs.map((q, i) => (
            <details key={q.id} className="group rounded-xl border border-white/[0.06] bg-black/20 transition-colors open:border-white/15 hover:border-white/12">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[12px]">
                <span className="w-6 shrink-0 font-mono tabular-nums text-[var(--muted)]">{i + 1}.</span>
                <span className={`shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] ${LEVEL_TEXT[q.difficulty]}`}>{q.difficulty}</span>
                <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">{q.category}</span>
                {q.withTools && <span className="shrink-0 text-[10px] text-cyan-300">tools</span>}
                {q.withVision && <span className="shrink-0 text-[10px] text-violet-300">vision</span>}
                <span className="min-w-0 flex-1 truncate text-gray-300">{q.question.replace(/\s+/g, " ").slice(0, 100)}</span>
              </summary>
              <div className="space-y-2 border-t border-white/[0.06] px-3 pb-3 pt-2 text-[12px]">
                <div>
                  <div className="mb-1 text-[var(--muted)]">คำถาม</div>
                  <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-2.5 font-mono text-[11px] text-gray-300">{q.question}</pre>
                </div>
                <div>
                  <div className="mb-1 text-[var(--muted)]">เฉลย / เกณฑ์ตรวจ</div>
                  <pre className="whitespace-pre-wrap rounded-lg bg-emerald-400/[0.06] p-2.5 font-mono text-[11px] text-emerald-200">{q.expected}</pre>
                </div>
              </div>
            </details>
          ))}
          {visibleQs.length === 0 && <div className="py-3 text-center text-[13px] text-[var(--muted)]">ยังไม่มีข้อสอบในระดับนี้</div>}
        </div>
      </div>
    </Card>
  );
}
