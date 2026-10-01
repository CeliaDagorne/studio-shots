import type { ActionableProductOption } from "@/types";

import { selectHighestPrioritySku } from "@/lib/request-planning";
import { WORKFLOW } from "@/lib/review";

export type ShotRequestSelectionSnapshot = {
  id: string;
  productSku: string;
  workflowStatus: string;
};

export type ProductSelectionResult =
  | { ok: true; option: ActionableProductOption }
  | { ok: false; reason: "not_in_import" | "unavailable" | "mismatch" };

/**
 * Keep picker options that are still `imported_unconfirmed` in live DB state.
 * Non-actionable products must not remain selectable.
 */
export const filterActionableOptionsByStatus = (
  options: ActionableProductOption[],
  requestsById: Map<string, ShotRequestSelectionSnapshot>,
): ActionableProductOption[] =>
  options.filter((option) => {
    const request = requestsById.get(option.requestId);
    return Boolean(
      request &&
        request.productSku === option.sku &&
        request.workflowStatus === WORKFLOW.importedUnconfirmed,
    );
  });

/**
 * Pick the next product to generate using shared priority ordering.
 * Ties keep the first matching option in the given (catalog) order.
 */
export const selectNextActionableProduct = (
  options: ActionableProductOption[],
): ActionableProductOption | null => {
  if (options.length === 0) {
    return null;
  }
  const best = selectHighestPrioritySku(options);
  if (!best) {
    return null;
  }
  return options.find((option) => option.sku === best.sku) ?? null;
};

/**
 * Validate a gen callback against the import's actionable list and
 * the live shot-request row.
 */
export const evaluateProductSelection = (params: {
  actionable: ActionableProductOption[];
  requestId: string;
  request: ShotRequestSelectionSnapshot | null;
}): ProductSelectionResult => {
  const option = params.actionable.find((entry) => entry.requestId === params.requestId);
  if (!option) {
    return { ok: false, reason: "not_in_import" };
  }

  if (
    !params.request ||
    params.request.workflowStatus !== WORKFLOW.importedUnconfirmed
  ) {
    return { ok: false, reason: "unavailable" };
  }

  if (
    params.request.id !== option.requestId ||
    params.request.productSku !== option.sku
  ) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true, option };
};

export const selectionErrorMessage = (
  reason: Exclude<ProductSelectionResult, { ok: true }>["reason"],
): string => {
  switch (reason) {
    case "not_in_import":
      return "That product is not part of this import selection.";
    case "unavailable":
      return "That product is no longer available to generate.";
    case "mismatch":
      return "Request does not match this import.";
  }
};
