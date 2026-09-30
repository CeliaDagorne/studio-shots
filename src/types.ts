export type TelegramDocument = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
};

export type TelegramMessage = {
  message_id: number;
  chat: { id: number | string };
  text?: string;
  caption?: string;
  document?: TelegramDocument;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type CatalogPriority = "high" | "normal" | "low";

export type CatalogRow = {
  sku: string;
  productName: string;
  category: string;
  colorOrFinish: string;
  material: string;
  priceCents: number;
  photoUrl: string;
  shotIdea: string | null;
  notes: string | null;
  priority: CatalogPriority;
};

export type CatalogWarning = {
  sku: string;
  message: string;
};

/** Actionable shot request exposed in the chat product picker. */
export type ActionableProductOption = {
  requestId: string;
  sku: string;
  priority: CatalogPriority;
};

/**
 * JSON stored in `imports.warnings` (jsonb). Keeps catalog warnings plus the
 * ordered actionable picker list so we can show priority without a migration.
 * `catalogProducts` is the full ordered showcase list (including completed /
 * unchanged SKUs that are no longer actionable).
 */
export type ImportWarningsPayload = {
  warnings: CatalogWarning[];
  actionable: ActionableProductOption[];
  catalogProducts?: ActionableProductOption[];
};

export type RequestPlanSummary = {
  totalCatalogRows: number;
  rowsWithShotIdea: number;
  newRequests: number;
  changedRequests: number;
  unchangedExistingRequests: number;
  existingPendingRequests: number;
  requestsReadyToGenerate: number;
  plannedGenerations: number;
  additionalEstimatedCostMicrosUsd: number;
  warnings: CatalogWarning[];
  actionableProducts: ActionableProductOption[];
  priorityRequestSku: string | null;
  priorityRequestPriority: CatalogPriority | null;
  importId: string;
};

export type ImportResult = RequestPlanSummary & {
  alreadyProcessed?: boolean;
  previewMessageId?: string | null;
};
