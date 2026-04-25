import { NextRequest } from "next/server";
import { getNextApiKey } from "@/lib/api-keys";
import { resolveProviderUrl } from "@/lib/provider-resolver";

export const dynamic = "force-dynamic";

// Hoisted so we don't allocate a TextEncoder per chunk in the hot path.
const ENCODER = new TextEncoder();

export async function POST(req: NextRequest) {
  // Propagate client disconnect → upstream so we stop billing tokens the moment
  // the browser tab closes. Without this, the upstream LLM keeps generating
  // (sometimes seconds of paid output) after the user is already gone.
  const upstreamCtrl = new AbortController();
  const onClientAbort = () => upstreamCtrl.abort();
  req.signal.addEventListener("abort", onClientAbort, { once: true });

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

    const url = resolveProviderUrl(provider);
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
      signal: upstreamCtrl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[chat] API error:", res.status, errText.slice(0, 300));
      req.signal.removeEventListener("abort", onClientAbort);
      return new Response(JSON.stringify({ error: `API ${res.status}: ${errText.slice(0, 200)}` }), { status: 502 });
    }

    const reader = res.body?.getReader();
    if (!reader) {
      req.signal.removeEventListener("abort", onClientAbort);
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
                  controller.enqueue(ENCODER.encode(content));
                }
              } catch { /* skip */ }
            }
          }
        } catch (err) {
          // AbortError on client disconnect is expected — don't log as error
          if ((err as { name?: string })?.name !== "AbortError") {
            console.error("[chat] stream error:", err);
          }
        } finally {
          try { reader.releaseLock(); } catch { /* ignore */ }
          controller.close();
        }
      },
      cancel(reason) {
        // Browser closed the response stream → cancel upstream too
        upstreamCtrl.abort(reason);
        try { reader.cancel(reason); } catch { /* ignore */ }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    req.signal.removeEventListener("abort", onClientAbort);
    if ((err as { name?: string })?.name === "AbortError") {
      return new Response(JSON.stringify({ error: "client aborted" }), { status: 499 });
    }
    console.error("[chat] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
