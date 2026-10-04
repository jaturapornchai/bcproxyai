"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getAdminAccess } from "@/components/admin-access";
import { Analytics } from "@/components/Analytics";
import type { AnalyticsData } from "@/components/Analytics";
import { ExamLevelPanel } from "@/components/ExamLevelPanel";
import { ModelGrid } from "@/components/ModelGrid";
import { ProviderCatalogPanel } from "@/components/ProviderCatalogPanel";
import { SpeedRace } from "@/components/SpeedRace";
import { LiveNumber, StatsCards } from "@/components/StatsCards";
import { TeachersPanel } from "@/components/TeachersPanel";
import { WarmupPanel } from "@/components/WarmupPanel";
import type { LeaderboardEntry, ModelData, StatusData } from "@/components/shared";
import { IconCheck, IconCube, IconPlug, IconPulse, IconRefresh, IconSparkle } from "@/components/ui/icons";
import { Button, Callout, LinkButton, PageHeader, Reveal, Stat, Tabs } from "@/components/ui/ui";
import { Leaderboard } from "./_parts/Leaderboard";
import { ModelChanges, hasModelChanges } from "./_parts/ModelChanges";
import { ProviderStatusGrid } from "./_parts/ProviderStatusGrid";
import type { ProviderStatus } from "./_parts/ProviderStatusGrid";
import { WorkerStatusCard } from "./_parts/WorkerStatusCard";

// ─── Tabs (persisted in the URL hash, e.g. /models#exam) ──────────────────────

