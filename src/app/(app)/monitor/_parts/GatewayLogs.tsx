"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, LinkButton } from "@/components/ui/ui";
import { IconBook, IconChat, IconRefresh, IconX } from "@/components/ui/icons";
import { ProviderBadge, fmtMs } from "@/components/shared";

/** Parse user message — handle legacy JSON array format from DB */
function parseUserMsg(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("[")) return raw;
  try {
    const arr = JSON.parse(raw) as Array<{ type: string; text?: string }>;
    if (Array.isArray(arr)) {
      return arr.filter((p) => p.type === "text" && p.text).map((p) => p.text).join("") || raw;
    }
  } catch { /* not JSON */ }
  return raw;
}

type RoutingExplain = {
  mode?: string;
  category?: string;
  fallbackUsed?: boolean;
  selected?: { provider?: string; model?: string; reason?: string };
  candidates?: Array<{ provider?: string; model?: string; accepted?: boolean; reason?: string }>;
};

function routingActivity(routingExplain: RoutingExplain | null | undefined): string {
  if (!routingExplain) return "—";
  const candidates = Array.isArray(routingExplain.candidates) ? routingExplain.candidates : [];
  const accepted = candidates.filter((c) => c.accepted).length;
  const mode = routingExplain.mode ? `mode:${routingExplain.mode}` : null;
  const category = routingExplain.category ? `cat:${routingExplain.category}` : null;
  const fallback = routingExplain.fallbackUsed ? "fallback" : null;
  return [mode, category, candidates.length ? `${accepted}/${candidates.length} candidates` : null, fallback]
    .filter(Boolean)
    .join(" · ") || "—";
}

function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "—";
}

