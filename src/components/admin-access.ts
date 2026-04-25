"use client";

type WhoAmI =
  | { loggedIn: false }
  | { loggedIn: true; source: "google"; role: "admin" | "guest"; email: string }
  | { loggedIn: true; source: "password"; role: "admin"; email: null };

let adminAccessPromise: Promise<boolean> | null = null;

export function getAdminAccess(): Promise<boolean> {
  adminAccessPromise ??= fetch("/api/auth/whoami", {
    credentials: "include",
    cache: "no-store",
  })
    .then((res) => (res.ok ? (res.json() as Promise<WhoAmI>) : { loggedIn: false } as WhoAmI))
    .then((me) => Boolean(me.loggedIn && me.role === "admin"))
    .catch(() => false);

  return adminAccessPromise;
}
