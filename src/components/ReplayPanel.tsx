"use client";

import { useState } from "react";

interface ReplayResult {
  provider: string;
  model: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  outputPreview?: string;
  error?: string;
}

interface Resp {
  reqId: string;
  promptLength: number;
  by?: string;
  results: ReplayResult[];
  blocked?: boolean;
  error?: string;
}

interface CandidateInput {
  provider: string;
  model: string;
}

export function ReplayPanel() {
  const [reqId, setReqId] = useState("");
  const [candidates, setCandidates] = useState<CandidateInput[]>([{ provider: "", model: "" }]);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Resp | null>(null);

  function setCandidate(i: number, key: "provider" | "model", v: string): void {
    setCandidates((cs) => cs.map((c, idx) => (idx === i ? { ...c, [key]: v } : c)));
  }
  function addCandidate(): void {
    if (candidates.length >= 5) return;
    setCandidates((cs) => [...cs, { provider: "", model: "" }]);
  }
  function removeCandidate(i: number): void {
    setCandidates((cs) => cs.filter((_, idx) => idx !== i));
  }

  async function run(): Promise<void> {
    if (!reqId.trim()) return;
    const valid = candidates.filter((c) => c.provider && c.model);
    if (valid.length === 0) return;

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reqId: reqId.trim(), candidates: valid, confirm }),
      });
      const json = (await res.json()) as Resp;
      setResult(json);
    } catch (err) {
      setResult({ reqId, promptLength: 0, results: [], error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass rounded-xl p-4 border border-pink-500/15 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-2xl">🔁</span>
        <div>
          <h2 className="text-xl font-black text-white leading-tight">Replay & Compare</h2>
          <p className="text-xs text-gray-400">ยิง request เดิมเทียบหลาย model · owner-only · sensitive prompt block อัตโนมัติ</p>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <label className="text-gray-400">Request ID</label>
          <input
            value={reqId}
            onChange={(e) => setReqId(e.target.value)}
            placeholder="abc123 (จาก X-SMLGateway-Request-Id)"
            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 mt-0.5 text-gray-200"
          />
        </div>
        <div>
          <label className="text-gray-400">Candidates ({candidates.length}/5)</label>
          {candidates.map((c, i) => (
            <div key={i} className="flex gap-1 mt-1">
              <input
                value={c.provider}
                onChange={(e) => setCandidate(i, "provider", e.target.value)}
                placeholder="provider"
                className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-gray-200"
              />
              <input
                value={c.model}
                onChange={(e) => setCandidate(i, "model", e.target.value)}
                placeholder="model"
                className="flex-[2] bg-black/30 border border-white/10 rounded px-2 py-1 text-gray-200"
              />
              {candidates.length > 1 && (
                <button onClick={() => removeCandidate(i)} className="text-red-400 px-2">×</button>
              )}
            </div>
          ))}
          {candidates.length < 5 && (
            <button onClick={addCandidate} className="mt-1 text-pink-400 text-[11px]">+ เพิ่ม candidate</button>
          )}
        </div>
        <label className="flex items-center gap-2 text-gray-400">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          override sensitive-prompt block (ใช้เฉพาะตอน debug จำเป็น)
        </label>
        <button
          onClick={run}
          disabled={loading || !reqId.trim()}
          className="bg-pink-500/20 border border-pink-500/40 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {loading ? "กำลังยิง..." : "Replay"}
        </button>
      </div>

      {result && (
        <div className="space-y-1.5 text-xs border-t border-white/5 pt-3">
          {result.error && <div className="text-red-400">{result.error}</div>}
          {result.blocked && <div className="text-amber-400">prompt ถูก block — ถ้ามั่นใจให้ติ๊ก override แล้วลองใหม่</div>}
          {result.results.map((r, i) => (
            <div key={i} className={`border rounded-lg p-2 ${r.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
              <div className="flex justify-between text-gray-200">
                <span className="font-mono">{r.provider}/{r.model}</span>
                <span className="text-gray-400">{r.status ?? "—"} · {r.latencyMs}ms</span>
              </div>
              {r.error && <div className="text-red-300 mt-0.5">{r.error}</div>}
              {r.outputPreview && (
                <div className="text-gray-300 mt-1 whitespace-pre-wrap">
                  <span className="text-gray-500">{r.promptTokens ?? 0}+{r.completionTokens ?? 0} tok · </span>
                  {r.outputPreview}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