function fmtLogTime(iso: string): string {
  const raw = iso.includes("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(raw).toLocaleString("th-TH", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface GatewayLog {
  id: number | string;
  requestModel: string;
  resolvedModel: string | null;
  provider: string | null;
  status: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  userMessage: string | null;
  assistantMessage: string | null;
  requestId: string | null;
  clientIp: string | null;
  routingExplain: RoutingExplain | null;
  createdAt: string;
}

const isOk = (status: number) => status >= 200 && status < 300;

const STATUS_FILTERS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "ok", label: "สำเร็จ" },
  { id: "error", label: "ผิดพลาด" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["id"];

const TH = "whitespace-nowrap px-3 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted)]";
const FIELD = "rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[13px] text-gray-200 placeholder:text-gray-500";

/** Request log (polled every 2s) with status / provider / text filters and a detail dialog. Owner-only data. */
export function GatewayLogs() {
  const [logs, setLogs] = useState<GatewayLog[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [provider, setProvider] = useState("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<GatewayLog | null>(null);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    const load = async () => {
      try {
        const g = await fetch("/api/gateway-logs").then((r) => r.json());
        if (alive) setLogs(Array.isArray(g) ? g : Array.isArray(g.logs) ? g.logs : []);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, 2_000);
    return () => { alive = false; clearInterval(t); };
  }, [paused]);

  const providers = useMemo(
    () => [...new Set((logs ?? []).map((l) => l.provider).filter((p): p is string => !!p))].sort(),
    [logs],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (logs ?? []).filter((l) => {
      if (status === "ok" && !isOk(l.status)) return false;
      if (status === "error" && isOk(l.status)) return false;
      if (provider !== "all" && l.provider !== provider) return false;
      if (!q) return true;
      const hay = [l.requestModel, l.resolvedModel, l.provider, l.requestId, l.error, parseUserMsg(l.userMessage), l.assistantMessage]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [logs, status, provider, query]);

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          icon={<IconBook size={18} />}
          title="คำขอล่าสุด"
          subtitle="ทุกคำขอที่ผ่าน gateway: ใครเรียกโมเดลอะไร ผลเป็นอย่างไร ใช้เวลาเท่าไหร่ — คลิกแถวเพื่อดูรายละเอียด"
          action={
            <div className="flex items-center gap-2">
              <Badge tone={paused ? "warning" : "success"} dot={!paused}>{paused ? "หยุดชั่วคราว" : "LIVE"}</Badge>
              <Button size="sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
                <IconRefresh size={14} /> {paused ? "เล่นต่อ" : "หยุด"}
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <div className="flex gap-1" role="group" aria-label="กรองตามสถานะ">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatus(f.id)}
                aria-pressed={status === f.id}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
                  status === f.id
                    ? "border-violet-400/40 bg-violet-400/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-[var(--muted)] hover:text-gray-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="กรองตามผู้ให้บริการ" className={FIELD}>
            <option value="all">ทุก provider</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาโมเดล, ข้อความ, request id"
            aria-label="ค้นหาในคำขอ"
            className={`${FIELD} min-w-0 flex-1 sm:max-w-xs`}
          />
          <span className="ml-auto text-[12px] tabular-nums text-[var(--muted)]">
            {logs ? `${rows.length}/${logs.length} รายการ` : ""}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto border-t border-white/5">
          {!logs ? (
            <div className="space-y-2 p-5" aria-busy="true">
              <div className="skeleton h-10" />
              <div className="skeleton h-10" />
              <div className="skeleton h-10" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={<IconChat size={22} />}
              title="ยังไม่มีคำขอเข้ามา"
              description="ลองส่งแชทในหน้าทดลอง หรือเชื่อมแอปของคุณกับ gateway แล้วคำขอจะปรากฏที่นี่แบบเรียลไทม์"
              action={<LinkButton href="/playground" variant="primary" size="sm">ไปหน้าทดลองแชท</LinkButton>}
            />
          ) : rows.length === 0 ? (
            <EmptyState title="ไม่พบรายการที่ตรงกับตัวกรอง" description="ลองเปลี่ยนสถานะ provider หรือคำค้นหา" />
          ) : (
            <table className="w-full min-w-[1000px] text-[13px]">
              <thead>
                <tr className="border-b border-white/10 text-left">
                  <th className={TH}>เวลา</th>
                  <th className={TH}>สถานะ</th>
                  <th className={TH}>โมเดล (ขอ → ใช้จริง)</th>
                  <th className={TH}>Provider</th>
                  <th className={`${TH} text-right`}>Latency</th>
                  <th className={`${TH} text-right`}>In / Out</th>
                  <th className={TH}>การเลือกโมเดล</th>
                  <th className={TH}>ขาเข้า / ขาออก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((log) => (
                  <tr key={log.id} className="cursor-pointer transition-colors hover:bg-white/[0.04]" onClick={() => setDetail(log)}>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px] tabular-nums text-[var(--muted)]">{fmtLogTime(log.createdAt)}</td>
                    <td className="px-3 py-2.5"><Badge tone={isOk(log.status) ? "success" : "danger"}>{log.status}</Badge></td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[12px] text-violet-200">{log.requestModel}</div>
                      <div className="max-w-[260px] truncate font-mono text-[12px] text-gray-400" title={log.resolvedModel ?? undefined}>→ {log.resolvedModel ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2.5">{log.provider ? <ProviderBadge provider={log.provider} /> : <span className="text-gray-600">—</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-gray-300">{fmtMs(log.latencyMs)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-[var(--muted)]">
                      {log.inputTokens.toLocaleString()} / {log.outputTokens.toLocaleString()}
                    </td>
                    <td className="min-w-[200px] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--muted)]">
                      <div>{routingActivity(log.routingExplain)}</div>
                      <div className="font-mono text-gray-600">req:{shortId(log.requestId)}</div>
                    </td>
                    <td className="min-w-[340px] max-w-[460px] px-3 py-2.5">
                      <button
                        className="block w-full text-left text-gray-300 transition-colors hover:text-white"
                        onClick={(e) => { e.stopPropagation(); setDetail(log); }}
                        aria-label={`ดูรายละเอียดคำขอ ${shortId(log.requestId)}`}
                      >
                        {log.error ? (
                          <span className="line-clamp-2 text-rose-300">{log.error.slice(0, 220)}</span>
                        ) : (
                          <span className="block space-y-0.5">
                            <span className="line-clamp-2 block text-cyan-200">→ {parseUserMsg(log.userMessage)?.slice(0, 180) ?? "—"}</span>
                            <span className="line-clamp-2 block text-emerald-200/80">← {log.assistantMessage?.slice(0, 180) ?? "stream / ไม่มีข้อความที่บันทึก"}</span>
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {detail && <LogDetail log={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">{label}</div>
      <div className="break-all font-mono text-[13px] text-gray-200">{children}</div>
    </div>
  );
}

function LogDetail({ log, onClose }: { log: GatewayLog; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="รายละเอียดคำขอ"
        className="card animate-pop max-h-[88vh] w-full max-w-5xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0b0d14]/95 px-5 py-3.5 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge tone={isOk(log.status) ? "success" : "danger"}>{log.status}</Badge>
            {log.provider && <ProviderBadge provider={log.provider} />}
            <span className="text-[12px] tabular-nums text-[var(--muted)]">{fmtMs(log.latencyMs)}</span>
          </div>
          <button onClick={onClose} aria-label="ปิดหน้าต่าง" autoFocus className="btn btn-ghost btn-sm">
            <IconX size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Request ID">{log.requestId ?? "—"}</Field>
            <Field label="Client">{log.clientIp ?? "—"}</Field>
            <Field label="Tokens ขาเข้า / ขาออก">{log.inputTokens.toLocaleString()} / {log.outputTokens.toLocaleString()}</Field>
          </div>

          <div>
            <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">การเลือกโมเดล</div>
            <div className="break-all font-mono text-[13px] text-violet-200">{log.requestModel} → {log.resolvedModel ?? "—"}</div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">{routingActivity(log.routingExplain)}</div>
          </div>

          {log.error && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">Error</div>
              <div className="whitespace-pre-wrap break-all rounded-xl border border-rose-400/20 bg-rose-400/[0.07] p-3 font-mono text-[13px] text-rose-300">{log.error}</div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-cyan-300">ขาเข้า: ข้อความผู้ใช้</div>
              <div className="min-h-32 whitespace-pre-wrap break-all rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-3 text-[13px] text-gray-200">
                {parseUserMsg(log.userMessage) ?? "—"}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-emerald-300">ขาออก: คำตอบ AI / ผลลัพธ์</div>
              <div className="min-h-32 whitespace-pre-wrap break-all rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-[13px] text-gray-200">
                {log.assistantMessage ?? "stream / ไม่มีข้อความที่บันทึก"}
              </div>
            </div>
          </div>

          {log.routingExplain && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">รายละเอียดการเลือกโมเดลทั้งหมด (JSON)</div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-all rounded-xl bg-black/40 p-3 font-mono text-[12px] text-gray-300">
                {JSON.stringify(log.routingExplain, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
