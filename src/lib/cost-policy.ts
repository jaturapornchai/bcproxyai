const DEFAULT_FREE_PROVIDER_ALLOWLIST = ["ollama", "pollinations"];
const DEFAULT_FREE_MODEL_ALLOWLIST = [
  "openrouter/*:free",
  "openrouter/openrouter/free",
];

function parseProviderList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseModelList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`, "i");
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

export function getFreeModelAllowlist(): string[] {
  const configured = parseModelList(process.env.SML_FREE_MODEL_ALLOWLIST);
  if (configured.length > 0) return configured;
  return [...DEFAULT_FREE_MODEL_ALLOWLIST];
}

export function isPaidProviderOverrideEnabled(): boolean {
  return process.env.SML_ALLOW_PAID_PROVIDERS === "1";
}

export function isProviderCostAllowed(provider: string): boolean {
  const normalized = provider.toLowerCase();
  if (isPaidProviderOverrideEnabled()) return true;
  if (getFreeProviderAllowlist().has(normalized)) return true;
  return getFreeModelAllowlist().some((rule) => rule.startsWith(`${normalized}/`));
}

export function isModelCostAllowed(provider: string, modelId: string | null | undefined): boolean {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = (modelId ?? "").toLowerCase();
  if (isPaidProviderOverrideEnabled()) return true;
  if (getFreeProviderAllowlist().has(normalizedProvider)) return true;
  if (!normalizedModel) return false;
  const fullName = `${normalizedProvider}/${normalizedModel}`;
  return getFreeModelAllowlist().some((rule) => globToRegExp(rule).test(fullName));
}

export function getCostAllowedProviders(): string[] {
  const providers = new Set(getFreeProviderAllowlist());
  for (const rule of getFreeModelAllowlist()) {
    const provider = rule.split("/", 1)[0];
    if (provider) providers.add(provider);
  }
  return [...providers];
}

export function costPolicyBlockMessage(provider: string, modelId?: string | null): string {
  const target = modelId ? `${provider}/${modelId}` : provider;
  return `Provider/model '${target}' is blocked by cost policy. Default allows only trusted free providers (${[...getFreeProviderAllowlist()].join(", ")}) and free model rules (${getFreeModelAllowlist().join(", ")}). Set SML_FREE_PROVIDER_ALLOWLIST/SML_FREE_MODEL_ALLOWLIST only after verifying zero billing, or SML_ALLOW_PAID_PROVIDERS=1 for paid deployments.`;
}
