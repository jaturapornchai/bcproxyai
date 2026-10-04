import { applyNoSpendGuards } from "@/lib/cost-policy";
import { openAIError } from "@/lib/openai-compat";

/**
 * Clear 402 for client bodies carrying paid add-ons (models/route/preset/provider/plugins/web search,
 * server-side tools, file/document content parts). Any key applyNoSpendGuards removes or rewrites
 * (it keeps untouched keys by reference) is rejected, so this never drifts from the last-line guard
 * that every upstream fetch still runs.
 */
export function rejectPaidBodyKeys(body: Record<string, unknown>): Response | null {
  const guarded = applyNoSpendGuards("", body);
  const paidKey = Object.keys(body).find((key) => body[key] !== undefined && guarded[key] !== body[key]);
  if (!paidKey) return null;
  return openAIError(402, {
    message: `Paid add-on in '${paidKey}' is blocked in no-spend mode (only function tools and text/image content are allowed)`,
    code: "cost_policy_blocked",
    param: paidKey,
  });
}
