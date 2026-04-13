"use client";

import { useEffect, useRef, useState } from "react";
import { PROVIDER_COLORS, fmtCtx } from "./shared";
import type { ModelData } from "./shared";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel({ availableModels }: { availableModels: ModelData[] }) {
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !selectedModel || isLoading) return;

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
          modelId: selectedModel.modelId,
          provider: selectedModel.provider,
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
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
    <div className="flex flex-col glass rounded-2xl border border-indigo-500/20">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-gray-900/50">
        <div className="flex-1">
          <select
            value={selectedModel?.id ?? ""}
            onChange={(e) => {
              const m = availableModels.find((x) => x.id === e.target.value);
              setSelectedModel(m ?? null);
            }}
            className="w-full bg-gray-800/80 text-gray-100 text-sm rounded-lg px-3 py-2 border border-gray-700/60 focus:outline-none focus:border-indigo-500"
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
          <div className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
            <span className={provColor.text}>{selectedModel.provider}</span>
            <span>·</span>
            <span>{fmtCtx(selectedModel.contextLength)} ctx</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="h-16 w-16 rounded-full bg-indigo-500/10 flex items-center justify-center animate-float">
              <svg className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">เริ่มแชทกับ {selectedModel?.name ?? "โมเดล AI"}</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-indigo-600/70 text-white rounded-br-sm"
                  : "glass-bright text-gray-100 rounded-bl-sm"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.content || (isLoading && m.role === "assistant" ? (
                <span className="flex gap-1">
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              ) : "")}</div>
            </div>
          </div>
        ))}
        {errorMsg && (
          <div className="text-center text-red-400 text-xs py-2">เกิดข้อผิดพลาด: {errorMsg}</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-3 border-t border-white/5 bg-gray-900/50">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!selectedModel}
            placeholder={isLoading ? "กำลังตอบ..." : selectedModel ? "ถามอะไรก็ได้..." : "เลือกโมเดลก่อน"}
            className="flex-1 bg-gray-800/80 text-gray-100 text-sm rounded-xl px-4 py-3 border border-gray-700/60 focus:outline-none focus:border-indigo-500 placeholder-gray-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || !selectedModel}
            className="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
