import { createHash } from "node:crypto";

import type { CatalogRow, CatalogWarning, RequestPlanSummary } from "@/types";

export const IMAGE_REF_COST_USD_MICROS = 43_400;
export const MVP_ASPECT_RATIO = "3:2";
export const CANDIDATES_PER_REQUEST = 3;

/** Workflow statuses that still need generation (not yet claimed, reviewed, or closed). */
export const ACTIONABLE_WORKFLOW_STATUSES = new Set(["imported_unconfirmed"]);

const normalizeForHash = (value: string | null) => (value ?? "").trim().toLowerCase();

export const computeRequestHash = (row: CatalogRow): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        sku: row.sku,
        shotIdea: normalizeForHash(row.shotIdea),
        notes: normalizeForHash(row.notes),
      }),
    )
    .digest("hex");

export const classifyRequestChange = (
  row: CatalogRow,
  priorRequests: Array<{ requestHash: string }>,
): "none" | "new" | "changed" => {
  if (!row.shotIdea) {
    return "none";
  }

  const requestHash = computeRequestHash(row);
  const exactExisting = priorRequests.some((request) => request.requestHash === requestHash);

  if (exactExisting) {
    return "none";
  }

  return priorRequests.length === 0 ? "new" : "changed";
};

export const isActionableWorkflowStatus = (status: string): boolean =>
  ACTIONABLE_WORKFLOW_STATUSES.has(status);

export const computePriorityScore = (row: CatalogRow): number => {
  const notes = row.notes?.toLowerCase() ?? "";
  let score = 0;
  if (notes.includes("do this one first")) score += 100;
  if (notes.includes("bestseller")) score += 50;
  if (notes.includes("top seller")) score += 40;
  if (notes.includes("q4")) score += 30;
  if (notes.includes("holiday")) score += 20;
  return score;
};

export const formatUsdMicros = (micros: number): string => {
  const dollars = Math.floor(micros / 1_000_000);
  const cents = Math.round((micros % 1_000_000) / 10_000);
  return `$${dollars}.${String(cents).padStart(2, "0")}`;
};

export const IMPORT_UP_TO_DATE_MESSAGE =
  "Everything is up to date — no pending shot requests to generate.";

export const hasActionableGenerations = (summary: RequestPlanSummary): boolean =>
  summary.requestsReadyToGenerate > 0;

export const buildImportPreviewText = (summary: RequestPlanSummary): string => {
  const warningLines =
    summary.warnings.length === 0
      ? ["- None"]
      : summary.warnings.slice(0, 6).map((warning) => `- ${warning.sku}: ${warning.message}`);

  const lines = [
    "Catalog import preview",
    "",
    `- Total catalog rows: ${summary.totalCatalogRows}`,
    `- Rows with a Shot Idea: ${summary.rowsWithShotIdea}`,
    `- New requests: ${summary.newRequests}`,
    `- Changed requests: ${summary.changedRequests}`,
    `- Unchanged existing requests: ${summary.unchangedExistingRequests}`,
    `- Existing pending requests: ${summary.existingPendingRequests}`,
    `- Requests ready to generate: ${summary.requestsReadyToGenerate}`,
    `- Planned generations: ${summary.plannedGenerations}`,
    `- Additional estimated cost: ${formatUsdMicros(summary.additionalEstimatedCostMicrosUsd)}`,
    `- Aspect ratio: ${MVP_ASPECT_RATIO}`,
    summary.priorityRequestSku ? `- Priority request: ${summary.priorityRequestSku}` : "- Priority request: none detected",
    "",
    "Catalog-level warnings:",
    ...warningLines,
  ];

  if (!hasActionableGenerations(summary)) {
    lines.push("", IMPORT_UP_TO_DATE_MESSAGE);
  }

  return lines.join("\n");
};

export const requestPlanFromCounts = (params: {
  totalCatalogRows: number;
  rowsWithShotIdea: number;
  newRequests: number;
  changedRequests: number;
  unchangedExistingRequests: number;
  existingPendingRequests: number;
  warnings: CatalogWarning[];
  priorityRequestSku: string | null;
  importId: string;
}): RequestPlanSummary => {
  const requestsReadyToGenerate =
    params.newRequests + params.changedRequests + params.existingPendingRequests;
  return {
    ...params,
    requestsReadyToGenerate,
    plannedGenerations: requestsReadyToGenerate * CANDIDATES_PER_REQUEST,
    additionalEstimatedCostMicrosUsd:
      requestsReadyToGenerate * CANDIDATES_PER_REQUEST * IMAGE_REF_COST_USD_MICROS,
  };
};
