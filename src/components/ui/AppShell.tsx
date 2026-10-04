"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavSessionChip } from "@/components/NavSessionChip";
import { Tour, openTour } from "./Tour";
import {
  IconBook, IconChat, IconCompass, IconCube, IconHome, IconKey, IconMenu, IconPlug, IconPulse, IconServer, IconSparkle, IconX,
} from "./icons";

type NavItem = { href: string; label: string; icon: ReactNode; tour?: string; hint?: string };

const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "เริ่มต้น",
    items: [
      { href: "/", label: "ศูนย์ควบคุม 3D", icon: <IconSparkle /> },
      { href: "/overview", label: "ภาพรวม", icon: <IconHome />, tour: "nav-home", hint: "เช็กลิสต์ + สถานะ" },
    ],
  },
  {
    group: "ใช้งาน",
    items: [
      { href: "/playground", label: "ทดลองแชท", icon: <IconChat />, tour: "nav-playground" },
      { href: "/models", label: "โมเดล & อันดับ", icon: <IconCube />, tour: "nav-models" },
      { href: "/monitor", label: "มอนิเตอร์", icon: <IconPulse />, tour: "nav-monitor" },
    ],
  },
  {
    group: "ตั้งค่า",
    items: [
      { href: "/setup", label: "API key ผู้ให้บริการ", icon: <IconPlug />, tour: "nav-setup" },
      { href: "/admin/keys", label: "API key ของแอป", icon: <IconKey /> },
      { href: "/admin/providers", label: "จัดการผู้ให้บริการ", icon: <IconServer /> },
    ],
  },
  {
    group: "ช่วยเหลือ",
    items: [{ href: "/guide", label: "คู่มือ & ตัวอย่างโค้ด", icon: <IconBook />, tour: "nav-guide" }],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Drawer is open only for the path it was opened on → navigating closes it without an effect.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const drawer = drawerPath === pathname;
  const setDrawer = (open: boolean) => setDrawerPath(open ? pathname : null);

  return (
    <div className="min-h-screen lg:pl-[264px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col border-r border-white/[0.06] bg-[rgba(8,9,15,0.72)] backdrop-blur-xl lg:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.06] bg-[rgba(8,9,15,0.8)] px-4 py-3 backdrop-blur-xl lg:hidden">
        <Brand />
        <button className="btn btn-ghost btn-sm" onClick={() => setDrawer(true)} aria-label="เปิดเมนู">
          <IconMenu size={18} />
        </button>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="drawer-in absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-white/10 bg-[rgb(10,11,18)]">
            <button className="absolute right-3 top-4 rounded-lg p-1.5 text-gray-400 hover:bg-white/10" onClick={() => setDrawer(false)} aria-label="ปิดเมนู">
              <IconX size={18} />
            </button>
            <SidebarContent pathname={pathname} />
          </aside>
        </div>
      )}

      <main className="mx-auto w-full max-w-[1280px] px-4 pb-20 pt-8 sm:px-6 lg:px-10 lg:pt-10">{children}</main>
      <Tour />
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 text-[13px] font-black text-white shadow-[0_8px_24px_-8px_rgba(139,123,255,0.9)]">
        BC
        <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/30" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-white">BCAiRouter</span>
        <span className="block text-[11px] text-[var(--muted)]">AI Gateway ฟรี อัจฉริยะ</span>
      </span>
    </Link>
  );
}

function SidebarContent({ pathname }: { pathname: string }) {
  return (
    <>
      <div className="px-5 pb-4 pt-5">
        <Brand />
      </div>
      <HealthPill />
      <nav className="mt-2 flex-1 space-y-6 overflow-y-auto px-3 pb-6" aria-label="เมนูหลัก">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500">{g.group}</div>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(pathname, it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      data-tour={it.tour}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-300 ${
                        active ? "bg-white/[0.07] text-white" : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-100"
                      }`}
                    >
                      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-violet-400 to-cyan-300" />}
                      <span className={`transition-colors ${active ? "text-violet-300" : "text-gray-500 group-hover:text-gray-300"}`}>{it.icon}</span>
                      <span className="truncate">{it.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-3 border-t border-white/[0.06] p-4">
        <button onClick={openTour} className="btn btn-ghost btn-sm w-full">
          <IconCompass size={15} /> ทัวร์แนะนำ
        </button>
        <div className="flex justify-center"><NavSessionChip /></div>
      </div>
    </>
  );
}

type Health = { status: "healthy" | "degraded" | "down"; checks?: { providers?: { available?: number; total?: number } } };

function HealthPill() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: Health) => alive && setH(d))
        .catch(() => alive && setH({ status: "down" }));
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const tone = !h ? "text-gray-400" : h.status === "healthy" ? "text-emerald-300" : h.status === "degraded" ? "text-amber-300" : "text-rose-300";
  const label = !h ? "กำลังตรวจสอบ…" : h.status === "healthy" ? "ระบบทำงานปกติ" : h.status === "degraded" ? "ทำงานได้บางส่วน" : "ระบบขัดข้อง";
  const p = h?.checks?.providers;
  return (
    <Link href="/monitor" className="mx-4 mb-2 flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 transition-colors hover:bg-white/[0.06]">
      <span className={`pulse-dot h-2 w-2 shrink-0 rounded-full bg-current ${tone}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[12.5px] font-medium ${tone}`}>{label}</span>
        {p && <span className="block text-[11px] text-gray-500">โมเดลพร้อมใช้ {p.available ?? 0}/{p.total ?? 0}</span>}
      </span>
    </Link>
  );
}
