import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  FREE_EMBEDDING_MODELS,
  GROQ_TRANSCRIPTION_MODELS,
  GROQ_TRANSLATION_MODELS,
  GROQ_TTS_MODELS,
  isFreeEmbeddingModel,
  pickAllowedModel,
} from "@/lib/free-media-models";
import { isLocalEmbedTarget } from "@/lib/semantic-cache";

vi.mock("@/lib/api-keys", () => ({
  ensureApiKeysLoaded: async () => {},
  getNextApiKey: (p: string) => (p === "openrouter" || p === "groq" ? "test-key" : ""),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("free embedding allowlist", () => {
  it("lists only providers with a verified $0 model", () => {
    for (const p of ["together", "huggingface", "ollama", "google"]) expect(FREE_EMBEDDING_MODELS[p]).toBeUndefined();
    for (const m of FREE_EMBEDDING_MODELS.openrouter) expect(m).toMatch(/:free$/);
  });

  it("rejects paid / unknown explicit models", () => {
    expect(isFreeEmbeddingModel("nvidia/nemotron-3-embed-1b:free")).toBe(true);
    expect(isFreeEmbeddingModel("openai/text-embedding-3-small")).toBe(false);
    expect(isFreeEmbeddingModel("gemini-embedding-001")).toBe(false);
    expect(isFreeEmbeddingModel("gemini-embedding-2")).toBe(false); // Google AI Studio is banned
    expect(isFreeEmbeddingModel(["mistral-embed"])).toBe(false);
  });

  it("picks per provider: default for auto, exact match only, else null", () => {
    expect(pickAllowedModel(undefined, FREE_EMBEDDING_MODELS.openrouter)).toBe("nvidia/nemotron-3-embed-1b:free");
    expect(pickAllowedModel("bcai/auto", FREE_EMBEDDING_MODELS.cohere)).toBe("embed-multilingual-v3.0");
    expect(pickAllowedModel("mistral-embed", FREE_EMBEDDING_MODELS.mistral)).toBe("mistral-embed");
    expect(pickAllowedModel("mistral-embed", FREE_EMBEDDING_MODELS.openrouter)).toBeNull();
    expect(pickAllowedModel("Mistral-Embed", FREE_EMBEDDING_MODELS.mistral)).toBeNull();
  });
});

describe("groq audio allowlists", () => {
  it("whisper: default when missing, allowlisted passes, anything else null", () => {
    expect(pickAllowedModel(null, GROQ_TRANSCRIPTION_MODELS)).toBe("whisper-large-v3-turbo");
    expect(pickAllowedModel("whisper-large-v3", GROQ_TRANSCRIPTION_MODELS)).toBe("whisper-large-v3");
    expect(pickAllowedModel("whisper-1", GROQ_TRANSCRIPTION_MODELS)).toBeNull();
    expect(pickAllowedModel(new Blob(["x"]), GROQ_TRANSCRIPTION_MODELS)).toBeNull();
    expect(pickAllowedModel(null, GROQ_TRANSLATION_MODELS)).toBe("whisper-large-v3");
    expect(pickAllowedModel("whisper-large-v3-turbo", GROQ_TRANSLATION_MODELS)).toBeNull();
  });

  it("tts: only hardcoded Orpheus ids pass", () => {
    expect(pickAllowedModel("canopylabs/orpheus-arabic-saudi", GROQ_TTS_MODELS)).toBe("canopylabs/orpheus-arabic-saudi");
    expect(pickAllowedModel("openai/gpt-4o-mini-tts", GROQ_TTS_MODELS)).toBeNull();
    expect(pickAllowedModel("canopylabs/orpheus-v2-paid", GROQ_TTS_MODELS)).toBeNull();
  });
});

describe("semantic cache embed target", () => {
  it("allows only local/private Ollama without credentials or cloud models", () => {
    expect(isLocalEmbedTarget("http://host.docker.internal:11434/api/embeddings", "nomic-embed-text")).toBe(true);
    expect(isLocalEmbedTarget("http://localhost:11434/api/embeddings", "nomic-embed-text")).toBe(true);
    expect(isLocalEmbedTarget("http://ollama:11434/api/embeddings", "nomic-embed-text")).toBe(true);
    expect(isLocalEmbedTarget("http://[::1]:11434/api/embeddings", "nomic-embed-text")).toBe(true);
    expect(isLocalEmbedTarget("http://192.168.1.5:11434/api/embeddings", "nomic-embed-text")).toBe(true);
    expect(isLocalEmbedTarget("https://ollama.com/api/embeddings", "nomic-embed-text")).toBe(false);
    expect(isLocalEmbedTarget("http://127.0.0.1.evil.com/api/embeddings", "nomic-embed-text")).toBe(false);
    expect(isLocalEmbedTarget("http://localhost:11434/api/embeddings?key=x", "nomic-embed-text")).toBe(false);
    expect(isLocalEmbedTarget("http://u:p@localhost:11434/api/embeddings", "nomic-embed-text")).toBe(false);
    expect(isLocalEmbedTarget("http://[2001:db8::1]:11434/api/embeddings", "nomic-embed-text")).toBe(false);
    expect(isLocalEmbedTarget("http://localhost:11434/api/embeddings", "qwen3-embedding:8b-cloud")).toBe(false);
    expect(isLocalEmbedTarget("not a url", "nomic-embed-text")).toBe(false);
  });
});

describe("/v1/embeddings route", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/v1/embeddings/route");
    return POST(new NextRequest("http://x/v1/embeddings", { method: "POST", body: JSON.stringify(body) }));
  };

  it("402s a paid model without calling upstream", async () => {
    const fetchMock = stubFetch({});
    const res = await post({ model: "openai/text-embedding-3-small", input: "hi" });
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("cost_policy_blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto → free OpenRouter model with a $0 max_price ceiling", async () => {
    const fetchMock = stubFetch({ data: [{ embedding: [0.1] }] });
    const res = await post({ input: "hi", provider: { order: ["openai"] }, models: ["openai/text-embedding-3-large"] });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    const sent = JSON.parse(String(init.body));
    expect(sent.model).toBe("nvidia/nemotron-3-embed-1b:free");
    expect(sent.models).toBeUndefined();
    expect(sent.provider).toEqual({ max_price: { prompt: 0, completion: 0, request: 0, image: 0 } });
  });
});

describe("/v1/audio routes", () => {
  const form = (models: string[]) => {
    const fd = new FormData();
    fd.set("file", new Blob(["x"]), "a.wav");
    for (const m of models) fd.append("model", m);
    return fd;
  };

  it("transcriptions 402s a non-allowlisted model", async () => {
    const fetchMock = stubFetch({});
    const { POST } = await import("@/app/v1/audio/transcriptions/route");
    const res = await POST(new NextRequest("http://x/v1/audio/transcriptions", { method: "POST", body: form(["whisper-1"]) }));
    expect(res.status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("transcriptions forwards exactly one allowlisted model (duplicates dropped)", async () => {
    const fetchMock = stubFetch({ text: "ok" });
    const { POST } = await import("@/app/v1/audio/transcriptions/route");
    const res = await POST(new NextRequest("http://x/v1/audio/transcriptions", {
      method: "POST",
      body: form(["whisper-large-v3", "some-paid-model"]),
    }));
    expect(res.status).toBe(200);
    const sent = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(sent.getAll("model")).toEqual(["whisper-large-v3"]);
  });

  it("translations defaults to whisper-large-v3 and 402s turbo", async () => {
    const fetchMock = stubFetch({ text: "ok" });
    const { POST } = await import("@/app/v1/audio/translations/route");
    const ok = await POST(new NextRequest("http://x/v1/audio/translations", { method: "POST", body: form([]) }));
    expect(ok.status).toBe(200);
    expect(((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData).get("model")).toBe("whisper-large-v3");
    const bad = await POST(new NextRequest("http://x/v1/audio/translations", { method: "POST", body: form(["whisper-large-v3-turbo"]) }));
    expect(bad.status).toBe(402);
  });

  it("speech never forwards a non-allowlisted model id", async () => {
    const fetchMock = vi.fn(async () => new Response(new ArrayBuffer(1), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/v1/audio/speech/route");
    const res = await POST(new NextRequest("http://x/v1/audio/speech", {
      method: "POST",
      body: JSON.stringify({ input: "hello", model: "openai/gpt-4o-mini-tts" }),
    }));
    expect(res.status).toBe(200);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.model).toBe("canopylabs/orpheus-v1-english");
  });
});
