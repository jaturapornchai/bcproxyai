"use client";

import { useCallback, useEffect, useState } from "react";

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
  primary:    "border-emerald-500/40 bg-emerald-500/5",
  middle:     "border-yellow-500/40 bg-yellow-500/5",
  high:       "border-orange-500/40 bg-orange-500/5",
  university: "border-red-500/40 bg-red-500/5",
};

const LEVEL_TEXT: Record<ExamLevel, string> = {
  primary:    "text-emerald-300",
  middle:     "text-yellow-300",
  high:       "text-orange-300",
  university: "text-red-300",
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
        text: `✓ ตั้งค่าเป็น ${meta?.emoji ?? ""} ${meta?.label ?? lv} แล้ว — สอบรอบหน้าใช้ ${meta?.questionCount ?? "?"} ข้อ ผ่าน ≥ ${meta?.threshold ?? "?"}%`,
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
      <div className="glass rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <span className="animate-pulse">⏳</span> กำลังโหลดข้อมูลระดับสอบ…
        </div>
      </div>
    );
  }

  const active = data.active;
  const selected = previewLevel ?? active;
  const questions = data.questions ?? [];
  const visibleQs = showAll ? questions : questions.slice(0, 5);

  return (
    <div className="glass rounded-xl border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-indigo-500/5 to-purple-500/5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-2xl">🎚</span>
          <div className="flex-1 min-w-[200px]">
            <div className="font-bold text-white text-lg">ระดับความยากของข้อสอบ</div>
            <div className="text-xs text-gray-400">
              เลือกระดับ → ทุกคนที่สอบใหม่จะใช้ชุดข้อสอบและเกณฑ์ผ่านตามระดับนี้
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-lg border ${LEVEL_BORDER[active]} text-sm`}>
            <span className="text-gray-500">กำลังใช้:</span>{" "}
            <span className={`font-bold ${LEVEL_TEXT[active]}`}>
              {data.levels.find((l) => l.id === active)?.emoji} {data.levels.find((l) => l.id === active)?.label}
            </span>
          </div>
        </div>
      </div>

      {/* Level selector — 4 cards (คลิกแล้ว save ทันที) */}
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
        {data.levels.map((lv) => {
          const isActive = active === lv.id;
          const isPreview = selected === lv.id && !isActive;
          return (
            <button
              key={lv.id}
              onClick={() => onSelectAndSave(lv.id)}
              disabled={saving}
              className={`relative text-left p-3 rounded-lg border-2 transition-all disabled:opacity-60 disabled:cursor-wait ${
                isActive
                  ? `${LEVEL_BORDER[lv.id]} shadow-lg ring-2 ring-emerald-500/40`
                  : isPreview
                  ? `${LEVEL_BORDER[lv.id]}`
                  : "border-white/5 bg-white/2 hover:bg-white/5"
              }`}
            >
              {isActive && (
                <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 font-bold">
                  ✓ ใช้งานอยู่
                </span>
              )}
              {saving && selected === lv.id && (
                <span className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/30 text-indigo-200">
                  กำลังบันทึก…
                </span>
              )}
              <div className="text-2xl mb-1">{lv.emoji}</div>
              <div className={`font-bold text-sm ${isActive ? LEVEL_TEXT[lv.id] : "text-white"}`}>
                {lv.label}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {lv.questionCount} ข้อ · ผ่าน ≥ {lv.threshold}%
              </div>
              <div className="text-[10px] text-gray-600 mt-1 line-clamp-2">{lv.description}</div>
            </button>
          );
        })}
      </div>

      {/* Action bar — เลือกระดับ save อัตโนมัติแล้ว เหลือแค่ปุ่ม Reset */}
      <div className="px-4 py-3 border-t border-white/5 bg-black/20 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 italic">💡 คลิกการ์ดระดับ → บันทึกอัตโนมัติทันที</span>
        <span className="flex-1" />
        <button
          onClick={onResetAll}
          disabled={resetting}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            confirmReset
              ? "bg-red-600 hover:bg-red-500 text-white animate-pulse"
              : "bg-white/5 hover:bg-white/10 text-amber-300 border border-amber-500/30"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          title="ล้างผลสอบทั้งหมด แล้ว trigger worker ให้สอบใหม่ทันที"
        >
          {resetting
            ? "กำลังรีเซ็ต…"
            : confirmReset
            ? "⚠️ กดอีกครั้งเพื่อยืนยัน — จะลบประวัติทั้งหมด"
            : "🔄 สอบใหม่ทุกคน"}
        </button>
        {statusMsg && (
          <span
            className={`text-xs px-2 py-1 rounded ${
              statusMsg.kind === "ok"
                ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20"
                : "text-red-300 bg-red-500/10 border border-red-500/20"
            }`}
          >
            {statusMsg.text}
          </span>
        )}
      </div>

      {/* Question preview */}
      <div className="px-4 py-3 border-t border-white/5">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-sm font-semibold text-white">
            ตัวอย่างข้อสอบระดับ {data.levels.find((l) => l.id === selected)?.label}
          </span>
          <span className="text-xs text-gray-500">({questions.length} ข้อทั้งหมด)</span>
          {questions.length > 5 && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="ml-auto text-xs text-indigo-300 hover:text-white"
            >
              {showAll ? "ย่อ" : `แสดงทั้งหมด (${questions.length} ข้อ)`}
            </button>
          )}
        </div>
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {visibleQs.map((q, i) => (
            <details
              key={q.id}
              className="group rounded-lg border border-white/5 bg-black/20 hover:border-white/10 transition-colors"
            >
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-xs">
                <span className="text-gray-500 font-mono w-6">{i + 1}.</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${LEVEL_TEXT[q.difficulty]} bg-white/5`}>
                  {q.difficulty}
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] text-gray-400 bg-white/5">{q.category}</span>
                {q.withTools && <span className="text-[10px] text-cyan-300">🔧 tools</span>}
                {q.withVision && <span className="text-[10px] text-purple-300">🖼 vision</span>}
                <span className="text-gray-300 truncate flex-1">{q.question.replace(/\s+/g, " ").slice(0, 100)}</span>
              </summary>
              <div className="px-3 pb-3 pt-1 text-xs space-y-1.5 border-t border-white/5">
                <div>
                  <div className="text-gray-500 mb-0.5">คำถาม:</div>
                  <pre className="whitespace-pre-wrap text-gray-300 bg-black/30 rounded p-2 font-mono text-[11px]">
                    {q.question}
                  </pre>
                </div>
                <div>
                  <div className="text-gray-500 mb-0.5">เฉลย / เกณฑ์ตรวจ:</div>
                  <pre className="whitespace-pre-wrap text-emerald-200 bg-emerald-500/5 rounded p-2 font-mono text-[11px]">
                    {q.expected}
                  </pre>
                </div>
              </div>
            </details>
          ))}
          {visibleQs.length === 0 && (
            <div className="text-xs text-gray-500 italic">ไม่มีข้อสอบ</div>
          )}
        </div>
      </div>
    </div>
  );
}
