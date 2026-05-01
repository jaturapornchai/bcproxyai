import { describe, it, expect } from "vitest";
import { buildOpenAIStyleToolCallStreamChunks, extractRequestToolNames, repairJsonToolCallLeak, repairStreamedJsonToolCallLeak } from "@/lib/tool-call-repair";

const TOOLS = new Set(["brain_search", "send_email"]);

describe("extractRequestToolNames", () => {
  it("extracts names from OpenAI tool spec", () => {
    const body = {
      tools: [
        { type: "function", function: { name: "brain_search" } },
        { type: "function", function: { name: "send_email" } },
      ],
    };
    expect(extractRequestToolNames(body)).toEqual(new Set(["brain_search", "send_email"]));
  });

  it("falls back to bare name field", () => {
    const body = { tools: [{ name: "legacy_tool" }] };
    expect(extractRequestToolNames(body)).toEqual(new Set(["legacy_tool"]));
  });

  it("returns empty set when no tools", () => {
    expect(extractRequestToolNames({}).size).toBe(0);
    expect(extractRequestToolNames({ tools: [] }).size).toBe(0);
  });
});

describe("repairJsonToolCallLeak", () => {
  it("returns null when request had no tools (false-positive guard)", () => {
    const content = '{"name": "brain_search", "parameters": {"keyword": "x"}}';
    expect(repairJsonToolCallLeak(content, new Set())).toBeNull();
  });

  it("repairs Hermes-style {name, parameters} leak", () => {
    const content = '{"name": "brain_search", "parameters": {"keyword": "สาวตอฮา"}}';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].type).toBe("function");
    expect(result![0].function.name).toBe("brain_search");
    expect(JSON.parse(result![0].function.arguments)).toEqual({ keyword: "สาวตอฮา" });
    expect(result![0].id).toMatch(/^call_/);
  });

  it("repairs OpenAI-style {name, arguments} leak", () => {
    const content = '{"name": "send_email", "arguments": {"to": "x@y.z"}}';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe("send_email");
    expect(JSON.parse(result![0].function.arguments)).toEqual({ to: "x@y.z" });
  });

  it("repairs Qwen-style {name, args}", () => {
    const content = '{"name": "brain_search", "args": {"q": "test"}}';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(1);
    expect(JSON.parse(result![0].function.arguments)).toEqual({ q: "test" });
  });

  it("repairs older NousResearch {function, input}", () => {
    const content = '{"function": "brain_search", "input": {"q": "test"}}';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe("brain_search");
  });

  it("strips ```json code fence", () => {
    const content = '```json\n{"name": "brain_search", "parameters": {"keyword": "x"}}\n```';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe("brain_search");
  });

  it("strips ```tool_call fence", () => {
    const content = '```tool_call\n{"name": "send_email", "arguments": {"to": "a"}}\n```';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(1);
  });

  it("repairs array of multiple calls", () => {
    const content = '[{"name": "brain_search", "parameters": {"q": "1"}}, {"name": "send_email", "arguments": {"to": "x"}}]';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(2);
    expect(result![0].function.name).toBe("brain_search");
    expect(result![1].function.name).toBe("send_email");
  });

  it("rejects unknown tool names (anti-hallucination)", () => {
    const content = '{"name": "evil_hallucinated_tool", "parameters": {}}';
    expect(repairJsonToolCallLeak(content, TOOLS)).toBeNull();
  });

  it("rejects non-JSON content", () => {
    expect(repairJsonToolCallLeak("Hello, this is a normal response.", TOOLS)).toBeNull();
  });

  it("rejects empty content", () => {
    expect(repairJsonToolCallLeak("", TOOLS)).toBeNull();
    expect(repairJsonToolCallLeak("   ", TOOLS)).toBeNull();
  });

  it("rejects malformed JSON", () => {
    expect(repairJsonToolCallLeak('{"name": "brain_search", "parameters":', TOOLS)).toBeNull();
  });

  it("rejects valid JSON without tool-call shape", () => {
    expect(repairJsonToolCallLeak('{"answer": 42}', TOOLS)).toBeNull();
  });

  it("rejects JSON object with no name field", () => {
    expect(repairJsonToolCallLeak('{"parameters": {"x": 1}}', TOOLS)).toBeNull();
  });

  it("coerces string arguments through unchanged", () => {
    const content = '{"name": "brain_search", "arguments": "raw-string-args"}';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result![0].function.arguments).toBe("raw-string-args");
  });

  it("defaults arguments to {} when missing", () => {
    const content = '{"name": "brain_search"}';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result![0].function.arguments).toBe("{}");
  });

  it("filters out unknown tools from a mixed array", () => {
    const content = '[{"name": "brain_search", "parameters": {}}, {"name": "fake_tool", "parameters": {}}]';
    const result = repairJsonToolCallLeak(content, TOOLS);
    expect(result).toHaveLength(1);
    expect(result![0].function.name).toBe("brain_search");
  });
});

