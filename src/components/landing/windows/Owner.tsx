"use client";

// 7 + 8. owner-only windows: how to connect, and a one-shot prompt box.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, LinkButton, Tabs } from "@/components/ui/ui";
import { IconCheck, IconCopy } from "@/components/ui/icons";
import { Empty, secs } from "./shared";
import type { WinCtx } from "./shared";

// ---------- 7. connect ----------

const BASE_URL = "https://bcairouter.bcaicloud.com/v1";
const KEY = "bcai_live_xxx";

const SNIPPETS = {
  curl: `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer ${KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto","messages":[{"role":"user","content":"สวัสดี"}]}'`,
  python: `from openai import OpenAI

client = OpenAI(base_url="${BASE_URL}", api_key="${KEY}")
r = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "สวัสดี"}],
)
print(r.choices[0].message.content)`,
  node: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${BASE_URL}", apiKey: "${KEY}" });
const r = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "สวัสดี" }],
});
console.log(r.choices[0].message.content);`,
};
type Lang = keyof typeof SNIPPETS;
const LANGS: Array<{ id: Lang; label: string }> = [
  { id: "curl", label: "curl" },
  { id: "python", label: "Python" },
  { id: "node", label: "Node" },
];

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { /* clipboard blocked */ }
  };
  return (
    <Button size="sm" onClick={copy} aria-label={label}>
      {done ? <IconCheck size={14} className="text-emerald-300" /> : <IconCopy size={14} />}
    </Button>
  );
}

export function ConnectWindow() {
  const [lang, setLang] = useState<Lang>("curl");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-gray-200">{BASE_URL}</code>
        <CopyBtn text={BASE_URL} label="คัดลอก Base URL" />
      </div>
      <Tabs tabs={LANGS} value={lang} onChange={setLang} />
      <div className="relative rounded-xl border border-white/10 bg-black/40">
        <pre className="overflow-x-auto p-3 pr-12 font-mono text-[11.5px] leading-relaxed text-gray-200"><code>{SNIPPETS[lang]}</code></pre>
        <div className="absolute right-1.5 top-1.5"><CopyBtn text={SNIPPETS[lang]} label="คัดลอกโค้ดตัวอย่าง" /></div>
      </div>
      <p className="text-[11.5px] text-[var(--muted)]">
        แทน <code className="font-mono text-gray-300">{KEY}</code> ด้วย API key จริง —{" "}
        <Link href="/admin/keys" className="font-medium text-violet-200 underline-offset-2 hover:underline">จัดการ API key →</Link>
      </p>
    </div>
  );
}

// ---------- 8. ask ----------

const FIELD =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-gray-100 placeholder:text-[var(--muted)] transition-colors focus:border-violet-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:opacity-50 [color-scheme:dark]";

const modelKey = (m: { provider: string; model: string }) => `${m.provider}/${m.model}`;
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>\s*/g, "");

// /api/chat has no "auto" — it needs an explicit provider + model, so the owner picks from the busiest models.
export function AskWindow({ ctx }: { ctx: WinCtx }) {
  const models = ctx.data.topModels ?? [];
  const [pick, setPick] = useState(""); // provider/model key: topModels re-sorts on every poll, an index would drift
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [meta, setMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { refresh } = ctx;

  useEffect(() => () => abortRef.current?.abort(), []);

  const model = models.find((m) => modelKey(m) === pick) ?? models[0];
  if (!model) {
    return (
      <div className="space-y-3">
        <Empty>ยังไม่มีสถิติโมเดลให้เลือก — ใช้หน้า Playground เลือกโมเดลเองได้</Empty>
        <LinkButton href="/playground" size="sm">เปิด Playground</LinkButton>
      </div>
    );
  }

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    const t0 = performance.now();
    setBusy(true);
    setError(null);
    setMeta(null);
    setAnswer("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({ modelId: model.model, provider: model.provider, messages: [{ role: "user", content: text }] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ? `HTTP ${res.status} — ${body.error.slice(0, 160)}` : `HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("ไม่มีข้อมูลตอบกลับ");
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setAnswer(stripThink(acc));
      }
      if (!stripThink(acc).trim()) throw new Error("โมเดลไม่ได้ตอบกลับ — ลองเลือกโมเดลอื่น");
      setMeta(`${model.provider} · ${model.model} · ${secs(Math.round(performance.now() - t0))}`);
      setTimeout(refresh, 1200); // ponytail: /api/chat doesn't write gateway_logs yet, so no comet — log it there if one is wanted
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="space-y-2.5">
      <select className={FIELD} value={modelKey(model)} onChange={(e) => setPick(e.target.value)} disabled={busy} aria-label="โมเดล">
        {models.map((m) => (
          <option key={modelKey(m)} value={modelKey(m)}>{m.provider} · {m.model}</option>
        ))}
      </select>
      <textarea
        className={`${FIELD} resize-none`}
        rows={3}
        value={prompt}
        placeholder="พิมพ์คำถาม แล้วกด Enter"
        aria-label="คำถาม"
        disabled={busy}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {busy ? (
          <Button size="sm" onClick={() => abortRef.current?.abort()}>หยุด</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void send()} disabled={!prompt.trim()}>ส่ง</Button>
        )}
        {meta && <span className="min-w-0 truncate text-[11px] text-[var(--muted)]">{meta}</span>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-rose-400/10 px-2.5 py-1.5 text-[12px] text-rose-200">{error}</p>}
      {(answer || busy) && (
        <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-gray-100" aria-live="polite">
          {answer || <span className="text-[var(--muted)]">กำลังรอคำตอบ…</span>}
        </div>
      )}
    </div>
  );
}
