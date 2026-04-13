/**
 * Pattern B+: JSON repair + structurally broken tool_call detection + retry
 * 
 * Ported from BCProxyAI local (SQLite) to SML Gateway (async PostgreSQL).
 * Pure functions that can be used by the main route handler.
 */

import { jsonrepair } from "jsonrepair";

// ── JSON Repair for tool_call arguments ──

/**
 * Attempt to repair malformed JSON in tool_call arguments.
 * Returns true if any repair was made.
 */
export function repairToolCallArguments(json: Record<string, unknown>): boolean {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (!choices) return false;

  let repaired = false;

  for (const choice of choices) {
    const msg = choice.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const toolCalls = msg.tool_calls;
    if (!Array.isArray(toolCalls)) continue;

    for (const tc of toolCalls) {
      const fn = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined;
      if (!fn?.arguments || typeof fn.arguments !== "string") continue;

      try {
        // Try normal parse first
        JSON.parse(fn.arguments as string);
      } catch {
        // Parse failed — attempt repair
        try {
          const fixed = jsonrepair(fn.arguments as string);
          JSON.parse(fixed); // validate the repair
          console.log(`[ToolRepair] Fixed malformed arguments for ${fn.name}: ${(fn.arguments as string).length} → ${fixed.length} chars`);
          fn.arguments = fixed;
          repaired = true;
        } catch {
          console.log(`[ToolRepair] Could not repair arguments for ${fn.name}: ${(fn.arguments as string).slice(0, 100)}`);
        }
      }
    }
  }

  return repaired;
}

// ── Structural break detection ──

interface StructuralCheckResult {
  broken: boolean;
  reason: string;
}

/**
 * Check if tool_calls are structurally broken (needs retry, not just repair).
 * Structurally broken means: missing function.name, null arguments, or oversized arguments.
 */
export function hasStructurallyBrokenToolCalls(json: Record<string, unknown>): StructuralCheckResult {
  const choices = json.choices as Array<Record<string, unknown>> | undefined;
  if (!choices?.[0]) return { broken: false, reason: "" };
  const msg = (choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (!msg) return { broken: false, reason: "" };
  const toolCalls = msg.tool_calls;
  if (!toolCalls) return { broken: false, reason: "" };

  // tool_calls must be array
  if (!Array.isArray(toolCalls)) {
    return { broken: true, reason: "tool_calls is not an array" };
  }

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i] as Record<string, unknown>;
    const fn = tc.function as Record<string, unknown> | undefined;

    // Must have function.name
    if (!fn?.name || typeof fn.name !== "string" || (fn.name as string).trim() === "") {
      return { broken: true, reason: `tool_call[${i}] missing function.name` };
    }

    // Arguments too large → skip repair, needs retry
    const args = fn.arguments;
    if (typeof args === "string" && args.length > 100000) {
      return { broken: true, reason: `tool_call[${i}] arguments too large (${args.length} chars)` };
    }

    // Null/undefined arguments with valid name → broken
    if (args === null || args === undefined) {
      return { broken: true, reason: `tool_call[${i}] missing arguments` };
    }
  }

  return { broken: false, reason: "" };
}
