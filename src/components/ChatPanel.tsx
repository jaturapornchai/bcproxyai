"use client";

import { useEffect, useRef, useState } from "react";
import { PROVIDER_COLORS, fmtCtx, fmtMs } from "./shared";
import type { ModelData } from "./shared";
import { Badge, Button, Card } from "./ui/ui";
import { IconArrowRight, IconChat, IconSparkle } from "./ui/icons";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Filled when the reply finishes: who answered and how long it took. */
  meta?: { model: string; provider: string; ms: number };
}

const FIELD =
  "w-full rounded-xl border border-white/10 bg-black/30 text-[14px] text-gray-100 placeholder:text-[var(--muted)] transition-colors focus:border-violet-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:opacity-50 [color-scheme:dark]";

export function ChatPanel({
  availableModels,
  suggestions,
}: {
  availableModels: ModelData[];
  /** Optional starter prompts shown in the empty state; clicking fills the input. */
  suggestions?: string[];
}) {
  const [selectedModel, setSelectedModel] = useState<ModelData | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (availableModels.length > 0 && !selectedModel) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !selectedModel || isLoading) return;

    const model = selectedModel;
    const startedAt = performance.now();
    const userMsg: ChatMsg = { id: Date.now().toString(), role: "user", content: input.trim() };
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
    setIsLoading(true);
    setErrorMsg(null);

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          modelId: model.modelId,
          provider: model.provider,
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ? `HTTP ${res.status} — ${body.error.slice(0, 200)}` : `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        accumulated += text;
        // Strip <think>...</think> reasoning blocks
        const cleaned = accumulated.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: cleaned } : m
          )
        );
      }

      // Upstream can answer 200 with no tokens (e.g. provider without an API key) — say so instead of an empty bubble.
      if (!accumulated.replace(/<think>[\s\S]*?<\/think>/g, "").trim()) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        setErrorMsg(`${model.name} ไม่ได้ตอบกลับ — ลองเลือกโมเดลอื่น หรือตรวจว่าใส่ API key ของ ${model.provider} แล้วที่หน้า API key ผู้ให้บริการ`);
        return;
      }
      const meta = { model: model.name, provider: model.provider, ms: Math.round(performance.now() - startedAt) };
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, meta } : m)));
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg(String(err));
        setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
      abortRef.current = null;
    }
  };

  const provColor = PROVIDER_COLORS[selectedModel?.provider ?? ""] ?? { text: "text-gray-300" };

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* Header: model picker */}
      <div className="flex flex-col gap-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3.5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <select
            aria-label="เลือกโมเดล"
            value={selectedModel?.id ?? ""}
            onChange={(e) => {
              const m = availableModels.find((x) => x.id === e.target.value);
              setSelectedModel(m ?? null);
            }}
            className={`${FIELD} px-3 py-2.5`}
          >
            {availableModels.length === 0 && (
              <option value="">— ยังไม่มีโมเดลพร้อมใช้ —</option>
            )}
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
        </div>
        {selectedModel && (
          <div className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--muted)]">
            <Badge tone="success" dot>พร้อมใช้</Badge>
            <span className={provColor.text}>{selectedModel.provider}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{fmtCtx(selectedModel.contextLength)} ctx</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="h-[min(55vh,460px)] min-h-[280px] space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="animate-float grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-cyan-400/10 text-violet-200 ring-1 ring-white/10">
              <IconChat size={26} />
            </div>
            <div>
              <p className="text-[15px] font-medium text-white">เริ่มแชทกับ {selectedModel?.name ?? "โมเดล AI"}</p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">พิมพ์ข้อความด้านล่าง หรือเลือกตัวอย่างคำถามเพื่อเริ่มต้น</p>
            </div>
            {suggestions && suggestions.length > 0 && selectedModel && (
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12.5px] text-gray-200 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-400/40 hover:bg-violet-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                  >
                    <IconSparkle size={12} className="text-violet-300" />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`animate-pop flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed sm:max-w-[80%] ${
                m.role === "user"
                  ? "rounded-br-md bg-gradient-to-br from-violet-500/80 to-blue-500/70 text-white shadow-[0_8px_24px_-12px_rgba(123,107,255,0.8)]"
                  : "rounded-bl-md border border-white/10 bg-white/[0.045] text-gray-100"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.content || (isLoading && m.role === "assistant" ? (
                <span className="flex gap-1 py-1" role="status" aria-label="กำลังตอบ">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-violet-300 [animation-delay:300ms]" />
                </span>
              ) : "")}</div>
            </div>
            {m.meta && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-[var(--muted)]">
                <Badge tone="accent">{m.meta.model}</Badge>
                <span className={PROVIDER_COLORS[m.meta.provider]?.text ?? "text-gray-300"}>{m.meta.provider}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">ใช้เวลา {fmtMs(m.meta.ms)}</span>
              </div>
            )}
          </div>
        ))}
        {errorMsg && (
          <div role="alert" className="rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2 text-center text-[12.5px] text-rose-200">
            เกิดข้อผิดพลาด: {errorMsg}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="border-t border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            aria-label="ข้อความ"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!selectedModel}
            placeholder={isLoading ? "กำลังตอบ..." : selectedModel ? "ถามอะไรก็ได้..." : "เลือกโมเดลก่อน"}
            className={`${FIELD} flex-1 px-4 py-3`}
          />
          <Button
            type="submit"
            variant="primary"
            aria-label="ส่งข้อความ"
            disabled={isLoading || !input.trim() || !selectedModel}
          >
            <span className="hidden sm:inline">ส่ง</span>
            <IconArrowRight size={16} />
          </Button>
        </div>
      </form>
    </Card>
  );
}