describe("repairStreamedJsonToolCallLeak", () => {
  const streamTools = new Set(["SendMessage"]);

  it("repairs thClaws streamed SendMessage JSON split across chunks", () => {
    const streamText = [
      'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"x","choices":[{"index":0,"delta":{"content":"{\\"type\\": \\"function\\", "},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"x","choices":[{"index":0,"delta":{"content":"\\"name\\": \\"SendMessage\\", \\"parameters\\": {\\"to\\": \\"*\\", \\"text\\": \\"สวัสดี\\"}}"},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const result = repairStreamedJsonToolCallLeak(streamText, streamTools);
    expect(result).not.toBeNull();
    expect(result!.source.id).toBe("chatcmpl_1");
    expect(result!.repaired).toHaveLength(1);
    expect(result!.repaired[0].function.name).toBe("SendMessage");
    expect(JSON.parse(result!.repaired[0].function.arguments)).toEqual({ to: "*", text: "สวัสดี" });
  });

  it("returns null for normal streamed content", () => {
    const streamText = 'data: {"choices":[{"delta":{"content":"สวัสดีครับ"},"finish_reason":null}]}\n\ndata: [DONE]\n\n';
    expect(repairStreamedJsonToolCallLeak(streamText, streamTools)).toBeNull();
  });

  it("returns null when the streamed tool name was not requested", () => {
    const streamText = 'data: {"choices":[{"delta":{"content":"{\\"name\\":\\"SendMessage\\",\\"parameters\\":{}}"},"finish_reason":null}]}\n\ndata: [DONE]\n\n';
    expect(repairStreamedJsonToolCallLeak(streamText, new Set(["OtherTool"]))).toBeNull();
  });
});

describe("buildOpenAIStyleToolCallStreamChunks", () => {
  it("emits OpenAI-style streaming tool-call deltas", () => {
    const chunks = buildOpenAIStyleToolCallStreamChunks([{
      id: "call_abc",
      type: "function",
      function: { name: "SendMessage", arguments: "{\"to\":\"*\",\"text\":\"hello\"}" },
    }], { id: "chatcmpl_1", created: 1, model: "x" });

    const events = chunks
      .filter(chunk => chunk.startsWith("data: {"))
      .map(chunk => JSON.parse(chunk.slice("data: ".length)));
    expect(events).toHaveLength(3);
    expect(events[0].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      id: "call_abc",
      type: "function",
      function: { name: "SendMessage", arguments: "" },
    });
    expect(events[1].choices[0].delta.tool_calls[0]).toEqual({
      index: 0,
      function: { arguments: "{\"to\":\"*\",\"text\":\"hello\"}" },
    });
    expect(events[2].choices[0].finish_reason).toBe("tool_calls");
    expect(chunks.at(-1)).toBe("data: [DONE]\n\n");
  });
});
