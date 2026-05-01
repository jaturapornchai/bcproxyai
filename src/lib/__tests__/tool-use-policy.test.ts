import { describe, expect, it } from "vitest";
import { shouldSuppressToolsForSimpleChat } from "@/lib/tool-use-policy";

const THCLAWS_TOOLS = new Set(["SendMessage", "CheckInbox", "TeamCreate", "SpawnTeammate"]);

describe("shouldSuppressToolsForSimpleChat", () => {
  it("suppresses thClaws team tools for plain greetings", () => {
    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "hello" }],
      tool_choice: "auto",
    }, THCLAWS_TOOLS)).toBe(true);

    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "สวัสดี" }],
    }, THCLAWS_TOOLS)).toBe(true);

    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "สวัสดี" }],
      tool_choice: "auto",
    }, new Set(["AskUserQuestion"]))).toBe(true);
  });

  it("keeps tools for explicit teammate actions", () => {
    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "send this to agent1" }],
      tool_choice: "auto",
    }, THCLAWS_TOOLS)).toBe(false);

    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "สร้างทีมช่วยตรวจระบบ" }],
    }, THCLAWS_TOOLS)).toBe(false);
  });

  it("suppresses tools for thClaws team tool-result chatter", () => {
    for (const content of [
      "Message sent to 'lead'",
      "No new messages.",
      "<teammate_message from=\"logic\" summary=\"Waiting\">Waiting</teammate_message>",
      "error: tool error: missing or non-string field: pattern",
      "[1] InProgress — Implement business logic for UI components (owner: logic)",
      "## Agents\n- agent1: available",
      "{\"type\":\"idle_notification\",\"from\":\"flutter_ui\"}",
      "เสร็จแล้วจะรานงานเหรอ",
      "ถึงไหนแล้ว",
    ]) {
      expect(shouldSuppressToolsForSimpleChat({
        messages: [{ role: "user", content }],
        tool_choice: "auto",
      }, THCLAWS_TOOLS)).toBe(true);
    }
  });

  it("does not affect non-thClaws tool sets", () => {
    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "hello" }],
    }, new Set(["get_weather"]))).toBe(false);
  });

  it("honors required tool_choice", () => {
    expect(shouldSuppressToolsForSimpleChat({
      messages: [{ role: "user", content: "hello" }],
      tool_choice: { type: "function", function: { name: "SendMessage" } },
    }, THCLAWS_TOOLS)).toBe(false);
  });
});
