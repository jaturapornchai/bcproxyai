/**
 * OpenAI API compatibility helpers
 * Ensures all responses follow the official OpenAI API specification
 * Reference: https://platform.openai.com/docs/api-reference
 */

import { NextResponse } from "next/server";
import crypto from "crypto";

// Generate OpenAI-style chat completion ID: chatcmpl-<random>
export function generateChatId(): string {
  return `chatcmpl-${crypto.randomBytes(12).toString("base64url")}`;
}

// Generate system fingerprint
export function generateFingerprint(): string {
  return `fp_sml_${crypto.randomBytes(4).toString("hex")}`;
}

// Unix timestamp (seconds)
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * OpenAI standard error types:
 * - invalid_request_error (400, 401, 404, 422)
 * - rate_limit_exceeded (429)
 * - api_error (500, 503)
 */
type OpenAIErrorType = "invalid_request_error" | "rate_limit_exceeded" | "api_error";

interface OpenAIErrorOptions {
  message: string;
  type?: OpenAIErrorType;
  param?: string | null;
  code?: string | null;
}

// Map HTTP status to OpenAI error type
function statusToErrorType(status: number): OpenAIErrorType {
  if (status === 429) return "rate_limit_exceeded";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

// Map HTTP status to OpenAI error code
function statusToErrorCode(status: number): string | null {
  switch (status) {
    case 400: return "invalid_request";
    case 401: return "invalid_api_key";
    case 403: return "permission_denied";
    case 404: return "model_not_found";
    case 422: return "invalid_request";
    case 429: return "rate_limit_exceeded";
    case 500: return "server_error";
    case 503: return "server_overloaded";
    default: return null;
  }
}

/**
 * Return an OpenAI-standard error response
 * Format: { error: { message, type, param, code } }
 */
export function openAIError(status: number, opts: OpenAIErrorOptions | string) {
  const options: OpenAIErrorOptions =
    typeof opts === "string" ? { message: opts } : opts;

  return NextResponse.json(
    {
      error: {
        message: options.message,
        type: options.type ?? statusToErrorType(status),
        param: options.param ?? null,
        code: options.code ?? statusToErrorCode(status),
      },
    },
    { status }
  );
}

/**
 * Ensure a chat completion response has all required OpenAI fields
 * Adds missing id, object, created, system_fingerprint, usage
 */
export function ensureChatCompletionFields(
  json: Record<string, unknown>,
  _provider: string,
  modelId: string
): Record<string, unknown> {
  // id — must be chatcmpl-xxx format
  if (!json.id || typeof json.id !== "string") {
    json.id = generateChatId();
  }

  // object — must be "chat.completion"
  json.object = "chat.completion";

  // created — unix timestamp
  if (!json.created || typeof json.created !== "number") {
    json.created = unixNow();
  }

  // model — ensure it's set
  if (!json.model) {
    json.model = modelId;
  }

  // system_fingerprint
  if (!json.system_fingerprint) {
    json.system_fingerprint = generateFingerprint();
  }

  // usage — ensure all fields exist
  if (json.usage && typeof json.usage === "object") {
    const usage = json.usage as Record<string, unknown>;
    usage.prompt_tokens = usage.prompt_tokens ?? 0;
    usage.completion_tokens = usage.completion_tokens ?? 0;
    usage.total_tokens =
      (usage.prompt_tokens as number) + (usage.completion_tokens as number);
  } else {
    json.usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
  }

  // choices — ensure each choice has required fields
  if (Array.isArray(json.choices)) {
    for (let i = 0; i < json.choices.length; i++) {
      const choice = json.choices[i] as Record<string, unknown>;
      choice.index = choice.index ?? i;
      choice.finish_reason = choice.finish_reason ?? "stop";
      choice.logprobs = choice.logprobs ?? null;

      // message must have role and content
      if (choice.message && typeof choice.message === "object") {
        const msg = choice.message as Record<string, unknown>;
        msg.role = msg.role ?? "assistant";
        if (msg.content === undefined) msg.content = null;
        if (msg.refusal === undefined) msg.refusal = null;
      }
    }
  }

  return json;
}

/**
 * Standard OpenAI model object (GET /v1/models)
 * Only 4 fields: id, object, created, owned_by
 */
export function toOpenAIModelObject(
  id: string,
  ownedBy: string,
  created?: number
) {
  return {
    id,
    object: "model" as const,
    created: created ?? unixNow(),
    owned_by: ownedBy,
  };
}
