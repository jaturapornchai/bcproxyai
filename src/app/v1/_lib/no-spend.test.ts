import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { rejectPaidBodyKeys } from "@/app/v1/_lib/no-spend";

const db = vi.hoisted(() => ({
  rows: [{ id: "or-free", provider: "openrouter", model_id: "openai/gpt-oss-20b:free" }],
}));
vi.mock("@/lib/db/schema", () => ({ getSqlClient: () => async () => db.rows }));
vi.mock("@/lib/api-keys", () => ({ getNextApiKey: () => "test-key" }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAID_KEYS = ["models", "route", "preset", "provider", "plugins", "web_search_options", "web_search", "search"];

describe("rejectPaidBodyKeys", () => {
  it.each(PAID_KEYS)("rejects paid add-on key '%s' with 402", async (key) => {
    const res = rejectPaidBodyKeys({ model: "auto", messages: [], [key]: {} });
    expect(res?.status).toBe(402);
    expect((await res!.json()).error).toMatchObject({ code: "cost_policy_blocked", param: key });
  });

  it("lets standard chat bodies through", () => {
    expect(rejectPaidBodyKeys({ model: "auto", messages: [], temperature: 0, tools: [], stream: true })).toBeNull();
    expect(
      rejectPaidBodyKeys({
        model: "auto",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://x/y.png" } }] }],
        tools: [{ type: "function", function: { name: "f" } }],
        tool_choice: { type: "function", function: { name: "f" } },
      }),
    ).toBeNull();
  });

  it.each([
    ["tools", { tools: [{ type: "function", function: { name: "f" } }, { type: "openrouter:web_search" }] }],
    ["tools", { tools: [{ type: "browser_search" }] }],
    ["tool_choice", { tool_choice: { type: "openrouter:advisor" } }],
    ["messages", { messages: [{ role: "user", content: [{ type: "file", file: { filename: "a.pdf", file_data: "x" } }] }] }],
  ])("rejects paid add-ons inside '%s' with 402", async (param, extra) => {
    const res = rejectPaidBodyKeys({ model: "auto", messages: [], ...extra });
    expect(res?.status).toBe(402);
    expect((await res!.json()).error).toMatchObject({ code: "cost_policy_blocked", param });
  });
});

describe("POST /v1/completions no-spend", () => {
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/v1/completions/route");
    return POST(new NextRequest("http://localhost/v1/completions", { method: "POST", body: JSON.stringify(body) }));
  };

  it("rejects paid add-ons before any upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ prompt: "hi", models: ["anthropic/claude-sonnet-4.5"] });
    expect(res.status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins OpenRouter max_price to 0 on the upstream body", async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ text: "ok" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ prompt: "hi" });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("openrouter.ai");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/gpt-oss-20b:free",
      provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
    });
  });
});
