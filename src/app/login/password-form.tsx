"use client";

import { useState } from "react";

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
    <form onSubmit={handleSubmit} className="space-y-2">
      <label className="block text-xs text-neutral-400">Admin password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        autoFocus
        className="w-full rounded-md bg-neutral-950 border border-neutral-700 focus:border-indigo-500/60 focus:outline-none px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 font-mono"
      />
      <button
        type="submit"
        disabled={submitting || !password}
        className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium px-4 py-2.5 transition"
      >
        {submitting ? "กำลังเข้า…" : "เข้าด้วย password"}
      </button>
      {err && <div className="text-xs text-red-300">✗ {err}</div>}
    </form>
  );
}
