"use client";

import { useEffect, useState } from "react";

type WhoAmI =
  | { loggedIn: false }
  | { loggedIn: true; source: "google"; role: "admin" | "guest"; email: string }
  | { loggedIn: true; source: "password"; role: "admin"; email: null };

// Session chip for the top nav. Talks to /api/auth/whoami so it stays
// correct for both login paths (Google OAuth + password cookie).
export function NavSessionChip() {
  const [me, setMe] = useState<WhoAmI | null>(null);

  useEffect(() => {
    fetch("/api/auth/whoami")
      .then((r) => (r.ok ? r.json() : { loggedIn: false }))
      .then(setMe)
      .catch(() => setMe({ loggedIn: false }));
  }, []);

  if (!me) return null;

  if (!me.loggedIn) {
    return (
      <a
        href="/login"
        className="px-3 py-1.5 rounded-lg text-xs text-indigo-300 hover:text-white hover:bg-white/5 transition-colors border border-indigo-500/40"
        title="เข้าสู่ระบบ"
      >
        🔐 เข้าสู่ระบบ
      </a>
    );
  }

  const isAdmin = me.role === "admin";
  const isPassword = me.source === "password";
  const label = isPassword ? "admin (key)" : me.email ?? "—";
  const signOutUrl = isPassword ? "/api/auth/admin-logout" : "/api/auth/signout?callbackUrl=/";

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-200">
      <span
        className={`inline-block h-2 w-2 rounded-full ${isAdmin ? "bg-emerald-400" : "bg-amber-400"}`}
        title={isPassword ? "Admin via password" : isAdmin ? "Admin" : "Guest"}
      />
      <span className="font-mono max-w-[12rem] truncate">{label}</span>
      <span
        className={`rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
          isAdmin ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
        }`}
      >
        {isAdmin ? "admin" : "guest"}
      </span>
      <a
        href={signOutUrl}
        className="ml-0.5 text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded px-1"
        title="ออก"
      >
        ออก
      </a>
    </div>
  );
}
