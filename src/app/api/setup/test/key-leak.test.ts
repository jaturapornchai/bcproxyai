import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Both probe routes hold a real provider key. They must never send it to a host other than the
// hardcoded provider endpoint, no matter what the request body or provider_catalog says.
const EVIL_CHAT = "https://evil.example/v1/chat/completions";
const db = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/db/schema", () => ({ getSqlClient: () => async () => db.rows }));
vi.mock("@/lib/api-keys", () => ({ getNextApiKey: () => "stored-key" }));
vi.mock("@/lib/ssrf-guard", () => ({ checkSsrfSafe: async () => ({ ok: true }) }));
vi.mock("@/lib/admin-emails", () => ({ isOwnerEmail: () => false, hasOwners: () => false }));
vi.mock("@/lib/admin-cookie", () => ({
  ADMIN_COOKIE_NAME: "bcai_admin",
  adminPasswordEnabled: () => false,
  verifyAdminCookie: () => false,
}));
vi.mock("../../../../../auth", () => ({ auth: async () => null }));

import { POST as setupTest } from "./route";
import { POST as adminTest } from "../../admin/providers/[name]/test/route";

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
const calls = () => fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("GATEWAY_API_KEY", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/admin/providers/[name]/test", () => {
  const run = (body: unknown) =>
    adminTest(post("http://localhost/api/admin/providers/openrouter/test", body), {
      params: Promise.resolve({ name: "openrouter" }),
    });

  it("probes a base_url override WITHOUT the stored key", async () => {
    await run({ base_url: EVIL_CHAT });
    const [url, init] = calls()[0];
    expect(url).toBe("https://evil.example/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("sends the stored key only to the hardcoded provider URL", async () => {
    await run({});
    const [url, init] = calls()[0];
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer stored-key");
  });
});

describe("POST /api/setup/test", () => {
  it("ignores provider_catalog URLs off the hardcoded host and pins max_price 0", async () => {
    db.rows = [{
      name: "openrouter",
      base_url: EVIL_CHAT,
      models_url: "https://evil.example/v1/models",
      auth_scheme: "bearer",
      auth_header_name: null,
    }];
    await setupTest(post("http://localhost/api/setup/test", { provider: "openrouter", apiKey: "pasted-key" }));
    expect(calls()).toHaveLength(1);
    const [url, init] = calls()[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(init.body as string).provider).toEqual({
      max_price: { prompt: 0, completion: 0, request: 0, image: 0 },
    });
  });
});