const TABS = [
  { id: "rankings", label: "อันดับ", icon: <IconSparkle size={15} /> },
  { id: "models", label: "โมเดลทั้งหมด", icon: <IconCube size={15} /> },
  { id: "exam", label: "ผลสอบ", icon: <IconCheck size={15} /> },
  { id: "providers", label: "ผู้ให้บริการ", icon: <IconPlug size={15} /> },
  { id: "stats", label: "สถิติ", icon: <IconPulse size={15} /> },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Old dashboard anchors still resolve to the tab that now owns the section.
const HASH_TO_TAB: Record<string, TabId> = {
  rankings: "rankings", "speed-race": "rankings",
  models: "models", "all-models": "models",
  exam: "exam", status: "exam", "exam-level": "exam", teachers: "exam", warmup: "exam",
  providers: "providers", "provider-catalog": "providers",
  stats: "stats", analytics: "stats",
};

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const readHash = () => window.location.hash.slice(1);
const serverHash = () => "";

function useHashTab(): [TabId, (id: TabId) => void] {
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  return [HASH_TO_TAB[hash] ?? "rankings", (id) => { window.location.hash = id; }];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ModelsPage() {
  const [tab, setTab] = useHashTab();

  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [models, setModels] = useState<ModelData[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const admin = await getAdminAccess();
      const [s, m, l, an, ps] = await Promise.all([
        admin ? fetch("/api/status").then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
        fetch("/api/models").then((r) => r.json()),
        fetch("/api/leaderboard").then((r) => r.json()),
        fetch("/api/analytics").then((r) => r.json()).catch(() => null),
        admin ? fetch("/api/providers").then((r) => (r.ok ? r.json() : [])).catch(() => []) : Promise.resolve([]),
      ]);
      setIsAdmin(admin);
      setStatusData(s && typeof s === "object" && "worker" in s ? s : null);
      setModels(Array.isArray(m) ? m : []);
      setLeaderboard(Array.isArray(l) ? l : []);
      if (an) setAnalyticsData(an);
      if (Array.isArray(ps)) setProviderStatuses(ps);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 15_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const triggerWorker = async () => {
    setTriggering(true);
    try {
      if (!(await getAdminAccess())) return;
      await fetch("/api/worker", { method: "POST" });
      await fetchAll();
    } finally {
      setTriggering(false);
    }
  };

  // Same provider+model id = duplicate; id is already "provider:model_id"
  const deduped = models.filter((m, i) => models.findIndex((x) => x.id === m.id) === i);
  const availableModels = deduped.filter((m) => m.health.status === "available");
  const cooldownModels = deduped.filter((m) => m.health.status === "cooldown");
  const unknownModels = deduped.filter((m) => m.health.status === "unknown");
  const sortedModels = [...availableModels, ...cooldownModels, ...unknownModels];

  const stats = statusData?.stats;
  const modelChanges = statusData?.modelChanges;
  const providerCount = new Set(deduped.map((m) => m.provider)).size;
  const availablePct = deduped.length > 0 ? Math.round((availableModels.length / deduped.length) * 100) : 0;

  const goExam = (
    <Button variant="primary" onClick={() => setTab("exam")}>ไปที่แท็บผลสอบ</Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="Models & Leaderboard"
        title="โมเดล & อันดับ"
        description="ดูว่าโมเดล AI ฟรีตัวไหนพร้อมใช้ ใครสอบได้คะแนนดีที่สุด และตอบเร็วแค่ไหน — ระบบสอบและคัดเลือกให้อัตโนมัติ"
        actions={
          <Button onClick={fetchAll} aria-label="รีเฟรชข้อมูล">
            <IconRefresh size={16} /> รีเฟรช
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Reveal i={0}>
          <Stat
            label="โมเดลทั้งหมด"
            tone="accent"
            icon={<IconCube size={16} />}
            loading={loading}
            value={<LiveNumber value={deduped.length} />}
            hint={`จากผู้ให้บริการ ${providerCount} เจ้า`}
          />
        </Reveal>
        <Reveal i={1}>
          <Stat
            label="พร้อมใช้"
            tone="success"
            icon={<IconCheck size={16} />}
            loading={loading}
            value={<LiveNumber value={availableModels.length} />}
            hint={`${availablePct}% ของทั้งหมด`}
          />
        </Reveal>
        <Reveal i={2}>
          <Stat
            label="สอบผ่าน"
            tone="info"
            icon={<IconSparkle size={16} />}
            loading={loading}
            value={stats ? <LiveNumber value={stats.passedExam} /> : "—"}
            hint={stats ? `สอบตก ${stats.failedExam} · รอสอบ ${Math.max(0, stats.totalModels - stats.passedExam - stats.failedExam)}` : "ดูได้เฉพาะผู้ดูแลระบบ"}
          />
        </Reveal>
        <Reveal i={3}>
          <Stat
            label="ติด cooldown"
            tone="warning"
            icon={<IconPulse size={16} />}
            loading={loading}
            value={<LiveNumber value={cooldownModels.length} />}
            hint="พักชั่วคราว แล้วลองใหม่เอง"
          />
        </Reveal>
      </div>

      <Reveal i={4} className="mt-5">
        <Callout title="ระบบสอบโมเดลทำงานยังไง?">
          ทุก 15 นาที “ครูใหญ่” (ระบบอัตโนมัติ) จะทำ 3 ขั้นตอน: <strong className="text-white">1)</strong> สแกนรายการโมเดลฟรี{" "}
          <strong className="text-white">2)</strong> ตรวจว่าโมเดลตอบได้จริงและตอบเร็วแค่ไหน{" "}
          <strong className="text-white">3)</strong> ให้ทำข้อสอบหลายหมวด (ไทย โค้ด เลข ฯลฯ) แล้วจัดอันดับ — โมเดลที่คะแนนถึงเกณฑ์จะ “สอบผ่าน” และถูกเลือกใช้เมื่อมีคำขอเข้ามา
          ส่วนตัวที่ติดโควต้าหรือตอบไม่ได้จะเข้า <strong className="text-white">cooldown</strong> พักชั่วคราวแล้วลองใหม่เอง{" "}
          <button type="button" onClick={() => setTab("exam")} className="font-medium text-cyan-200 underline underline-offset-2 hover:text-white">
            ปรับความยากของข้อสอบได้ที่แท็บผลสอบ
          </button>
        </Callout>
      </Reveal>

      <div className="mb-6 mt-6">
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label} className="space-y-6">
        {tab === "rankings" && (
          <>
            <Reveal i={0}>
              <Leaderboard leaderboard={leaderboard} loading={loading} emptyAction={goExam} />
            </Reveal>
            <Reveal i={1}>
              <SpeedRace models={deduped} loading={loading} />
            </Reveal>
          </>
        )}

        {tab === "models" && (
          <Reveal i={0}>
            <ModelGrid
              sortedModels={sortedModels}
              availableCount={availableModels.length}
              cooldownCount={cooldownModels.length}
              unknownCount={unknownModels.length}
              loading={loading}
            />
          </Reveal>
        )}

        {tab === "exam" && (
          <>
            {isAdmin === false && (
              <Reveal i={0}>
                <Callout tone="warning" title="สถานะระบบตรวจสอบเปิดให้เฉพาะผู้ดูแล">
                  ล็อกอินด้วยบัญชีผู้ดูแลเพื่อดูสถานะครูใหญ่ สถิติสอบ และสั่งสอบใหม่ — ส่วนระดับข้อสอบและคณะครูด้านล่างดูได้ปกติ
                </Callout>
              </Reveal>
            )}
            {isAdmin && (
              <>
                <Reveal i={0}>
                  <WorkerStatusCard
                    worker={statusData?.worker}
                    isAdmin={isAdmin}
                    triggering={triggering}
                    lastRefresh={lastRefresh}
                    onTrigger={triggerWorker}
                  />
                </Reveal>
                <Reveal i={1}><StatsCards stats={stats} loading={loading} /></Reveal>
                {hasModelChanges(modelChanges) && (
                  <Reveal i={2}><ModelChanges changes={modelChanges} /></Reveal>
                )}
              </>
            )}
            <Reveal i={3}><ExamLevelPanel /></Reveal>
            <Reveal i={4}><TeachersPanel /></Reveal>
            {isAdmin && <Reveal i={5}><WarmupPanel /></Reveal>}
          </>
        )}

        {tab === "providers" && (
          <>
            <Reveal i={0}>
              <ProviderStatusGrid providers={providerStatuses} isAdmin={isAdmin} loading={loading} />
            </Reveal>
            <Reveal i={1}><ProviderCatalogPanel /></Reveal>
            <Reveal i={2}>
              <Callout title="ยังไม่ได้ใส่ API key?">
                โมเดลของผู้ให้บริการแต่ละเจ้าจะใช้งานได้ต่อเมื่อมี API key —{" "}
                <LinkButton href="/setup" size="sm" className="ml-1 align-middle">ไปใส่ API key</LinkButton>
              </Callout>
            </Reveal>
          </>
        )}

        {tab === "stats" && (
          <Reveal i={0}>
            <Analytics data={analyticsData} loading={loading} />
          </Reveal>
        )}
      </div>
    </>
  );
}
