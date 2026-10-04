import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  keys: [
    { provider: "openrouter", api_key: "or-key" },
    { provider: "groq", api_key: "groq-key" },
  ],
  toggles: [] as { provider: string; enabled: boolean }[],
  failToggles: false,
}));

vi.mock("@/lib/db/schema", () => ({
  getSqlClient: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM api_keys")) return db.keys;
    if (text.includes("FROM provider_settings")) {
      if (db.failToggles) throw new Error("db down");
      return db.toggles;
    }
    if (text.includes("INSERT INTO provider_settings")) {
      const [provider, enabled] = values as [string, boolean];
      db.toggles = [...db.toggles.filter((t) => t.provider !== provider), { provider, enabled }];
      return [];
    }
    return [];
  },
}));
vi.mock("@/lib/secret-vault", () => ({ open: (value: string) => value }));
vi.mock("@/lib/provider-resolver", () => ({ getAllProviderNames: () => ["openrouter", "groq"] }));

beforeEach(() => {
  vi.resetModules();
  db.toggles = [];
  db.failToggles = false;
});

describe("getNextApiKey provider toggle", () => {
  it("returns no key for a provider switched off in Setup", async () => {
    const { ensureApiKeysLoaded, getNextApiKey } = await import("@/lib/api-keys");
    const { setProviderEnabled } = await import("@/lib/provider-toggle");
    await ensureApiKeysLoaded();
    expect(getNextApiKey("groq")).toBe("groq-key");

    await setProviderEnabled("groq", false);
    expect(getNextApiKey("groq")).toBe("");
    expect(getNextApiKey("openrouter")).toBe("or-key");

    await setProviderEnabled("groq", true);
    expect(getNextApiKey("groq")).toBe("groq-key");
  });

  it("fails closed while toggles have never loaded", async () => {
    db.failToggles = true;
    const { ensureApiKeysLoaded, getNextApiKey } = await import("@/lib/api-keys");
    await ensureApiKeysLoaded();
    expect(getNextApiKey("openrouter")).toBe("");
  });

  it("keeps the last known toggles when a refresh fails", async () => {
    db.toggles = [{ provider: "groq", enabled: false }];
    const { ensureApiKeysLoaded, getNextApiKey } = await import("@/lib/api-keys");
    const { getAllProviderToggles } = await import("@/lib/provider-toggle");
    await ensureApiKeysLoaded();
    db.failToggles = true;
    await getAllProviderToggles();
    expect(getNextApiKey("groq")).toBe("");
    expect(getNextApiKey("openrouter")).toBe("or-key");
  });
});
