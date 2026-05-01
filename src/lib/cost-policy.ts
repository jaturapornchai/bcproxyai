const DEFAULT_FREE_PROVIDER_ALLOWLIST = ["ollama", "pollinations"];

function parseProviderList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Cost guard for every upstream call.
 *
 * Default policy is strict: only local/no-key providers are allowed. Many cloud
 * providers advertise a free tier, but accounts with billing enabled can still
 * consume paid quota after the free tier is exhausted. Add a provider to
 * SML_FREE_PROVIDER_ALLOWLIST only after the operator has verified it cannot
 * charge this deployment.
 */
export function getFreeProviderAllowlist(): Set<string> {
  const configured = parseProviderList(process.env.SML_FREE_PROVIDER_ALLOWLIST);
  if (configured.size > 0) return configured;
  return new Set(DEFAULT_FREE_PROVIDER_ALLOWLIST);
}

export function isPaidProviderOverrideEnabled(): boolean {
  return process.env.SML_ALLOW_PAID_PROVIDERS === "1";
}

export function isProviderCostAllowed(provider: string): boolean {
  const normalized = provider.toLowerCase();
  if (isPaidProviderOverrideEnabled()) return true;
  return getFreeProviderAllowlist().has(normalized);
}

export function getCostAllowedProviders(): string[] {
  return [...getFreeProviderAllowlist()];
}

export function costPolicyBlockMessage(provider: string): string {
  return `Provider '${provider}' is blocked by cost policy. Default allows only local/no-key providers (${getCostAllowedProviders().join(", ")}). Set SML_FREE_PROVIDER_ALLOWLIST or SML_ALLOW_PAID_PROVIDERS=1 to override.`;
}
