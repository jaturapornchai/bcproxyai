"use client";

import { useCallback, useEffect, useState } from "react";
import { IconServer } from "./ui/icons";
import { Badge, Card, CardHeader, EmptyState } from "./ui/ui";
import type { Tone } from "./ui/ui";

interface CatalogProvider {
  name: string;
  label: string | null;
  base_url: string;
  env_var: string | null;
  homepage: string | null;
  status: "active" | "pending" | "failed" | "paused";
  source: string;
  notes: string | null;
  free_tier: boolean;
  last_probed_at: string | null;
  probe_status_code: number | null;
  discovered_at: string;
  updated_at: string;
}

interface CatalogResponse {
  summary: {
    total: number;
    active: number;
    pending: number;
    free_tier: number;
    sources: Record<string, number>;
  };
  providers: CatalogProvider[];
}

const STATUS_STYLE: Record<CatalogProvider["status"], { label: string; tone: Tone }> = {
  active:  { label: "ใช้งานได้", tone: "success" },
  pending: { label: "รอเชื่อม",  tone: "warning" },
  failed:  { label: "ใช้ไม่ได้", tone: "danger" },
  paused:  { label: "ปิดอยู่",   tone: "neutral" },
};

const SOURCE_LABEL: Record<string, string> = {
  seed:        "ในตัวระบบ",
  openrouter:  "จาก OpenRouter",
  huggingface: "จาก HuggingFace",
  pattern:     "สแกน URL",
  manual:      "เพิ่มเอง",
};

const FILTERS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "active", label: "ใช้งานได้" },
  { id: "pending", label: "รอเชื่อม" },
] as const;

export function ProviderCatalogPanel() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  const fetchCatalog = useCallback(
    () =>
      fetch("/api/provider-catalog", { cache: "no-store" })
        .then((res) => res.json() as Promise<CatalogResponse>)
        .then(setData)
        .catch((err) => console.error("[ProviderCatalogPanel] fetch error", err)),
    [],
  );

  useEffect(() => {
    fetchCatalog();
    const t = setInterval(fetchCatalog, 30_000);
    return () => clearInterval(t);
  }, [fetchCatalog]);

  if (!data) {
    return (
      <Card className="p-5">
        <div className="skeleton mb-4 h-6 w-64" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}
        </div>
      </Card>
    );
  }

  const filtered = data.providers.filter((p) => filter === "all" || p.status === filter);

  return (
    <Card>
      <CardHeader
        title="รายชื่อผู้ให้บริการที่ระบบรู้จัก"
        subtitle="ตอนนี้ระบบใช้รายการโมเดลฟรีที่กำหนดไว้ในตัวระบบเท่านั้น (ปิดการค้นหาผู้ให้บริการใหม่อัตโนมัติ)"
        icon={<IconServer size={18} />}
        action={
          <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
            <Badge tone="success">ใช้งานได้ {data.summary.active}</Badge>
            <Badge tone="warning">รอเชื่อม {data.summary.pending}</Badge>
            <Badge tone="info">ฟรี {data.summary.free_tier}</Badge>
            <Badge>รวม {data.summary.total}</Badge>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1" role="group" aria-label="กรองตามสถานะ">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-300 ${
                filter === f.id ? "bg-white/10 text-white" : "text-[var(--muted)] hover:text-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {Object.keys(data.summary.sources).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
            <span>แหล่งข้อมูล:</span>
            {Object.entries(data.summary.sources).map(([src, count]) => (
              <Badge key={src}>{SOURCE_LABEL[src] ?? src} {count}</Badge>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconServer size={22} />}
          title={data.providers.length === 0 ? "ยังไม่มีรายการผู้ให้บริการ" : "ไม่มีผู้ให้บริการในกลุ่มนี้"}
          description={
            data.providers.length === 0
              ? "รายการจะปรากฏที่นี่เมื่อระบบบันทึกผู้ให้บริการเข้าบัญชีรายชื่อ"
              : "ลองเลือกตัวกรอง “ทั้งหมด”"
          }
        />
      ) : (
        <div className="max-h-[480px] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((p) => {
              const stat = STATUS_STYLE[p.status];
              return (
                <div
                  key={p.name}
                  className={`rounded-2xl border p-3.5 text-[12px] transition-colors hover:border-white/20 ${
                    p.status === "active" ? "border-white/10 bg-white/[0.02]" : "border-amber-400/20 bg-amber-400/[0.04]"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-white">{p.label ?? p.name}</span>
                    {p.free_tier && <Badge tone="info">ฟรี</Badge>}
                    <span className="ml-auto shrink-0"><Badge tone={stat.tone} dot={p.status === "active"}>{stat.label}</Badge></span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-[var(--muted)]" title={p.base_url}>{p.base_url}</div>
                  {p.env_var && <div className="mt-0.5 font-mono text-[10px] text-[var(--muted)]/80">ตัวแปร: {p.env_var}</div>}
                  {p.notes && <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-gray-400">{p.notes}</div>}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                    <span>แหล่ง: {SOURCE_LABEL[p.source] ?? p.source}</span>
                    {p.homepage && (
                      <a
                        href={p.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-violet-300 transition-colors hover:text-white"
                      >
                        เปิดเว็บ →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
