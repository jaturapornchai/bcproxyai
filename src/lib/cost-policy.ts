import {
  getHardcodedFreeModelRules,
  getHardcodedFreeProviders,
  isHardcodedFreeModel,
} from "@/lib/free-model-catalog";

/**
 * Cost guard for every upstream call. This deployment intentionally ignores
 * runtime allowlist env vars and allows only the hardcoded zero-price remote
 * model catalog. Local Ollama and provider-wide free lists are blocked.
 */
export function getFreeProviderAllowlist(): Set<string> {
  return new Set();
}

export function getFreeModelAllowlist(): string[] {
  return getHardcodedFreeModelRules();
}

export function isPaidProviderOverrideEnabled(): boolean {
  return false;
}

export function isProviderCostAllowed(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return getHardcodedFreeProviders().includes(normalized);
}

export function isModelCostAllowed(provider: string, modelId: string | null | undefined): boolean {
  return isHardcodedFreeModel(provider.toLowerCase(), modelId);
}

export function getCostAllowedProviders(): string[] {
  return getHardcodedFreeProviders();
}

export function costPolicyBlockMessage(provider: string, modelId?: string | null): string {
  const target = modelId ? `${provider}/${modelId}` : provider;
  return `Provider/model '${target}' is blocked by cost policy. This gateway allows only hardcoded remote free models (${getFreeModelAllowlist().join(", ")}). Local models, provider-wide allowlists, router aliases, and paid overrides are disabled.`;
}
