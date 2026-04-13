"use client";

import { useCallback, useEffect, useState } from "react";

interface CodegenEntry {
  id: number;
  filename: string;
  purpose: string;
  kind: string;
  sizeBytes: number;
  lines: number;
  source: string | null;
  outcome: string | null;
  createdAt: string;
}

interface CodegenResponse {
  entries: CodegenEntry[];
  totalCount: number;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_META: Record<string, { icon: string; color: string }> = {
  analysis: { icon: "🔬", color: "text-cyan-300" },
  migration: { icon: "🗃", color: "text-violet-300" },
  script: { icon: "📜", color: "text-amber-300" },
  test: { icon: "🧪", color: "text-pink-300" },
  component: { icon: "🧩", color: "text-indigo-300" },
  api: { icon: "🌐", color: "text-emerald-300" },
  fix: { icon: "🔧", color: "text-orange-300" },
  refactor: { icon: "♻️", color: "text-teal-300" },
  feature: { icon: "✨", color: "text-fuchsia-300" },
  other: { icon: "📄", color: "text-gray-400" },
};

function outcomeIcon(outcome: string | null): string {
  if (!outcome) return "⏳";
  if (/success|ok|passed|200/i.test(outcome)) return "✅";
  if (/fail|error|500|❌/i.test(outcome)) return "❌";
  return "⏳";
}

export function CodegenPanel() {
  const [data, setData] = useState<CodegenResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/codegen");
      if (res.ok) setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const empty = !data || data.entries.length === 0;

  return (
    <div className="glass rounded-lg p-2 border border-white/10">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">💾</span>
        <h2 className="text-3xl font-black text-white">
          โค้ดที่ระบบสร้างขึ้น
        </h2>
        <span className="text-sm text-gray-400">{data?.totalCount ?? 0} ไฟล์</span>
        <span className="text-sm text-gray-600">· refresh 15s</span>
      </div>

      <p className="text-sm text-gray-400 mb-2">
        ไฟล์ code / script / analysis ที่ AI สร้างขึ้นเพื่อวิเคราะห์ optimize หรือแก้ไขตัวเอง — ไม่มี hardcode
      </p>

      {loading ? (
        <div className="text-base text-gray-500 py-3">กำลังโหลด…</div>
      ) : empty ? (
        <div className="text-base text-gray-500 py-6 text-center">
          ยังไม่มี code generation logs — ระบบจะเริ่มบันทึกเมื่อมีการสร้างไฟล์อัตโนมัติ
          <div className="text-sm text-gray-600 mt-2 font-mono">
            Sources: worker auto-analysis · self-healing scripts · schema migrations
          </div>
        </div>
      ) : (
        <div className="space-y-0.5 font-mono text-base">
          {data.entries.map((e) => {
            const meta = KIND_META[e.kind] ?? KIND_META.other;
            return (
              <div
                key={e.id}
                className="flex items-start gap-2 py-1 border-b border-gray-800/40 last:border-0"
              >
                <span className="text-gray-500 shrink-0 w-12">
                  {formatRelative(e.createdAt)}
                </span>
                <span className="shrink-0 text-xl" title={e.kind}>
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate ${meta.color} text-lg font-semibold`}>{e.filename}</span>
                    <span className="shrink-0 text-gray-500">
                      {outcomeIcon(e.outcome)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 truncate">
                    {e.purpose}
                  </div>
                  {e.outcome && (
                    <div className="text-sm text-gray-500 truncate italic">
                      → {e.outcome}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right text-sm text-gray-500">
                  <div>{e.lines}L</div>
                  <div>{formatBytes(e.sizeBytes)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
