"use client";

import { useState } from "react";
import { Badge, Button, Callout, Card, CardHeader } from "./ui/ui";
import { IconRefresh, IconX } from "./ui/icons";

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

const FIELD =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13.5px] text-gray-100 placeholder:text-[var(--muted)] transition-colors focus:border-violet-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40";

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
    <Card>
      <CardHeader
        icon={<IconRefresh size={18} />}
        title="Replay & Compare"
        subtitle="เฉพาะเจ้าของระบบ · prompt ที่อ่อนไหวจะถูกบล็อกอัตโนมัติ"
      />

      <div className="space-y-5 p-5">
        <Callout title="วิธีใช้">
          1) คัดลอก Request ID จาก header <code className="font-mono text-[12px] text-cyan-200">X-BCAiRouter-Request-Id</code> ของ request ที่ต้องการ ·
          2) ใส่ provider และ model ที่อยากเทียบ (ได้สูงสุด 5 ตัว) · 3) กด Replay แล้วดูผลด้านล่าง
        </Callout>

        <div>
          <label htmlFor="replay-reqid" className="mb-1.5 block text-[12px] font-medium text-[var(--muted)]">Request ID</label>
          <input
            id="replay-reqid"
            value={reqId}
            onChange={(e) => setReqId(e.target.value)}
            placeholder="abc123 (จาก X-BCAiRouter-Request-Id)"
            className={FIELD}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-medium text-[var(--muted)]">โมเดลที่ต้องการเทียบ</span>
            <Badge tone="neutral"><span className="tabular-nums">{candidates.length}/5</span></Badge>
          </div>
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={c.provider}
                  onChange={(e) => setCandidate(i, "provider", e.target.value)}
                  placeholder="provider เช่น groq"
                  aria-label={`provider ตัวที่ ${i + 1}`}
                  className={`${FIELD} sm:flex-1`}
                />
                <input
                  value={c.model}
                  onChange={(e) => setCandidate(i, "model", e.target.value)}
                  placeholder="model เช่น llama-3.3-70b-versatile"
                  aria-label={`model ตัวที่ ${i + 1}`}
                  className={`${FIELD} sm:flex-[2]`}
                />
                {candidates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCandidate(i)}
                    aria-label={`ลบตัวที่ ${i + 1}`}
                    className="grid h-10 w-10 shrink-0 place-items-center self-end rounded-xl border border-white/10 text-rose-300 transition-colors hover:bg-rose-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 sm:self-auto"
                  >
                    <IconX size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {candidates.length < 5 && (
            <Button type="button" size="sm" className="mt-3" onClick={addCandidate}>
              + เพิ่มโมเดล
            </Button>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[13px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-violet-400"
          />
          <span>
            <span className="text-gray-200">ข้ามการบล็อก prompt อ่อนไหว</span> — ใช้เฉพาะตอน debug ที่จำเป็นเท่านั้น
          </span>
        </label>

        <Button variant="primary" onClick={run} disabled={loading || !reqId.trim()}>
          <IconRefresh size={16} className={loading ? "animate-spin" : undefined} />
          {loading ? "กำลังยิง..." : "Replay"}
        </Button>

        {loading && (
          <div className="space-y-2" role="status" aria-label="กำลังรอผล">
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
          </div>
        )}

        {result && (
          <div className="space-y-2.5 border-t border-white/[0.06] pt-5 text-[13px]">
            {result.error && <Callout tone="warning" title="เกิดข้อผิดพลาด">{result.error}</Callout>}
            {result.blocked && (
              <Callout tone="warning" title="prompt ถูกบล็อก">
                ถ้ามั่นใจว่าปลอดภัย ให้ติ๊ก “ข้ามการบล็อก” แล้วลองใหม่
              </Callout>
            )}
            {result.results.map((r, i) => (
              <div
                key={i}
                className={`animate-pop rounded-xl border p-3.5 ${r.ok ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-rose-400/25 bg-rose-400/[0.05]"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all font-mono text-[12.5px] text-gray-100">{r.provider}/{r.model}</span>
                  <span className="flex items-center gap-1.5">
                    <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "สำเร็จ" : "ล้มเหลว"}</Badge>
                    <Badge tone="neutral"><span className="tabular-nums">{r.status ?? "—"} · {r.latencyMs}ms</span></Badge>
                  </span>
                </div>
                {r.error && <div className="mt-1.5 text-rose-200">{r.error}</div>}
                {r.outputPreview && (
                  <div className="mt-2 whitespace-pre-wrap break-words text-gray-300">
                    <span className="tabular-nums text-[var(--muted)]">{r.promptTokens ?? 0}+{r.completionTokens ?? 0} tok · </span>
                    {r.outputPreview}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
