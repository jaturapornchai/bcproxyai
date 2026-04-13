import { NextRequest } from "next/server";
import { getNextApiKey } from "@/lib/api-keys";
import { PROVIDER_URLS } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, provider, messages } = body as {
      modelId: string;
      provider: string;
      messages: Array<{ role: string; content: string }>;
    };

    if (!modelId || !provider || !messages?.length) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 });
    }

    const url = PROVIDER_URLS[provider];
    const apiKey = getNextApiKey(provider);
    if (!url) {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), { status: 400 });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://sml-gateway.app";
      headers["X-Title"] = "SMLGateway";
    }

    // Simple messages format — only role + content string
    const cleanMessages = messages.map(m => ({ role: m.role, content: m.content }));

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: cleanMessages,
        stream: true,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[chat] API error:", res.status, errText.slice(0, 300));
      return new Response(JSON.stringify({ error: `API ${res.status}: ${errText.slice(0, 200)}` }), { status: 502 });
    }

    // Forward SSE stream as plain text stream
    const reader = res.body?.getReader();
    if (!reader) {
      return new Response(JSON.stringify({ error: "No stream" }), { status: 502 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const json = JSON.parse(data);
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(new TextEncoder().encode(content));
                }
              } catch { /* skip */ }
            }
          }
        } catch (err) {
          console.error("[chat] stream error:", err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    console.error("[chat] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
