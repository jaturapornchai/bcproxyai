"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  CodeBlock,
  EmptyState,
  PageHeader,
  Reveal,
} from "@/components/ui/ui";
import { IconArrowRight, IconCheck, IconKey } from "@/components/ui/icons";

interface KeyRow {
  id: number;
  keyPrefix: string;
  label: string;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  enabled: boolean;
  notes: string | null;
}

interface CreatedKey {
  id: number;
  keyPrefix: string;
  label: string;
  plaintext: string;
  createdAt: string;
  expiresAt: string | null;
}

const INPUT =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[14px] text-gray-100 outline-none transition placeholder:text-gray-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20 disabled:cursor-not-allowed disabled:opacity-40 [color-scheme:dark]";

const STEPS = [
  { title: "สร้าง key", desc: "ตั้งชื่อให้จำง่าย เช่น ทีม CRM หรือ แล็ปท็อปของฉัน" },
  { title: "คัดลอกเก็บไว้", desc: "key เต็มจะแสดงครั้งเดียวตอนสร้างเท่านั้น" },
  { title: "ใส่ในแอปของคุณ", desc: "ตั้ง base URL + API key แล้วเรียกใช้ได้เลย" },
];

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "—";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-gray-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

// Native <dialog>: focus trap, Esc and top-layer backdrop for free.
function Modal({
  title,
  dismissible = true,
  onClose,
  children,
}: {
  title: string;
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[min(520px,calc(100vw-2rem))] bg-transparent p-0 text-inherit backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="reveal card p-5 sm:p-6">{children}</div>
    </dialog>
  );
}

