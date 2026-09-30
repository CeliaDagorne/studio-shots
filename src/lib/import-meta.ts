import type {
  ActionableProductOption,
  CatalogWarning,
  ImportWarningsPayload,
} from "@/types";

const isCatalogWarning = (value: unknown): value is CatalogWarning => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.sku === "string" && typeof record.message === "string";
};

const isActionableProductOption = (value: unknown): value is ActionableProductOption => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.requestId === "string" &&
    typeof record.sku === "string" &&
    (record.priority === "high" || record.priority === "normal" || record.priority === "low")
  );
};

/** Normalize legacy warning arrays and the current payload shape. */
export const parseImportWarningsPayload = (raw: unknown): ImportWarningsPayload => {
  if (Array.isArray(raw)) {
    return {
      warnings: raw.filter(isCatalogWarning),
      actionable: [],
      catalogProducts: [],
    };
  }

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const warnings = Array.isArray(record.warnings)
      ? record.warnings.filter(isCatalogWarning)
      : [];
    const actionable = Array.isArray(record.actionable)
      ? record.actionable.filter(isActionableProductOption)
      : [];
    const catalogProducts = Array.isArray(record.catalogProducts)
      ? record.catalogProducts.filter(isActionableProductOption)
      : [];
    return { warnings, actionable, catalogProducts };
  }

  return { warnings: [], actionable: [], catalogProducts: [] };
};

export const serializeImportWarningsPayload = (
  warnings: CatalogWarning[],
  actionable: ActionableProductOption[],
  catalogProducts: ActionableProductOption[] = actionable,
): ImportWarningsPayload => ({
  warnings,
  actionable,
  catalogProducts,
});
