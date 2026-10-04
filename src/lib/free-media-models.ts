/**
 * Hardcoded $0 allowlists for non-chat endpoints (embeddings, audio). Verified 2026-10-04:
 * - openrouter: https://openrouter.ai/api/v1/embeddings/models — only entries whose pricing is all "0"
 * - mistral: Studio free mode; cohere: trial key; nvidia: Developer Program free NIM endpoints
 * - groq: console.groq.com/docs/{speech-to-text,text-to-speech,rate-limits} — all listed on the Free plan;
 *   whisper-large-v3-turbo has no translation support
 * First entry of each list = default when the client sends no model / "auto".
 */
export const FREE_EMBEDDING_MODELS: Record<string, readonly string[]> = {
  mistral: ["mistral-embed"],
  cohere: ["embed-multilingual-v3.0"],
  nvidia: ["nvidia/nv-embedqa-e5-v5"],
  openrouter: [
    "nvidia/nemotron-3-embed-1b:free",
    "nvidia/llama-nemotron-embed-vl-1b-v2:free",
    "liquid/lfm-2.5-embedding-350m:free",
  ],
};

export const GROQ_TRANSCRIPTION_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"] as const;
export const GROQ_TRANSLATION_MODELS = ["whisper-large-v3"] as const;
export const GROQ_TTS_MODELS = ["canopylabs/orpheus-v1-english", "canopylabs/orpheus-arabic-saudi"] as const;

export function isAutoModel(model: unknown): boolean {
  return model == null || model === "" || model === "auto" || model === "bcai/auto";
}

/** Missing/auto → default (first entry); allowlisted string → itself; anything else → null (caller answers 402). */
export function pickAllowedModel(requested: unknown, allowed: readonly string[]): string | null {
  if (isAutoModel(requested)) return allowed[0] ?? null;
  return typeof requested === "string" && allowed.includes(requested) ? requested : null;
}

/** True when some provider serves this explicit embedding model for free. */
export function isFreeEmbeddingModel(model: unknown): boolean {
  return typeof model === "string" && Object.values(FREE_EMBEDDING_MODELS).some((list) => list.includes(model));
}
