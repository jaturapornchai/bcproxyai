import { describe, it, expect } from "vitest";
import { compressMessages } from "../prompt-compress";

describe("compressMessages", () => {
  it("never leaves a tool message without its assistant tool_calls", () => {
    const big = "x".repeat(30000);
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: big },
      { role: "assistant", content: big },
      { role: "user", content: "run tools" },
      { role: "assistant", content: null, tool_calls: [{ id: "a" }, { id: "b" }] },
      { role: "tool", tool_call_id: "a", content: "r1" },
      { role: "tool", tool_call_id: "b", content: "r2" },
      { role: "assistant", content: "done" },
      { role: "user", content: "next" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "again" },
    ];
    const out = compressMessages(messages);
    expect(out.compressed).toBe(true);
    const nonSystem = out.messages.filter((m) => m.role !== "system");
    expect(nonSystem[0].role).not.toBe("tool");
    out.messages.forEach((m, i) => {
      if (m.role === "tool") {
        const prev = out.messages.slice(0, i).reverse().find((p) => p.role !== "tool") as { tool_calls?: unknown } | undefined;
        expect(prev?.tool_calls).toBeTruthy();
      }
    });
  });
});
