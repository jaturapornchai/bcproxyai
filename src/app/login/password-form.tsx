"use client";

import { useState } from "react";
import { Callout } from "@/components/ui/ui";

export function PasswordLoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/password-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = next;
        return;
      }
      if (res.status === 429) setErr("พยายามผิดเกินกำหนด — รอสักครู่");
      else if (res.status === 401) setErr("Password ผิด");
      else setErr(`ล้มเหลว (${res.status})`);
    } catch {
      setErr("network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="admin-password" className="block text-[12.5px] font-medium text-gray-300">
          Admin password
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          autoFocus
          className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-white placeholder:text-gray-600 transition focus:border-violet-400/60 focus:outline-none focus:ring-2 focus:ring-violet-400/25"
        />
      </div>
      <button type="submit" disabled={submitting || !password} className="btn btn-primary w-full">
        {submitting && (
          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {submitting ? "กำลังเข้า…" : "เข้าด้วย password"}
      </button>
      {err && (
        <div role="alert">
          <Callout tone="warning">{err}</Callout>
        </div>
      )}
    </form>
  );
}