// Access is enforced by the server-side admin/layout.tsx guard.
export default function AdminKeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState("https://your-server/v1");
  useEffect(() => {
    setApiBase(`${window.location.origin}/v1`);
  }, []);

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<KeyRow | null>(null);

  const fetchKeys = useCallback(() => {
    fetch("/api/admin/keys")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setKeys(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const closeCreate = () => {
    setCreateOpen(false);
    setCreated(null);
    setCreateError(null);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          expiresAt: neverExpires ? undefined : expiresAt || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setCreated(data);
        setLabel("");
        setExpiresAt("");
        setNeverExpires(true);
        setNotes("");
        fetchKeys();
      } else {
        setCreateError("สร้างไม่สำเร็จ: " + (data.error ?? "unknown"));
      }
    } catch (err) {
      setCreateError("เชื่อมต่อไม่ได้: " + err);
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    const { id } = revokeTarget;
    setRevokeTarget(null);
    try {
      const res = await fetch(`/api/admin/keys/${id}`, { method: "DELETE" });
      if (!res.ok) setError("ยกเลิก key ไม่สำเร็จ (HTTP " + res.status + ")");
    } catch (err) {
      setError("เชื่อมต่อไม่ได้: " + err);
    }
    fetchKeys();
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      const res = await fetch(`/api/admin/keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) setError("เปลี่ยนสถานะ key ไม่สำเร็จ (HTTP " + res.status + ")");
    } catch (err) {
      setError("เชื่อมต่อไม่ได้: " + err);
    }
    fetchKeys();
  };

  const activeCount = keys.filter((k) => k.enabled).length;

  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่า"
        title="API key ของแอป"
        description="API key คือ “รหัสผ่าน” ที่ให้แอปหรือเครื่องของคุณใช้เรียก BCAiRouter แทนการใช้ key ของผู้ให้บริการโดยตรง สร้างแยกตามแอป/ทีม เพื่อปิดหรือยกเลิกได้ง่ายเมื่อไม่ใช้แล้ว"
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <IconKey size={16} /> สร้าง key ใหม่
          </Button>
        }
      />

      {error && (
        <div className="reveal mb-6">
          <Callout tone="warning" title="เกิดข้อผิดพลาด">
            {error}{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => setError(null)}>
              ปิด
            </button>
          </Callout>
        </div>
      )}

      <Reveal i={1}>
        <Card className="p-5">
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, n) => (
              <li key={s.title} className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-400/20 text-[13px] font-semibold text-white ring-1 ring-white/15">
                  {n + 1}
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-white">{s.title}</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </Reveal>

      <Reveal i={2} className="mt-6">
        <Card>
          <CardHeader
            icon={<IconKey size={18} />}
            title="key ทั้งหมด"
            subtitle={loading ? "กำลังโหลด…" : `ทั้งหมด ${keys.length} · เปิดใช้งานอยู่ ${activeCount}`}
          />
          {loading ? (
            <div className="space-y-3 p-5">
              <div className="skeleton h-14" />
              <div className="skeleton h-14" />
            </div>
          ) : keys.length === 0 ? (
            <EmptyState
              icon={<IconKey size={22} />}
              title="ยังไม่มี key"
              description="สร้าง key แรกเพื่อให้แอปของคุณเริ่มเรียกใช้ BCAiRouter ได้"
              action={
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  สร้าง key แรก
                </Button>
              }
            />
          ) : (
            <ul className="mt-4 divide-y divide-white/5 border-t border-white/5">
              {keys.map((k) => {
                const expired = Boolean(k.expiresAt && new Date(k.expiresAt) < new Date());
                const dim = k.enabled && !expired ? "" : "opacity-60";
                return (
                  <li
                    key={k.id}
                    className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-5"
                  >
                    <div className={`min-w-0 ${dim}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all text-[14.5px] font-semibold text-white">{k.label}</span>
                        <code className="rounded-md bg-violet-400/10 px-1.5 py-0.5 font-mono text-[11px] text-violet-200">
                          {k.keyPrefix}…
                        </code>
                        {expired ? (
                          <Badge tone="danger">หมดอายุ</Badge>
                        ) : k.enabled ? (
                          <Badge tone="success" dot>ใช้งานอยู่</Badge>
                        ) : (
                          <Badge>ปิดอยู่</Badge>
                        )}
                      </div>
                      {k.notes && <p className="mt-1.5 text-[12.5px] italic text-[var(--muted)]">{k.notes}</p>}
                    </div>
                    <div className={`space-y-0.5 text-[12.5px] tabular-nums text-[var(--muted)] ${dim}`}>
                      <div>
                        สร้าง: <span className="text-gray-300">{fmt(k.createdAt)}</span>
                        {k.createdBy ? ` โดย ${k.createdBy}` : ""}
                      </div>
                      <div>
                        ใช้ล่าสุด: <span className="text-gray-300">{k.lastUsedAt ? fmt(k.lastUsedAt) : "ยังไม่เคยใช้"}</span>
                      </div>
                      {k.expiresAt && (
                        <div>
                          หมดอายุ: <span className="text-gray-300">{fmt(k.expiresAt)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={k.enabled}
                        aria-label={`${k.enabled ? "ปิด" : "เปิด"}ใช้งาน key ${k.label}`}
                        title={k.enabled ? "ปิดชั่วคราว" : "เปิดใช้งาน"}
                        onClick={() => handleToggle(k.id, k.enabled)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ${k.enabled ? "bg-emerald-500/80" : "bg-white/15"}`}
                      >
                        <span
                          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${k.enabled ? "translate-x-5" : ""}`}
                        />
                      </button>
                      <Button
                        size="sm"
                        className="text-rose-300!"
                        aria-label={`ยกเลิก key ${k.label}`}
                        onClick={() => setRevokeTarget(k)}
                      >
                        ยกเลิก key
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </Reveal>

      <Reveal i={3} className="mt-6">
        <Card className="pb-5">
          <CardHeader
            icon={<IconArrowRight size={18} />}
            title="วิธีใช้ key กับ BCAiRouter"
            subtitle="ใช้ได้กับทุกโปรแกรมที่รองรับ OpenAI API — แค่เปลี่ยน base URL และใส่ key ของคุณ"
          />
          <div className="mt-4 space-y-3 px-5">
            <CodeBlock
              label="ตัวอย่าง (curl)"
              code={`# OpenAI SDK (Python/Node)
base_url = "${apiBase}"
api_key  = "bcai_live_xxxxxxxxxxxx"

# cURL
curl ${apiBase}/chat/completions \\
  -H "Authorization: Bearer bcai_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"bcai/auto","messages":[{"role":"user","content":"สวัสดี"}]}'`}
            />
            <p className="text-[13px] text-[var(--muted)]">
              ดูตัวอย่างทุก framework (LangChain, Hermes Agent, OpenClaw, …) ได้ที่{" "}
              <Link href="/guide" className="text-violet-300 underline-offset-2 hover:underline">
                คู่มือ
              </Link>
            </p>
          </div>
        </Card>
      </Reveal>

      {createOpen && (
        <Modal title="สร้าง API key ใหม่" dismissible={!created && !creating} onClose={closeCreate}>
          <div className="mb-5 flex items-center gap-2 text-[12px] font-medium">
            <Badge tone={created ? "success" : "accent"}>{created ? <IconCheck size={12} /> : "1"} ตั้งชื่อ</Badge>
            <span className="h-px w-6 bg-white/15" />
            <Badge tone={created ? "accent" : "neutral"}>2 คัดลอก key</Badge>
          </div>

          {created ? (
            <div className="space-y-4">
              <Callout tone="success" title={`สร้าง key “${created.label}” สำเร็จ`}>
                คัดลอก key ด้านล่างไปใส่ในแอปของคุณได้เลย
              </Callout>
              <CodeBlock label="API key (แสดงครั้งเดียว)" code={created.plaintext} />
              <Callout tone="warning" title="เก็บไว้ตอนนี้ จะไม่แสดงอีก">
                ระบบเก็บเฉพาะ hash ไม่สามารถดูย้อนหลังได้ ถ้าทำหาย ต้องสร้าง key ใหม่
              </Callout>
              <div className="flex justify-end">
                <Button variant="primary" onClick={closeCreate}>
                  <IconCheck size={16} /> เก็บ key แล้ว ปิดหน้าต่าง
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <h2 className="text-[17px] font-semibold text-white">ตั้งชื่อ key</h2>
              <Field label="ชื่อ / label" hint="ตั้งให้รู้ว่าใครหรือแอปไหนใช้ เช่น “ทีม CRM”, “jead-laptop”">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="เช่น ทีม CRM"
                  maxLength={80}
                  autoFocus
                  className={INPUT}
                />
              </Field>
              <div className="space-y-2">
                <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-gray-200">
                  <input
                    type="checkbox"
                    checked={neverExpires}
                    onChange={(e) => setNeverExpires(e.target.checked)}
                    className="h-4 w-4 accent-violet-500"
                  />
                  ไม่หมดอายุ
                </label>
                {!neverExpires && (
                  <Field label="วันหมดอายุ">
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      className={INPUT}
                    />
                  </Field>
                )}
              </div>
              <Field label="โน้ต (ไม่บังคับ)" hint="จดไว้ว่าใช้ที่ไหน เพื่ออะไร">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className={`${INPUT} resize-none`}
                />
              </Field>
              {createError && <Callout tone="warning">{createError}</Callout>}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" onClick={closeCreate} disabled={creating}>
                  ยกเลิก
                </Button>
                <Button type="submit" variant="primary" disabled={creating || !label.trim()}>
                  {creating ? "กำลังสร้าง…" : "สร้าง key"}
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {revokeTarget && (
        <Modal title="ยืนยันการยกเลิก key" onClose={() => setRevokeTarget(null)}>
          <h2 className="text-[17px] font-semibold text-white">ยกเลิก key “{revokeTarget.label}”?</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--muted)]">
            ผู้ถือ key นี้ (<code className="font-mono text-violet-200">{revokeTarget.keyPrefix}…</code>) จะใช้งานไม่ได้ทันที
            และกู้คืนไม่ได้ — หากแค่ต้องการหยุดชั่วคราว ให้ใช้สวิตช์ปิดแทน
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setRevokeTarget(null)}>เก็บ key ไว้</Button>
            <Button variant="primary" className="bg-none! bg-rose-600!" onClick={confirmRevoke}>
              ยืนยัน ยกเลิก key
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
