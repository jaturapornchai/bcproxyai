/**
 * JSON tool-call leak detection & repair.
 *
 * Some upstream models (Hermes, Qwen, OpenClaw, NousResearch fine-tunes)
 * emit tool calls as raw JSON in `message.content` instead of populating
 * the OpenAI-standard `message.tool_calls` field. Downstream agents
 * (OpenClaw / Cline / Hermes / Claude harness) then can't dispatch them
 * and stall.
 *
 * This module detects those leaks and rewrites them into the OpenAI
 * `tool_calls` shape so any claw can consume the response uniformly.
 */

const CODE_FENCE_RE = /^\s*```(?:json|tool_call|function_call)?\s*\n?([\s\S]*?)\n?```\s*$/i;

export type RepairedToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type RepairedStreamToolCall = {
  repaired: RepairedToolCall[];
  source: Record<string, unknown>;
};

export type ToolCallStreamChunkOptions = {
  id: string;
  created: number;
  model: string;
};

export function extractRequestToolNames(body: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  const tools = body.tools;
  if (!Array.isArray(tools)) return names;
  for (const t of tools as Array<{ type?: string; function?: { name?: string }; name?: string }>) {
    const n = t?.function?.name ?? t?.name;
    if (typeof n === "string" && n) names.add(n);
  }
  return names;
}

function tcId(): string {
  return "call_" + Math.random().toString(36).slice(2, 11);
}

function coerceArgs(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "{}";
  try { return JSON.stringify(v); } catch { return "{}"; }
}

/**
 * Validate that every tool call's `arguments` is parseable JSON.
 *
 * Some upstream models emit tool calls with broken JSON (trailing commas,
 * unterminated strings, single quotes). Downstream agents fail silently
 * when JSON.parse throws. Returns true if every argument string parses,
 * false otherwise — caller can retry/fallback.
 */
export interface ToolCallLike {
  function?: { arguments?: string };
}

export function validateToolCallArguments(
  toolCalls: ReadonlyArray<ToolCallLike>,
): { ok: boolean; firstError?: { index: number; raw: string; reason: string } } {
  for (let i = 0; i < toolCalls.length; i++) {
    const raw = toolCalls[i]?.function?.arguments;
    // Empty arguments are allowed by OpenAI spec for zero-arg tools.
    if (raw == null || raw === "") continue;
    if (typeof raw !== "string") {
      return { ok: false, firstError: { index: i, raw: String(raw), reason: "arguments not a string" } };
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, firstError: { index: i, raw, reason: "arguments not a JSON object" } };
      }
    } catch (err) {
      return { ok: false, firstError: { index: i, raw, reason: `JSON.parse failed: ${(err as Error).message}` } };
    }
  }
  return { ok: true };
}

function objectToToolCall(obj: Record<string, unknown>, toolNames: Set<string>): RepairedToolCall | null {
  const name = obj.name ?? obj.tool ?? obj.function;
  const args = obj.parameters ?? obj.arguments ?? obj.args ?? obj.input;
  if (typeof name !== "string" || !name) return null;
  if (toolNames.size > 0 && !toolNames.has(name)) return null;
  return { id: tcId(), type: "function", function: { name, arguments: coerceArgs(args) } };
}

/**
 * Detect & repair JSON-style tool-call leaks.
 *
 * Returns repaired tool_calls if confidence is high, else null.
 *
 * False-positive guard: only repair when the request actually had `tools`
 * AND the emitted name matches one of the tool schemas the client sent.
 * This prevents legitimate JSON content (e.g., user asked for JSON output)
 * from being mistaken for a tool call.
 *
 * Accepted shapes (claws differ):
 *   {"name": "x", "parameters": {...}}        — Hermes / OpenClaw style
 *   {"name": "x", "arguments": {...}}         — OpenAI-ish leak
 *   {"name": "x", "args": {...}}              — some Qwen forks
 *   {"function": "x", "input": {...}}         — older NousResearch
 *   [ {...}, {...} ]                          — multi-call array
 *   ```json\n{...}\n```                       — code-fenced
 */
export function repairJsonToolCallLeak(content: string, toolNames: Set<string>): RepairedToolCall[] | null {
  if (toolNames.size === 0) return null;
  let s = content.trim();
  if (!s) return null;

  const fenceMatch = s.match(CODE_FENCE_RE);
  if (fenceMatch) s = fenceMatch[1].trim();
  if (s[0] !== "{" && s[0] !== "[") return null;

  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch { return null; }

  const calls: RepairedToolCall[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (item && typeof item === "object") {
        const tc = objectToToolCall(item as Record<string, unknown>, toolNames);
        if (tc) calls.push(tc);
      }
    }
  } else if (parsed && typeof parsed === "object") {
    const tc = objectToToolCall(parsed as Record<string, unknown>, toolNames);
    if (tc) calls.push(tc);
  }
  return calls.length > 0 ? calls : null;
}

function parseSseDataLines(streamText: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const blocks = streamText.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") events.push(parsed as Record<string, unknown>);
    } catch {
      return [];
    }
  }
  return events;
}

/**
 * Repair streaming JSON leaks after the upstream stream completes.
 *
 * This is deliberately scoped to real tool requests via `toolNames`.
 * If the stream contains normal text, malformed SSE, or a tool name that the
 * client did not request, it returns null so callers can replay the original
 * upstream bytes unchanged.
 */
export function repairStreamedJsonToolCallLeak(
  streamText: string,
  toolNames: Set<string>,
): RepairedStreamToolCall | null {
  if (toolNames.size === 0) return null;
  const events = parseSseDataLines(streamText);
  if (events.length === 0) return null;

  let content = "";
  let source: Record<string, unknown> | null = null;
  for (const event of events) {
    const choices = event.choices;
    if (!Array.isArray(choices)) continue;
    const first = choices[0] as { delta?: { content?: unknown; tool_calls?: unknown }; message?: { content?: unknown; tool_calls?: unknown } } | undefined;
    const delta = first?.delta;
    const message = first?.message;
    if (Array.isArray(delta?.tool_calls) || Array.isArray(message?.tool_calls)) return null;
    const part = delta?.content ?? message?.content;
    if (typeof part === "string") {
      content += part;
      source ??= event;
    }
  }

  const repaired = repairJsonToolCallLeak(content, toolNames);
  return repaired && source ? { repaired, source } : null;
}

export function buildOpenAIStyleToolCallStreamChunks(
  toolCalls: RepairedToolCall[],
  options: ToolCallStreamChunkOptions,
): string[] {
  const chunks: string[] = [];
  for (const [index, toolCall] of toolCalls.entries()) {
    chunks.push(`data: ${JSON.stringify({
      id: options.id,
      object: "chat.completion.chunk",
      created: options.created,
      model: options.model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.function.name,
              arguments: "",
            },
          }],
        },
        finish_reason: null,
      }],
    })}\n\n`);
    chunks.push(`data: ${JSON.stringify({
      id: options.id,
      object: "chat.completion.chunk",
      created: options.created,
      model: options.model,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            function: { arguments: toolCall.function.arguments },
          }],
        },
        finish_reason: null,
      }],
    })}\n\n`);
  }
  chunks.push(`data: ${JSON.stringify({
    id: options.id,
    object: "chat.completion.chunk",
    created: options.created,
    model: options.model,
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  return chunks;
}
