/**
 * Shared invalidation hook for the model-list cache used by /v1/chat/completions.
 *
 * The actual cache lives inside route.ts (closures), but health + scan need to
 * tell it "things changed, drop the cached rows". Module-level singleton keeps
 * the contract one-line: route.ts registers, workers fire it.
 */
type Invalidator = () => void;
let invalidator: Invalidator | null = null;

export function registerInvalidator(fn: Invalidator): void {
  invalidator = fn;
}

export function invalidateModelListCache(): void {
  invalidator?.();
}
